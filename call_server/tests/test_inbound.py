import asyncio
import sys
import unittest
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

    def test_complete_requires_same_sender_and_is_single_use(self):
        token = self.reverse.start("alice@corp.example", "license:1")["token"]
        with self.assertRaises(inbound.ReverseVerificationError) as error:
            self.reverse.complete(token, "mallory@corp.example")
        self.assertEqual(error.exception.code, "sender_mismatch")
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

    def test_spf_requires_aligned_envelope(self):
        raw = make_message()
        self.assertEqual(inbound.authenticate_sender(raw, "alice@corp.example", "1.2.3.4", "alice@corp.example", "mx",
                                                     dkim_verify=lambda r, i: False, spf_check=lambda *a: "pass"), "spf")
        self.assertIsNone(inbound.authenticate_sender(raw, "alice@corp.example", "1.2.3.4", "alice@corp.example", "mx",
                                                      dkim_verify=lambda r, i: False, spf_check=lambda *a: "softfail"))

    def test_broken_signature_does_not_pass(self):
        raw = make_message(dkim_domain="corp.example")

        def broken(r, i):
            raise ValueError("bad signature")

        self.assertIsNone(inbound.authenticate_sender(raw, "alice@corp.example", "1.2.3.4", "", "mx",
                                                      dkim_verify=broken, spf_check=lambda *a: "pass"))


class HandlerTests(unittest.TestCase):
    def setUp(self):
        self.reverse = inbound.ReverseVerification(lambda email, subject: "proof", DOMAIN)
        self.verified = []
        self.auth_result = "dkim"
        self.handler = inbound.InboundHandler(
            self.reverse,
            lambda token, sender: self.verified.append((token, sender)) or True,
            authenticate=lambda *args: self.auth_result,
            log=lambda line: None,
        )

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
        reply = self.run_flow(ready["address"], make_message())
        self.assertTrue(reply.startswith("250"), reply)
        self.assertEqual(self.verified, [(ready["token"], "alice@corp.example")])

    def test_rejects_unknown_recipient_no_open_relay(self):
        self.assertTrue(self.run_flow("someone@gmail.com", make_message()).startswith("550"))
        self.assertTrue(self.run_flow(f"verify+abcdefghijklmnop@{DOMAIN}", make_message()).startswith("550"))
        self.assertEqual(self.verified, [])

    def test_rejects_unauthenticated_sender(self):
        ready = self.reverse.start("alice@corp.example", "license:1")
        self.auth_result = None
        self.assertTrue(self.run_flow(ready["address"], make_message()).startswith("550"))
        self.assertEqual(self.verified, [])

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
        second = self.connect(device="device-alice-2")
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

    def test_wrong_sender_is_rejected(self):
        peer = self.connect()
        self.hub.handle(peer, {"type": "verify-reverse-start", "email": "alice@corp.example"})
        token = self.last(peer, "verify-reverse-ready")["token"]
        self.assertFalse(self.hub.reverse_verified(token, "boss@corp.example"))
        self.assertIsNone(self.last(peer, "verified"))

    def test_disabled_without_configuration(self):
        self.hub.reverse = None
        peer = self.connect()
        self.hub.handle(peer, {"type": "verify-reverse-start", "email": "alice@corp.example"})
        self.assertEqual(self.last(peer, "error")["code"], "verification_unavailable")


if __name__ == "__main__":
    unittest.main()
