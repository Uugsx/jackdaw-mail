# Jackdaw Mail license server

Сервис выдаёт подписанные Pro-entitlement и принимает лицензионные ключи.
Почтовые пароли, содержимое сообщений и локальные базы Jackdaw в сервис не передаются.

## Модель доступа

1. Lemon Squeezy после покупки передаёт UUID license key через подписанный webhook.
2. Сервер хранит только SHA-256 ключа и связывает его с лимитом устройств.
3. Пользователь вводит ключ в `Настройки → Jackdaw Pro`.
4. Клиент активирует устройство и проверяет Ed25519-подпись entitlement встроенным публичным ключом.
5. Администратор выпускает собственные `JACKDAW-PRO-...` ключи, просматривает и отзывает ключи через `/admin` или защищённый API.
6. Новый пользователь может один раз запустить 7-дневный trial без карты. Сервер хранит только хеш device ID, не продлевает claim повторным запросом и требует онлайн-проверку trial.

Email не является учётной записью приложения и не требуется для активации. Он используется только как необязательная служебная метка, которую может передать платёжный провайдер.

В бесплатном плане первый почтовый аккаунт доступен без ограничений. Добавление второго аккаунта, shared mailbox или следующего почтового профиля требует Pro. Pro также открывает создание и автоматическую вставку форматированных HTML-подписей; уже сохранённые аккаунты не удаляются при истечении лицензии.

## Переменные окружения

Обязательные переменные задаются только в `/etc/jackdaw-license/license.env`:

- `JACKDAW_ADMIN_TOKEN_SHA256` — SHA-256 административного токена;
- `JACKDAW_LICENSE_PRIVATE_KEY` — путь к Ed25519 PEM-ключу;
- `JACKDAW_LICENSE_DB` — путь к SQLite базе;
- `LEMON_SQUEEZY_WEBHOOK_SECRET` и `LEMON_SQUEEZY_STORE_ID` — после активации магазина;
- `LEMON_SQUEEZY_MONTHLY_CHECKOUT_URL` и `LEMON_SQUEEZY_YEARLY_CHECKOUT_URL` — публичные URL вариантов checkout.

Необязательные переменные защиты, по умолчанию выключены:

- `JACKDAW_TRUST_X_FORWARDED_FOR=1` — считать лимиты запросов по адресу клиента из `X-Forwarded-For`. Включать, только если перед сервисом на этом же хосте стоит reverse proxy, который дописывает адрес клиента в конец заголовка (nginx: `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`, Caddy делает это сам). Без этой переменной все клиенты за прокси делят один лимит;
- `LEMON_SQUEEZY_REJECT_TEST_MODE=1` — игнорировать webhook из Test mode. Включить перед запуском продаж, иначе покупка тестовой картой выдаст настоящий ключ;
- `LEMON_SQUEEZY_PRODUCT_IDS` — id продуктов Jackdaw Pro через запятую. Webhook других продуктов магазина игнорируются.

Отзыв лицензии событием Lemon Squeezy (возврат, истечение или отключение ключа) или администратором не снимается последующими webhook. Вернуть лицензию можно только через `/v1/admin/licenses/restore`.

До заполнения Lemon Squeezy переменных активация выданных администратором ключей работает, а checkout честно сообщает, что магазин ещё не подключён. Сервис не перенаправляет покупателя на выдуманный URL. При подключённом магазине принимаются и provider UUID-ключи из письма Lemon Squeezy.

## Проверка

Тесты запускаются из корня репозитория командой `python3 -m unittest discover -s license_server/tests -v`.

## Автодеплой

Workflow `.github/workflows/deploy-license-server.yml` при пуше в `license_server/` запускает тесты, загружает `app.py` на VPS и перезапускает сервис. Миграции базы он не применяет.

Сервис работает под пользователем `jackdaw-license`, файл лежит в `/opt/jackdaw-license/app.py`. Для деплоя нужен отдельный пользователь, например `jackdaw-deploy`, у которого нет прав на запись в `/opt/jackdaw-license` и на чтение базы. Ему разрешены ровно две команды через `sudo`. Файл `/etc/sudoers.d/jackdaw-license-deploy` создают на сервере командой `visudo -f`:

```
jackdaw-deploy ALL=(root) NOPASSWD: /usr/bin/install -o jackdaw-license -g jackdaw-license -m 0644 /home/jackdaw-deploy/license-incoming/app.py /opt/jackdaw-license/app.py
jackdaw-deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart jackdaw-license
```

Пути в `sudoers` должны совпадать с теми, что вызывает workflow, и с абсолютным путём домашней папки deploy-пользователя.

Секреты репозитория: `LICENSE_DEPLOY_SSH_KEY` (закрытый ключ, который нужен только для деплоя) и `LICENSE_DEPLOY_KNOWN_HOSTS` (результат `ssh-keyscan -t ed25519 <хост>`). Переменные: `LICENSE_DEPLOY_HOST`, `LICENSE_DEPLOY_USER`; необязательные `LICENSE_DEPLOY_PATH` и `LICENSE_SERVICE_USER`. Пока обязательные значения не заданы, шаг деплоя пропускается с предупреждением.
