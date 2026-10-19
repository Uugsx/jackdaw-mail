# Jackdaw Mail license server

Сервис выдаёт подписанные Pro-entitlement и принимает лицензионные ключи.
Почтовые пароли, содержимое сообщений и локальные базы Jackdaw в сервис не передаются.

## Модель доступа

1. Основной провайдер — Paddle Billing. Paddle не выдаёт ключи Jackdaw: после подписанного webhook `transaction.completed` сервер сам выпускает ключ `JACKDAW-PRO-...`, отдаёт его странице покупки и, если настроено, дублирует письмом покупателю (см. «Paddle» ниже).
   Lemon Squeezy остаётся совместимым запасным провайдером: он передаёт UUID license key через подписанный webhook, маршрут `/v1/webhooks/lemon-squeezy` работает как раньше.
2. Сервер хранит только SHA-256 ключа и связывает его с лимитом устройств.
3. Пользователь вводит ключ в `Настройки → Jackdaw Pro`.
4. Клиент активирует устройство и проверяет Ed25519-подпись entitlement встроенным публичным ключом.
5. Администратор выпускает собственные `JACKDAW-PRO-...` ключи, просматривает и отзывает ключи через `/admin` или защищённый API.
6. Новый пользователь может один раз запустить 7-дневный trial без карты. Сервер хранит только хеш device ID, не продлевает claim повторным запросом и требует онлайн-проверку trial.

Email не является учётной записью приложения и не требуется для активации. Он используется только как необязательная служебная метка, которую может передать платёжный провайдер, и как адрес письма с ключом Paddle (в базе не сохраняется).

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

## Paddle

Поток покупки:

1. Сайт берёт клиентский токен, окружение и ID цен из `GET /v1/public-config` и открывает checkout Paddle.js с `customData.jackdaw_claim` — случайным токеном, созданным в браузере покупателя.
2. Paddle присылает `transaction.completed` на `POST /v1/webhooks/paddle`. Сервер проверяет `Paddle-Signature` (HMAC-SHA256 над `ts:тело` по исходным байтам, сравнение постоянного времени, расхождение времени не больше `PADDLE_WEBHOOK_TOLERANCE_SECONDS`), статус `completed`, ID цены и продукта.
3. При первой оплате подписки сервер выпускает ключ `JACKDAW-PRO-...`: в `licenses` попадает только хеш, а для выдачи сохраняется шифротекст ключа (AES-GCM, ключ шифрования выводится из токена покупателя) и хеш токена. Открытый ключ и токен в базе не хранятся.
4. Страница покупки после события `checkout.completed` опрашивает `POST /v1/paddle/claim` с `transactionId` и токеном. Ключ отдаётся только владельцу токена; неизвестная покупка и неверный токен дают одинаковый ответ `404 purchase_pending`. Получить ключ можно 30 дней.
5. Продление (`transaction.completed` с `origin=subscription_recurring`) сдвигает оплаченный период вперёд, но никогда назад. `subscription.*` применяются только если событие не старше уже применённого (`occurred_at`): отмена и пауза заканчивают доступ в момент `canceled_at`/`paused_at`, `past_due` включает льготный период `JACKDAW_LICENSE_GRACE_DAYS`, смена цены меняет план. Доступ без подтверждённой оплаты события подписки не выдают.
6. Полный возврат и chargeback (`adjustment.created`/`adjustment.updated` со статусом `approved`) отзывают лицензию. Отзыв не снимается последующими событиями.
7. Повтор того же `event_id` отвечает `duplicate` и ничего не меняет. События с чужим ID цены или продукта отвечают `200 ignored` и не записываются, поэтому после исправления настроек их можно повторить из Paddle.

Если покупка прошла без токена (например, через ссылку из Paddle Dashboard), лицензия создаётся, а ключ приходит только письмом. Если не настроено и письмо, ключ некому передать: сервер пишет предупреждение в журнал, администратор выпускает замену в `/admin`.

### Письмо с ключом

При первой оплате подписки ключ кроме страницы покупки отправляется на email покупателя. В `transaction.completed` есть только `customer_id`, поэтому адрес берётся запросом `GET /customers/{customer_id}` к API Paddle непосредственно перед отправкой. Подписка на `customer.*` с хранением адресов отклонена: тогда база хранила бы email каждого, кто открыл checkout, а событие `customer.created` может прийти позже оплаты.

1. В той же транзакции базы, что выпускает ключ, в `paddle_key_emails` ставится запись: `customer_id` и ключ, зашифрованный AES-GCM ключом, выведенным (HKDF) из закрытого Ed25519-ключа сервиса. Копия базы без этого файла ключ не раскрывает. Email в базе не хранится никогда.
2. Webhook сразу отвечает `200`, фоновый поток запрашивает адрес у Paddle и отправляет письмо через SMTP со STARTTLS и проверкой сертификата. После отправки или окончательного отказа `customer_id` и шифротекст стираются, остаются только статус и время.
3. Сбой API или SMTP повторяется с паузами от минуты до суток, всего около четырёх суток (`PADDLE_KEY_EMAIL_RETRY_DELAYS`); очередь в базе переживает перезапуск. Если у покупателя нет адреса, письмо помечается `failed` без повторов. Лицензия, отозванная до отправки (возврат), письма не получает (`canceled`).
4. Продление и повтор webhook письма не создают: запись появляется только вместе с новым ключом и только один раз на транзакцию. Если процесс упадёт между отправкой и записью результата, письмо может уйти повторно — это лучше потерянного ключа.
5. В журнал попадают только id транзакции и короткий код ошибки (`smtp_SMTPAuthenticationError`, `paddle_api_http_403`…), без адреса, ключа и пароля.

Без настройки или при сбое письма ключ по-прежнему забирается со страницы покупки — ничего не меняется.

Переменные письма (в `/etc/jackdaw-license/license.env`):

- `PADDLE_API_KEY` — серверный API-ключ Paddle (`pdl_sdbx_apikey_...` для Sandbox, `pdl_live_apikey_...` для Live) с единственным разрешением **Customers: Read** (`customer.read`). Создаётся в **Developer tools → Authentication → API keys**. Секретный, вводит владелец; ключ другого окружения или неверного формата останавливает запуск;
- `JACKDAW_LICENSE_SMTP_PASSWORD_FILE` — путь к файлу с паролем SMTP. На VPS это общий с сервисом звонков файл Resend `/etc/jackdaw-calls/smtp.secret` (`root:jackdaw-license 0440`); пароль читается при каждой отправке и никуда не копируется;
- необязательно: `JACKDAW_LICENSE_SMTP_HOST` (по умолчанию `smtp.resend.com`), `JACKDAW_LICENSE_SMTP_PORT` (`2587` — на VPS исходящие 25/465/587 закрыты), `JACKDAW_LICENSE_SMTP_USER` (`resend`), `JACKDAW_LICENSE_MAIL_FROM` (`Jackdaw Mail <noreply@jackdaw-mail.pro>`).

Письмо включается, когда настроен webhook Paddle и заданы `PADDLE_API_KEY` и `JACKDAW_LICENSE_SMTP_PASSWORD_FILE`; строка запуска в журнале показывает `key_email_configured=True`. Покупки, прошедшие до включения, писем не получают.

Переменные Paddle (все в `/etc/jackdaw-license/license.env`, значения не коммитятся):

- `PADDLE_ENVIRONMENT` — `sandbox` (по умолчанию) или `production`;
- `PADDLE_CLIENT_TOKEN` — клиентский токен Paddle.js: `test_...` для Sandbox, `live_...` для Live. Публичный, отдаётся сайту через `/v1/public-config`;
- `PADDLE_WEBHOOK_SECRET` — секрет notification destination (`pdl_ntfset_...`). Секретный, наружу не отдаётся;
- `PADDLE_MONTHLY_PRICE_ID`, `PADDLE_YEARLY_PRICE_ID` — ID цен `pri_...`. Для Sandbox: `pri_01m5a4y49fpvggt57sfxwaf7k4` и `pri_01m5a4yq26dcyy79600zwytjrw`;
- `PADDLE_PRODUCT_ID` — необязательно, ID продукта `pro_...` (Sandbox: `pro_01m5a4tmfa7qet7sgepx5wdh5h`). Позиции другого продукта игнорируются;
- `PADDLE_WEBHOOK_TOLERANCE_SECONDS` — необязательно, по умолчанию 5 (как в SDK Paddle), не больше 300.

Webhook принимается при заданных секрете и обеих ценах, checkout на сайте открывается при наличии ещё и клиентского токена. Заданное, но некорректное значение (неизвестное окружение, токен `live_` в Sandbox, неверный формат ID) останавливает запуск сервиса. Лицензии из Sandbox помечены `source = paddle-sandbox` и заметкой «Paddle Sandbox»; перед запуском продаж их стоит отозвать. В Sandbox и Live разные секреты, токены и ID цен — переключение на Live меняет все пять значений вместе с `PADDLE_ENVIRONMENT=production` и `environment` в `site/billing-config.js`.

Ссылки `/buy/monthly` и `/buy/yearly` (их открывает приложение) при настроенном Paddle ведут на `https://jackdaw-mail.pro/?checkout={plan}#plans`, где сайт сразу открывает checkout. Без Paddle они по-прежнему ведут в Lemon Squeezy.

Миграция `migrations/003_paddle_billing.sql` (таблицы `paddle_subscriptions` и `paddle_key_deliveries`) применяется автоматически при запуске: её SQL встроен в `app.py`, потому что автодеплой загружает только этот файл. Откат: остановить сервис, выполнить `sqlite3 /var/lib/jackdaw-license/license.sqlite3 < migrations/003_paddle_billing.rollback.sql` и вернуть предыдущий `app.py` — текущая версия при запуске применит миграцию снова. Лицензии, уже выпущенные через Paddle, при откате остаются в `licenses` и продолжают работать до своего срока.

Миграция `migrations/004_paddle_key_emails.sql` (очередь писем `paddle_key_emails`) встроена так же. Откат: остановить сервис, выполнить `migrations/004_paddle_key_emails.rollback.sql` и вернуть предыдущий `app.py`. Неотправленные письма при откате теряются, ключи остаются доступны на странице покупки.

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
