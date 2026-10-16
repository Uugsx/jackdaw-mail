# Сервис звонков Jackdaw Mail

Аудио- и видеозвонки между пользователями Jackdaw Mail по email-адресу.

```
Клиент A ──wss /v1/calls──► jackdaw-calls (присутствие, вызов, токены) ◄──wss── Клиент B
   │                                  │ только чтение
   │                                  ▼
   │                         база сервиса лицензий
   └────── WebRTC ──────► LiveKit SFU + встроенный TURN ◄────── WebRTC ── Клиент B
```

- `calls.py` — сигналинг на `websockets` (asyncio). Логика (`CallHub`) не зависит от транспорта и покрыта тестами без сети.
- Медиа идёт через собственный LiveKit (`deploy/livekit.yaml`). Сервис только выдаёт токены на одну комнату `call-<uuid>` на 15 минут; LiveKit сам продлевает токен подключённым участникам.
- Звонки — 1:1 (`room.max_participants: 2`).

## Модель доступа

1. **Лицензия.** Клиент при входе передаёт тот же ключ и `deviceId`, что и сервису лицензий (или `deviceId` пробного периода). Сервис проверяет их по базе лицензий через соединение с `PRAGMA query_only` — записать в базу он не может. Каждые 15 минут проверка повторяется; отозванная лицензия отключает клиента.
2. **Владение адресом.** Адрес становится доступным для звонков только после кода из письма (SMTP, `JACKDAW_CALLS_SMTP_*`). Сервис выдаёт подписанное HMAC подтверждение на 90 дней, привязанное к лицензии (или устройству пробного периода): чужая лицензия его не примет. Сервер подтверждений не хранит.
3. **Присутствие** живёт только в памяти: адрес «в сети», пока открыто соединение с подтверждением. После перезапуска сервиса клиенты переподключаются сами.
4. Звонящий указывает только свой подтверждённый адрес; подделать отправителя нельзя. Принять, отклонить или завершить звонок может только его участник.

Ограничения: 3 письма с кодом на адрес в час, 5 попыток ввода кода, 12 запросов справочника в минуту (до 50 адресов), 10 писем с кодом на лицензию в час, 10 вызовов в минуту на соединение.

Справочник отвечает лицензированным пользователям, доступен ли адрес для звонка. Это раскрывает факт использования Jackdaw тем, кто знает адрес, — поэтому адрес попадает в справочник только после явного подтверждения пользователем, а запросы ограничены.

## Состояния звонка

`invite` → `ringing` (всем устройствам вызываемого приходит `incoming`) → `accept` / `reject` / `cancel` / 45 с без ответа → `accepted` + `joined` с токенами LiveKit → `hangup`.

Причины завершения (`call-ended.reason`): `offline`, `busy`, `declined`, `no-answer`, `cancelled`, `hangup`, `answered-elsewhere`, `connection-lost` (обрыв без переподключения 30 с), `timeout` (4 часа).

## Развёртывание (рядом с сервисом лицензий)

1. LiveKit: `docker run` из комментария в `deploy/livekit.yaml`. Открыть наружу UDP 3478, TCP 5349 (TURN/TLS), TCP 7881, UDP 50000–60000. Сертификат для `turn.jackdaw-mail.pro`.
2. Сигналинг:
   ```bash
   sudo install -d -o jackdaw-license -g jackdaw-license /opt/jackdaw-calls
   sudo install -o jackdaw-license -g jackdaw-license -m 0644 call_server/calls.py /opt/jackdaw-calls/calls.py
   sudo -u jackdaw-license python3 -m venv /opt/jackdaw-calls/venv
   sudo -u jackdaw-license /opt/jackdaw-calls/venv/bin/pip install -r call_server/requirements.txt
   sudo install -d -m 0700 /etc/jackdaw-calls
   sudo install -m 0600 call_server/deploy/calls.env.example /etc/jackdaw-calls/calls.env
   sudo sh -c 'openssl rand -hex 32 > /etc/jackdaw-calls/proof.secret && chmod 0600 /etc/jackdaw-calls/proof.secret'
   sudo install -m 0644 call_server/systemd/jackdaw-calls.service /etc/systemd/system/
   sudo systemctl daemon-reload && sudo systemctl enable --now jackdaw-calls
   ```
   Секреты (`livekit.secret`, `smtp.secret`) кладутся файлами с правами 0600; systemd читает env-файл от root.
3. Reverse proxy: `deploy/Caddyfile.example` — `/v1/calls` на 8091 под тем же доменом, что и сервис лицензий (клиент строит адрес `wss://<домен лицензий>/v1/calls`), и `calls.jackdaw-mail.pro` на LiveKit.

Схема БД сервиса лицензий не меняется, миграций нет.

## Стоимость

VPS 2 vCPU / 4 ГБ для LiveKit + сигналинга: ≈ $10–25 в месяц. Основная переменная статья — трафик: видеозвонок 1:1 через SFU ≈ 2 × 1,5 Мбит/с ≈ 1,3 ГБ в час. Аудио ≈ 50 МБ в час.

## Проверка

```bash
python3 -m unittest discover -s call_server/tests -v
```

Тест транспорта (`test_transport.py`) запускается, когда установлен `websockets`, иначе пропускается.
