"""Асинхронная обработка: база и файлы — в пуле потоков, состояние хаба — в цикле событий, без гонок."""

import asyncio
import base64
import concurrent.futures
import contextlib
import io
import sqlite3
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import calls  # noqa: E402
import chat  # noqa: E402
from test_calls import HAVE_WEBSOCKETS, LICENSE_KEY, Clock, FakeScheduler, FakeWebSocket, create_database  # noqa: E402


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


class ManualExecutor:
    """Пул, в котором шаги выполняются только по команде теста: так видно состояние «запрос к базе идёт»."""

    def __init__(self):
        self.pending = []

    def submit(self, fn, *args):
        future = concurrent.futures.Future()
        self.pending.append((fn, args, future))
        return future

    def run_next(self):
        fn, args, future = self.pending.pop(0)
        try:
            future.set_result(fn(*args))
        except Exception as error:  # noqa: BLE001 — ошибку получает ожидающий обработчик
            future.set_exception(error)


async def settle(condition=lambda: False, rounds=200):
    for _ in range(rounds):
        if condition():
            return
        await asyncio.sleep(0)


class AsyncHubTestCase(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tmp.name) / "license.sqlite3"
        create_database(self.db_path)
        self.clock = Clock()
        self.signer = calls.EmailProofSigner(b"p" * 32)
        self.executor = ManualExecutor()
        self.store = chat.ChatStore(Path(self.tmp.name) / "chat.sqlite3", Path(self.tmp.name) / "blobs",
                                    clock=lambda: self.clock.value + 1_800_000_000)
        self.hub = calls.CallHub(
            calls.CredentialVerifier(self.db_path),
            calls.EmailVerification(self.signer, clock=self.clock),
            None,
            None,
            scheduler=FakeScheduler(),
            clock=self.clock,
            chat=chat.ChatService(self.store),
            verified_store=self.store,
            executor=self.executor,
        )

    def tearDown(self):
        self.tmp.cleanup()

    def peer(self):
        inbox = []
        closed = []
        peer = calls.Peer(inbox.append, lambda: closed.append(True))
        peer.inbox = inbox
        peer.closed = closed
        self.hub.connected(peer)
        return peer

    def hello_message(self, device="device-alice-1", emails=(), kind="license"):
        credential = {"kind": kind, "deviceId": device}
        if kind == "license":
            credential["licenseKey"] = LICENSE_KEY
        subject = "license:1" if kind == "license" else f"trial:{calls.sha256_hex(device)}"
        return {"type": "hello", "credential": credential, "emailProofs": [self.signer.issue(e, subject) for e in emails]}

    def connect(self, device="device-alice-1", emails=()):
        """Готовое соединение: вход синхронно, без ручного пула."""
        peer = self.peer()
        self.hub.handle(peer, self.hello_message(device, emails))
        return peer

    def start(self, peer, message):
        return asyncio.create_task(self.hub.handle_async(peer, message))

    async def step(self, task=None):
        """Дождаться блокирующего шага в пуле и выполнить его."""
        await settle(lambda: self.executor.pending)
        self.assertTrue(self.executor.pending, "обработчик не дошёл до обращения к базе")
        self.executor.run_next()
        await settle(lambda: task is not None and task.done() or bool(self.executor.pending))

    @staticmethod
    def types(peer):
        return [message["type"] for message in peer.inbox]


class EventLoopIsNotBlockedTests(AsyncHubTestCase):
    async def test_other_connections_are_served_while_hello_waits_for_database(self):
        bob = self.connect(device="device-bob-0001", emails=["bob@example.com"])
        alice = self.peer()
        hello = self.start(alice, self.hello_message(emails=["alice@example.com"]))
        await settle(lambda: self.executor.pending)
        self.assertFalse(hello.done())
        # Пока вход Алисы ждёт базу лицензий, Боб получает ответы сразу и без обращения к пулу.
        await self.hub.handle_async(bob, {"type": "ping"})
        await self.hub.handle_async(bob, {"type": "lookup", "emails": ["alice@example.com"]})
        self.assertEqual(bob.inbox[-2:], [{"type": "pong"}, {"type": "lookup-result", "reachable": {"alice@example.com": False}}])
        while not hello.done():
            await self.step(hello)
        self.assertEqual(alice.inbox[-1]["type"], "welcome")
        await self.hub.handle_async(bob, {"type": "lookup", "emails": ["alice@example.com"]})
        self.assertEqual(bob.inbox[-1]["reachable"], {"alice@example.com": True})

    async def test_locked_license_database_does_not_stop_other_connections(self):
        """Настоящий пул потоков и настоящая блокировка базы лицензий."""
        self.hub.executor = None
        bob = self.connect(device="device-bob-0001", emails=["bob@example.com"])
        alice = self.peer()
        locker = sqlite3.connect(self.db_path, isolation_level=None)
        locker.execute("BEGIN EXCLUSIVE")
        try:
            hello = self.start(alice, self.hello_message(emails=["alice@example.com"]))
            await asyncio.sleep(0.2)
            self.assertFalse(hello.done())
            started = time.monotonic()
            await self.hub.handle_async(bob, {"type": "ping"})
            self.assertLess(time.monotonic() - started, 0.1)
            self.assertEqual(bob.inbox[-1], {"type": "pong"})
        finally:
            locker.execute("ROLLBACK")
            locker.close()
        await asyncio.wait_for(hello, 5)
        self.assertEqual(alice.inbox[-1]["type"], "welcome")
        self.assertIn("alice@example.com", alice.inbox[-1]["emails"])


class StaleResultTests(AsyncHubTestCase):
    async def test_disconnect_during_hello_leaves_no_presence(self):
        alice = self.peer()
        hello = self.start(alice, self.hello_message(emails=["alice@example.com"]))
        await settle(lambda: self.executor.pending)
        self.hub.disconnected(alice)
        while self.executor.pending:
            await self.step(hello)
        await asyncio.wait_for(hello, 1)
        self.assertNotIn("alice@example.com", self.hub.peers_by_email)
        self.assertNotIn("license:1", self.hub.peers_by_subject)
        self.assertIsNone(alice.credential)
        self.assertNotIn("welcome", self.types(alice))

    async def test_requests_of_closed_connection_are_skipped(self):
        alice = self.connect(emails=["alice@example.com"])
        self.hub.disconnected(alice)
        await self.hub.handle_async(alice, self.hello_message(emails=["alice@example.com"]))
        await self.hub.handle_async(alice, {"type": "ping"})
        self.assertEqual(self.executor.pending, [])
        self.assertNotIn("alice@example.com", self.hub.peers_by_email)
        self.assertNotIn("pong", self.types(alice))

    async def test_disconnect_during_chat_register_leaves_no_device(self):
        alice = self.connect(emails=["alice@example.com"])
        register = self.start(alice, {"type": "chat-register", "deviceId": "chat-alice-1", "publicKey": b64(b"a" * 32)})
        await settle(lambda: self.executor.pending)
        self.hub.disconnected(alice)
        await self.step(register)
        await asyncio.wait_for(register, 1)
        self.assertEqual(self.hub.chat.peers_by_device, {})
        self.assertIsNone(alice.chat_device_id)
        self.assertNotIn("chat-registered", self.types(alice))

    async def test_changed_credential_discards_result(self):
        alice = self.connect(emails=["alice@example.com"])
        register = self.start(alice, {"type": "chat-register", "deviceId": "chat-alice-1", "publicKey": b64(b"a" * 32)})
        await settle(lambda: self.executor.pending)
        # Соединение успело войти с другим credential (пробный период): результат старого запроса не применяется.
        trial = calls.Credential(subject="trial:x", device_hash="x", kind="trial")
        alice.credential = trial
        await self.step(register)
        await asyncio.wait_for(register, 1)
        self.assertEqual(self.hub.chat.peers_by_device, {})
        self.assertNotIn("chat-registered", self.types(alice))

    async def test_saved_chat_message_reaches_recipient_after_sender_disconnects(self):
        alice = self.connect(emails=["alice@example.com"])
        bob = self.connect(device="device-bob-0001", emails=["bob@example.com"])
        for peer, device, key in ((alice, "chat-alice-1", b"a"), (bob, "chat-bob-0001", b"b")):
            self.hub.handle(peer, {"type": "chat-register", "deviceId": device, "publicKey": b64(key * 32)})
        send = self.start(alice, {"type": "chat-send", "messageId": "msg-00000001", "recipients": ["bob@example.com"],
                                  "ciphertext": b64(b"secret"), "keys": {"chat-bob-0001": b64(b"wrapped")}})
        await self.step(send)  # владельцы устройств
        self.assertEqual(len(self.executor.pending), 1)  # сохранение сообщения уже в пуле
        self.hub.disconnected(alice)
        await self.step(send)
        await asyncio.wait_for(send, 1)
        self.assertEqual(bob.inbox[-1]["messageId"], "msg-00000001")

    async def test_disconnect_before_chat_message_is_saved_stores_nothing(self):
        alice = self.connect(emails=["alice@example.com"])
        bob = self.connect(device="device-bob-0001", emails=["bob@example.com"])
        for peer, device, key in ((alice, "chat-alice-1", b"a"), (bob, "chat-bob-0001", b"b")):
            self.hub.handle(peer, {"type": "chat-register", "deviceId": device, "publicKey": b64(key * 32)})
        send = self.start(alice, {"type": "chat-send", "messageId": "msg-00000001", "recipients": ["bob@example.com"],
                                  "ciphertext": b64(b"secret"), "keys": {"chat-bob-0001": b64(b"wrapped")}})
        await settle(lambda: self.executor.pending)
        self.hub.disconnected(alice)
        await self.step(send)
        await asyncio.wait_for(send, 1)
        self.assertEqual(self.executor.pending, [])
        self.assertEqual(self.store.pending_for("chat-bob-0001"), ([], 0))

    async def test_revoked_license_on_async_recheck_disconnects(self):
        alice = self.connect(emails=["alice@example.com"])
        connection = sqlite3.connect(self.db_path)
        connection.execute("UPDATE licenses SET status = 'revoked' WHERE id = 1")
        connection.commit()
        connection.close()
        self.clock.value += calls.CREDENTIAL_RECHECK_SECONDS + 1
        lookup = self.start(alice, {"type": "lookup", "emails": ["bob@example.com"]})
        await self.step(lookup)
        await asyncio.wait_for(lookup, 1)
        self.assertEqual(alice.closed, [True])
        self.assertEqual(alice.inbox[-1]["code"], "license_inactive")
        self.assertNotIn("alice@example.com", self.hub.peers_by_email)
        self.assertNotIn("license:1", self.hub.peers_by_subject)

    async def test_database_error_in_pool_is_reported_to_client(self):
        alice = self.connect(emails=["alice@example.com"])
        self.hub.handle(alice, {"type": "chat-register", "deviceId": "chat-alice-1", "publicKey": b64(b"a" * 32)})

        def broken(*args, **kwargs):
            raise sqlite3.OperationalError("database is locked")

        self.store.devices_for = broken
        with contextlib.redirect_stderr(io.StringIO()):
            keys = self.start(alice, {"type": "chat-keys", "emails": ["bob@example.com"]})
            await self.step(keys)
            await asyncio.wait_for(keys, 1)
        self.assertEqual(alice.inbox[-1]["code"], "internal_error")
        await self.hub.handle_async(alice, {"type": "ping"})
        self.assertEqual(alice.inbox[-1], {"type": "pong"})

    async def test_reverse_verification_stores_proof_in_background(self):
        alice = self.connect()
        proof = self.signer.issue("alice@example.com", "license:1")
        steps = self.hub._remember_verified_proof("license:1", proof)
        self.hub._spawn(steps)
        self.assertEqual(self.store.verified_emails("license:1"), [])
        await settle(lambda: self.executor.pending)
        self.executor.run_next()
        await settle(lambda: not self.hub._background)
        self.assertEqual([email for email, _ in self.store.verified_emails("license:1")], ["alice@example.com"])
        self.assertIsNotNone(alice.credential)


class RecordingHub:
    """Хаб, который фиксирует порядок обработки и держит первый запрос «в базе»."""

    def __init__(self):
        self.events = []
        self.release = asyncio.Event()
        self.disconnected_peers = []

    def connected(self, peer):
        peer.send({"type": "server-hello"})

    async def handle_async(self, peer, message):
        self.events.append(("start", message["n"]))
        if message["n"] == 0:
            await self.release.wait()
        self.events.append(("end", message["n"]))

    def disconnected(self, peer):
        self.disconnected_peers.append(peer)


@unittest.skipUnless(HAVE_WEBSOCKETS, "websockets не установлен")
class ConnectionQueueTests(unittest.IsolatedAsyncioTestCase):
    async def test_messages_of_one_connection_are_handled_in_order(self):
        hub = RecordingHub()
        websocket = FakeWebSocket([f'{{"n": {n}}}' for n in range(5)])
        handler = asyncio.create_task(calls.make_connection_handler(hub)(websocket))
        await settle(lambda: len(hub.disconnected_peers) == 1)
        # Сокет прочитан до конца, а следующий запрос не начат, пока первый ждёт базу.
        self.assertEqual(hub.events, [("start", 0)])
        hub.release.set()
        await asyncio.wait_for(handler, 2)
        self.assertEqual(hub.events, [(kind, n) for n in range(5) for kind in ("start", "end")])


if __name__ == "__main__":
    unittest.main()
