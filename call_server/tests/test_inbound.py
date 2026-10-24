import asyncio
import sys
import time
import unittest
from email.message import EmailMessage
from email.utils import formatdate
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import calls  # noqa: E402
import inbound  # noqa: E402
from test_calls import HubTestCase  # noqa: E402

DOMAIN = "verify.example.test"


def make_message(from_header="Alice <alice@corp.example>", dkim_domain=None, extra=""):
    lines = [f"From: {from_header}", "To: verify@x", "Subject: test"]
    if dkim_domain is not None:
        lines.insert(0, f"DKIM-Signature: v=1; a=rsa-sha256; d={dkim_domain}; s=sel; h=from; bh=x; b=y")
    return ("\r\n".join(lines) + extra + "\r\n\r\nbody\r\n").encode()


def client_message(ready, sender="Alice <alice@corp.example>", date=None, subject=None, to=None):
    """Письмо как его собирает клиент (ReverseVerification.ts): To — одноразовый адрес, Subject — `mailSubject`."""
    message = EmailMessage()
    message["From"] = sender
    message["To"] = to if to is not None else f"Jackdaw Mail <{ready['address']}>"
    message["Subject"] = subject if subject is not None else ready["mailSubject"]
    message["Date"] = formatdate(date if date is not None else time.time())
    message.set_content("Подтверждаю адрес.")
    return message.as_bytes()


def with_dkim(raw, headers="from:to:subject:date", domain="corp.example"):
    return f"DKIM-Signature: v=1; a=rsa-sha256; d={domain}; s=sel;\r\n h={headers}; bh=x; b=y\r\n".encode() + raw


class Clock:
    def __init__(self):
        self.value = 1000.0

    def __call__(self):
        return self.value


class ReverseVerificationTests(unittest.TestCase):
    def setUp(self):
        self.clock = Clock()
        self.reverse = inbound.ReverseVerification(lambda email, subject: f"proof:{email}:{subject}", DOMAIN, self.clock)

    def test_start_returns_one_time_address(self):
        ready = self.reverse.start("alice@corp.example", "license:1")
        self.assertRegex(ready["token"], r"^[a-z2-7]{16}$")
        self.assertEqual(ready["address"], f"verify+{ready['token']}@{DOMAIN}")
        self.assertIn(ready["token"], ready["mailSubject"])
        self.assertTrue(self.reverse.accepts(ready["token"]))

    def test_complete_confirms_actual_sender(self):
        # Exchange отправляет от основного адреса ящика, а не от псевдонима
        token = self.reverse.start("alias@corp.example", "license:1")["token"]
        pending = self.reverse.complete(token, "primary@corp.example")
        self.assertEqual(pending.email, "primary@corp.example")
        self.assertEqual(pending.requested_email, "alias@corp.example")
        self.assertEqual(pending.proof, "proof:primary@corp.example:license:1")

    def test_complete_is_single_use(self):
        token = self.reverse.start("alice@corp.example", "license:1")["token"]
        pending = self.reverse.complete(token, "alice@corp.example")
        self.assertEqual(pending.proof, "proof:alice@corp.example:license:1")
        self.assertFalse(self.reverse.accepts(token))
        with self.assertRaises(inbound.ReverseVerificationError):
            self.reverse.complete(token, "alice@corp.example")

    def test_token_expires(self):
        token = self.reverse.start("alice@corp.example", "license:1")["token"]
        self.clock.value += inbound.REVERSE_TTL_SECONDS
        self.assertFalse(self.reverse.accepts(token))
        with self.assertRaises(inbound.ReverseVerificationError):
            self.reverse.complete(token, "alice@corp.example")

    def test_check_is_bound_to_subject(self):
        token = self.reverse.start("alice@corp.example", "license:1")["token"]
        self.assertIsNone(self.reverse.check(token, "license:2"))
        self.assertIsNone(self.reverse.check(token, "license:1").proof)
        self.reverse.complete(token, "alice@corp.example")
        self.assertIsNotNone(self.reverse.check(token, "license:1").proof)

    def test_rate_limit_per_email(self):
        for _ in range(inbound.REVERSE_PER_EMAIL_PER_HOUR):
            self.reverse.start("alice@corp.example", "license:1")
        with self.assertRaises(inbound.ReverseVerificationError) as error:
            self.reverse.start("alice@corp.example", "license:1")
        self.assertEqual(error.exception.code, "rate_limited")


class ParsingTests(unittest.TestCase):
    def test_recipient_token(self):
        self.assertEqual(inbound.parse_recipient_token(f"<verify+abcdefghijklmnop@{DOMAIN}>", DOMAIN), "abcdefghijklmnop")
        self.assertEqual(inbound.parse_recipient_token(f"VERIFY+ABCDEFGHIJKLMNOP@{DOMAIN.upper()}", DOMAIN), "abcdefghijklmnop")
        for address in ("verify+short@" + DOMAIN, "verify+abcdefghijklmnop@evil.test", "postmaster@" + DOMAIN, "verify+abcdefghijklmno1@" + DOMAIN):
            self.assertIsNone(inbound.parse_recipient_token(address, DOMAIN), address)

    def test_single_from_address(self):
        self.assertEqual(inbound.single_from_address(make_message("Alice <Alice@Corp.Example>")), "alice@corp.example")
        self.assertIsNone(inbound.single_from_address(make_message("a@corp.example, b@corp.example")))
        self.assertIsNone(inbound.single_from_address(make_message(extra="\r\nFrom: other@corp.example")))
        self.assertIsNone(inbound.single_from_address(b"Subject: none\r\n\r\nbody"))

    def test_alignment(self):
        self.assertTrue(inbound.aligned("corp.example", "corp.example"))
        self.assertTrue(inbound.aligned("mail.corp.example", "corp.example"))
        self.assertFalse(inbound.aligned("corp.example", "evilcorp.example"))
        self.assertFalse(inbound.aligned("corp.example", "mail.corp.example"))
        self.assertFalse(inbound.aligned("corp.example", "example"))


class AuthenticationTests(unittest.TestCase):
    def test_dkim_aligned_passes(self):
        raw = make_message(dkim_domain="corp.example")
        method = inbound.authenticate_sender(raw, "alice@corp.example", "1.2.3.4", "bounce@other.test", "mx",
                                             dkim_verify=lambda r, i: True, spf_check=lambda *a: "fail")
        self.assertEqual(method, "dkim")

    def test_dkim_from_foreign_domain_is_ignored(self):
        raw = make_message(dkim_domain="evil.test")
        method = inbound.authenticate_sender(raw, "alice@corp.example", "1.2.3.4", "x@evil.test", "mx",
                                             dkim_verify=lambda r, i: True, spf_check=lambda *a: "pass")
        self.assertIsNone(method)

    def test_spf_alone_does_not_confirm_mailbox(self):
        # SPF подтверждает сервер, а не ящик: через общий сервис из SPF можно подделать From чужого адреса
        raw = make_message()
        self.assertIsNone(inbound.authenticate_sender(raw, "alice@corp.example", "1.2.3.4", "alice@corp.example", "mx",
                                                      dkim_verify=lambda r, i: False, spf_check=lambda *a: "pass"))
        self.assertIsNone(inbound.authenticate_sender(raw, "alice@corp.example", "1.2.3.4", "alice@corp.example", "mx",
                                                      dkim_verify=lambda r, i: False, spf_check=lambda *a: "softfail"))

    def test_broken_signature_does_not_pass(self):
        raw = make_message(dkim_domain="corp.example")

        def broken(r, i):
            raise ValueError("bad signature")

        self.assertIsNone(inbound.authenticate_sender(raw, "alice@corp.example", "1.2.3.4", "", "mx",
                                                      dkim_verify=broken, spf_check=lambda *a: "pass"))


class TokenBindingTests(unittest.TestCase):
    def setUp(self):
        self.reverse = inbound.ReverseVerification(lambda email, subject: "proof", DOMAIN)
        self.ready = self.reverse.start("alice@corp.example", "license:1")
        self.token = self.ready["token"]

    def test_client_subject_contains_token(self):
        # Тема на русском уходит в RFC 2047 (base64): токен ищется в раскодированной теме
        raw = client_message(self.ready, to="Jackdaw <verify@other.test>")
        self.assertNotIn(self.token.encode(), raw.split(b"\n\n", 1)[0].split(b"Subject:")[1].split(b"\n")[0])
        self.assertEqual(inbound.token_headers(raw, self.token, DOMAIN), {"subject"})
        self.assertEqual(inbound.token_headers(client_message(self.ready), self.token, DOMAIN), {"subject", "to"})

    def test_other_token_or_duplicate_header_does_not_count(self):
        self.assertEqual(inbound.token_headers(client_message(self.ready), "abcdefghijklmnop", DOMAIN), set())
        doubled = b"Subject: " + self.token.encode() + b"\r\n" + client_message(self.ready, subject="old", to="x@other.test")
        self.assertEqual(inbound.token_headers(doubled, self.token, DOMAIN), set())

    def test_dkim_must_sign_header_with_token(self):
        def auth(raw, **kwargs):
            return inbound.authenticate_sender(raw, "alice@corp.example", "1.2.3.4", "alice@corp.example", "mx",
                                               dkim_verify=lambda r, i: True, spf_check=lambda *a: "fail",
                                               token=self.token, token_domain=DOMAIN, **kwargs)
        raw = client_message(self.ready)
        self.assertEqual(auth(with_dkim(raw, "from:subject")), "dkim")
        self.assertEqual(auth(with_dkim(raw, "From : To")), "dkim")
        self.assertIsNone(auth(with_dkim(raw, "from:date")))
        self.assertEqual(inbound.dkim_signed_headers(with_dkim(raw, "From:Subject")), [{"from", "subject"}])

    def test_spf_with_token_header_is_not_enough(self):
        def auth(raw):
            return inbound.authenticate_sender(raw, "alice@corp.example", "1.2.3.4", "alice@corp.example", "mx",
                                               dkim_verify=lambda r, i: False, spf_check=lambda *a: "pass",
                                               token=self.token, token_domain=DOMAIN)
        self.assertIsNone(auth(client_message(self.ready)))
        self.assertIsNone(auth(client_message(self.ready, subject="test", to="verify@other.test")))

    def test_message_date_freshness(self):
        now = time.time()
        self.assertTrue(inbound.message_date_fresh(client_message(self.ready, date=now - 60), now))
        self.assertTrue(inbound.message_date_fresh(client_message(self.ready, date=now + 60), now))
        self.assertFalse(inbound.message_date_fresh(client_message(self.ready, date=now - 21 * 60), now))
        self.assertFalse(inbound.message_date_fresh(client_message(self.ready, date=now + 6 * 60), now))
        self.assertFalse(inbound.message_date_fresh(make_message(), now))
        self.assertFalse(inbound.message_date_fresh(make_message(extra="\r\nDate: garbage"), now))
        doubled = f"Date: {formatdate(now)}\r\n".encode() + client_message(self.ready, date=now)
        self.assertFalse(inbound.message_date_fresh(doubled, now))

    def test_default_clock_is_monotonic(self):
        self.assertIs(inbound.ReverseVerification(lambda e, s: "", DOMAIN)._clock, time.monotonic)


class HandlerTests(unittest.TestCase):
    def setUp(self):
        self.reverse = inbound.ReverseVerification(lambda email, subject: "proof", DOMAIN)
        self.verified = []
        self.failed = []
        self.auth_result = "dkim"
        self.handler = inbound.InboundHandler(
            self.reverse,
            lambda token, sender: self.verified.append((token, sender)) or True,
            lambda token, reason: self.failed.append((token, reason)),
            authenticate=self.authenticate,
            log=lambda line: None,
        )
        self.auth_calls = []

    def authenticate(self, *args, **kwargs):
        self.auth_calls.append(kwargs)
        return self.auth_result

    def session(self):
        return SimpleNamespace(peer=("1.2.3.4", 1234), host_name="mx.corp.example")

    @staticmethod
    def envelope():
        return SimpleNamespace(rcpt_tos=[], mail_from=None, mail_options=[], original_content=None, content=None)

    def run_flow(self, rcpt, raw):
        async def flow():
            session, envelope = self.session(), self.envelope()
            await self.handler.handle_MAIL(None, session, envelope, "alice@corp.example", [])
            rcpt_reply = await self.handler.handle_RCPT(None, session, envelope, rcpt, [])
            if not rcpt_reply.startswith("250"):
                return rcpt_reply
            envelope.original_content = raw
            return await self.handler.handle_DATA(None, session, envelope)
        return asyncio.run(flow())

    def test_accepts_authenticated_message(self):
        ready = self.reverse.start("alice@corp.example", "license:1")
        reply = self.run_flow(ready["address"], client_message(ready))
        self.assertTrue(reply.startswith("250"), reply)
        self.assertEqual(self.verified, [(ready["token"], "alice@corp.example")])
        # Проверке подписи передаётся токен: подпись должна покрывать заголовок с ним
        self.assertEqual(self.auth_calls, [{"token": ready["token"], "token_domain": DOMAIN}])

    def test_replayed_message_without_token_in_headers_is_rejected(self):
        # Чужое подписанное письмо, пересланное на свой одноразовый адрес: токен только в конверте
        ready = self.reverse.start("boss@corp.example", "license:2")
        old = {"address": f"verify+abcdefghijklmnop@{DOMAIN}", "mailSubject": "Jackdaw Mail: подтверждение адреса abcdefghijklmnop"}
        reply = self.run_flow(ready["address"], client_message(old, sender="Boss <boss@corp.example>"))
        self.assertTrue(reply.startswith("550"), reply)
        self.assertEqual(self.verified, [])
        self.assertEqual(self.auth_calls, [])
        self.assertEqual(self.failed, [(ready["token"], "sender_not_authenticated")])

    def test_token_only_in_to_is_accepted(self):
        # Тема могла быть изменена, но адрес получателя с токеном в заголовке остался
        ready = self.reverse.start("alice@corp.example", "license:1")
        reply = self.run_flow(ready["address"], client_message(ready, subject="Jackdaw"))
        self.assertTrue(reply.startswith("250"), reply)

    def test_stale_or_future_date_is_rejected(self):
        for date in (time.time() - inbound.MAX_MESSAGE_AGE_SECONDS - 60, time.time() + inbound.MAX_MESSAGE_CLOCK_SKEW_SECONDS + 60):
            ready = self.reverse.start("alice@corp.example", "license:1")
            reply = self.run_flow(ready["address"], client_message(ready, date=date))
            self.assertTrue(reply.startswith("550"), reply)
            self.assertEqual(self.failed[-1], (ready["token"], "sender_not_authenticated"))
        self.assertEqual(self.verified, [])

    def test_stale_ip_entries_are_forgotten(self):
        clock = Clock()
        handler = inbound.InboundHandler(self.reverse, lambda t, s: True, clock=clock, log=lambda line: None)
        self.assertTrue(handler._ip_allowed("1.1.1.1"))
        self.assertTrue(handler._ip_allowed("2.2.2.2"))
        clock.value += 3600
        self.assertTrue(handler._ip_allowed("3.3.3.3"))
        self.assertEqual(set(handler._per_ip), {"3.3.3.3"})

    def test_rejects_unknown_recipient_no_open_relay(self):
        self.assertTrue(self.run_flow("someone@gmail.com", make_message()).startswith("550"))
        self.assertTrue(self.run_flow(f"verify+abcdefghijklmnop@{DOMAIN}", make_message()).startswith("550"))
        self.assertEqual(self.verified, [])

    def test_rejects_unauthenticated_sender(self):
        ready = self.reverse.start("alice@corp.example", "license:1")
        self.auth_result = None
        self.assertTrue(self.run_flow(ready["address"], client_message(ready)).startswith("550"))
        self.assertEqual(self.verified, [])
        self.assertEqual(self.failed, [(ready["token"], "sender_not_authenticated")])

    def test_only_one_recipient(self):
        ready = self.reverse.start("alice@corp.example", "license:1")

        async def flow():
            envelope = self.envelope()
            await self.handler.handle_RCPT(None, self.session(), envelope, ready["address"], [])
            return await self.handler.handle_RCPT(None, self.session(), envelope, ready["address"], [])
        self.assertTrue(asyncio.run(flow()).startswith("452"))


class HubReverseTests(HubTestCase):
    def setUp(self):
        super().setUp()
        self.hub.reverse = inbound.ReverseVerification(self.signer.issue, DOMAIN, self.clock)

    def test_full_reverse_flow_reaches_all_devices_of_subject(self):
        first = self.connect(device="device-alice-1")
        second = self.connect(device="device-alice-2", mailboxes=["alice@corp.example"])
        stranger = self.connect(device="device-trial-01", kind="trial")
        self.hub.handle(first, {"type": "verify-reverse-start", "email": "Alice@Corp.Example"})
        ready = self.last(first, "verify-reverse-ready")
        self.assertEqual(ready["email"], "alice@corp.example")
        self.assertTrue(self.hub.reverse_verified(ready["token"], "alice@corp.example"))
        for peer in (first, second):
            verified = self.last(peer, "verified")
            self.assertEqual(verified["email"], "alice@corp.example")
            self.assertEqual(self.signer.verify(verified["proof"], "license:1"), "alice@corp.example")
        self.assertIsNone(self.last(stranger, "verified"))
        self.assertIn("alice@corp.example", self.hub.peers_by_email)

    def test_reverse_flow_skips_colleague_with_same_license(self):
        alice = self.connect(device="device-alice-1", mailboxes=["alice@corp.example"])
        colleague = self.connect(device="device-bob-0001", mailboxes=["bob@corp.example"])
        legacy = self.connect(device="device-carol-01")
        for peer in (colleague, legacy):
            self.assertIsNotNone(self.last(peer, "welcome"))
        self.hub.handle(alice, {"type": "verify-reverse-start", "email": "alice@corp.example"})
        token = self.last(alice, "verify-reverse-ready")["token"]
        self.assertTrue(self.hub.reverse_verified(token, "alice@corp.example"))
        self.assertEqual(self.last(alice, "verified")["email"], "alice@corp.example")
        self.assertIsNone(self.last(colleague, "verified"))
        self.assertIsNone(self.last(legacy, "verified"))
        self.assertEqual({peer for peer in self.hub.peers_by_email["alice@corp.example"]}, {alice})

    def test_check_after_reconnect(self):
        peer = self.connect()
        self.hub.handle(peer, {"type": "verify-reverse-start", "email": "alice@corp.example"})
        token = self.last(peer, "verify-reverse-ready")["token"]
        self.hub.handle(peer, {"type": "verify-reverse-check", "token": token})
        self.assertEqual(self.last(peer, "verify-reverse-pending")["token"], token)
        self.hub.disconnected(peer)
        self.assertTrue(self.hub.reverse_verified(token, "alice@corp.example"))
        again = self.connect()
        self.hub.handle(again, {"type": "verify-reverse-check", "token": token})
        self.assertEqual(self.last(again, "verified")["email"], "alice@corp.example")

    def test_other_license_cannot_check_token(self):
        peer = self.connect()
        self.hub.handle(peer, {"type": "verify-reverse-start", "email": "alice@corp.example"})
        token = self.last(peer, "verify-reverse-ready")["token"]
        self.hub.reverse_verified(token, "alice@corp.example")
        trial = self.connect(device="device-trial-01", kind="trial")
        self.hub.handle(trial, {"type": "verify-reverse-check", "token": token})
        self.assertEqual(self.last(trial, "error")["code"], "code_expired")
        self.assertIsNone(self.last(trial, "verified"))

    def test_actual_sender_is_confirmed_and_reported(self):
        peer = self.connect()
        self.hub.handle(peer, {"type": "verify-reverse-start", "email": "alias@corp.example"})
        token = self.last(peer, "verify-reverse-ready")["token"]
        self.assertTrue(self.hub.reverse_verified(token, "Primary@Corp.Example"))
        verified = self.last(peer, "verified")
        self.assertEqual(verified["email"], "primary@corp.example")
        self.assertEqual(verified["requestedEmail"], "alias@corp.example")
        self.assertEqual(self.signer.verify(verified["proof"], "license:1"), "primary@corp.example")
        self.assertNotIn("alias@corp.example", self.hub.peers_by_email)

    def test_used_token_is_rejected(self):
        peer = self.connect()
        self.hub.handle(peer, {"type": "verify-reverse-start", "email": "alice@corp.example"})
        token = self.last(peer, "verify-reverse-ready")["token"]
        self.assertTrue(self.hub.reverse_verified(token, "alice@corp.example"))
        self.assertFalse(self.hub.reverse_verified(token, "alice@corp.example"))

    def test_failed_message_is_reported_on_check(self):
        peer = self.connect()
        self.hub.handle(peer, {"type": "verify-reverse-start", "email": "alice@corp.example"})
        token = self.last(peer, "verify-reverse-ready")["token"]
        self.hub.reverse.fail(token, "sender_not_authenticated")
        self.assertFalse(self.hub.reverse.accepts(token))
        self.hub.handle(peer, {"type": "verify-reverse-check", "token": token})
        self.assertEqual(self.last(peer, "error")["code"], "sender_not_authenticated")
        self.assertFalse(self.hub.reverse_verified(token, "alice@corp.example"))

    def test_disabled_without_configuration(self):
        self.hub.reverse = None
        peer = self.connect()
        self.hub.handle(peer, {"type": "verify-reverse-start", "email": "alice@corp.example"})
        self.assertEqual(self.last(peer, "error")["code"], "verification_unavailable")


if __name__ == "__main__":
    unittest.main()
