#!/usr/bin/env python3
"""
Сервисы лицензий и звонков на этом компьютере для автопроверок двух копий Jackdaw Mail.

    python local_servers.py <каталог данных>

- Лицензии: http://127.0.0.1:18090, свой ключ подписи (публичный ключ печатается для сборки).
- Звонки и чат: ws://127.0.0.1:18091/v1/calls.
- Письма с кодом подтверждения адреса никуда не уходят: код дописывается в <каталог>/codes.jsonl.

Код серверов не меняется: подменяется только отправка письма. Слушают только 127.0.0.1.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import os
import secrets
import sys
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
LICENSE_PORT = 18090
CALLS_PORT = 18091


def prepare(data_dir: Path) -> str:
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    data_dir.mkdir(parents=True, exist_ok=True)
    key_path = data_dir / "ed25519-private.pem"
    if not key_path.exists():
        key_path.write_bytes(Ed25519PrivateKey.generate().private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    key = serialization.load_pem_private_key(key_path.read_bytes(), password=None)
    public_raw = key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    proof_path = data_dir / "proof.secret"
    if not proof_path.exists():
        proof_path.write_text(secrets.token_hex(32))
    os.environ.update({
        "JACKDAW_LICENSE_HOST": "127.0.0.1",
        "JACKDAW_LICENSE_PORT": str(LICENSE_PORT),
        "JACKDAW_LICENSE_DB": str(data_dir / "license.sqlite3"),
        "JACKDAW_LICENSE_PRIVATE_KEY": str(key_path),
        "JACKDAW_ADMIN_TOKEN_SHA256": hashlib.sha256(secrets.token_bytes(32)).hexdigest(),
        "JACKDAW_CALLS_HOST": "127.0.0.1",
        "JACKDAW_CALLS_PORT": str(CALLS_PORT),
        "JACKDAW_CALLS_DATA_DIR": str(data_dir / "calls"),
        "JACKDAW_CALLS_PROOF_SECRET_FILE": str(proof_path),
        # Mailer считает подтверждение доступным только с адресом сервера и отправителем
        "JACKDAW_CALLS_SMTP_HOST": "codes-file",
        "JACKDAW_CALLS_MAIL_FROM": "Jackdaw Mail UI test <noreply@example.test>",
    })
    (data_dir / "calls").mkdir(exist_ok=True)
    return base64.urlsafe_b64encode(public_raw).decode().rstrip("=")


# Настоящие файлы с CDN KLIPY (из примеров docs.klipy.com): выбор GIF их показывает и скачивает.
FAKE_GIF_URLS = [
    "https://static.klipy.com/ii/925f17378dd1893b674a723c07535afe/1c/24/Oizp49sT.gif",
    "https://static.klipy.com/ii/f87f46a2c5aeaeed4c68910815f73eaf/af/77/35MgTkW5.gif",
    "https://static.klipy.com/ii/ce286d05b8e1a47cd4f32b0e1b6dec0e/a6/f3/SEmLt8aA.gif",
    "https://static.klipy.com/ii/e293a233a303a98e471f78d04e13a1b0/a5/fd/NnGoLmO8.gif",
    "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/8GCrVAB7.gif",
    "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/um0L4dFH.gif",
]


def install_fake_gifs() -> None:
    """JACKDAW_UI_TEST_FAKE_GIFS=1: поиск GIF без ключа KLIPY. Подменяется только запрос к KLIPY —
    разбор ответа, кеш и лимиты в gifs.py работают как на сервере."""
    import urllib.parse
    import gifs

    def fake_fetch(url: str) -> dict:
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query).get("q", ["trending"])[0]
        items = [{"id": f"fake{index}", "type": "gif", "title": f"{query} {index + 1}",
                  "file": {"sm": {"gif": {"url": gif_url, "width": 220, "height": 160}}}}
                 for index, gif_url in enumerate(FAKE_GIF_URLS)]
        if query == "nothing":
            items = []
        return {"result": True, "data": {"data": items, "has_next": False}}

    gifs.build_gifs_from_environment = lambda: gifs.GifService("ui-test-fake-key", fetch=fake_fetch)


def main() -> None:
    data_dir = Path(sys.argv[1]).resolve()
    public_key = prepare(data_dir)
    sys.path[:0] = [str(ROOT / "call_server"), str(ROOT / "license_server")]
    import app as license_app
    import calls

    codes_path = data_dir / "codes.jsonl"

    def write_code(self, email: str, code: str) -> None:
        with codes_path.open("a") as codes:
            codes.write(json.dumps({"email": email, "code": code}) + "\n")

    calls.Mailer.send_code = write_code
    if os.environ.get("JACKDAW_UI_TEST_FAKE_GIFS") == "1":
        install_fake_gifs()

    config = license_app.Configuration()
    store = license_app.LicenseStore(config.database_path)
    signer = license_app.EntitlementSigner(config.private_key_path)
    license_service = license_app.LicenseHTTPService(config, store, signer)
    threading.Thread(target=license_service.serve_forever, daemon=True).start()

    print(f"VITE_BILLING_LICENSE_API_URL=http://127.0.0.1:{LICENSE_PORT}", flush=True)
    print(f"VITE_BILLING_ENTITLEMENT_PUBLIC_KEY={public_key}", flush=True)
    print(f"VITE_JACKDAW_UI_TEST_CALLS_URL=ws://127.0.0.1:{CALLS_PORT}/v1/calls", flush=True)
    print(f"Коды подтверждения: {codes_path}", flush=True)
    hub, host, port = calls.build_hub_from_environment()
    asyncio.run(calls.serve(hub, host, port))


if __name__ == "__main__":
    main()
