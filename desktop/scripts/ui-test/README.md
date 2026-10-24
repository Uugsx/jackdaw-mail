# Автопроверка интерфейса

Копии Jackdaw Mail для проверки интерфейса запускаются рядом с основным приложением. Основное приложение они не трогают:

- окна прозрачные, не забирают фокус и клики;
- у каждой копии свой профиль и свой порт backend;
- звук и уведомления выключены;
- камера и микрофон поддельные.

Подробности — в `backend/testProfile.ts`.

## Одна копия (демо-данные)

```bash
cd desktop
npm run build && npx electron-builder --mac --arm64 --dir --config
export JACKDAW_UI_TEST_DIR=/tmp/jd-ui
node scripts/ui-test/jd.mjs launch demo 9301 --demo
node scripts/ui-test/jd.mjs shot 9301 /tmp/jd-ui/start.png
node scripts/ui-test/jd.mjs click 9301 "text=Входящие"
node scripts/ui-test/jd.mjs stop 9301
```

Команды: `launch`, `shot`, `text`, `eval`, `click`, `clickxy`, `type`, `key`, `wait`, `size`, `stop`. Описание — в начале `jd.mjs`.

Отдельные окна письма и черновика: команды с `JD_PAGE=message` или `JD_PAGE=compose` работают с этим окном, а не с главным. Порт backend копии передаётся и им.

## Две копии: чат и звонки

1. Запустите сервисы лицензий и звонков на этом компьютере. Нужен venv с `call_server/requirements.txt` и `license_server/requirements.txt`:

   ```bash
   python scripts/ui-test/local_servers.py /tmp/jd-ui/servers
   ```

   Скрипт печатает переменные `VITE_*` для тестовой сборки. С `JACKDAW_UI_TEST_FAKE_GIFS=1` поиск GIF работает без ключа KLIPY: подменяется только ответ KLIPY, картинки настоящие, с их CDN (`nothing` — пустой результат).

   В тестовой сборке демо-данные у профиля одни и те же при каждом запуске: так проверяется перезапуск.

2. Соберите тестовый вариант. Флаг `VITE_JACKDAW_UI_TEST=1` разрешает локальные адреса. В выпусках его нет.

   ```bash
   VITE_JACKDAW_UI_TEST=1 VITE_BILLING_LICENSE_API_URL=... VITE_BILLING_ENTITLEMENT_PUBLIC_KEY=... \
     VITE_JACKDAW_UI_TEST_CALLS_URL=... npm run build
   npx electron-builder --mac --arm64 --dir --config --config.directories.output=/tmp/jd-ui/dist
   ```

   После этого пересоберите обычный вариант (`npm run build`): `out/` общий.

3. Запустите две копии:

   ```bash
   launch alice 9311 --demo --app ".../Jackdaw Mail.app"
   launch bob 9312 --demo --app ".../Jackdaw Mail.app"
   ```

   В каждой копии:
   - запустите пробный период в «Настройки → Jackdaw Mail Pro»;
   - подтвердите адрес в «Звонки и чат». Код приходит не письмом: он дописывается в `servers/codes.jsonl`.

## Важно

- В рабочей копии (worktree) `desktop/node_modules` должен быть настоящим каталогом, не ссылкой. Иначе electron-builder упакует не все зависимости, и приложение не запустится.
- Из песочницы Claude Code копии запускаются только с отключённой песочницей: GUI-приложению нужен доступ к окну.
