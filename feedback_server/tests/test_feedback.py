import json
import sys
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import feedback as fb  # noqa: E402


def valid(**overrides):
    body = {
        "kind": "bug",
        "message": "Не открывается письмо с вложением",
        "contactEmail": "user@example.com",
        "diagnostics": {"appVersion": "0.9.126-dev.20261017061649", "platform": "macOS", "locale": "ru"},
        "device": "a" * 64,
    }
    body.update(overrides)
    return body


class FakeClock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


class ParseTests(unittest.TestCase):
    def test_valid_feedback(self):
        item = fb.parse_feedback(valid())
        self.assertEqual(item.kind, "bug")
        self.assertEqual(item.contact_email, "user@example.com")
        self.assertEqual(item.diagnostics["platform"], "macOS")
        self.assertRegex(item.id, r"^[0-9a-f]{8}$")

    def test_honeypot_is_dropped_silently(self):
        self.assertIsNone(fb.parse_feedback(valid(website="http://spam")))

    def test_rejects_unknown_fields_and_kinds(self):
        for body in (valid(extra=1), valid(kind="admin"), [], "x"):
            with self.subTest(body=body), self.assertRaises(fb.FeedbackError):
                fb.parse_feedback(body)

    def test_message_length_limits(self):
        with self.assertRaises(fb.FeedbackError):
            fb.parse_feedback(valid(message="ok"))
        with self.assertRaises(fb.FeedbackError):
            fb.parse_feedback(valid(message="x" * (fb.MAX_MESSAGE_CHARS + 1)))

    def test_control_characters_are_removed(self):
        item = fb.parse_feedback(valid(message="Строка\x00 один\r\nдва\x1b[31m"))
        self.assertEqual(item.message, "Строка один\nдва[31m")

    def test_rejects_bad_email_and_header_injection(self):
        for email in ("not-an-email", "a@b.c\r\nBcc: x@y.z", "x" * 300 + "@a.io", "a<b>@c.io"):
            with self.subTest(email=email), self.assertRaises(fb.FeedbackError):
                fb.parse_feedback(valid(contactEmail=email))

    def test_device_fingerprint_is_required(self):
        for device in (None, "", "short", "A" * 64, "z" * 64, "a" * 65):
            with self.subTest(device=device), self.assertRaises(fb.FeedbackError) as error:
                body = valid()
                if device is None:
                    del body["device"]
                else:
                    body["device"] = device
                fb.parse_feedback(body)
            self.assertEqual(error.exception.code, "invalid_device")

    def test_contact_email_is_optional(self):
        self.assertIsNone(fb.parse_feedback(valid(contactEmail="")).contact_email)

    def test_rejects_bad_diagnostics(self):
        for diagnostics in ({"appVersion": "1.0; rm -rf"}, {"cpu": "x"}, {"locale": "<script>"}, "x"):
            with self.subTest(diagnostics=diagnostics), self.assertRaises(fb.FeedbackError):
                fb.parse_feedback(valid(diagnostics=diagnostics))


class GuardTests(unittest.TestCase):
    def test_per_ip_window_limit(self):
        clock = FakeClock()
        guard = fb.AbuseGuard(clock)
        for i in range(fb.PER_IP_WINDOW_LIMIT):
            self.assertTrue(guard.check("1.1.1.1", f"f{i}"))
        with self.assertRaises(fb.FeedbackError) as error:
            guard.check("1.1.1.1", "next")
        self.assertEqual(error.exception.status, 429)
        self.assertTrue(guard.check("2.2.2.2", "other-ip"))
        clock.now += fb.PER_IP_WINDOW_SECONDS
        self.assertTrue(guard.check("1.1.1.1", "after-window"))

    def test_per_ip_day_limit(self):
        clock = FakeClock()
        guard = fb.AbuseGuard(clock)
        for i in range(fb.PER_IP_DAY_LIMIT):
            guard.check("1.1.1.1", f"f{i}")
            clock.now += fb.PER_IP_WINDOW_SECONDS
        with self.assertRaises(fb.FeedbackError):
            guard.check("1.1.1.1", "over-day")

    def test_per_device_limit_across_ips(self):
        clock = FakeClock()
        guard = fb.AbuseGuard(clock)
        for i in range(fb.PER_DEVICE_WINDOW_LIMIT):
            self.assertTrue(guard.check(f"10.0.0.{i}", f"f{i}", "dev1"))
        with self.assertRaises(fb.FeedbackError):
            guard.check("10.0.0.99", "next", "dev1")
        self.assertTrue(guard.check("10.0.0.99", "other-device", "dev2"))

    def test_global_day_limit(self):
        clock = FakeClock()
        guard = fb.AbuseGuard(clock, global_day_limit=5)
        for i in range(5):
            guard.check(f"10.0.1.{i}", f"f{i}", f"d{i}")
        with self.assertRaises(fb.FeedbackError):
            guard.check("10.0.1.99", "next", "d99")
        clock.now += fb.DAY_SECONDS
        self.assertTrue(guard.check("10.0.1.99", "after-day", "d99"))

    def test_duplicates_are_dropped(self):
        clock = FakeClock()
        guard = fb.AbuseGuard(clock)
        self.assertTrue(guard.check("1.1.1.1", "same"))
        self.assertFalse(guard.check("2.2.2.2", "same"))
        clock.now += fb.DUPLICATE_WINDOW_SECONDS
        self.assertTrue(guard.check("3.3.3.3", "same"))

    def test_fingerprint_ignores_case_and_spaces(self):
        a = fb.parse_feedback(valid(message="Ошибка   при  ОТПРАВКЕ"))
        b = fb.parse_feedback(valid(message="ошибка при отправке"))
        self.assertEqual(fb.fingerprint(a), fb.fingerprint(b))


class FormattingTests(unittest.TestCase):
    def test_issue_has_no_contact_email(self):
        item = fb.parse_feedback(valid(message="Сломалось @octocat смотри ```код``` user@example.com"))
        item.contact_email = "secret@example.com"
        issue = fb.github_issue(item)
        self.assertNotIn("secret@example.com", issue["title"] + issue["body"])
        self.assertIn("````text", issue["body"])
        self.assertNotIn("@octocat", issue["title"])

    def test_issue_title_neutralizes_mentions(self):
        item = fb.parse_feedback(valid(message="@everyone не работает"))
        self.assertIn("@​everyone", fb.github_issue(item)["title"])

    def test_telegram_text_is_limited(self):
        item = fb.parse_feedback(valid(message="я" * fb.MAX_MESSAGE_CHARS))
        self.assertLessEqual(len(fb.telegram_text(item, None)), fb.TELEGRAM_TEXT_LIMIT)

    def test_email_subject_is_single_line(self):
        item = fb.parse_feedback(valid(message="Первая строка\nвторая строка"))
        self.assertNotIn("\n", fb.email_subject(item))


class FakeSMTP:
    sent = []

    def __init__(self, host, port, timeout):
        self.host = host

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def starttls(self, context):
        pass

    def login(self, user, password):
        pass

    def send_message(self, message):
        FakeSMTP.sent.append(message)


class DelivererTests(unittest.TestCase):
    def settings(self):
        return fb.Settings(
            smtp_host="smtp.example.com", smtp_password="secret", mail_from="noreply@example.com", mail_to="owner@example.com",
            telegram_token="TOKEN", telegram_chat_id="-100", github_token="GH", github_repo="owner/repo",
        )

    def test_bug_goes_to_all_channels_and_links_issue(self):
        calls = []

        def post(url, payload, headers):
            calls.append((url, payload, headers))
            if "api.github.com" in url:
                return {"html_url": "https://github.com/owner/repo/issues/7"}
            return {"ok": True}

        FakeSMTP.sent = []
        results = fb.Deliverer(self.settings(), post=post, smtp_factory=FakeSMTP).deliver(fb.parse_feedback(valid()))
        self.assertEqual(results, {"github": "ok", "telegram": "ok", "email": "ok"})
        self.assertIn("issues/7", calls[1][1]["text"])
        self.assertNotIn("parse_mode", calls[1][1])
        self.assertEqual(calls[0][2]["Authorization"], "Bearer GH")
        self.assertEqual(FakeSMTP.sent[0]["Reply-To"], "user@example.com")

    def test_idea_does_not_create_issue(self):
        urls = []

        def post(url, payload, headers):
            urls.append(url)
            return {"ok": True}

        results = fb.Deliverer(self.settings(), post=post, smtp_factory=FakeSMTP).deliver(fb.parse_feedback(valid(kind="idea")))
        self.assertNotIn("github", results)
        self.assertFalse(any("github" in url for url in urls))

    def test_github_and_email_quotas(self):
        settings = self.settings()
        settings.github_daily_limit = 1
        settings.email_daily_limit = 1
        texts = []

        def post(url, payload, headers):
            if "api.github.com" in url:
                return {"html_url": "https://github.com/owner/repo/issues/1"}
            texts.append(payload["text"])
            return {"ok": True}

        deliverer = fb.Deliverer(settings, post=post, smtp_factory=FakeSMTP)
        first = deliverer.deliver(fb.parse_feedback(valid(message="Первая ошибка")))
        second = deliverer.deliver(fb.parse_feedback(valid(message="Вторая ошибка")))
        self.assertEqual(first, {"github": "ok", "telegram": "ok", "email": "ok"})
        self.assertEqual(second, {"github": "skipped:quota", "email": "skipped:quota", "telegram": "ok"})
        self.assertIn("лимит issue", texts[1])
        self.assertIn("лимит писем", texts[1])

    def test_channel_failure_does_not_stop_others(self):
        def post(url, payload, headers):
            if "api.github.com" in url:
                raise urllib.error.URLError("down")
            return {"ok": True}

        results = fb.Deliverer(self.settings(), post=post, smtp_factory=FakeSMTP).deliver(fb.parse_feedback(valid()))
        self.assertEqual(results["github"], "error:URLError")
        self.assertEqual(results["telegram"], "ok")
        self.assertEqual(results["email"], "ok")


class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.delivered = []
        deliverer = fb.Deliverer(fb.Settings())
        self.service = fb.FeedbackService(deliverer, log=lambda line: None)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), fb.make_handler(self.service))
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def request(self, path, body, content_type="application/json", headers=None):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        request = urllib.request.Request(self.url + path, data=data, method="POST",
                                         headers={"Content-Type": content_type, **(headers or {})})
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            with error:
                return error.code, json.loads(error.read())

    def test_accepts_feedback(self):
        status, body = self.request("/v1/feedback", valid())
        self.assertEqual(status, 202)
        self.assertTrue(body["ok"])
        self.assertEqual(self.service.queue.qsize(), 1)

    def test_rejects_wrong_path_type_and_size(self):
        self.assertEqual(self.request("/v1/other", valid())[0], 404)
        self.assertEqual(self.request("/v1/feedback", valid(), content_type="text/plain")[0], 415)
        self.assertEqual(self.request("/v1/feedback", b"x" * (fb.MAX_BODY_BYTES + 1))[0], 413)
        self.assertEqual(self.request("/v1/feedback", b"{bad")[0], 400)

    def test_rate_limit_uses_forwarded_ip_from_local_proxy(self):
        for i in range(fb.PER_IP_WINDOW_LIMIT):
            self.request("/v1/feedback", valid(message=f"Сообщение номер {i}"), headers={"X-Forwarded-For": "9.9.9.9"})
        status, body = self.request("/v1/feedback", valid(message="Ещё одно", device="b" * 64), headers={"X-Forwarded-For": "9.9.9.9"})
        self.assertEqual(status, 429)
        self.assertEqual(body["error"], "rate_limited")
        self.assertEqual(self.request("/v1/feedback", valid(message="Другой пользователь", device="c" * 64),
                                      headers={"X-Forwarded-For": "8.8.8.8"})[0], 202)


if __name__ == "__main__":
    unittest.main()
