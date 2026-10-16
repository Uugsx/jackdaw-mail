"""Проверка настоящего WebSocket-транспорта. Пропускается, если пакет websockets не установлен."""

import asyncio
import json
import socket
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import calls  # noqa: E402
from test_calls import LICENSE_KEY, create_database  # noqa: E402

try:
    from websockets.asyncio.client import connect
except ImportError:  # pragma: no cover - зависит от окружения
    connect = None


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


@unittest.skipIf(connect is None, "websockets не установлен")
class TransportTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        db_path = Path(self.tmp.name) / "license.sqlite3"
        create_database(db_path)
        self.signer = calls.EmailProofSigner(b"p" * 32)
        hub = calls.CallHub(
            calls.CredentialVerifier(db_path),
            calls.EmailVerification(self.signer),
            None,
            None,
        )
        self.port = free_port()
        self.server = asyncio.create_task(calls.serve(hub, "127.0.0.1", self.port))
        for _ in range(50):
            try:
                async with connect(f"ws://127.0.0.1:{self.port}/v1/calls"):
                    break
            except OSError:
                await asyncio.sleep(0.02)

    async def asyncTearDown(self):
        self.server.cancel()
        try:
            await self.server
        except asyncio.CancelledError:
            pass
        self.tmp.cleanup()

    async def hello(self, websocket, device, email):
        await websocket.send(json.dumps({
            "type": "hello",
            "credential": {"kind": "license", "licenseKey": LICENSE_KEY, "deviceId": device},
            "emailProofs": [self.signer.issue(email, "license:1")],
        }))
        while True:
            message = json.loads(await websocket.recv())
            if message["type"] == "welcome":
                return message

    async def receive(self, websocket, message_type):
        while True:
            message = json.loads(await asyncio.wait_for(websocket.recv(), 2))
            if message["type"] == message_type:
                return message

    async def test_call_between_two_clients(self):
        url = f"ws://127.0.0.1:{self.port}/v1/calls"
        async with connect(url) as alice, connect(url) as bob:
            self.assertEqual((await self.hello(alice, "device-alice-1", "alice@example.com"))["emails"], ["alice@example.com"])
            await self.hello(bob, "device-bob-0001", "bob@example.com")
            await alice.send(json.dumps({"type": "invite", "callId": "call-0001", "to": "bob@example.com", "video": False}))
            incoming = await self.receive(bob, "incoming")
            self.assertFalse(incoming["video"])
            await bob.send(json.dumps({"type": "accept", "callId": "call-0001"}))
            self.assertEqual((await self.receive(alice, "accepted"))["media"], "p2p")
            await self.receive(bob, "joined")
            sdp = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n"
            await alice.send(json.dumps({"type": "signal", "callId": "call-0001", "kind": "offer", "sdp": sdp}))
            self.assertEqual((await self.receive(bob, "signal"))["sdp"], sdp)
            await alice.send(json.dumps({"type": "hangup", "callId": "call-0001"}))
            self.assertEqual((await self.receive(bob, "call-ended"))["reason"], "hangup")

    async def test_unknown_path_and_oversized_message(self):
        async with connect(f"ws://127.0.0.1:{self.port}/v1/calls") as websocket:
            await websocket.send("{" + " " * 100 + "}")
            await websocket.send("not json")
            self.assertEqual((await self.receive(websocket, "error"))["code"], "invalid_message")
        async with connect(f"ws://127.0.0.1:{self.port}/other") as websocket:
            with self.assertRaises(Exception):
                await asyncio.wait_for(websocket.recv(), 2)


if __name__ == "__main__":
    unittest.main()
