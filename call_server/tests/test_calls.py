import base64
import contextlib
import hashlib
import hmac
import io
import json
import runpy
import sqlite3
import sys
import tempfile
import time
import unittest
from unittest import mock
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


class SharedVerificationTests(HubTestCase):
    """Адрес, подтверждённый на одном устройстве лицензии, подтверждён на всех её устройствах."""

    def setUp(self):
        super().setUp()
        import chat

        self.store = chat.ChatStore(Path(self.tmp.name) / "chat.sqlite3", Path(self.tmp.name) / "blobs")
        self.hub.verified_store = self.store

    def verify(self, peer, email):
        self.hub.handle(peer, {"type": "verify-start", "email": email})
        self.hub.handle(peer, {"type": "verify-finish", "email": email, "code": self.mail_outbox[-1][1]})
        return self.last(peer, "verified")

    def test_code_is_valid_for_thirty_minutes(self):
        self.assertEqual(calls.VERIFICATION_CODE_TTL_SECONDS, 30 * 60)
        peer = self.connect()
        self.hub.handle(peer, {"type": "verify-start", "email": "a@example.com"})
        code = self.mail_outbox[-1][1]
        self.clock.value += 25 * 60
        self.hub.handle(peer, {"type": "verify-finish", "email": "a@example.com", "code": code})
        self.assertEqual(self.last(peer)["type"], "verified")

    def test_other_device_of_license_gets_address_on_login(self):
        mac = self.connect(device="device-alice-1")
        self.verify(mac, "alice@example.com")
        windows = self.connect(device="device-alice-2")
        welcome = self.last(windows, "welcome")
        self.assertEqual(welcome["emails"], ["alice@example.com"])
        self.assertEqual(self.signer.verify(welcome["proofs"]["alice@example.com"], "license:1"), "alice@example.com")
        self.assertIn(windows, self.hub.peers_by_email["alice@example.com"])

    def test_online_device_of_license_gets_address_at_once(self):
        mac = self.connect(device="device-alice-1")
        windows = self.connect(device="device-alice-2")
        self.verify(mac, "alice@example.com")
        self.assertEqual(self.last(windows, "verified")["email"], "alice@example.com")
        self.assertIn(windows, self.hub.peers_by_email["alice@example.com"])

    def test_proofs_issued_before_the_store_are_shared(self):
        self.connect(device="device-alice-1", emails=["old@example.com"])
        windows = self.connect(device="device-alice-2")
        self.assertEqual(self.last(windows, "welcome")["emails"], ["old@example.com"])

    def test_copied_proof_does_not_extend_its_lifetime(self):
        expires = int(time.time()) + 3600
        proof = self.signer.issue("a@example.com", "license:1", expires=expires)
        peer = calls.Peer(lambda m: None)
        self.hub.handle(peer, {"type": "hello", "credential": {"kind": "license", "deviceId": "device-alice-1", "licenseKey": LICENSE_KEY}, "emailProofs": [proof]})
        windows = self.connect(device="device-alice-2")
        copied = self.last(windows, "welcome")["proofs"]["a@example.com"]
        self.assertEqual(self.signer.verify_claims(copied, "license:1"), ("a@example.com", expires))

    def test_other_license_and_trial_do_not_get_address(self):
        self.verify(self.connect(device="device-alice-1"), "alice@example.com")
        trial = self.connect(device="device-trial-01", kind="trial")
        self.assertEqual(self.last(trial, "welcome")["emails"], [])
        self.assertNotIn("proofs", self.last(trial, "welcome"))

    def test_address_disconnected_on_device_is_not_restored(self):
        self.verify(self.connect(device="device-alice-1"), "alice@example.com")
        windows = calls.Peer(lambda m: windows.inbox.append(m))
        windows.inbox = []
        self.hub.handle(windows, {"type": "hello", "credential": {"kind": "license", "deviceId": "device-alice-2", "licenseKey": LICENSE_KEY},
                                  "emailProofs": [], "excludedEmails": ["Alice@Example.com"]})
        self.assertEqual(self.last(windows, "welcome")["emails"], [])
        self.verify(self.connect(device="device-bob-0001"), "alice@example.com")
        self.assertIsNone(self.last(windows, "verified"))
        # Подтверждая адрес на этом устройстве заново, пользователь снова его включает.
        self.hub.handle(windows, {"type": "verify-start", "email": "alice@example.com"})
        self.assertNotIn("alice@example.com", windows.excluded_emails)

    def test_expired_addresses_are_not_restored(self):
        expires = int(time.time()) + 60
        self.store.remember_verified_email("license:1", "a@example.com", expires)
        self.store._clock = lambda: expires + 1
        windows = self.connect(device="device-alice-2")
        self.assertEqual(self.last(windows, "welcome")["emails"], [])


class RobustnessTests(HubTestCase):
    def test_unexpected_handler_error_does_not_close_the_connection(self):
        peer = self.connect(emails=["alice@example.com"])

        def broken(_peer, _message):
            raise RuntimeError("boom")

        self.hub._lookup = broken
        with contextlib.redirect_stderr(io.StringIO()):
            self.hub.handle(peer, {"type": "lookup", "emails": [], "requestId": "r1"})
        reply = self.last(peer)
        self.assertEqual((reply["type"], reply["code"], reply["requestId"]), ("error", "internal_error", "r1"))
        self.assertEqual(peer.closed, [])

    def test_script_entry_point_uses_the_calls_module(self):
        """Запуск `python calls.py`: ошибки chat.py должны быть тем же классом CallError, что ловит CallHub."""
        with mock.patch.object(calls, "main") as main:
            runpy.run_path(str(Path(calls.__file__)), run_name="__main__")
        main.assert_called_once_with()


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


SDP_OFFER = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n"
SDP_ANSWER = SDP_OFFER.replace("o=- 1 2", "o=- 3 4")
CANDIDATE = {"candidate": "candidate:1 1 udp 2122260223 192.0.2.10 54400 typ host", "sdpMid": "0", "sdpMLineIndex": 0}


class P2PCallTests(HubTestCase):
    """Режим без LiveKit: сервис только пересылает SDP и ICE между участниками."""

    def setUp(self):
        super().setUp()
        self.hub.livekit = None
        self.alice = self.connect(emails=["alice@example.com"], name="Alice")
        self.bob_desk = self.connect(device="device-bob-0001", emails=["bob@example.com"], name="Bob")
        self.bob_laptop = self.connect(device="device-carol-01", emails=["bob@example.com"], name="Bob")

    def start_call(self):
        self.hub.handle(self.alice, {"type": "invite", "callId": "call-p2p1", "to": "bob@example.com", "video": False})
        self.hub.handle(self.bob_desk, {"type": "accept", "callId": "call-p2p1"})

    def signal(self, peer, kind, **fields):
        self.hub.handle(peer, {"type": "signal", "callId": "call-p2p1", "kind": kind, **fields})

    def test_accept_without_livekit_announces_p2p(self):
        self.start_call()
        accepted = self.last(self.alice, "accepted")
        joined = self.last(self.bob_desk, "joined")
        for message in (accepted, joined):
            self.assertEqual(message["media"], "p2p")
            self.assertNotIn("token", message)
            self.assertNotIn("livekitURL", message)
            self.assertNotIn("iceServers", message)

    def test_configured_stun_servers_are_sent(self):
        self.hub.stun_urls = calls.validate_stun_urls(["stun:stun.example.test:3478"])
        self.start_call()
        self.assertEqual(self.last(self.alice, "accepted")["iceServers"], [{"urls": ["stun:stun.example.test:3478"]}])

    def test_offer_answer_and_candidates_reach_only_the_other_participant(self):
        self.start_call()
        self.signal(self.alice, "offer", sdp=SDP_OFFER)
        self.assertEqual(self.last(self.bob_desk, "signal"), {"type": "signal", "callId": "call-p2p1", "kind": "offer", "sdp": SDP_OFFER})
        self.assertIsNone(self.last(self.bob_laptop, "signal"))
        self.signal(self.bob_desk, "answer", sdp=SDP_ANSWER)
        self.assertEqual(self.last(self.alice, "signal")["sdp"], SDP_ANSWER)
        self.signal(self.alice, "ice", candidate={**CANDIDATE, "usernameFragment": "abc", "extra": "x" * 10})
        self.assertEqual(self.last(self.bob_desk, "signal")["candidate"], CANDIDATE)
        self.signal(self.bob_desk, "ice", candidate=None)
        self.assertIsNone(self.last(self.alice, "signal")["candidate"])
        self.assertIsNone(self.last(self.alice, "error"))
        self.assertIsNone(self.last(self.bob_desk, "error"))

    def test_signal_requires_active_call_participant(self):
        self.hub.handle(self.alice, {"type": "invite", "callId": "call-p2p1", "to": "bob@example.com"})
        self.signal(self.alice, "offer", sdp=SDP_OFFER)
        self.assertEqual(self.last(self.alice, "error")["code"], "call_not_found")
        self.assertIsNone(self.last(self.bob_desk, "signal"))
        self.hub.handle(self.bob_desk, {"type": "accept", "callId": "call-p2p1"})
        # Другое устройство того же адреса и посторонний не участвуют в звонке.
        intruder = self.connect(device="device-alice-2", emails=["eve@example.com"])
        for peer in (self.bob_laptop, intruder):
            self.signal(peer, "offer", sdp=SDP_OFFER)
            self.assertEqual(self.last(peer, "error")["code"], "call_not_found")
        self.assertIsNone(self.last(self.alice, "signal"))
        self.assertIsNone(self.last(self.bob_desk, "signal"))
        self.signal(self.alice, "offer", sdp=SDP_OFFER)
        self.hub.handle(self.alice, {"type": "hangup", "callId": "call-p2p1"})
        self.signal(self.bob_desk, "answer", sdp=SDP_ANSWER)
        self.assertEqual(self.last(self.bob_desk, "error")["code"], "call_not_found")

    def test_invalid_signals_are_rejected(self):
        self.start_call()
        invalid = [
            {"kind": "bye"},
            {"kind": "offer"},
            {"kind": "offer", "sdp": "not sdp"},
            {"kind": "offer", "sdp": "v=0\r\n" + "a" * calls.MAX_SDP_LENGTH},
            {"kind": "answer", "sdp": "v=0\r\na=x\x00"},
            {"kind": "ice", "candidate": "candidate:1"},
            {"kind": "ice", "candidate": {"candidate": "c" * (calls.MAX_ICE_CANDIDATE_LENGTH + 1), "sdpMid": "0"}},
            {"kind": "ice", "candidate": {"candidate": "candidate:1", "sdpMid": None, "sdpMLineIndex": None}},
            {"kind": "ice", "candidate": {"candidate": "candidate:1", "sdpMLineIndex": True}},
            {"kind": "ice", "candidate": {"candidate": "candidate:1", "sdpMLineIndex": 1000}},
            {"kind": "ice", "candidate": {"candidate": "candidate:\n1", "sdpMid": "0"}},
        ]
        for fields in invalid:
            with self.subTest(fields=str(fields)[:80]):
                self.signal(self.alice, **fields)
                error = self.last(self.alice, "error")
                self.assertEqual(error["code"], "invalid_signal")
                self.assertEqual(error["callId"], "call-p2p1")
                self.assertEqual(error["requestType"], "signal")
        self.assertIsNone(self.last(self.bob_desk, "signal"))
        # Ошибка в сигнале не завершает звонок.
        self.assertIn("call-p2p1", self.hub.calls)

    def test_signals_are_rate_limited(self):
        self.start_call()
        for _ in range(calls.RATE_LIMITS["signal"]):
            self.signal(self.alice, "ice", candidate=CANDIDATE)
        self.signal(self.alice, "ice", candidate=CANDIDATE)
        self.assertEqual(self.last(self.alice, "error")["code"], "rate_limited")

    def test_signal_follows_resumed_connection(self):
        self.start_call()
        self.hub.disconnected(self.alice)
        alice_again = calls.Peer(lambda m: alice_again.inbox.append(m))
        alice_again.inbox = []
        self.hub.handle(alice_again, {
            "type": "hello",
            "credential": {"kind": "license", "deviceId": "device-alice-1", "licenseKey": LICENSE_KEY},
            "emailProofs": [self.signer.issue("alice@example.com", "license:1")],
            "activeCalls": ["call-p2p1"],
        })
        self.signal(self.bob_desk, "ice", candidate=CANDIDATE)
        self.assertEqual(self.last(alice_again, "signal")["candidate"], CANDIDATE)


class ConfigurationTests(unittest.TestCase):
    def setUp(self):
        self.saved = {name: calls.os.environ.pop(name, None) for name in (
            "JACKDAW_LIVEKIT_URL", "JACKDAW_LIVEKIT_API_KEY", "JACKDAW_LIVEKIT_API_SECRET", "JACKDAW_LIVEKIT_API_SECRET_FILE")}

    def tearDown(self):
        for name, value in self.saved.items():
            calls.os.environ.pop(name, None)
            if value is not None:
                calls.os.environ[name] = value

    def test_livekit_is_optional(self):
        self.assertIsNone(calls.build_livekit_from_environment())

    def test_partial_livekit_configuration_is_an_error(self):
        calls.os.environ["JACKDAW_LIVEKIT_URL"] = "wss://lk.example.test"
        with self.assertRaises(RuntimeError):
            calls.build_livekit_from_environment()

    def test_full_livekit_configuration_is_used(self):
        calls.os.environ.update({
            "JACKDAW_LIVEKIT_URL": "wss://lk.example.test",
            "JACKDAW_LIVEKIT_API_KEY": "APIkey",
            "JACKDAW_LIVEKIT_API_SECRET": LIVEKIT_SECRET,
        })
        self.assertEqual(calls.build_livekit_from_environment().url, "wss://lk.example.test")

    def test_stun_urls_are_validated(self):
        self.assertEqual(calls.validate_stun_urls(["", " stun:stun.l.google.com:19302 ", "stuns:stun.example.test"]),
                         ("stun:stun.l.google.com:19302", "stuns:stun.example.test"))
        for bad in (["turn:turn.example.test"], ["stun:evil host"], ["stun:a"] * (calls.MAX_STUN_URLS + 1)):
            with self.assertRaises(RuntimeError):
                calls.validate_stun_urls(bad)


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
