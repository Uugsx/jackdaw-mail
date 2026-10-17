import base64
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import calls  # noqa: E402
import chat  # noqa: E402
from test_calls import HubTestCase, LICENSE_KEY  # noqa: E402


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


KEY_A = b64(b"a" * 32)
KEY_B = b64(b"b" * 32)
KEY_C = b64(b"c" * 32)


class ChatTestCase(HubTestCase):
    def setUp(self):
        super().setUp()
        self.chat_dir = Path(self.tmp.name) / "calls"
        self.store = chat.ChatStore(self.chat_dir / "chat.sqlite3", self.chat_dir / "blobs", clock=lambda: self.clock.value + 1_800_000_000)
        self.hub.chat = chat.ChatService(self.store)

    def chat_peer(self, device, email, chat_device, key):
        peer = self.connect(device=device, emails=[email])
        self.hub.handle(peer, {"type": "chat-register", "deviceId": chat_device, "publicKey": key})
        return peer

    def send(self, peer, message_id, recipients, keys, ciphertext=b"secret", **extra):
        self.hub.handle(peer, {
            "type": "chat-send", "messageId": message_id, "recipients": recipients,
            "ciphertext": b64(ciphertext), "keys": keys, **extra,
        })


class ChatFlowTests(ChatTestCase):
    def setUp(self):
        super().setUp()
        self.alice = self.chat_peer("device-alice-1", "alice@example.com", "chat-alice-1", KEY_A)
        self.bob = self.chat_peer("device-bob-0001", "bob@example.com", "chat-bob-0001", KEY_B)

    def test_register_requires_verified_email(self):
        stranger = self.connect(device="device-alice-2")
        self.hub.handle(stranger, {"type": "chat-register", "deviceId": "chat-x-0001", "publicKey": KEY_C})
        self.assertEqual(self.last(stranger)["code"], "not_verified")

    def test_register_rejects_bad_key_and_device_takeover(self):
        self.hub.handle(self.alice, {"type": "chat-register", "deviceId": "chat-alice-1", "publicKey": b64(b"x" * 31)})
        self.assertEqual(self.last(self.alice)["code"], "invalid_device")
        trial = self.connect(device="device-trial-01", kind="trial", emails=["t@example.com"])
        self.hub.handle(trial, {"type": "chat-register", "deviceId": "chat-bob-0001", "publicKey": KEY_C})
        self.assertEqual(self.last(trial)["code"], "invalid_device")

    def test_keys_are_published_per_email(self):
        self.hub.handle(self.alice, {"type": "chat-keys", "requestId": "k1", "emails": ["BOB@example.com", "nobody@example.com"]})
        result = self.last(self.alice, "chat-keys-result")
        self.assertEqual(result["requestId"], "k1")
        self.assertEqual(result["devices"], {
            "bob@example.com": [{"deviceId": "chat-bob-0001", "publicKey": KEY_B}],
            "nobody@example.com": [],
        })

    def test_online_delivery_and_ack(self):
        self.send(self.alice, "msg-00000001", ["bob@example.com"], {"chat-bob-0001": b64(b"wrapped")})
        delivered = self.last(self.bob, "chat-message")
        self.assertEqual(delivered["from"], "alice@example.com")
        self.assertEqual(delivered["fromDevice"], "chat-alice-1")
        self.assertEqual(base64.b64decode(delivered["ciphertext"]), b"secret")
        self.assertEqual(base64.b64decode(delivered["key"]), b"wrapped")
        self.assertEqual(self.last(self.alice, "chat-sent"), {"type": "chat-sent", "messageId": "msg-00000001", "queued": 1, "delivered": 1})
        self.hub.handle(self.bob, {"type": "chat-ack", "messageIds": ["msg-00000001"]})
        self.assertEqual(self.store.pending_for("chat-bob-0001"), ([], 0))

    def test_offline_queue_is_delivered_on_register(self):
        self.hub.disconnected(self.bob)
        self.send(self.alice, "msg-00000002", ["bob@example.com"], {"chat-bob-0001": b64(b"w")})
        self.assertEqual(self.last(self.alice, "chat-sent")["delivered"], 0)
        bob = self.chat_peer("device-bob-0001", "bob@example.com", "chat-bob-0001", KEY_B)
        self.assertEqual(self.last(bob, "chat-message")["messageId"], "msg-00000002")
        self.assertEqual(self.last(bob, "chat-pending"), {"type": "chat-pending", "count": 1, "remaining": 0})

    def test_unacknowledged_message_is_redelivered(self):
        self.send(self.alice, "msg-00000003", ["bob@example.com"], {"chat-bob-0001": b64(b"w")})
        self.hub.handle(self.bob, {"type": "chat-pull"})
        self.assertEqual(self.last(self.bob, "chat-message")["messageId"], "msg-00000003")

    def test_cannot_send_to_devices_of_other_people(self):
        carol = self.chat_peer("device-carol-01", "carol@example.com", "chat-carol-01", KEY_C)
        self.send(self.alice, "msg-00000004", ["bob@example.com"], {"chat-bob-0001": b64(b"w"), "chat-carol-01": b64(b"w")})
        self.assertIsNone(self.last(carol, "chat-message"))
        self.assertEqual(self.last(self.alice, "chat-sent")["queued"], 1)

    def test_own_other_devices_get_a_copy(self):
        alice2 = self.chat_peer("device-alice-2", "alice@example.com", "chat-alice-2", KEY_C)
        self.send(self.alice, "msg-00000005", ["bob@example.com"], {"chat-bob-0001": b64(b"w"), "chat-alice-2": b64(b"w2"), "chat-alice-1": b64(b"self")})
        self.assertEqual(base64.b64decode(self.last(alice2, "chat-message")["key"]), b"w2")
        self.assertEqual(self.last(self.alice, "chat-sent")["queued"], 2)

    def test_resend_is_idempotent(self):
        self.send(self.alice, "msg-00000006", ["bob@example.com"], {"chat-bob-0001": b64(b"w")})
        self.send(self.alice, "msg-00000006", ["bob@example.com"], {"chat-bob-0001": b64(b"w")})
        self.assertEqual(len([m for m in self.bob.inbox if m["type"] == "chat-message"]), 1)

    def test_ephemeral_is_not_stored(self):
        self.hub.disconnected(self.bob)
        self.send(self.alice, "msg-00000007", ["bob@example.com"], {"chat-bob-0001": b64(b"w")}, ephemeral=True)
        self.assertEqual(self.store.pending_for("chat-bob-0001"), ([], 0))

    def test_sender_is_stamped_and_cannot_be_spoofed(self):
        self.send(self.alice, "msg-00000008", ["bob@example.com"], {"chat-bob-0001": b64(b"w")}, **{"from": "boss@example.com"})
        self.assertEqual(self.last(self.alice)["code"], "not_verified")

    def test_payload_limits(self):
        self.send(self.alice, "msg-00000009", ["bob@example.com"], {"chat-bob-0001": b64(b"w")}, ciphertext=b"x" * (chat.MAX_CIPHERTEXT_BYTES + 1))
        self.assertEqual(self.last(self.alice)["code"], "invalid_payload")
        self.hub.handle(self.alice, {"type": "chat-send", "messageId": "msg-00000010", "recipients": ["bob@example.com"], "ciphertext": "!!!", "keys": {"chat-bob-0001": "AA=="}})
        self.assertEqual(self.last(self.alice)["code"], "invalid_payload")

    def test_send_requires_registration(self):
        stranger = self.connect(device="device-alice-2", emails=["alice@example.com"])
        self.send(stranger, "msg-00000011", ["bob@example.com"], {"chat-bob-0001": b64(b"w")})
        self.assertEqual(self.last(stranger)["code"], "chat_not_registered")

    def test_key_change_drops_old_queue(self):
        self.hub.disconnected(self.bob)
        self.send(self.alice, "msg-00000012", ["bob@example.com"], {"chat-bob-0001": b64(b"w")})
        bob = self.chat_peer("device-bob-0001", "bob@example.com", "chat-bob-0001", KEY_C)
        self.assertIsNone(self.last(bob, "chat-message"))

    def test_expired_messages_are_cleaned_up(self):
        self.hub.disconnected(self.bob)
        self.send(self.alice, "msg-00000013", ["bob@example.com"], {"chat-bob-0001": b64(b"w")})
        self.clock.value += chat.MESSAGE_TTL_SECONDS + 1
        self.store.cleanup(force=True)
        self.assertEqual(self.store.pending_for("chat-bob-0001"), ([], 0))

    def test_disconnect_removes_live_routing(self):
        self.hub.disconnected(self.bob)
        self.assertNotIn("chat-bob-0001", self.hub.chat.peers_by_device)


class BlobTests(ChatTestCase):
    def setUp(self):
        super().setUp()
        self.alice = self.chat_peer("device-alice-1", "alice@example.com", "chat-alice-1", KEY_A)
        self.bob = self.chat_peer("device-bob-0001", "bob@example.com", "chat-bob-0001", KEY_B)

    def put(self, peer, blob_id, index, total, data):
        self.hub.handle(peer, {"type": "blob-put", "blobId": blob_id, "index": index, "total": total, "data": b64(data)})
        return self.last(peer)

    def test_upload_and_download_in_chunks(self):
        blob_id = "0" * 32
        first = b"x" * chat.BLOB_CHUNK_BYTES
        self.assertEqual(self.put(self.alice, blob_id, 0, 2, first)["complete"], False)
        self.assertEqual(self.put(self.alice, blob_id, 1, 2, b"tail")["complete"], True)
        self.hub.handle(self.bob, {"type": "blob-get", "blobId": blob_id, "index": 1})
        reply = self.last(self.bob, "blob-data")
        self.assertEqual((base64.b64decode(reply["data"]), reply["total"]), (b"tail", 2))

    def test_out_of_order_and_incomplete(self):
        blob_id = "1" * 32
        self.assertEqual(self.put(self.alice, blob_id, 1, 2, b"x")["code"], "invalid_blob")
        self.put(self.alice, blob_id, 0, 2, b"x" * chat.BLOB_CHUNK_BYTES)
        self.hub.handle(self.bob, {"type": "blob-get", "blobId": blob_id, "index": 0})
        self.assertEqual(self.last(self.bob)["code"], "blob_not_found")
        self.assertEqual(self.put(self.bob, blob_id, 1, 2, b"x")["code"], "invalid_blob")

    def test_short_middle_chunk_and_bad_ids(self):
        self.assertEqual(self.put(self.alice, "2" * 32, 0, 2, b"short")["code"], "invalid_blob")
        self.assertEqual(self.put(self.alice, "../etc/passwd", 0, 1, b"x")["code"], "invalid_blob")
        self.assertEqual(self.put(self.alice, "3" * 32, 0, chat.MAX_BLOB_CHUNKS + 1, b"x")["code"], "invalid_blob")

    def test_quota(self):
        original = chat.BLOB_QUOTA_BYTES
        chat.BLOB_QUOTA_BYTES = chat.BLOB_CHUNK_BYTES
        try:
            self.assertEqual(self.put(self.alice, "4" * 32, 0, 1, b"x")["complete"], True)
            self.assertEqual(self.put(self.alice, "5" * 32, 0, 1, b"x")["code"], "quota_exceeded")
        finally:
            chat.BLOB_QUOTA_BYTES = original

    def test_expired_blobs_are_deleted(self):
        blob_id = "6" * 32
        self.put(self.alice, blob_id, 0, 1, b"data")
        self.clock.value += chat.BLOB_TTL_SECONDS + 1
        self.store.cleanup(force=True)
        self.assertFalse((self.chat_dir / "blobs" / blob_id).exists())


class MigrationTests(unittest.TestCase):
    def test_migration_and_rollback(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = Path(tmp) / "chat.sqlite3"
            chat.ChatStore(db, Path(tmp) / "blobs")
            chat.ChatStore(db, Path(tmp) / "blobs")  # повторный запуск не применяет миграцию дважды
            connection = sqlite3.connect(db)
            try:
                tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                self.assertTrue({"chat_devices", "chat_messages", "chat_deliveries", "chat_blobs", "verified_emails"} <= tables)
                # Откат — в обратном порядке миграций
                for _, filename in reversed(chat.MIGRATIONS):
                    rollback = (Path(chat.__file__).with_name("migrations") / filename.replace(".sql", ".rollback.sql")).read_text()
                    connection.executescript(rollback)
                tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                self.assertFalse(tables & {"chat_devices", "chat_messages", "chat_deliveries", "chat_blobs", "verified_emails"})
                self.assertEqual(connection.execute("SELECT COUNT(*) FROM schema_migrations").fetchone()[0], 0)
            finally:
                connection.close()


if __name__ == "__main__":
    unittest.main()
