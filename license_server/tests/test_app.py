import base64
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

    def _start_http_service(self) -> tuple[object, str]:
        config = SimpleNamespace(
            store_configured=False,
            monthly_checkout_url=None,
            yearly_checkout_url=None,
            webhook_secret="",
            store_id="",
            allowed_origins={"http://127.0.0.1"},
            admin_token_sha256="",
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
    def _post_json(base_url: str, path: str, payload: dict[str, object]) -> tuple[int, dict[str, object]]:
        request = urllib.request.Request(
            f"{base_url}{path}",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json", "Accept": "application/json"},
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


if __name__ == "__main__":
    unittest.main()
