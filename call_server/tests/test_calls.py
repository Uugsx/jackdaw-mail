import base64
import hashlib
import hmac
import json
import sqlite3
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import calls  # noqa: E402


LICENSE_KEY = "JACKDAW-PRO-AAAA-BBBB-CCCC-DDDD"
OTHER_KEY = "JACKDAW-PRO-EEEE-FFFF-GGGG-HHHH"
LIVEKIT_SECRET = "s" * 40


def iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


class FakeScheduler:
    def __init__(self):
        self.pending = []

    def call_later(self, delay, callback):
        handle = {"delay": delay, "callback": callback, "cancelled": False}
        self.pending.append(handle)
        return handle

    @staticmethod
    def cancel(handle):
        handle["cancelled"] = True

    def fire(self, delay):
        for handle in list(self.pending):
            if handle["delay"] == delay and not handle["cancelled"]:
                handle["cancelled"] = True
                handle["callback"]()


class Clock:
    def __init__(self):
        self.value = 1000.0

    def __call__(self):
        return self.value


def create_database(path: Path) -> None:
    connection = sqlite3.connect(path)
    connection.executescript(
        """
        CREATE TABLE licenses (
            id INTEGER PRIMARY KEY AUTOINCREMENT, key_hash TEXT NOT NULL UNIQUE, plan TEXT NOT NULL,
            status TEXT NOT NULL, expires_at TEXT, grace_until TEXT
        );
        CREATE TABLE activations (
            license_id INTEGER NOT NULL, device_hash TEXT NOT NULL, deactivated_at TEXT,
            PRIMARY KEY (license_id, device_hash)
        );
        CREATE TABLE trial_claims (
            id INTEGER PRIMARY KEY AUTOINCREMENT, device_hash TEXT NOT NULL UNIQUE,
            status TEXT NOT NULL, expires_at TEXT NOT NULL
        );
        """
    )
    future = iso(datetime.now(timezone.utc) + timedelta(days=30))
    past = iso(datetime.now(timezone.utc) - timedelta(days=1))
    rows = [
        (calls.sha256_hex(LICENSE_KEY), "yearly", "active", future, None),
        (calls.sha256_hex(OTHER_KEY), "yearly", "revoked", future, None),
    ]
    connection.executemany("INSERT INTO licenses (key_hash, plan, status, expires_at, grace_until) VALUES (?, ?, ?, ?, ?)", rows)
    for device in ("device-alice-1", "device-alice-2", "device-bob-0001", "device-carol-01"):
        connection.execute("INSERT INTO activations (license_id, device_hash, deactivated_at) VALUES (1, ?, NULL)", (calls.sha256_hex(device),))
    connection.execute("INSERT INTO activations (license_id, device_hash, deactivated_at) VALUES (1, ?, ?)", (calls.sha256_hex("device-gone-001"), past))
    connection.execute("INSERT INTO trial_claims (device_hash, status, expires_at) VALUES (?, 'active', ?)", (calls.sha256_hex("device-trial-01"), future))
    connection.execute("INSERT INTO trial_claims (device_hash, status, expires_at) VALUES (?, 'active', ?)", (calls.sha256_hex("device-trial-old"), past))
    connection.commit()
    connection.close()


class HubTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tmp.name) / "license.sqlite3"
        create_database(self.db_path)
        self.scheduler = FakeScheduler()
        self.clock = Clock()
        self.mail_outbox = []
        self.signer = calls.EmailProofSigner(b"p" * 32)
        self.livekit = calls.LiveKitTokenIssuer("wss://calls.example.test", "APIkey", LIVEKIT_SECRET)
        mailer = calls.Mailer("smtp.example.test", 587, "", "", "noreply@example.test")

        def send_mail(email, code, done):
            self.mail_outbox.append((email, code))
            done(None)

        self.hub = calls.CallHub(
            calls.CredentialVerifier(self.db_path),
            calls.EmailVerification(self.signer, clock=self.clock),
            self.livekit,
            mailer,
            scheduler=self.scheduler,
            clock=self.clock,
            send_mail=send_mail,
        )

    def tearDown(self):
        self.tmp.cleanup()

    def connect(self, device="device-alice-1", emails=(), name="", kind="license", key=LICENSE_KEY):
        inbox = []
        closed = []
        peer = calls.Peer(inbox.append, lambda: closed.append(True))
        peer.inbox = inbox
        peer.closed = closed
        self.hub.connected(peer)
        credential = {"kind": kind, "deviceId": device}
        if kind == "license":
            credential["licenseKey"] = key
        subject = "license:1" if kind == "license" else f"trial:{calls.sha256_hex(device)}"
        proofs = [self.signer.issue(email, subject) for email in emails]
        self.hub.handle(peer, {"type": "hello", "credential": credential, "emailProofs": proofs, "name": name})
        return peer

    @staticmethod
    def last(peer, message_type=None):
        messages = [m for m in peer.inbox if message_type is None or m["type"] == message_type]
        return messages[-1] if messages else None


class CredentialTests(HubTestCase):
    def test_active_license_device_is_accepted(self):
        peer = self.connect(emails=["alice@example.com"])
        self.assertEqual(self.last(peer, "welcome")["emails"], ["alice@example.com"])

    def test_revoked_license_is_rejected(self):
        peer = self.connect(key=OTHER_KEY)
        self.assertEqual(self.last(peer)["code"], "license_inactive")
        self.assertIsNone(peer.credential)

    def test_deactivated_device_is_rejected(self):
        peer = self.connect(device="device-gone-001")
        self.assertEqual(self.last(peer)["code"], "device_not_activated")

    def test_active_trial_is_accepted_and_expired_trial_is_rejected(self):
        trial = self.connect(device="device-trial-01", kind="trial", emails=["t@example.com"])
        self.assertEqual(self.last(trial, "welcome")["emails"], ["t@example.com"])
        old = self.connect(device="device-trial-old", kind="trial")
        self.assertEqual(self.last(old)["code"], "license_inactive")

    def test_requests_before_hello_are_rejected(self):
        peer = calls.Peer(lambda m: setattr(peer, "msg", m))
        self.hub.handle(peer, {"type": "lookup", "emails": []})
        self.assertEqual(peer.msg["code"], "not_authenticated")

    def test_license_db_is_never_written(self):
        verifier = calls.CredentialVerifier(self.db_path)
        connection = verifier._connect()
        try:
            with self.assertRaises(sqlite3.OperationalError):
                connection.execute("DELETE FROM licenses")
        finally:
            connection.close()

    def test_revoked_license_disconnects_on_recheck(self):
        peer = self.connect(emails=["alice@example.com"])
        connection = sqlite3.connect(self.db_path)
        connection.execute("UPDATE licenses SET status = 'revoked' WHERE id = 1")
        connection.commit()
        connection.close()
        self.clock.value += calls.CREDENTIAL_RECHECK_SECONDS + 1
        self.hub.handle(peer, {"type": "lookup", "emails": ["bob@example.com"]})
        self.assertEqual(peer.closed, [True])
        self.assertNotIn("alice@example.com", self.hub.peers_by_email)


class EmailProofTests(HubTestCase):
    def test_proof_is_bound_to_subject(self):
        proof = self.signer.issue("a@example.com", "license:1")
        self.assertEqual(self.signer.verify(proof, "license:1"), "a@example.com")
        self.assertIsNone(self.signer.verify(proof, "license:2"))

    def test_tampered_or_expired_proof_is_rejected(self):
        proof = self.signer.issue("a@example.com", "license:1", now=0)
        self.assertIsNone(self.signer.verify(proof, "license:1"))
        fresh = self.signer.issue("a@example.com", "license:1")
        prefix, body, signature = fresh.split(".")
        forged_body = calls.base64url_encode(json.dumps({"email": "boss@example.com", "sub": "license:1", "exp": 2**40}).encode())
        self.assertIsNone(self.signer.verify(f"{prefix}.{forged_body}.{signature}", "license:1"))
        self.assertIsNone(self.signer.verify("garbage", "license:1"))

    def test_hello_ignores_foreign_proofs(self):
        foreign = self.signer.issue("boss@example.com", "license:99")
        peer = calls.Peer(lambda m: peer.inbox.append(m))
        peer.inbox = []
        self.hub.handle(peer, {"type": "hello", "credential": {"kind": "license", "deviceId": "device-alice-1", "licenseKey": LICENSE_KEY}, "emailProofs": [foreign]})
        self.assertEqual(self.last(peer, "welcome")["emails"], [])

    def test_verification_flow_registers_email(self):
        peer = self.connect()
        self.hub.handle(peer, {"type": "verify-start", "email": " Alice@Example.com "})
        self.assertEqual(self.last(peer)["type"], "verify-sent")
        email, code = self.mail_outbox[-1]
        self.assertEqual(email, "alice@example.com")
        self.hub.handle(peer, {"type": "verify-finish", "email": "alice@example.com", "code": "000000" if code != "000000" else "111111"})
        self.assertEqual(self.last(peer)["code"], "code_invalid")
        self.hub.handle(peer, {"type": "verify-finish", "email": "alice@example.com", "code": code})
        verified = self.last(peer, "verified")
        self.assertEqual(self.signer.verify(verified["proof"], "license:1"), "alice@example.com")
        self.assertIn(peer, self.hub.peers_by_email["alice@example.com"])

    def test_code_from_other_subject_is_not_accepted(self):
        alice = self.connect()
        trial = self.connect(device="device-trial-01", kind="trial")
        self.hub.handle(alice, {"type": "verify-start", "email": "x@example.com"})
        code = self.mail_outbox[-1][1]
        self.hub.handle(trial, {"type": "verify-finish", "email": "x@example.com", "code": code})
        self.assertEqual(self.last(trial)["code"], "code_expired")

    def test_too_many_wrong_codes_invalidate_the_code(self):
        peer = self.connect()
        self.hub.handle(peer, {"type": "verify-start", "email": "a@example.com"})
        code = self.mail_outbox[-1][1]
        wrong = "000000" if code != "000000" else "111111"
        for _ in range(calls.VERIFICATION_MAX_ATTEMPTS):
            self.hub.handle(peer, {"type": "verify-finish", "email": "a@example.com", "code": wrong})
        self.hub.handle(peer, {"type": "verify-finish", "email": "a@example.com", "code": code})
        self.assertEqual(self.last(peer)["code"], "code_expired")

    def test_codes_per_address_are_limited(self):
        peer = self.connect()
        for _ in range(calls.VERIFY_EMAIL_PER_HOUR):
            self.hub.handle(peer, {"type": "verify-start", "email": "a@example.com"})
            self.clock.value += calls.RATE_WINDOW_SECONDS
        self.hub.handle(peer, {"type": "verify-start", "email": "a@example.com"})
        self.assertEqual(self.last(peer)["code"], "rate_limited")
        self.assertEqual(len(self.mail_outbox), calls.VERIFY_EMAIL_PER_HOUR)

    def test_codes_per_license_are_limited(self):
        peer = self.connect()
        for index in range(calls.VERIFY_SUBJECT_PER_HOUR):
            self.hub.handle(peer, {"type": "verify-start", "email": f"user{index}@example.com"})
            self.clock.value += calls.RATE_WINDOW_SECONDS
        self.hub.handle(peer, {"type": "verify-start", "email": "one-more@example.com"})
        self.assertEqual(self.last(peer)["code"], "rate_limited")
        self.clock.value += 3600
        self.hub.handle(peer, {"type": "verify-start", "email": "one-more@example.com"})
        self.assertEqual(self.last(peer)["type"], "verify-sent")

    def test_verification_without_smtp_is_reported(self):
        self.hub.mailer = calls.Mailer("", 587, "", "", "")
        peer = self.connect()
        self.hub.handle(peer, {"type": "verify-start", "email": "a@example.com"})
        self.assertEqual(self.last(peer)["code"], "verification_unavailable")


class LookupTests(HubTestCase):
    def test_lookup_reports_only_online_verified_addresses(self):
        alice = self.connect(emails=["alice@example.com"])
        self.connect(device="device-bob-0001", emails=["bob@example.com"])
        self.hub.handle(alice, {"type": "lookup", "requestId": "r1", "emails": ["BOB@example.com", "nobody@example.com", "alice@example.com", 5]})
        result = self.last(alice, "lookup-result")
        self.assertEqual(result["requestId"], "r1")
        self.assertEqual(result["reachable"], {"bob@example.com": True, "nobody@example.com": False, "alice@example.com": False})

    def test_lookup_size_is_limited(self):
        alice = self.connect(emails=["alice@example.com"])
        self.hub.handle(alice, {"type": "lookup", "emails": [f"u{i}@example.com" for i in range(calls.MAX_LOOKUP_EMAILS + 1)]})
        self.assertEqual(self.last(alice)["code"], "invalid_lookup")

    def test_presence_disappears_on_disconnect(self):
        bob = self.connect(device="device-bob-0001", emails=["bob@example.com"])
        self.hub.disconnected(bob)
        self.assertNotIn("bob@example.com", self.hub.peers_by_email)


class CallFlowTests(HubTestCase):
    def setUp(self):
        super().setUp()
        self.alice = self.connect(emails=["alice@example.com"], name="Alice\x07 A")
        self.bob_desk = self.connect(device="device-bob-0001", emails=["bob@example.com"], name="Bob")
        self.bob_laptop = self.connect(device="device-carol-01", emails=["bob@example.com"], name="Bob")

    def invite(self, call_id="call-0001", video=True):
        self.hub.handle(self.alice, {"type": "invite", "callId": call_id, "to": "bob@example.com", "video": video})

    def test_invite_rings_all_callee_devices(self):
        self.invite()
        self.assertEqual(self.last(self.alice)["type"], "ringing")
        for device in (self.bob_desk, self.bob_laptop):
            incoming = self.last(device, "incoming")
            self.assertEqual(incoming["from"], "alice@example.com")
            self.assertEqual(incoming["fromName"], "Alice A")
            self.assertTrue(incoming["video"])

    def test_accept_issues_room_tokens_and_stops_other_devices(self):
        self.invite()
        self.hub.handle(self.bob_desk, {"type": "accept", "callId": "call-0001"})
        accepted = self.last(self.alice, "accepted")
        joined = self.last(self.bob_desk, "joined")
        self.assertEqual(accepted["livekitURL"], "wss://calls.example.test")
        caller_claims = decode_jwt(accepted["token"])
        callee_claims = decode_jwt(joined["token"])
        self.assertEqual(caller_claims["video"]["room"], callee_claims["video"]["room"])
        self.assertTrue(caller_claims["sub"].startswith("alice@example.com#"))
        self.assertEqual(self.last(self.bob_laptop)["reason"], "answered-elsewhere")
        self.hub.handle(self.bob_laptop, {"type": "accept", "callId": "call-0001"})
        self.assertEqual(self.last(self.bob_laptop)["code"], "call_not_found")

    def test_reject_notifies_caller(self):
        self.invite()
        self.hub.handle(self.bob_laptop, {"type": "reject", "callId": "call-0001"})
        self.assertEqual(self.last(self.alice)["reason"], "declined")
        self.assertEqual(self.last(self.bob_desk)["reason"], "declined")
        self.assertNotIn("call-0001", self.hub.calls)

    def test_no_answer_after_timeout(self):
        self.invite()
        self.scheduler.fire(calls.RING_TIMEOUT_SECONDS)
        self.assertEqual(self.last(self.alice)["reason"], "no-answer")
        self.assertEqual(self.last(self.bob_desk)["reason"], "no-answer")

    def test_timeout_after_accept_does_not_end_call(self):
        self.invite()
        self.hub.handle(self.bob_desk, {"type": "accept", "callId": "call-0001"})
        self.scheduler.fire(calls.RING_TIMEOUT_SECONDS)
        self.assertIn("call-0001", self.hub.calls)

    def test_busy_when_callee_is_in_another_call(self):
        carol = self.connect(device="device-alice-2", emails=["carol@example.com"])
        self.invite()
        self.hub.handle(carol, {"type": "invite", "callId": "call-0002", "to": "bob@example.com"})
        self.assertEqual(self.last(carol)["reason"], "busy")

    def test_offline_and_self_calls(self):
        self.hub.handle(self.alice, {"type": "invite", "callId": "call-0003", "to": "nobody@example.com"})
        self.assertEqual(self.last(self.alice)["reason"], "offline")
        self.hub.handle(self.alice, {"type": "invite", "callId": "call-0004", "to": "alice@example.com"})
        self.assertEqual(self.last(self.alice)["code"], "call_self")

    def test_unverified_caller_cannot_call_or_spoof_sender(self):
        stranger = self.connect(device="device-alice-2")
        self.hub.handle(stranger, {"type": "invite", "callId": "call-0005", "to": "bob@example.com"})
        self.assertEqual(self.last(stranger)["code"], "not_verified")
        self.hub.handle(self.alice, {"type": "invite", "callId": "call-0006", "to": "bob@example.com", "from": "boss@example.com"})
        self.assertEqual(self.last(self.alice)["code"], "not_verified")

    def test_only_the_callee_can_accept(self):
        intruder = self.connect(device="device-alice-2", emails=["eve@example.com"])
        self.invite()
        self.hub.handle(intruder, {"type": "accept", "callId": "call-0001"})
        self.assertEqual(self.last(intruder)["code"], "call_not_found")
        self.hub.handle(intruder, {"type": "hangup", "callId": "call-0001"})
        self.assertEqual(self.last(intruder)["code"], "call_not_found")
        self.assertIn("call-0001", self.hub.calls)

    def test_cancel_before_answer(self):
        self.invite()
        self.hub.handle(self.alice, {"type": "cancel", "callId": "call-0001"})
        self.assertEqual(self.last(self.bob_desk)["reason"], "cancelled")
        self.assertNotIn("call-0001", self.hub.calls)

    def test_caller_disconnect_while_ringing_cancels(self):
        self.invite()
        self.hub.disconnected(self.alice)
        self.assertEqual(self.last(self.bob_laptop)["reason"], "cancelled")

    def test_callee_going_offline_while_ringing_ends_call(self):
        self.invite()
        self.hub.disconnected(self.bob_desk)
        self.assertIn("call-0001", self.hub.calls)
        self.hub.disconnected(self.bob_laptop)
        self.assertEqual(self.last(self.alice)["reason"], "offline")

    def test_hangup_ends_active_call_for_other_side(self):
        self.invite()
        self.hub.handle(self.bob_desk, {"type": "accept", "callId": "call-0001"})
        self.hub.handle(self.bob_desk, {"type": "hangup", "callId": "call-0001"})
        self.assertEqual(self.last(self.alice)["reason"], "hangup")
        self.assertNotEqual(self.last(self.bob_desk)["type"], "call-ended")
        self.assertFalse(self.hub._busy("bob@example.com"))

    def test_disconnect_during_call_has_grace_and_resume(self):
        self.invite()
        self.hub.handle(self.bob_desk, {"type": "accept", "callId": "call-0001"})
        self.hub.disconnected(self.alice)
        self.assertIn("call-0001", self.hub.calls)
        alice_again = calls.Peer(lambda m: alice_again.inbox.append(m))
        alice_again.inbox = []
        self.hub.handle(alice_again, {
            "type": "hello",
            "credential": {"kind": "license", "deviceId": "device-alice-1", "licenseKey": LICENSE_KEY},
            "emailProofs": [self.signer.issue("alice@example.com", "license:1")],
            "activeCalls": ["call-0001"],
        })
        self.assertEqual(self.last(alice_again, "welcome")["resumedCalls"], ["call-0001"])
        self.scheduler.fire(calls.RECONNECT_GRACE_SECONDS)
        self.assertIn("call-0001", self.hub.calls)
        self.hub.handle(self.bob_desk, {"type": "hangup", "callId": "call-0001"})
        self.assertEqual(self.last(alice_again)["reason"], "hangup")

    def test_other_device_cannot_resume_call(self):
        self.invite()
        self.hub.handle(self.bob_desk, {"type": "accept", "callId": "call-0001"})
        other = calls.Peer(lambda m: other.inbox.append(m))
        other.inbox = []
        self.hub.handle(other, {
            "type": "hello",
            "credential": {"kind": "license", "deviceId": "device-alice-2", "licenseKey": LICENSE_KEY},
            "emailProofs": [self.signer.issue("alice@example.com", "license:1")],
            "activeCalls": ["call-0001"],
        })
        self.assertEqual(self.last(other, "welcome")["resumedCalls"], [])

    def test_disconnect_without_resume_ends_call(self):
        self.invite()
        self.hub.handle(self.bob_desk, {"type": "accept", "callId": "call-0001"})
        self.hub.disconnected(self.alice)
        self.scheduler.fire(calls.RECONNECT_GRACE_SECONDS)
        self.assertEqual(self.last(self.bob_desk)["reason"], "connection-lost")
        self.assertNotIn("call-0001", self.hub.calls)

    def test_invalid_messages(self):
        self.hub.handle(self.alice, "nonsense")
        self.assertEqual(self.last(self.alice)["code"], "invalid_message")
        self.hub.handle(self.alice, {"type": "invite", "callId": "../x", "to": "bob@example.com"})
        self.assertEqual(self.last(self.alice)["code"], "invalid_call_id")
        self.hub.handle(self.alice, {"type": "teleport"})
        self.assertEqual(self.last(self.alice)["code"], "unknown_type")

    def test_invites_are_rate_limited(self):
        for index in range(calls.RATE_LIMITS["invite"]):
            self.hub.handle(self.alice, {"type": "invite", "callId": f"call-x{index:04d}", "to": "nobody@example.com"})
        self.hub.handle(self.alice, {"type": "invite", "callId": "call-overflow", "to": "nobody@example.com"})
        self.assertEqual(self.last(self.alice)["code"], "rate_limited")


def decode_jwt(token):
    header, claims, signature = token.split(".")
    expected = hmac.new(LIVEKIT_SECRET.encode(), f"{header}.{claims}".encode(), hashlib.sha256).digest()
    assert calls.base64url_encode(expected) == signature, "bad JWT signature"
    return json.loads(base64.urlsafe_b64decode(claims + "=" * (-len(claims) % 4)))


class LiveKitTokenTests(unittest.TestCase):
    def test_token_grants_only_one_room(self):
        issuer = calls.LiveKitTokenIssuer("wss://lk.example.test", "APIkey", LIVEKIT_SECRET)
        claims = decode_jwt(issuer.issue("call-abc", "a@example.com#1", "A", now=100))
        self.assertEqual(claims["iss"], "APIkey")
        self.assertEqual(claims["video"], {"room": "call-abc", "roomJoin": True, "canPublish": True, "canSubscribe": True, "canPublishData": True})
        self.assertEqual(claims["exp"], 100 + calls.LIVEKIT_TOKEN_TTL_SECONDS)
        self.assertNotIn("roomAdmin", claims["video"])

    def test_configuration_is_validated(self):
        with self.assertRaises(RuntimeError):
            calls.LiveKitTokenIssuer("ws://insecure", "k", LIVEKIT_SECRET)
        with self.assertRaises(RuntimeError):
            calls.LiveKitTokenIssuer("wss://lk.example.test", "k", "short")
        with self.assertRaises(RuntimeError):
            calls.EmailProofSigner(b"short")


if __name__ == "__main__":
    unittest.main()
