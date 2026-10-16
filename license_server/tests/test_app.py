import base64
import hashlib
import hmac
import http.client
import json
import os
import tempfile
import threading
import urllib.error
import urllib.request
import unittest
from pathlib import Path
from types import SimpleNamespace

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from license_server import app

WEBHOOK_SECRET = "test-webhook-secret"
STORE_ID = "4242"


class LicenseServerTests(unittest.TestCase):
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
        self.store = app.LicenseStore(Path(self.temp_dir.name) / "license.sqlite3")
        self.signer = app.EntitlementSigner(key_path)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def _start_http_service(self, webhook_secret: str = "", store_id: str = "", admin_token: str = "") -> tuple[object, str]:
        config = SimpleNamespace(
            store_configured=False,
            monthly_checkout_url=None,
            yearly_checkout_url=None,
            webhook_secret=webhook_secret,
            store_id=store_id,
            allowed_origins={"http://127.0.0.1"},
            admin_token_sha256=hashlib.sha256(admin_token.encode("utf-8")).hexdigest() if admin_token else "",
            trial_days=7,
            grace_days=7,
        )
        server = app.ThreadingHTTPServer(("127.0.0.1", 0), app.LicenseRequestHandler)
        server.service = app.LicenseHTTPService(config, self.store, self.signer)  # type: ignore[attr-defined]
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return server, f"http://127.0.0.1:{server.server_address[1]}"

    @staticmethod
    def _post_json(base_url: str, path: str, payload: dict[str, object], token: str = "") -> tuple[int, dict[str, object]]:
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        request = urllib.request.Request(
            f"{base_url}{path}",
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=3) as response:
                return response.status, json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read().decode("utf-8"))

    def test_key_normalization_and_hash_storage(self) -> None:
        key = "JACKDAW-PRO-ABCD-EFGH-JKLM-NPQR"
        normalized = app.normalize_license_key(" jackdaw pro abcd-efgh-jklm-npqr ")
        self.assertEqual(normalized, key)
        license_id = self.store.create_license(normalized, "monthly", None, 1, None, None, "admin")
        row = self.store.find_by_key(normalized)
        self.assertEqual(row["id"], license_id)
        self.assertEqual(row["key_hash"], app.license_key_hash(normalized))
        self.assertNotIn(normalized, row["key_hash"])

    def test_provider_license_key_is_accepted_without_exposing_plaintext_in_storage(self) -> None:
        key = "80e15db5-c796-436b-850c-8f9c98a48abe"
        normalized = app.normalize_license_key(key.upper())
        self.assertEqual(normalized, key)
        license_id = self.store.create_license(normalized, "yearly", None, 3, None, None, "lemon-squeezy")
        row = self.store.find_by_key(normalized)
        self.assertEqual(row["id"], license_id)
        self.assertNotIn(key, row["key_hash"])

    def test_provider_data_extracts_plan_and_expiration(self) -> None:
        event_name, key, provider_id, order_id, plan, expires_at = app.extract_provider_data(
            {
                "meta": {"event_name": "license_key_created"},
                "data": {
                    "id": "42",
                    "attributes": {
                        "key": "80e15db5-c796-436b-850c-8f9c98a48abe",
                        "order_id": 17,
                        "variant_name": "Jackdaw Pro Annual",
                        "expires_at": "2027-10-15T00:00:00Z",
                    },
                },
            }
        )
        self.assertEqual(event_name, "license_key_created")
        self.assertEqual(key, "80e15db5-c796-436b-850c-8f9c98a48abe")
        self.assertEqual(provider_id, "42")
        self.assertEqual(order_id, "17")
        self.assertEqual(plan, "yearly")
        self.assertEqual(expires_at, "2027-10-15T00:00:00Z")

    def test_provider_update_without_expiration_keeps_existing_expiration(self) -> None:
        key = "80e15db5-c796-436b-850c-8f9c98a48abe"
        expires_at = "2027-10-15T00:00:00Z"
        license_id = self.store.upsert_provider_license(
            key,
            "yearly",
            expires_at,
            "active",
            "42",
            "17",
            None,
        )
        self.store.upsert_provider_license(
            key,
            "yearly",
            None,
            "active",
            "42",
            "18",
            None,
        )
        row = self.store.find_by_id(license_id)
        self.assertIsNotNone(row)
        self.assertEqual(row["expires_at"], expires_at)
        self.assertEqual(row["provider_order_id"], "18")

    def test_checkout_configuration_requires_https_lemon_url(self) -> None:
        variable_names = (
            "LEMON_SQUEEZY_MONTHLY_CHECKOUT_URL",
            "LEMON_SQUEEZY_YEARLY_CHECKOUT_URL",
        )
        previous = {name: os.environ.get(name) for name in variable_names}
        try:
            os.environ[variable_names[0]] = "https://jackdaw.lemonsqueezy.com/checkout/buy/monthly"
            os.environ[variable_names[1]] = "https://jackdaw.lemonsqueezy.com/checkout/buy/yearly"
            config = app.Configuration()
            self.assertEqual(config.monthly_checkout_url, os.environ[variable_names[0]])
            self.assertEqual(config.yearly_checkout_url, os.environ[variable_names[1]])
            os.environ[variable_names[0]] = "http://jackdaw.lemonsqueezy.com/checkout/buy/monthly"
            with self.assertRaises(RuntimeError):
                app.Configuration()
        finally:
            for name, value in previous.items():
                if value is None:
                    os.environ.pop(name, None)
                else:
                    os.environ[name] = value

    def test_activation_limit_and_reactivation(self) -> None:
        key = app.normalize_license_key("JACKDAW-PRO-ABCD-EFGH-JKLM-NPQR")
        license_id = self.store.create_license(key, "monthly", None, 1, None, None, "admin")
        self.store.activate(license_id, "device-0001", "Mac", 1)
        with self.assertRaises(app.ServiceError):
            self.store.activate(license_id, "device-0002", "Windows", 1)
        self.store.deactivate(license_id, "device-0001")
        self.store.activate(license_id, "device-0002", "Windows", 1)
        self.assertTrue(self.store.activation_exists(license_id, "device-0002"))

    def test_deactivated_device_cannot_bypass_the_activation_limit(self) -> None:
        key = app.normalize_license_key("JACKDAW-PRO-ABCD-EFGH-JKLM-NPQR")
        license_id = self.store.create_license(key, "monthly", None, 1, None, None, "admin")
        self.store.activate(license_id, "device-0001", "Mac", 1)
        self.store.deactivate(license_id, "device-0001")
        self.store.activate(license_id, "device-0002", "Windows", 1)
        with self.assertRaises(app.ServiceError) as raised:
            self.store.activate(license_id, "device-0001", "Mac", 1)
        self.assertEqual(raised.exception.status, 409)
        self.assertFalse(self.store.activation_exists(license_id, "device-0001"))
        self.assertTrue(self.store.activation_exists(license_id, "device-0002"))

    def test_active_device_can_reactivate_at_the_limit(self) -> None:
        key = app.normalize_license_key("JACKDAW-PRO-ABCD-EFGH-JKLM-NPQR")
        license_id = self.store.create_license(key, "monthly", None, 1, None, None, "admin")
        self.store.activate(license_id, "device-0001", "Mac", 1)
        self.store.activate(license_id, "device-0001", "Mac mini", 1)
        self.assertTrue(self.store.activation_exists(license_id, "device-0001"))

    def test_license_list_shows_every_activated_device(self) -> None:
        key = app.normalize_license_key("JACKDAW-PRO-ABCD-EFGH-JKLM-NPQR")
        license_id = self.store.create_license(key, "admin", None, 0, None, None, "admin")
        mac_agent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Jackdaw Mail/1.4.2 Chrome/130 Electron/33"
        windows_agent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Jackdaw Mail/1.4.2 Chrome/130 Electron/33"
        self.store.activate(license_id, "device-11111111-aaaa", mac_agent, 0)
        self.store.activate(license_id, "device-22222222-bbbb", windows_agent, 0)
        self.store.deactivate(license_id, "device-22222222-bbbb")
        listed = self.store.list_licenses()[0]
        self.assertEqual(listed["activeActivations"], 1)
        self.assertEqual([device["deviceLabel"] for device in listed["devices"]], ["macOS · Jackdaw Mail 1.4.2", "Windows · Jackdaw Mail 1.4.2"])
        self.assertEqual([device["active"] for device in listed["devices"]], [True, False])
        self.assertEqual(listed["devices"][0]["devicePreview"], "111-aaaa")

    def test_admin_can_disconnect_device_and_change_limit(self) -> None:
        token = "admin-test-token"
        _, base_url = self._start_http_service(admin_token=token)
        key = app.normalize_license_key("JACKDAW-PRO-ABCD-EFGH-JKLM-NPQR")
        license_id = self.store.create_license(key, "admin", None, 0, None, None, "admin")
        self.store.activate(license_id, "device-0001", "Mac", 0)
        device_hash = self.store.list_licenses()[0]["devices"][0]["deviceHash"]

        status, _ = self._post_json(base_url, "/v1/admin/licenses/devices/deactivate", {"licenseId": license_id, "deviceHash": device_hash})
        self.assertEqual(status, 401)
        status, _ = self._post_json(base_url, "/v1/admin/licenses/devices/deactivate", {"licenseId": license_id, "deviceHash": device_hash}, token)
        self.assertEqual(status, 200)
        self.assertFalse(self.store.activation_exists(license_id, "device-0001"))
        status, body = self._post_json(base_url, "/v1/license/refresh", {"licenseKey": key, "deviceId": "device-0001"})
        self.assertEqual((status, body["error"]), (403, "device_not_activated"))

        status, _ = self._post_json(base_url, "/v1/admin/licenses/limit", {"licenseId": license_id, "maxActivations": 1}, token)
        self.assertEqual(status, 200)
        self.assertEqual(self.store.list_licenses()[0]["maxActivations"], 1)
        status, _ = self._post_json(base_url, "/v1/admin/licenses/limit", {"licenseId": license_id, "maxActivations": 101}, token)
        self.assertEqual(status, 400)
        status, _ = self._post_json(base_url, "/v1/admin/licenses/devices/deactivate", {"licenseId": license_id, "deviceHash": "../x"}, token)
        self.assertEqual(status, 400)

    def test_admin_plan_respects_requested_device_limit(self) -> None:
        token = "admin-test-token"
        _, base_url = self._start_http_service(admin_token=token)
        status, body = self._post_json(base_url, "/v1/admin/licenses", {"plan": "admin", "durationDays": 365, "maxActivations": 1}, token)
        self.assertEqual(status, 201)
        self.assertEqual(body["license"]["maxActivations"], 1)
        self.assertIsNone(body["license"]["validUntil"])
        key = body["licenseKey"]
        status, _ = self._post_json(base_url, "/v1/license/activate", {"licenseKey": key, "deviceId": "device-friend-01", "deviceName": "Mac"})
        self.assertEqual(status, 200)
        status, body = self._post_json(base_url, "/v1/license/activate", {"licenseKey": key, "deviceId": "device-owner-002", "deviceName": "Windows"})
        self.assertEqual((status, body["error"]), (409, "activation_limit_reached"))

    def test_trial_claim_is_idempotent_and_never_extends(self) -> None:
        first, created = self.store.claim_trial("device-0001", "Mac", 7)
        second, created_again = self.store.claim_trial("device-0001", "Renamed Mac", 30)

        self.assertTrue(created)
        self.assertFalse(created_again)
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(first["started_at"], second["started_at"])
        self.assertEqual(first["expires_at"], second["expires_at"])
        self.assertEqual(second["device_name"], "Renamed Mac")
        self.assertEqual(app.LicenseStore._effective_trial_status(second), "trial")
        self.assertNotIn("device-0001", second["device_hash"])

    def test_trial_claim_can_be_revoked(self) -> None:
        trial, _ = self.store.claim_trial("device-0002", "Windows", 7)
        self.assertTrue(self.store.revoke_trial(trial["id"]))
        revoked = self.store.find_trial_by_device("device-0002")
        self.assertIsNotNone(revoked)
        self.assertEqual(app.LicenseStore._effective_trial_status(revoked), "revoked")
        self.assertFalse(self.store.revoke_trial(trial["id"]))

    def test_trial_http_flow_is_server_timed_and_idempotent(self) -> None:
        _server, base_url = self._start_http_service()
        payload = {"deviceId": "device-http-0001", "deviceName": "Test Mac"}

        start_status, started = self._post_json(base_url, "/v1/trial/start", payload)
        repeat_status, repeated = self._post_json(
            base_url,
            "/v1/trial/start",
            {**payload, "deviceName": "Renamed Test Mac"},
        )
        refresh_status, refreshed = self._post_json(base_url, "/v1/trial/refresh", payload)

        self.assertEqual(start_status, 200)
        self.assertEqual(repeat_status, 200)
        self.assertEqual(refresh_status, 200)
        self.assertEqual(started["entitlement"]["payload"]["plan"], "trial")
        self.assertEqual(started["entitlement"]["payload"]["status"], "trial")
        self.assertIn("serverNow", started["entitlement"]["payload"])
        self.assertEqual(started["entitlement"]["payload"]["validUntil"], repeated["entitlement"]["payload"]["validUntil"])
        self.assertEqual(started["entitlement"]["payload"]["validUntil"], refreshed["entitlement"]["payload"]["validUntil"])
        self.assertFalse(started["trial"]["alreadyStarted"])
        self.assertTrue(repeated["trial"]["alreadyStarted"])

    def test_trial_refresh_requires_an_existing_claim(self) -> None:
        _server, base_url = self._start_http_service()
        status, body = self._post_json(
            base_url,
            "/v1/trial/refresh",
            {"deviceId": "device-http-0002", "deviceName": "Test Linux"},
        )
        self.assertEqual(status, 404)
        self.assertEqual(body["error"], "trial_not_started")

    def test_signed_entitlement_can_be_verified(self) -> None:
        payload = {"product": app.PRODUCT, "features": list(app.PRO_FEATURES), "plan": "admin", "status": "active", "validUntil": None}
        signature = self.signer.sign(payload)
        public_key = self.signer._key.public_key()
        public_key.verify(base64.urlsafe_b64decode(signature + "=" * (-len(signature) % 4)), app.canonical_json(payload))

    @staticmethod
    def _post_webhook(base_url: str, payload: dict[str, object], secret: str = WEBHOOK_SECRET, signature: str | None = None) -> int:
        body = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            f"{base_url}/v1/webhooks/lemon-squeezy",
            data=body,
            headers={
                "Content-Type": "application/json",
                "X-Event-Name": str(payload["meta"]["event_name"]),  # type: ignore[index]
                "X-Signature": signature if signature is not None else hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest(),
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=3) as response:
                return response.status
        except urllib.error.HTTPError as error:
            return error.code

    @staticmethod
    def _webhook(event_name: str, data_type: str, data_id: str, attributes: dict[str, object]) -> dict[str, object]:
        return {
            "meta": {"event_name": event_name},
            "data": {"type": data_type, "id": data_id, "attributes": {"store_id": STORE_ID, **attributes}},
        }

    def test_provider_data_does_not_use_order_or_subscription_id_as_license_key_id(self) -> None:
        _event, _key, provider_id, order_id, _plan, _expires = app.extract_provider_data(
            self._webhook("subscription_expired", "subscriptions", "100", {"order_id": 17, "status": "expired"})
        )
        self.assertIsNone(provider_id)
        self.assertEqual(order_id, "17")
        _event, _key, provider_id, order_id, _plan, _expires = app.extract_provider_data(
            self._webhook("order_refunded", "orders", "17", {"status": "refunded"})
        )
        self.assertIsNone(provider_id)
        self.assertEqual(order_id, "17")

    def test_refund_revokes_only_the_refunded_license(self) -> None:
        _server, base_url = self._start_http_service(WEBHOOK_SECRET, STORE_ID)
        refunded_key = "80e15db5-c796-436b-850c-8f9c98a48abe"
        other_key = "11111111-2222-4333-8444-555555555555"
        # Id ключа второго покупателя совпадает с id заказа первого.
        self.assertEqual(self._post_webhook(base_url, self._webhook("license_key_created", "license-keys", "5", {"key": refunded_key, "order_id": 100, "status": "inactive"})), 200)
        self.assertEqual(self._post_webhook(base_url, self._webhook("license_key_created", "license-keys", "100", {"key": other_key, "order_id": 200, "status": "inactive"})), 200)

        self.assertEqual(self._post_webhook(base_url, self._webhook("order_refunded", "orders", "100", {"status": "refunded"})), 200)

        self.assertEqual(self.store.find_by_key(refunded_key)["status"], "revoked")
        self.assertEqual(self.store.find_by_key(other_key)["status"], "active")

    def test_expired_subscription_revokes_license_by_order(self) -> None:
        _server, base_url = self._start_http_service(WEBHOOK_SECRET, STORE_ID)
        key = "80e15db5-c796-436b-850c-8f9c98a48abe"
        self._post_webhook(base_url, self._webhook("license_key_created", "license-keys", "5", {"key": key, "order_id": 100}))

        self.assertEqual(self._post_webhook(base_url, self._webhook("subscription_expired", "subscriptions", "900", {"order_id": 100, "status": "expired"})), 200)

        self.assertEqual(self.store.find_by_key(key)["status"], "revoked")

    def test_active_subscription_gets_grace_after_renewal_date(self) -> None:
        _server, base_url = self._start_http_service(WEBHOOK_SECRET, STORE_ID)
        key = "80e15db5-c796-436b-850c-8f9c98a48abe"
        self._post_webhook(base_url, self._webhook("license_key_created", "license-keys", "5", {"key": key, "order_id": 100}))

        self._post_webhook(base_url, self._webhook("subscription_updated", "subscriptions", "900", {"order_id": 100, "status": "active", "renews_at": "2027-01-01T00:00:00Z"}))

        row = self.store.find_by_key(key)
        self.assertEqual(row["status"], "active")
        self.assertEqual(row["expires_at"], "2027-01-08T00:00:00Z")

    def test_disabled_key_is_revoked_and_provider_cannot_undo_revocation(self) -> None:
        _server, base_url = self._start_http_service(WEBHOOK_SECRET, STORE_ID)
        key = "80e15db5-c796-436b-850c-8f9c98a48abe"
        self._post_webhook(base_url, self._webhook("license_key_created", "license-keys", "5", {"key": key, "order_id": 100, "status": "inactive"}))

        self._post_webhook(base_url, self._webhook("license_key_updated", "license-keys", "5", {"key": key, "order_id": 100, "status": "disabled", "disabled": True}))
        self.assertEqual(self.store.find_by_key(key)["status"], "revoked")

        self._post_webhook(base_url, self._webhook("license_key_updated", "license-keys", "5", {"key": key, "order_id": 100, "status": "active", "disabled": False}))
        row = self.store.find_by_key(key)
        self.assertEqual(row["status"], "revoked")
        self.assertTrue(self.store.restore(row["id"]))
        self.assertEqual(self.store.find_by_key(key)["status"], "active")

    def test_invalid_webhook_signatures_are_rejected_without_server_error(self) -> None:
        _server, base_url = self._start_http_service(WEBHOOK_SECRET, STORE_ID)
        payload = self._webhook("license_key_created", "license-keys", "5", {"key": "80e15db5-c796-436b-850c-8f9c98a48abe"})
        self.assertEqual(self._post_webhook(base_url, payload, secret="wrong-secret"), 401)
        # Не-ASCII подпись раньше приводила к TypeError в compare_digest и ответу 500.
        self.assertEqual(self._post_webhook(base_url, payload, signature="é" * 64), 401)
        self.assertIsNone(self.store.find_by_key("80e15db5-c796-436b-850c-8f9c98a48abe"))

    def test_unread_request_body_closes_connection_and_server_header_has_no_python_version(self) -> None:
        _server, base_url = self._start_http_service()
        connection = http.client.HTTPConnection(base_url.removeprefix("http://"), timeout=3)
        self.addCleanup(connection.close)
        connection.request("POST", "/unknown", body=b"GET /v1/public-config HTTP/1.1\r\nHost: x\r\n\r\n", headers={"Content-Type": "text/plain"})
        response = connection.getresponse()
        response.read()
        self.assertEqual(response.status, 404)
        self.assertEqual(response.getheader("Connection"), "close")
        self.assertEqual(response.getheader("Server"), "JackdawLicense/1.0")

    def test_forwarded_for_is_trusted_only_from_local_proxy_when_enabled(self) -> None:
        def client_ip(peer: str, forwarded: str, trusted: bool) -> str:
            handler = app.LicenseRequestHandler.__new__(app.LicenseRequestHandler)
            handler.client_address = (peer, 50000)
            handler.headers = {"X-Forwarded-For": forwarded}
            handler.server = SimpleNamespace(service=SimpleNamespace(config=SimpleNamespace(trust_forwarded_for=trusted)))
            return handler._client_ip()

        self.assertEqual(client_ip("127.0.0.1", "203.0.113.9", False), "127.0.0.1")
        self.assertEqual(client_ip("127.0.0.1", "198.51.100.1, 203.0.113.9", True), "203.0.113.9")
        self.assertEqual(client_ip("127.0.0.1", "not-an-ip", True), "127.0.0.1")
        self.assertEqual(client_ip("192.0.2.5", "203.0.113.9", True), "192.0.2.5")


if __name__ == "__main__":
    unittest.main()
