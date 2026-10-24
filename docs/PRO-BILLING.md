# Jackdaw Mail Pro: покупка и лицензирование

> Код сервера лицензий — в закрытом репозитории `Uugsx/jackdaw-servers`. Здесь остаются поток покупки и контракт API, с которым работает открытый клиент.

## Решение для международного запуска

Основной провайдер — **Paddle Billing** (Merchant of Record): checkout Paddle.js открывается поверх страницы тарифов на сайте, ключ Jackdaw выпускает сервер лицензий после подписанного webhook. Сейчас подключена только тестовая среда **Paddle Sandbox**; настройка описана в разделе «Paddle» ниже и в `license_server/README.md`.

**Lemon Squeezy** остаётся совместимым запасным провайдером на сервере: его маршруты, webhook и ключи продолжают работать, а `/buy/{plan}` ведёт в него, если Paddle не настроен. Исходное решение:

Для международных продаж был выбран **Lemon Squeezy** как внешний hosted checkout и Merchant of Record. Он принимает карты Visa и Mastercard, а также доступные для конкретной страны PayPal, Apple Pay и Google Pay. Платёжная форма открывается во внешнем браузере; данные карты не проходят через Jackdaw Mail.

Российская Федерация не входит в список поддерживаемых стран покупателей Lemon Squeezy. До публикации магазина отдельно проверяются активация продавца, KYC/KYB и возможность получать выплаты на поддерживаемый банковский счёт или PayPal.

## Что входит в Pro

| Бесплатная версия | Jackdaw Mail Pro |
|---|---|
| Почта, календарь, контакты и один почтовый аккаунт | Интерактивные отчёты |
| Основные настройки приложения | Живой контроль SLA в правой панели |
| Локальная работа с почтой | Рабочий календарь по каждому дню недели |
|  | Таймеры и напоминания в рабочих минутах |
|  | Правила категорий, архив контроля и восстановление |
|  | Подробный просмотр внутри приложения и HTML-экспорт |
|  | Несколько почтовых аккаунтов и shared mailboxes |
|  | Форматированные HTML-подписи с ссылками и изображениями |

## Актуальные цены Pro

- **$9.99 / month** — месячная подписка с автоматическим продлением;
- **$79.99 / year** — годовая подписка с автоматическим продлением.

Цены указаны в долларах США и синхронизированы с Test mode Lemon Squeezy, лендингом и экраном биллинга в приложении. Итоговая сумма, налоги и условия продления показываются в checkout перед оплатой; изменение цены в магазине требует синхронного обновления публичных цен в клиенте и документации.

## Paddle

Каталог Sandbox (шаг 1 из 4 в Paddle Dashboard выполнен):

| Объект | ID |
|---|---|
| Продукт Jackdaw Mail | `pro_01m5a4tmfa7qet7sgepx5wdh5h` |
| $9.99 / month | `pri_01m5a4y49fpvggt57sfxwaf7k4` |
| $79.99 / year | `pri_01m5a4yq26dcyy79600zwytjrw` |

Состояние на 2026-10-19: шаги 1–3 выполнены в Sandbox — создан клиентский токен «jackdaw-mail.pro website», задан default payment link, домен `jackdaw-mail.pro` одобрен для checkout, создан webhook destination на 11 событий (Platform и Simulation). Значения токена и секрета в репозиторий не записаны: они берутся из Dashboard и задаются только на сервере.

Настройка в Paddle Dashboard (Sandbox, без переключения в Live):

1. **Developer tools → Authentication → Client-side tokens**: создать токен `test_...` и записать его в `PADDLE_CLIENT_TOKEN` на сервере лицензий. В репозиторий токен не попадает: сайт получает его из `/v1/public-config`.
2. **Checkout → Checkout settings**: указать default payment link `https://jackdaw-mail.pro/` — без него Paddle.js не открывает checkout. В Live домен `jackdaw-mail.pro` дополнительно проходит проверку Paddle.
3. **Developer tools → Notifications → New destination**: URL `https://license.jackdaw-mail.pro/v1/webhooks/paddle`, тип webhook, события `transaction.completed`, `subscription.created`, `subscription.activated`, `subscription.updated`, `subscription.canceled`, `subscription.past_due`, `subscription.paused`, `subscription.resumed`, `subscription.trialing`, `adjustment.created`, `adjustment.updated`. Секрет destination (`pdl_ntfset_...`) записать в `PADDLE_WEBHOOK_SECRET`.
4. На сервере лицензий задать `PADDLE_ENVIRONMENT=sandbox`, `PADDLE_MONTHLY_PRICE_ID`, `PADDLE_YEARLY_PRICE_ID`, `PADDLE_PRODUCT_ID` и перезапустить сервис. `GET /healthz` вернёт `paddleConfigured: true`.
5. Проверить покупку тестовой картой Paddle Sandbox и повтор события через **Notifications → Replay**.

Переход на Live: отдельный аккаунт Paddle Live с собственными продуктом, ценами, токеном `live_...` и секретом; на сервере `PADDLE_ENVIRONMENT=production` и новые значения, на сайте `environment: 'production'` и новые ID цен в `site/billing-config.js`. Сайт открывает checkout только при совпадении окружения и цен с сервером.

Поток покупки через Paddle:

```text
Сайт: Paddle.Checkout.open(priceId, quantity 1, customData.jackdaw_claim)
                              ↓
          Paddle: оплата → transaction.completed (webhook)
                              ↓
   Сервер лицензий: подпись, цена, статус → ключ JACKDAW-PRO-...
                              ↓
   Сайт: checkout.completed → POST /v1/paddle/claim → ключ на странице
   Сервер (фоном): GET /customers/{id} в Paddle → письмо с ключом через Resend
                              ↓
          Пользователь вставляет ключ в Настройки → Jackdaw Pro
```

`jackdaw_claim` — случайный токен из браузера покупателя. Он не даёт права на лицензию: доступ выдаётся только по подписанному webhook с оплаченной транзакцией. Токен лишь позволяет этой вкладке забрать уже выпущенный ключ.

Письмо с ключом уходит один раз, при первой оплате подписки (не при продлении), если на сервере заданы `PADDLE_API_KEY` (разрешение Customers: Read) и `JACKDAW_LICENSE_SMTP_PASSWORD_FILE`. Адрес покупателя запрашивается у Paddle перед отправкой и в базе не хранится; при сбое письмо повторяется около четырёх суток, а ключ в любом случае доступен на странице. Подробности — в `license_server/README.md` закрытого репозитория `Uugsx/jackdaw-servers`, раздел «Письмо с ключом».

## Настройка магазина Lemon Squeezy (запасной провайдер)

1. Создать продукт `Jackdaw Mail Pro`.
2. Создать варианты `Monthly` и `Yearly` с подпиской.
3. Включить генерацию license keys для обоих вариантов и выбрать допустимое число активаций.
4. Настроить письмо с ключом, receipt и страницу после покупки.
5. Указать webhook на `https://license.jackdaw-mail.pro/v1/webhooks/lemon-squeezy`.
6. Активировать магазин и проверить payout account до публикации ссылок checkout.

Для размещения на сайте и в приложении используются только shareable-ссылки вида:

```text
https://<store>.lemonsqueezy.com/checkout/buy/<variant-id>
```

Ссылки с `/checkout/?cart=` являются одноразовыми ссылками конкретной корзины и не должны публиковаться в коде или рекламе.

## Поток покупки

```text
Jackdaw Mail / сайт → checkout Lemon Squeezy
                              ↓
                 подписка и license key
                              ↓
                  подписанный webhook
                              ↓
                 сервер лицензий и entitlement
                              ↓
                    Jackdaw проверяет доступ
```

1. Пользователь выбирает месячный или годовой вариант на сайте.
2. `license.jackdaw-mail.pro/buy/{plan}` перенаправляет на проверенный checkout Lemon Squeezy.
3. После оплаты Lemon Squeezy отправляет покупателю license key на email.
4. Сервер лицензий принимает webhook, проверяет `X-Signature` по исходному телу запроса и идемпотентно обновляет подписку.
5. Пользователь вставляет ключ в `Настройки → Jackdaw Pro`; email-вход в приложение для этого не нужен.
6. Сервер активирует устройство и выдаёт подписанное entitlement, а Jackdaw проверяет Ed25519-подпись встроенным публичным ключом.

Почтовые пароли, содержимое писем, локальный кэш и категории не отправляются в Lemon Squeezy или сервер лицензий.

### Администратор

Администратор не использует пользовательский email-вход. В закрытом интерфейсе `https://license.jackdaw-mail.pro/admin/` он может:

- выпустить бессрочный admin-ключ или ограниченный ключ `monthly`/`yearly`/`trial`;
- задать срок действия, число устройств, email-метку и внутреннюю заметку;
- посмотреть статус и последние четыре символа ключа;
- отозвать или восстановить доступ.

В базе хранятся только хеши ключей и устройств. Административный bearer-токен хранится на VPS в root-only файле и не попадает в приложение, Git или лендинг.

### Пробный период Pro

В приложении доступна одна бесплатная проба на **7 дней** без банковской карты. Кнопка запуска появляется в `Настройки → Jackdaw Pro` и на экране заблокированной Pro-функции, пока на устройстве нет платной лицензии.

Пробный период работает так:

1. Клиент отправляет на сервер только случайный идентификатор устройства и техническое имя устройства.
2. Сервер один раз создаёт запись `trial_claims`, хранит только хеш идентификатора и выдаёт подписанный Ed25519 entitlement со сроком `validUntil`.
3. Повторный запуск не продлевает срок: повторный `start` возвращает тот же срок, а после окончания сервер отклоняет запрос.
4. Во время trial приложение проверяет сервер при запуске и затем каждые 15 минут. Для trial офлайн-доступ не предоставляется.
5. В entitlement передаётся серверное время. Клиент сохраняет временной якорь, поэтому перевод часов назад не продлевает срок и переводит доступ в состояние проверки при обнаружении отката.
6. Администратор видит пробные периоды через `GET /v1/admin/trials` и может досрочно отозвать конкретный период через `POST /v1/admin/trials/revoke`.

Важно: на машине, которую пользователь полностью контролирует, невозможно гарантировать абсолютную защиту от патчинга бинарника, удаления профиля, виртуальной машины или подмены окружения. Текущая схема блокирует обычные обходы сменой даты, переустановкой в том же профиле и повторным запросом к API. Если понадобится защита от сброса профиля/VM, следующим уровнем будет обязательный аккаунт с подтверждённым email и серверная политика на уровне аккаунта; это добавит пользовательскую авторизацию и обработку персональных данных.

## Публичная конфигурация клиента

В клиент можно передавать только публичные URL:

```text
VITE_LEMON_SQUEEZY_MONTHLY_CHECKOUT_URL=https://<store>.lemonsqueezy.com/checkout/buy/<monthly-variant-id>
VITE_LEMON_SQUEEZY_YEARLY_CHECKOUT_URL=https://<store>.lemonsqueezy.com/checkout/buy/<yearly-variant-id>
VITE_BILLING_LICENSE_API_URL=https://license.jackdaw-mail.pro
VITE_BILLING_ENTITLEMENT_PUBLIC_KEY=<публичный Ed25519-ключ>
```

Сайт берёт клиентский токен Paddle только из `/v1/public-config`; в `site/billing-config.js` хранятся окружение и публичные ID цен. Если Paddle не настроен, кнопки покупки работают по-старому.

Для статического сайта checkout-кнопки уже ведут только на собственный allowlist-адрес `https://license.jackdaw-mail.pro/buy/monthly` или `/buy/yearly`. Сервер перенаправит их в Lemon Squeezy только после заполнения своих переменных окружения; до этого он показывает честную страницу «магазин не подключён».

Клиент проверяет HTTPS, домен Lemon Squeezy или собственный домен лицензий и формат пути. Секрет магазина, API-токен Lemon Squeezy, webhook secret и приватный ключ подписи entitlement никогда не попадают в Vite-переменные или Electron-бандл.

До заполнения Lemon-переменных администраторские ключи уже работают, а бесплатная почта продолжает работать независимо от состояния Pro.

## Контракт сервера лицензий

Провайдер скрыт за серверным адаптером. В клиенте нет SDK Lemon Squeezy и платёжных секретов. Paddle.js загружается только сайтом и только при настроенном Paddle.

### `GET /v1/public-config`

Возвращает только публичную конфигурацию:

```json
{
  "activation": { "method": "license-key", "emailRequired": false },
  "checkout": { "monthly": { "configured": true }, "yearly": { "configured": true } },
  "paddle": {
    "configured": true,
    "environment": "sandbox",
    "clientToken": "test_...",
    "prices": { "monthly": "pri_...", "yearly": "pri_..." }
  },
  "trial": { "configured": true, "durationDays": 7, "onlineRequired": true }
}
```

`checkout.{plan}.configured` истинно, если настроен Paddle или Lemon Squeezy. Без клиентского токена объект Paddle сокращается до `{ "configured": false }`.

### `POST /v1/webhooks/paddle`

- подпись `Paddle-Signature` (`ts=...;h1=...`) проверяется HMAC-SHA256 над `ts:исходное тело` с constant-time сравнением и допуском по времени 5 секунд;
- `event_id` записывается до бизнес-обработки, повтор отвечает `duplicate`;
- `transaction.completed` со статусом `completed` и известной ценой выдаёт или продлевает доступ; при выдаче нового ключа ставит в очередь письмо с ключом (ответ webhook его не ждёт); `subscription.*` применяются по `occurred_at` и не выдают доступ без оплаты;
- полный возврат и chargeback отзывают лицензию;
- чужие цены и продукты отвечают `200 ignored` без записи события.

### `POST /v1/paddle/claim`

Принимает `transactionId` и `claimToken`, возвращает `licenseKey` и `license` только владельцу токена. Пока webhook не пришёл или токен неверен — `404 purchase_pending`; отозванная лицензия — `403`; истёкший срок получения (30 дней) — `410`.

### `POST /v1/license/activate` и `/v1/license/refresh`

Оба endpoint принимают `licenseKey`, `deviceId` и необязательное имя устройства. `activate` создаёт активацию, `refresh` требует, чтобы устройство уже было активировано. Ответ содержит подписанные `payload` и `signature`; почтовые данные в запросе отсутствуют.

### `POST /v1/license/deactivate`

Снимает текущую активацию устройства. Локальный ключ можно удалить и без сети, поэтому пользователь не блокируется при временном сбое сервера.

### `POST /v1/trial/start` и `/v1/trial/refresh`

Принимают `deviceId` и необязательное `deviceName`. `start` создаёт единственную серверную заявку на пробный период, а `refresh` возвращает entitlement только для уже зарегистрированного устройства. Оба ответа подписаны тем же Ed25519-ключом; в payload присутствуют `plan: "trial"`, `trialStartedAt`, `serverNow` и `validUntil`. Срок не пересчитывается по данным клиента и не продлевается повторным запуском.

### `POST /v1/admin/licenses` и `GET /v1/admin/licenses`

Защищены bearer-токеном администратора. POST выпускает ключ, GET возвращает только превью и метаданные. Отзыв и восстановление выполняются через `/v1/admin/licenses/revoke` и `/v1/admin/licenses/restore`.

### `POST /v1/webhooks/lemon-squeezy` (запасной провайдер)

Сервер обязан:

- сохранить исходное тело запроса до JSON-парсинга;
- проверить HMAC-SHA256 из `X-Signature` с constant-time сравнением;
- проверить `X-Event-Name` и принадлежность события своему `store_id`;
- сохранить уникальный ключ события до бизнес-обработки;
- повторную доставку обработать без повторной выдачи доступа;
- быстро вернуть HTTP 200 после надёжной фиксации события.

Минимальные события для подписок:

```text
order_created
order_refunded
subscription_created
subscription_updated
subscription_cancelled
subscription_resumed
subscription_expired
subscription_paused
subscription_unpaused
subscription_payment_failed
subscription_payment_success
subscription_payment_recovered
license_key_created
license_key_updated
```

### Entitlement внутри ответа активации

Ответ сервера содержит только данные доступа:

```json
{
  "payload": {
    "product": "jackdaw-mail",
    "plan": "monthly",
    "features": ["reports", "live-sla", "working-hours", "reminders", "html-export", "signatures", "multiple-accounts"],
    "status": "active",
    "issuedAt": "2026-10-15T00:00:00Z",
    "validUntil": "2027-01-01T00:00:00.000Z"
  },
  "signature": "base64url-ed25519-signature"
}
```

Приватный ключ подписи хранится только на сервере. Клиентский флаг `pro = true` сам по себе не является защитой.

## Лицензии и активации

Lemon Squeezy License API вызывается только сервером лицензий. Сервер может выполнять `activate`, `validate` и `deactivate`, контролируя лимит устройств и связывая license key с продуктовым аккаунтом. Секрет API не хранится в приложении.

## Состояния в приложении

- `active` — подписка действует;
- `trial` — действует пробный период, если он включён;
- `past_due` — платёж не прошёл, но действует grace period;
- `expired` — срок доступа закончился;
- `revoked` — заказ возвращён, подписка отменена или ключ отозван;
- `offline` — сервер временно недоступен, используется последний проверенный entitlement в ограниченном grace period;
- `trial-offline` — пробный период нельзя подтвердить без интернета, Pro-функции остаются заблокированными;
- `not-configured` — в сборке отсутствует endpoint или публичный ключ подписи.

Бесплатная почта, календарь и контакты не должны блокироваться из-за отсутствия Pro-entitlement или временного отсутствия сети.

## Перед включением production-оплаты

Paddle:

- пройти в Paddle Dashboard оставшиеся шаги проверки аккаунта и создать каталог в Live;
- прогнать в Sandbox: успешную оплату месячной и годовой подписки, отказ карты, повтор webhook, продление (Sandbox позволяет ускорить биллинг), отмену в конце периода, `past_due`, полный возврат;
- отозвать в `/admin` ключи с заметкой «Paddle Sandbox»;
- переключить переменные сервера и `site/billing-config.js` на Live одновременно.

Lemon Squeezy (если вернуться к нему):

- подтвердить, что магазин Lemon Squeezy активирован и принимает выплаты;
- создать и опубликовать месячный и годовой варианты;
- включить license keys и определить лимит активаций;
- настроить webhook с секретом на сервере лицензий;
- развернуть базу подписок и идемпотентных событий;
- сгенерировать пару Ed25519 для entitlement;
- настроить публичные URL checkout и API лицензий;
- опубликовать оферту, privacy, условия подписки и возврата;
- прогнать test mode: Visa, Mastercard, успешный платёж, отказ, возврат, повтор webhook, отмену, продление и работу без сети;
- проверить путь `https://jackdaw-mail.pro/#plans` и активацию ключа в реальном desktop-билде;
- задать на сервере лицензий `LEMON_SQUEEZY_REJECT_TEST_MODE=1` и `LEMON_SQUEEZY_PRODUCT_IDS`, чтобы test mode и другие продукты магазина не выдавали Pro (см. `license_server/README.md`);
- только после этого включить платный checkout для внешних покупателей.

## Официальные материалы

- [Paddle.js](https://developer.paddle.com/paddle-js/about/)
- [Paddle.Checkout.open()](https://developer.paddle.com/paddle-js/methods/paddle-checkout-open/)
- [Paddle: проверка подписи webhook](https://developer.paddle.com/webhooks/about/signature-verification/)
- [Paddle: transaction.completed](https://developer.paddle.com/webhooks/transactions/transaction-completed/)
- [Paddle: webhooks](https://developer.paddle.com/webhooks/)

- [Lemon Squeezy: payment methods](https://docs.lemonsqueezy.com/help/checkout/payment-methods)
- [Lemon Squeezy: supported countries](https://docs.lemonsqueezy.com/help/getting-started/supported-countries)
- [Lemon Squeezy: hosted checkout и URL](https://docs.lemonsqueezy.com/guides/developer-guide/taking-payments)
- [Lemon Squeezy: license API](https://docs.lemonsqueezy.com/api/license-api)
- [Lemon Squeezy: webhook requests](https://docs.lemonsqueezy.com/help/webhooks/webhook-requests)
- [Lemon Squeezy: signing requests](https://docs.lemonsqueezy.com/help/webhooks/signing-requests)
