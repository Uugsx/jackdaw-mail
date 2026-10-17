"""Сквозная проверка с настоящими aiosmtpd и dkimpy: письмо с DKIM-подписью уходит по SMTP."""
import asyncio
import smtplib
import sys
import threading
import unittest
from email.utils import formatdate
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import inbound  # noqa: E402

try:
    import dkim  # noqa: F401
    from aiosmtpd.smtp import SMTP  # noqa: F401
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    HAVE_LIBS = True
except ImportError:
    HAVE_LIBS = False

DOMAIN = "verify.example.test"


@unittest.skipUnless(HAVE_LIBS, "нужны aiosmtpd, dkimpy и cryptography")
class RealSMTPTests(unittest.TestCase):
    def setUp(self):
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        self.private_pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.TraditionalOpenSSL,
                                             serialization.NoEncryption())
        public_der = key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
        import base64
        self.dns_record = b"v=DKIM1; k=rsa; p=" + base64.b64encode(public_der)
        self.reverse = inbound.ReverseVerification(lambda email, subject: "proof", DOMAIN)
        self.verified = []

    def dnsfunc(self, name, timeout=5):
        return self.dns_record if name == b"sel._domainkey.corp.example." else None

    def authenticate(self, raw, from_email, ip, mail_from, helo, **kwargs):
        return inbound.authenticate_sender(raw, from_email, ip, mail_from, helo,
                                           dkim_verify=lambda r, i: inbound.default_dkim_verify(r, i, self.dnsfunc),
                                           spf_check=lambda *a: "none", **kwargs)

    def signed_message(self, sender, to, include_headers=(b"from", b"to", b"subject", b"date")):
        body = (f"From: Alice <{sender}>\r\nTo: <{to}>\r\nSubject: Jackdaw\r\nDate: {formatdate()}\r\n"
                "Message-ID: <1@corp.example>\r\n\r\nПодтверждаю адрес.\r\n").encode()
        signature = dkim.sign(body, b"sel", b"corp.example", self.private_pem, include_headers=list(include_headers))
        return signature + body

    def send(self, message, to, sender="alice@corp.example"):
        loop = asyncio.new_event_loop()
        handler = inbound.InboundHandler(self.reverse, lambda t, s: self.verified.append((t, s)) or True,
                                         authenticate=self.authenticate, log=lambda line: None)
        server = loop.run_until_complete(inbound.start_inbound_server(handler, "127.0.0.1", 0, DOMAIN))
        port = server.sockets[0].getsockname()[1]
        thread = threading.Thread(target=loop.run_forever, daemon=True)
        thread.start()
        try:
            with smtplib.SMTP("127.0.0.1", port, timeout=10) as client:
                client.ehlo("mx.corp.example")
                return client.sendmail(sender, [to], message)
        finally:
            loop.call_soon_threadsafe(loop.stop)
            thread.join(5)
            server.close()
            loop.close()

    def test_signed_message_confirms_address(self):
        ready = self.reverse.start("alice@corp.example", "license:1")
        self.send(self.signed_message("alice@corp.example", ready["address"]), ready["address"])
        self.assertEqual(self.verified, [(ready["token"], "alice@corp.example")])

    def test_exchange_style_signature_over_russian_subject(self):
        # Exchange Online подписывает From:Date:Subject:Message-ID, но не To; тема клиента — в RFC 2047
        from email.message import EmailMessage

        ready = self.reverse.start("alice@corp.example", "license:1")
        message = EmailMessage()
        message["From"] = "Alice <alice@corp.example>"
        message["To"] = f"Jackdaw Mail <{ready['address']}>"
        message["Subject"] = ready["mailSubject"]
        message["Date"] = formatdate(localtime=True)
        message["Message-ID"] = "<2@corp.example>"
        message.set_content("Подтверждаю адрес.")
        body = message.as_bytes().replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")
        signature = dkim.sign(body, b"sel", b"corp.example", self.private_pem,
                              include_headers=[b"from", b"date", b"subject", b"message-id"])
        self.send(signature + body, ready["address"])
        self.assertEqual(self.verified, [(ready["token"], "alice@corp.example")])

    def test_tampered_message_is_rejected(self):
        ready = self.reverse.start("alice@corp.example", "license:1")
        tampered = self.signed_message("alice@corp.example", ready["address"]).replace(b"Subject: Jackdaw", b"Subject: Hacked")
        with self.assertRaises(smtplib.SMTPDataError) as error:
            self.send(tampered, ready["address"])
        self.assertEqual(error.exception.smtp_code, 550)
        self.assertEqual(self.verified, [])

    def test_replayed_signed_message_does_not_confirm_other_token(self):
        # Настоящее подписанное письмо для одного токена, пересланное в конверте на другой токен
        victim = self.reverse.start("alice@corp.example", "license:1")
        attacker = self.reverse.start("alice@corp.example", "license:2")
        with self.assertRaises(smtplib.SMTPDataError) as error:
            self.send(self.signed_message("alice@corp.example", victim["address"]), attacker["address"])
        self.assertEqual(error.exception.smtp_code, 550)
        self.assertEqual(self.verified, [])

    def test_signature_without_token_header_is_rejected(self):
        ready = self.reverse.start("alice@corp.example", "license:1")
        with self.assertRaises(smtplib.SMTPDataError) as error:
            self.send(self.signed_message("alice@corp.example", ready["address"], include_headers=(b"from", b"date")),
                      ready["address"])
        self.assertEqual(error.exception.smtp_code, 550)
        self.assertEqual(self.verified, [])

    def test_unknown_recipient_is_refused(self):
        with self.assertRaises(smtplib.SMTPRecipientsRefused):
            self.send(self.signed_message("alice@corp.example", "someone@gmail.com"), "someone@gmail.com")


if __name__ == "__main__":
    unittest.main()
