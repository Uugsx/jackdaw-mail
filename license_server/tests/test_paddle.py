import hashlib
import hmac
import http.server
import json
import os
import socket
import sqlite3
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from license_server import app

PADDLE_SECRET = "pdl_ntfset_test_secret_value"
MONTHLY_PRICE = "pri_01m5a4y49fpvggt57sfxwaf7k4"
YEARLY_PRICE = "pri_01m5a4yq26dcyy79600zwytjrw"
PRODUCT_ID = "pro_01m5a4tmfa7qet7sgepx5wdh5h"
UNKNOWN_PRICE = "pri_01zzzzzzzzzzzzzzzzzzzzzzzz"
CLIENT_TOKEN = "test_0123456789abcdef0123456789a"
CLAIM_TOKEN = "A" * 42 + "Q"
SUBSCRIPTION_ID = "sub_01aaaaaaaaaaaaaaaaaaaaaaaa"
TRANSACTION_ID = "txn_01aaaaaaaaaaaaaaaaaaaaaaaa"
RENEWAL_TRANSACTION_ID = "txn_01bbbbbbbbbbbbbbbbbbbbbbbb"
DEVICE_ID = "device-paddle-0001"
PADDLE_ENV_NAMES = (
    "PADDLE_ENVIRONMENT",
    "PADDLE_CLIENT_TOKEN",
    "PADDLE_WEBHOOK_SECRET",
    "PADDLE_MONTHLY_PRICE_ID",
    "PADDLE_YEARLY_PRICE_ID",
    "PADDLE_PRODUCT_ID",
    "PADDLE_WEBHOOK_TOLERANCE_SECONDS",
    "PADDLE_API_KEY",
    "JACKDAW_LICENSE_SMTP_PASSWORD_FILE",
    "JACKDAW_LICENSE_SMTP_HOST",
    "JACKDAW_LICENSE_SMTP_PORT",
    "JACKDAW_LICENSE_SMTP_USER",
    "JACKDAW_LICENSE_MAIL_FROM",
)
CUSTOMER_ID = "ctm_01" + "c" * 24
BUYER_EMAIL = "buyer@example.com"
SANDBOX_API_KEY = "pdl_sdbx_apikey_" + "0" * 26 + "_" + "A" * 22 + "_" + "B1c"
LIVE_API_KEY = SANDBOX_API_KEY.replace("pdl_sdbx_", "pdl_live_")


def iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def sign(body: bytes, secret: str = PADDLE_SECRET, timestamp: int | None = None) -> str:
    ts = str(int(time.time()) if timestamp is None else timestamp)
    digest = hmac.new(secret.encode("utf-8"), ts.encode("ascii") + b":" + body, hashlib.sha256).hexdigest()
    return f"ts={ts};h1={digest}"


def unused_port() -> int:
    """Порт, на котором никто не слушает."""
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


class PaddleSignatureTests(unittest.TestCase):
    def test_valid_signature_is_accepted(self) -> None:
        body = b'{"event_id":"evt_1"}'
        self.assertTrue(app.verify_paddle_signature(sign(body), body, PADDLE_SECRET))

    def test_any_rotated_h1_may_match(self) -> None:
        body = b"{}"
        header = sign(body)
        rotated = f"{header.split(';')[0]};h1={'0' * 64};{header.split(';')[1]}"
        self.assertTrue(app.verify_paddle_signature(rotated, body, PADDLE_SECRET))

    def test_invalid_signatures_are_rejected(self) -> None:
        body = b'{"event_id":"evt_1"}'
        self.assertFalse(app.verify_paddle_signature(sign(body, secret="other-secret"), body, PADDLE_SECRET))
        self.assertFalse(app.verify_paddle_signature(sign(body), body + b" ", PADDLE_SECRET))
        self.assertFalse(app.verify_paddle_signature("", body, PADDLE_SECRET))
        self.assertFalse(app.verify_paddle_signature("ts=abc;h1=00", body, PADDLE_SECRET))
        self.assertFalse(app.verify_paddle_signature(f"ts={int(time.time())}", body, PADDLE_SECRET))
        self.assertFalse(app.verify_paddle_signature(sign(body), body, ""))

    def test_stale_or_future_timestamp_is_rejected(self) -> None:
        body = b"{}"
        now = int(time.time())
        self.assertFalse(app.verify_paddle_signature(sign(body, timestamp=now - 60), body, PADDLE_SECRET, 5))
        self.assertFalse(app.verify_paddle_signature(sign(body, timestamp=now + 60), body, PADDLE_SECRET, 5))
        self.assertTrue(app.verify_paddle_signature(sign(body, timestamp=now - 60), body, PADDLE_SECRET, 120))

    def test_sealed_key_opens_only_with_the_claim_token(self) -> None:
        sealed = app.seal_license_key("JACKDAW-PRO-ABCD-EFGH-JKLM-NPQR", CLAIM_TOKEN, TRANSACTION_ID)
        self.assertNotIn("JACKDAW", sealed)
        self.assertEqual(app.open_license_key(sealed, CLAIM_TOKEN, TRANSACTION_ID), "JACKDAW-PRO-ABCD-EFGH-JKLM-NPQR")
        self.assertIsNone(app.open_license_key(sealed, "B" * 42 + "Q", TRANSACTION_ID))
        self.assertIsNone(app.open_license_key(sealed, CLAIM_TOKEN, RENEWAL_TRANSACTION_ID))


class PaddleConfigurationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.previous = {name: os.environ.get(name) for name in PADDLE_ENV_NAMES}
        for name in PADDLE_ENV_NAMES:
            os.environ.pop(name, None)

    def tearDown(self) -> None:
        for name, value in self.previous.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value

    def _set_complete_sandbox(self) -> None:
        os.environ.update(
            {
                "PADDLE_ENVIRONMENT": "sandbox",
                "PADDLE_CLIENT_TOKEN": CLIENT_TOKEN,
                "PADDLE_WEBHOOK_SECRET": PADDLE_SECRET,
                "PADDLE_MONTHLY_PRICE_ID": MONTHLY_PRICE,
                "PADDLE_YEARLY_PRICE_ID": YEARLY_PRICE,
                "PADDLE_PRODUCT_ID": PRODUCT_ID,
            }
        )

    def test_paddle_is_disabled_without_configuration(self) -> None:
        config = app.Configuration()
        self.assertEqual(config.paddle_environment, "sandbox")
        self.assertFalse(config.paddle_webhook_configured)
        self.assertFalse(config.paddle_checkout_configured)

    def test_complete_sandbox_configuration_maps_prices_to_plans(self) -> None:
        self._set_complete_sandbox()
        config = app.Configuration()
        self.assertTrue(config.paddle_checkout_configured)
        self.assertEqual(config.paddle_price_plans, {MONTHLY_PRICE: "monthly", YEARLY_PRICE: "yearly"})
        self.assertEqual(config.paddle_signature_tolerance_seconds, 5)

    def test_live_token_is_rejected_in_sandbox_and_bad_values_fail_fast(self) -> None:
        self._set_complete_sandbox()
        os.environ["PADDLE_CLIENT_TOKEN"] = "live_0123456789abcdef0123456789a"
        with self.assertRaises(RuntimeError):
            app.Configuration()
        self._set_complete_sandbox()
        os.environ["PADDLE_ENVIRONMENT"] = "live"
        with self.assertRaises(RuntimeError):
            app.Configuration()
        self._set_complete_sandbox()
        os.environ["PADDLE_MONTHLY_PRICE_ID"] = "price-monthly"
        with self.assertRaises(RuntimeError):
            app.Configuration()
        self._set_complete_sandbox()
        os.environ["PADDLE_YEARLY_PRICE_ID"] = MONTHLY_PRICE
        with self.assertRaises(RuntimeError):
            app.Configuration()

    def test_key_email_needs_api_key_and_smtp_password_file(self) -> None:
        self._set_complete_sandbox()
        config = app.Configuration()
        self.assertFalse(config.key_email_configured)
        self.assertEqual((config.smtp_host, config.smtp_port, config.smtp_user), ("smtp.resend.com", 2587, "resend"))
        self.assertEqual(config.mail_from, "Jackdaw Mail <noreply@jackdaw-mail.pro>")
        os.environ["PADDLE_API_KEY"] = SANDBOX_API_KEY
        self.assertFalse(app.Configuration().key_email_configured)
        os.environ["JACKDAW_LICENSE_SMTP_PASSWORD_FILE"] = "/etc/jackdaw-calls/smtp.secret"
        config = app.Configuration()
        self.assertTrue(config.key_email_configured)
        self.assertEqual(config.smtp_password_file, Path("/etc/jackdaw-calls/smtp.secret"))

    def test_bad_key_email_values_fail_fast_without_echoing_secrets(self) -> None:
        self._set_complete_sandbox()
        os.environ["PADDLE_API_KEY"] = LIVE_API_KEY
        with self.assertRaises(RuntimeError) as error:
            app.Configuration()
        self.assertNotIn(LIVE_API_KEY, str(error.exception))
        os.environ["PADDLE_API_KEY"] = "not-a-key"
        with self.assertRaises(RuntimeError):
            app.Configuration()
        os.environ["PADDLE_API_KEY"] = SANDBOX_API_KEY
        os.environ["JACKDAW_LICENSE_SMTP_PORT"] = "smtp"
        with self.assertRaises(RuntimeError):
            app.Configuration()
        os.environ["JACKDAW_LICENSE_SMTP_PORT"] = "2587"
        os.environ["JACKDAW_LICENSE_MAIL_FROM"] = "noreply@jackdaw-mail.pro\r\nBcc: x@example.com"
        with self.assertRaises(RuntimeError):
            app.Configuration()


class PaddleWebhookTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        private_key = Ed25519PrivateKey.generate()
        key_path = Path(self.temp_dir.name) / "private.pem"
        key_path.write_bytes(
            private_key.private_bytes(
                serialization.Encoding.PEM,
                serialization.PrivateFormat.PKCS8,
                serialization.NoEncryption(),
            )
        )
        self.database_path = Path(self.temp_dir.name) / "license.sqlite3"
        self.store = app.LicenseStore(self.database_path)
        self.signer = app.EntitlementSigner(key_path)
        self.config = SimpleNamespace(
            store_configured=False,
            monthly_checkout_url=None,
            yearly_checkout_url=None,
            webhook_secret="",
            store_id="",
            allowed_origins={"https://jackdaw-mail.pro"},
            admin_token_sha256="",
            trial_days=7,
            grace_days=7,
            paddle_environment="sandbox",
            paddle_client_token=CLIENT_TOKEN,
            paddle_webhook_secret=PADDLE_SECRET,
            paddle_price_ids={"monthly": MONTHLY_PRICE, "yearly": YEARLY_PRICE},
            paddle_price_plans={MONTHLY_PRICE: "monthly", YEARLY_PRICE: "yearly"},
            paddle_product_id=PRODUCT_ID,
            paddle_signature_tolerance_seconds=5,
            paddle_webhook_configured=True,
            paddle_checkout_configured=True,
        )
        server = app.ThreadingHTTPServer(("127.0.0.1", 0), app.LicenseRequestHandler)
        server.service = app.LicenseHTTPService(self.config, self.store, self.signer)  # type: ignore[attr-defined]
        self.service = server.service  # type: ignore[attr-defined]
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        self.base_url = f"http://127.0.0.1:{server.server_address[1]}"
        self.event_counter = 0

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def _request(self, method: str, path: str, body: bytes | None = None, headers: dict[str, str] | None = None) -> tuple[int, dict[str, str], dict[str, object]]:
        request = urllib.request.Request(f"{self.base_url}{path}", data=body, headers=headers or {}, method=method)

        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *args: object, **kwargs: object) -> None:
                return None

        opener = urllib.request.build_opener(NoRedirect)
        try:
            with opener.open(request, timeout=3) as response:
                raw = response.read()
                return response.status, dict(response.headers), json.loads(raw) if raw else {}
        except urllib.error.HTTPError as error:
            with error:
                raw = error.read()
                return error.code, dict(error.headers), json.loads(raw) if raw else {}

    def _event_id(self) -> str:
        self.event_counter += 1
        return "evt_01" + f"{self.event_counter:024d}"

    def _post_event(self, event: dict[str, object], signature: str | None = None) -> tuple[int, dict[str, object]]:
        body = json.dumps(event).encode("utf-8")
        headers = {"Content-Type": "application/json", "Paddle-Signature": signature if signature is not None else sign(body)}
        status, _headers, payload = self._request("POST", "/v1/webhooks/paddle", body, headers)
        return status, payload

    def _event(self, event_type: str, data: dict[str, object], occurred_at: datetime | None = None, event_id: str | None = None) -> dict[str, object]:
        return {
            "event_id": event_id or self._event_id(),
            "event_type": event_type,
            "occurred_at": iso(occurred_at or datetime.now(timezone.utc)),
            "notification_id": "ntf_01" + "0" * 24,
            "data": data,
        }

    @staticmethod
    def _items(price_id: str, product_id: str = PRODUCT_ID) -> list[dict[str, object]]:
        return [{"price": {"id": price_id, "product_id": product_id}, "quantity": 1}]

    def _transaction(
        self,
        price_id: str = MONTHLY_PRICE,
        transaction_id: str = TRANSACTION_ID,
        ends_at: datetime | None = None,
        claim_token: str | None = CLAIM_TOKEN,
        origin: str = "web",
    ) -> dict[str, object]:
        starts_at = datetime.now(timezone.utc)
        return {
            "id": transaction_id,
            "status": "completed",
            "customer_id": "ctm_01" + "c" * 24,
            "subscription_id": SUBSCRIPTION_ID,
            "origin": origin,
            "custom_data": {"jackdaw_claim": claim_token} if claim_token else None,
            "items": self._items(price_id),
            "billing_period": {"starts_at": iso(starts_at), "ends_at": iso(ends_at or starts_at + timedelta(days=30))},
        }

    def _subscription(self, status: str, price_id: str = MONTHLY_PRICE, canceled_at: datetime | None = None, paused_at: datetime | None = None) -> dict[str, object]:
        return {
            "id": SUBSCRIPTION_ID,
            "status": status,
            "customer_id": "ctm_01" + "c" * 24,
            "items": self._items(price_id),
            "canceled_at": iso(canceled_at) if canceled_at else None,
            "paused_at": iso(paused_at) if paused_at else None,
            "current_billing_period": None,
            "scheduled_change": None,
        }

    def _claim(self, transaction_id: str = TRANSACTION_ID, claim_token: str = CLAIM_TOKEN) -> tuple[int, dict[str, object]]:
        body = json.dumps({"transactionId": transaction_id, "claimToken": claim_token}).encode("utf-8")
        status, _headers, payload = self._request(
            "POST", "/v1/paddle/claim", body, {"Content-Type": "application/json", "Origin": "https://jackdaw-mail.pro"}
        )
        return status, payload

    def _license(self) -> sqlite3.Row:
        with sqlite3.connect(self.database_path) as connection:
            connection.row_factory = sqlite3.Row
            rows = connection.execute("SELECT * FROM licenses").fetchall()
        self.assertEqual(len(rows), 1)
        return rows[0]

    def _license_count(self) -> int:
        with sqlite3.connect(self.database_path) as connection:
            return int(connection.execute("SELECT COUNT(*) FROM licenses").fetchone()[0])

    def _activate(self, license_key: str) -> tuple[int, dict[str, object]]:
        body = json.dumps({"licenseKey": license_key, "deviceId": DEVICE_ID, "deviceName": "Mac"}).encode("utf-8")
        status, _headers, payload = self._request("POST", "/v1/license/activate", body, {"Content-Type": "application/json"})
        return status, payload

    def _status(self) -> str:
        return self.store._effective_status(self._license())

    def test_migration_file_matches_embedded_sql_and_rolls_back(self) -> None:
        migration_dir = Path(app.__file__).with_name("migrations")
        self.assertEqual((migration_dir / "003_paddle_billing.sql").read_text(encoding="utf-8"), app.PADDLE_BILLING_MIGRATION_SQL)
        with sqlite3.connect(self.database_path) as connection:
            connection.executescript((migration_dir / "003_paddle_billing.rollback.sql").read_text(encoding="utf-8"))
            tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
            self.assertNotIn("paddle_subscriptions", tables)
            self.assertNotIn(3, {row[0] for row in connection.execute("SELECT version FROM schema_migrations")})
        app.LicenseStore(self.database_path)
        with sqlite3.connect(self.database_path) as connection:
            tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        self.assertTrue({"paddle_subscriptions", "paddle_key_deliveries", "licenses", "trial_claims"} <= tables)

    def test_public_config_exposes_only_public_paddle_values(self) -> None:
        status, _headers, payload = self._request("GET", "/v1/public-config")
        self.assertEqual(status, 200)
        paddle = payload["paddle"]
        self.assertEqual(paddle, {"configured": True, "environment": "sandbox", "clientToken": CLIENT_TOKEN, "prices": {"monthly": MONTHLY_PRICE, "yearly": YEARLY_PRICE}})
        self.assertNotIn(PADDLE_SECRET, json.dumps(payload))
        self.assertTrue(payload["checkout"]["monthly"]["configured"])

    def test_public_config_marks_paddle_unavailable_without_client_token(self) -> None:
        self.config.paddle_checkout_configured = False
        _status, _headers, payload = self._request("GET", "/v1/public-config")
        self.assertEqual(payload["paddle"], {"configured": False})
        self.assertFalse(payload["checkout"]["monthly"]["configured"])

    def test_legacy_buy_link_opens_paddle_checkout_on_the_site(self) -> None:
        status, headers, _payload = self._request("GET", "/buy/yearly")
        self.assertEqual(status, 302)
        self.assertEqual(headers["Location"], "https://jackdaw-mail.pro/?checkout=yearly#plans")

    def test_invalid_signature_is_rejected_without_issuing_a_license(self) -> None:
        event = self._event("transaction.completed", self._transaction())
        status, payload = self._post_event(event, signature=sign(b"other body"))
        self.assertEqual(status, 401)
        self.assertEqual(payload["error"], "invalid_webhook_signature")
        status, _payload = self._post_event(event, signature=sign(json.dumps(event).encode("utf-8"), timestamp=int(time.time()) - 600))
        self.assertEqual(status, 401)
        self.assertEqual(self._license_count(), 0)

    def test_monthly_purchase_issues_a_key_only_to_the_claim_token_holder(self) -> None:
        status, _payload = self._claim()
        self.assertEqual(status, 404)
        status, payload = self._post_event(self._event("transaction.completed", self._transaction()))
        self.assertEqual((status, payload), (200, {"ok": True}))

        status, payload = self._claim(claim_token="B" * 42 + "Q")
        self.assertEqual(status, 404)
        self.assertEqual(payload["error"], "purchase_pending")

        status, payload = self._claim()
        self.assertEqual(status, 200)
        license_key = payload["licenseKey"]
        self.assertRegex(license_key, app.LICENSE_KEY_RE)
        self.assertEqual(payload["license"]["plan"], "monthly")
        self.assertEqual(payload["license"]["status"], "active")

        row = self._license()
        self.assertEqual(row["source"], "paddle-sandbox")
        self.assertEqual(row["provider_license_id"], SUBSCRIPTION_ID)
        self.assertEqual(row["key_hash"], app.license_key_hash(license_key))
        with sqlite3.connect(self.database_path) as connection:
            dump = "\n".join(connection.iterdump())
        self.assertNotIn(license_key, dump)
        self.assertNotIn(CLAIM_TOKEN, dump)

        status, payload = self._activate(license_key)
        self.assertEqual(status, 200)
        self.assertEqual(payload["entitlement"]["payload"]["plan"], "monthly")

    def test_yearly_purchase_maps_to_yearly_plan(self) -> None:
        ends_at = datetime.now(timezone.utc) + timedelta(days=365)
        status, _payload = self._post_event(self._event("transaction.completed", self._transaction(YEARLY_PRICE, ends_at=ends_at)))
        self.assertEqual(status, 200)
        row = self._license()
        self.assertEqual(row["plan"], "yearly")
        self.assertEqual(row["expires_at"], iso(ends_at + timedelta(days=7)))

    def test_repeated_webhook_is_idempotent(self) -> None:
        event = self._event("transaction.completed", self._transaction())
        self.assertEqual(self._post_event(event), (200, {"ok": True}))
        first = self._license()
        self.assertEqual(self._post_event(event), (200, {"ok": True, "duplicate": True}))
        # Повтор той же транзакции новым событием тоже не создаёт второй ключ.
        retry = self._event("transaction.completed", self._transaction())
        self.assertEqual(self._post_event(retry), (200, {"ok": True}))
        self.assertEqual(self._license_count(), 1)
        self.assertEqual(self._license()["key_hash"], first["key_hash"])

    def test_unknown_price_or_product_is_ignored(self) -> None:
        status, payload = self._post_event(self._event("transaction.completed", self._transaction(UNKNOWN_PRICE)))
        self.assertEqual((status, payload), (200, {"ok": True, "ignored": "price"}))
        data = self._transaction()
        data["items"] = self._items(MONTHLY_PRICE, product_id="pro_01zzzzzzzzzzzzzzzzzzzzzzzz")
        status, payload = self._post_event(self._event("transaction.completed", data))
        self.assertEqual((status, payload), (200, {"ok": True, "ignored": "price"}))
        self.assertEqual(self._license_count(), 0)

    def test_simulator_event_ids_are_accepted_and_malformed_ids_rejected(self) -> None:
        simulated = self._event("transaction.completed", self._transaction(UNKNOWN_PRICE), event_id="ntfsimevt_01" + "s" * 24)
        self.assertEqual(self._post_event(simulated), (200, {"ok": True, "ignored": "price"}))
        simulated = self._event("transaction.completed", self._transaction(), event_id="ntfsimevt_01" + "t" * 24)
        self.assertEqual(self._post_event(simulated), (200, {"ok": True}))
        self.assertEqual(self._license_count(), 1)
        status, payload = self._post_event(self._event("transaction.completed", self._transaction(), event_id="event-1"))
        self.assertEqual((status, payload["error"]), (400, "invalid_webhook_event"))

    def test_unpaid_transaction_does_not_grant_access(self) -> None:
        data = self._transaction()
        data["status"] = "billed"
        status, payload = self._post_event(self._event("transaction.completed", data))
        self.assertEqual((status, payload), (200, {"ok": True, "ignored": "status"}))
        self.assertEqual(self._post_event(self._event("subscription.activated", self._subscription("active")))[0], 200)
        self.assertEqual(self._license_count(), 0)

    def test_renewal_extends_access_and_stale_renewal_does_not_shorten_it(self) -> None:
        first_end = datetime.now(timezone.utc) + timedelta(days=30)
        self._post_event(self._event("transaction.completed", self._transaction(ends_at=first_end)))
        second_end = first_end + timedelta(days=30)
        renewal = self._transaction(transaction_id=RENEWAL_TRANSACTION_ID, ends_at=second_end, origin="subscription_recurring")
        self.assertEqual(self._post_event(self._event("transaction.completed", renewal))[0], 200)
        self.assertEqual(self._license()["expires_at"], iso(second_end + timedelta(days=7)))
        # Запоздавшее событие первой оплаты не откатывает продление.
        self._post_event(self._event("transaction.completed", self._transaction(ends_at=first_end)))
        self.assertEqual(self._license()["expires_at"], iso(second_end + timedelta(days=7)))
        self.assertEqual(self._license_count(), 1)

    def test_cancellation_ends_access_at_the_end_of_the_paid_period(self) -> None:
        now = datetime.now(timezone.utc)
        self._post_event(self._event("transaction.completed", self._transaction(ends_at=now + timedelta(days=30))))
        scheduled = self._subscription("active")
        scheduled["scheduled_change"] = {"action": "cancel", "effective_at": iso(now + timedelta(days=30))}
        self._post_event(self._event("subscription.updated", scheduled))
        self.assertEqual(self._status(), "active")

        canceled_at = now - timedelta(seconds=1)
        self.assertEqual(self._post_event(self._event("subscription.canceled", self._subscription("canceled", canceled_at=canceled_at)))[0], 200)
        row = self._license()
        self.assertEqual(row["expires_at"], iso(canceled_at))
        self.assertEqual(self._status(), "expired")

    def test_out_of_order_subscription_events_are_ignored(self) -> None:
        now = datetime.now(timezone.utc)
        self._post_event(self._event("transaction.completed", self._transaction(ends_at=now + timedelta(days=30))))
        canceled_at = now - timedelta(seconds=1)
        self._post_event(self._event("subscription.canceled", self._subscription("canceled", canceled_at=canceled_at), occurred_at=now))
        # Старое событие active пришло позже отмены и не должно вернуть доступ.
        self._post_event(self._event("subscription.activated", self._subscription("active"), occurred_at=now - timedelta(minutes=5)))
        self.assertEqual(self._status(), "expired")
        self.assertEqual(self.store.find_paddle_subscription(SUBSCRIPTION_ID)["status"], "canceled")

    def test_payment_problem_gives_grace_period_and_recovery_restores_access(self) -> None:
        now = datetime.now(timezone.utc)
        self._post_event(self._event("transaction.completed", self._transaction(ends_at=now + timedelta(days=1))))
        self._post_event(self._event("subscription.past_due", self._subscription("past_due"), occurred_at=now))
        row = self._license()
        self.assertEqual(self._status(), "past_due")
        self.assertIsNotNone(row["grace_until"])

        renewal = self._transaction(transaction_id=RENEWAL_TRANSACTION_ID, ends_at=now + timedelta(days=31), origin="subscription_recurring")
        self._post_event(self._event("transaction.completed", renewal, occurred_at=now + timedelta(seconds=1)))
        self._post_event(self._event("subscription.updated", self._subscription("active"), occurred_at=now + timedelta(seconds=2)))
        row = self._license()
        self.assertEqual(self._status(), "active")
        self.assertIsNone(row["grace_until"])
        self.assertEqual(row["expires_at"], iso(now + timedelta(days=38)))

    def test_plan_switch_updates_the_license_plan(self) -> None:
        self._post_event(self._event("transaction.completed", self._transaction()))
        self._post_event(self._event("subscription.updated", self._subscription("active", price_id=YEARLY_PRICE)))
        self.assertEqual(self._license()["plan"], "yearly")

    def test_full_refund_revokes_and_later_events_cannot_restore(self) -> None:
        self._post_event(self._event("transaction.completed", self._transaction()))
        partial = {"id": "adj_01" + "a" * 24, "action": "refund", "type": "partial", "status": "approved", "transaction_id": TRANSACTION_ID, "subscription_id": SUBSCRIPTION_ID}
        self.assertEqual(self._post_event(self._event("adjustment.created", partial))[1], {"ok": True, "ignored": "adjustment"})
        self.assertEqual(self._status(), "active")
        full = dict(partial, type="full")
        self.assertEqual(self._post_event(self._event("adjustment.updated", full)), (200, {"ok": True}))
        self.assertEqual(self._status(), "revoked")
        self._post_event(self._event("subscription.updated", self._subscription("active")))
        self.assertEqual(self._status(), "revoked")
        status, payload = self._claim()
        self.assertEqual((status, payload["error"]), (403, "license_inactive"))

    def test_refund_before_payment_is_retried_by_paddle(self) -> None:
        full = {"id": "adj_01" + "a" * 24, "action": "refund", "type": "full", "status": "approved", "transaction_id": TRANSACTION_ID, "subscription_id": SUBSCRIPTION_ID}
        status, payload = self._post_event(self._event("adjustment.created", full))
        self.assertEqual((status, payload["error"]), (409, "subscription_not_ready"))

    def test_purchase_without_claim_token_still_creates_a_license(self) -> None:
        self._post_event(self._event("transaction.completed", self._transaction(claim_token=None)))
        self.assertEqual(self._license_count(), 1)
        self.assertEqual(self._claim()[0], 404)

    def test_claim_rejects_malformed_input(self) -> None:
        self.assertEqual(self._claim(transaction_id="txn_bad")[0], 400)
        self.assertEqual(self._claim(claim_token="short")[0], 400)

    def _attach_mailer(self, send_failures: int = 0, fetch_error: Exception | None = None, retry_delays: tuple[int, ...] = (60, 300)) -> SimpleNamespace:
        state = SimpleNamespace(sent=[], fetched=[], send_attempts=0, sent_event=threading.Event())

        def fetch(customer_id: str) -> str:
            state.fetched.append(customer_id)
            if fetch_error is not None:
                raise fetch_error
            return BUYER_EMAIL

        def send(message: object) -> None:
            state.send_attempts += 1
            if state.send_attempts <= send_failures:
                raise app.KeyEmailRetryableError("smtp_SMTPServerDisconnected")
            state.sent.append(message)
            state.sent_event.set()

        mailer = app.PaddleKeyMailer(self.store, self.signer.derive_secret(app.PADDLE_KEY_EMAIL_INFO), fetch, send, app.DEFAULT_MAIL_FROM, retry_delays=retry_delays, poll_seconds=3600)
        self.service.mailer = mailer
        state.mailer = mailer
        return state

    def _key_emails(self) -> list[sqlite3.Row]:
        with sqlite3.connect(self.database_path) as connection:
            connection.row_factory = sqlite3.Row
            return connection.execute("SELECT * FROM paddle_key_emails").fetchall()

    def _dump(self) -> str:
        with sqlite3.connect(self.database_path) as connection:
            return "\n".join(connection.iterdump())

    def test_key_emails_migration_file_matches_embedded_sql_and_rolls_back(self) -> None:
        migration_dir = Path(app.__file__).with_name("migrations")
        self.assertEqual((migration_dir / "004_paddle_key_emails.sql").read_text(encoding="utf-8"), app.PADDLE_KEY_EMAILS_MIGRATION_SQL)
        with sqlite3.connect(self.database_path) as connection:
            connection.executescript((migration_dir / "004_paddle_key_emails.rollback.sql").read_text(encoding="utf-8"))
            tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
            self.assertNotIn("paddle_key_emails", tables)
            self.assertIn("paddle_key_deliveries", tables)
            self.assertNotIn(4, {row[0] for row in connection.execute("SELECT version FROM schema_migrations")})
        app.LicenseStore(self.database_path)
        with sqlite3.connect(self.database_path) as connection:
            tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        self.assertIn("paddle_key_emails", tables)

    def test_first_payment_emails_the_key_once(self) -> None:
        mail = self._attach_mailer()
        event = self._event("transaction.completed", self._transaction())
        self.assertEqual(self._post_event(event), (200, {"ok": True}))
        # До отправки в базе нет ни ключа, ни адреса: только id покупателя и шифротекст.
        status, payload = self._claim()
        license_key = payload["licenseKey"]
        self.assertNotIn(license_key, self._dump())
        self.assertNotIn(BUYER_EMAIL, self._dump())

        self.assertEqual(mail.mailer.run_once(), 1)
        self.assertEqual(len(mail.sent), 1)
        message = mail.sent[0]
        self.assertEqual(message["To"], BUYER_EMAIL)
        self.assertEqual(message["From"], app.DEFAULT_MAIL_FROM)
        self.assertIn(license_key, message.get_content())
        self.assertIn("месячная подписка", message.get_content())
        self.assertEqual(mail.fetched, [CUSTOMER_ID])

        # Повтор события, новая доставка той же транзакции и продление второго письма не создают.
        self.assertEqual(self._post_event(event), (200, {"ok": True, "duplicate": True}))
        self.assertEqual(self._post_event(self._event("transaction.completed", self._transaction())), (200, {"ok": True}))
        renewal = self._transaction(transaction_id=RENEWAL_TRANSACTION_ID, ends_at=datetime.now(timezone.utc) + timedelta(days=60), origin="subscription_recurring")
        self.assertEqual(self._post_event(self._event("transaction.completed", renewal))[0], 200)
        self.assertEqual(mail.mailer.run_once(datetime.now(timezone.utc) + timedelta(days=10)), 0)
        self.assertEqual(len(mail.sent), 1)

        rows = self._key_emails()
        self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0]["status"], rows[0]["customer_id"], rows[0]["sealed_key"]), ("sent", None, None))
        self.assertIsNotNone(rows[0]["sent_at"])
        self.assertEqual(status, 200)

    def test_webhook_answers_before_the_background_email_is_sent(self) -> None:
        mail = self._attach_mailer()
        release = threading.Event()
        original_fetch = mail.mailer._fetch_email

        def slow_fetch(customer_id: str) -> str:
            release.wait(5)
            return original_fetch(customer_id)

        mail.mailer._fetch_email = slow_fetch
        worker = mail.mailer.start()
        self.addCleanup(mail.mailer.stop)
        started = time.monotonic()
        self.assertEqual(self._post_event(self._event("transaction.completed", self._transaction())), (200, {"ok": True}))
        self.assertLess(time.monotonic() - started, 2)
        self.assertEqual(mail.sent, [])
        release.set()
        self.assertTrue(mail.sent_event.wait(5))
        mail.mailer.stop()
        worker.join(5)
        self.assertFalse(worker.is_alive())
        self.assertEqual(len(mail.sent), 1)
        self.assertEqual(self._key_emails()[0]["status"], "sent")

    def test_smtp_failure_is_retried_later(self) -> None:
        mail = self._attach_mailer(send_failures=1)
        self._post_event(self._event("transaction.completed", self._transaction()))
        now = datetime.now(timezone.utc)
        self.assertEqual(mail.mailer.run_once(now), 1)
        self.assertEqual(mail.sent, [])
        row = self._key_emails()[0]
        self.assertEqual((row["status"], row["attempts"], row["last_error"]), ("pending", 1, "smtp_SMTPServerDisconnected"))
        self.assertIsNotNone(row["sealed_key"])
        # Раньше паузы повтора письмо не отправляется.
        self.assertEqual(mail.mailer.run_once(now + timedelta(seconds=30)), 0)
        self.assertEqual(mail.mailer.run_once(now + timedelta(seconds=61)), 1)
        self.assertEqual(len(mail.sent), 1)
        self.assertEqual(self._key_emails()[0]["status"], "sent")

    def test_email_gives_up_after_retries_and_the_key_stays_on_the_page(self) -> None:
        mail = self._attach_mailer(send_failures=100, retry_delays=(60,))
        self._post_event(self._event("transaction.completed", self._transaction()))
        now = datetime.now(timezone.utc)
        mail.mailer.run_once(now)
        mail.mailer.run_once(now + timedelta(seconds=61))
        self.assertEqual(mail.send_attempts, 2)
        row = self._key_emails()[0]
        self.assertEqual((row["status"], row["sealed_key"], row["customer_id"]), ("failed", None, None))
        self.assertEqual(mail.mailer.run_once(now + timedelta(days=30)), 0)
        status, payload = self._claim()
        self.assertEqual(status, 200)
        self.assertRegex(payload["licenseKey"], app.LICENSE_KEY_RE)

    def test_missing_email_does_not_break_the_purchase(self) -> None:
        mail = self._attach_mailer(fetch_error=app.KeyEmailPermanentError("paddle_customer_without_email"))
        self.assertEqual(self._post_event(self._event("transaction.completed", self._transaction())), (200, {"ok": True}))
        self.assertEqual(mail.mailer.run_once(), 1)
        self.assertEqual(mail.send_attempts, 0)
        row = self._key_emails()[0]
        self.assertEqual((row["status"], row["last_error"], row["sealed_key"]), ("failed", "paddle_customer_without_email", None))
        self.assertEqual(self._claim()[0], 200)

    def test_transaction_without_customer_is_not_queued(self) -> None:
        mail = self._attach_mailer()
        data = self._transaction()
        data["customer_id"] = None
        self.assertEqual(self._post_event(self._event("transaction.completed", data)), (200, {"ok": True}))
        self.assertEqual(self._key_emails(), [])
        self.assertEqual(mail.mailer.run_once(), 0)
        self.assertEqual(self._claim()[0], 200)

    def test_without_mailer_nothing_is_queued(self) -> None:
        self.assertIsNone(self.service.mailer)
        self.assertEqual(self._post_event(self._event("transaction.completed", self._transaction())), (200, {"ok": True}))
        self.assertEqual(self._key_emails(), [])

    def test_purchase_without_claim_token_gets_the_key_by_email(self) -> None:
        mail = self._attach_mailer()
        self._post_event(self._event("transaction.completed", self._transaction(claim_token=None)))
        mail.mailer.run_once()
        self.assertEqual(len(mail.sent), 1)
        self.assertEqual(app.license_key_hash(mail.sent[0].get_content().split("Ваш ключ: ")[1].split("\n")[0]), self._license()["key_hash"])

    def test_refund_before_sending_cancels_the_email(self) -> None:
        mail = self._attach_mailer()
        self._post_event(self._event("transaction.completed", self._transaction()))
        full = {"id": "adj_01" + "a" * 24, "action": "refund", "type": "full", "status": "approved", "transaction_id": TRANSACTION_ID, "subscription_id": SUBSCRIPTION_ID}
        self.assertEqual(self._post_event(self._event("adjustment.created", full)), (200, {"ok": True}))
        self.assertEqual(mail.mailer.run_once(), 1)
        self.assertEqual(mail.sent, [])
        self.assertEqual(self._key_emails()[0]["status"], "canceled")


class PaddleCustomerApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.requests: list[dict[str, str]] = []
        tests = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self) -> None:
                tests.requests.append({"path": self.path, "authorization": self.headers.get("Authorization", "")})
                customer = self.path.rsplit("/", 1)[-1]
                if customer.endswith("x" * 24):
                    self.send_response(404)
                    self.end_headers()
                    return
                if customer.endswith("e" * 24):
                    self.send_response(503)
                    self.end_headers()
                    return
                if customer.endswith("r" * 24):
                    self.send_response(302)
                    self.send_header("Location", "http://127.0.0.1:9/steal")
                    self.end_headers()
                    return
                email = None if customer.endswith("n" * 24) else BUYER_EMAIL
                body = json.dumps({"data": {"id": customer, "email": email}}).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args: object) -> None:
                return None

        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        previous = app.PADDLE_API_BASE_URLS["sandbox"]
        app.PADDLE_API_BASE_URLS["sandbox"] = f"http://127.0.0.1:{server.server_address[1]}"
        self.addCleanup(app.PADDLE_API_BASE_URLS.__setitem__, "sandbox", previous)
        self.fetch = app.paddle_customer_email_fetcher("sandbox", SANDBOX_API_KEY)

    def test_email_is_fetched_with_the_api_key(self) -> None:
        self.assertEqual(self.fetch(CUSTOMER_ID), BUYER_EMAIL)
        self.assertEqual(self.requests, [{"path": f"/customers/{CUSTOMER_ID}", "authorization": f"Bearer {SANDBOX_API_KEY}"}])

    def test_unknown_customer_or_missing_email_is_permanent(self) -> None:
        with self.assertRaises(app.KeyEmailPermanentError):
            self.fetch("ctm_01" + "x" * 24)
        with self.assertRaises(app.KeyEmailPermanentError):
            self.fetch("ctm_01" + "n" * 24)
        with self.assertRaises(app.KeyEmailPermanentError):
            self.fetch("../admin")
        self.assertEqual(len(self.requests), 2)

    def test_api_errors_and_redirects_are_retried_without_following(self) -> None:
        with self.assertRaises(app.KeyEmailRetryableError) as error:
            self.fetch("ctm_01" + "e" * 24)
        self.assertEqual(str(error.exception), "paddle_api_http_503")
        with self.assertRaises(app.KeyEmailRetryableError):
            self.fetch("ctm_01" + "r" * 24)
        self.assertEqual(len(self.requests), 2)


class SmtpSenderTests(unittest.TestCase):
    def test_missing_password_file_or_unreachable_server_is_retryable(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            message = app.build_paddle_key_email(app.DEFAULT_MAIL_FROM, BUYER_EMAIL, "JACKDAW-PRO-ABCD-EFGH-JKLM-NPQR", "yearly")
            send = app.smtp_message_sender("127.0.0.1", 9, "resend", Path(directory) / "missing.secret")
            with self.assertRaises(app.KeyEmailRetryableError) as error:
                send(message)
            self.assertEqual(str(error.exception), "smtp_password_unavailable")
            password_file = Path(directory) / "smtp.secret"
            password_file.write_text("secret-value\n", encoding="utf-8")
            send = app.smtp_message_sender("127.0.0.1", unused_port(), "resend", password_file)
            with self.assertRaises(app.KeyEmailRetryableError) as error:
                send(message)
            self.assertTrue(str(error.exception).startswith("smtp_"))
            self.assertNotIn("secret-value", str(error.exception))
            self.assertNotIn(BUYER_EMAIL, str(error.exception))

    def test_message_has_bilingual_key_and_no_header_injection(self) -> None:
        message = app.build_paddle_key_email(app.DEFAULT_MAIL_FROM, BUYER_EMAIL, "JACKDAW-PRO-ABCD-EFGH-JKLM-NPQR", "yearly")
        content = message.get_content()
        self.assertIn("Ваш ключ: JACKDAW-PRO-ABCD-EFGH-JKLM-NPQR", content)
        self.assertIn("Your key: JACKDAW-PRO-ABCD-EFGH-JKLM-NPQR", content)
        self.assertIn("годовая подписка", content)
        self.assertTrue(message["Message-ID"].endswith("@jackdaw-mail.pro>"))
        self.assertEqual(message["Auto-Submitted"], "auto-generated")



if __name__ == "__main__":
    unittest.main()
