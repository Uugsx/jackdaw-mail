# Jackdaw Mail Pro: Lemon Squeezy и лицензирование

## Решение для международного запуска

Для международных продаж выбран **Lemon Squeezy** как внешний hosted checkout и Merchant of Record. Он принимает карты Visa и Mastercard, а также доступные для конкретной страны PayPal, Apple Pay и Google Pay. Платёжная форма открывается во внешнем браузере; данные карты не проходят через Jackdaw Mail.

Российская Федерация не входит в список поддерживаемых стран покупателей Lemon Squeezy. До публикации магазина отдельно проверяются активация продавца, KYC/KYB и возможность получать выплаты на поддерживаемый банковский счёт или PayPal.

## Что входит в Pro

| Бесплатная версия | Jackdaw Mail Pro |
|---|---|
| Почта, календарь, контакты и базовая боковая панель | Интерактивные отчёты |
| Основные настройки приложения | Живой контроль SLA в правой панели |
| Локальная работа с почтой | Рабочий календарь по каждому дню недели |
|  | Таймеры и напоминания в рабочих минутах |
|  | Правила категорий, архив контроля и восстановление |
|  | Подробный просмотр внутри приложения и HTML-экспорт |

Цены, валюта, пробный период, налоги и условия продления настраиваются в Lemon Squeezy. Они не зашиваются в Electron-клиент и могут изменяться без выпуска новой версии приложения.

## Настройка магазина

1. Создать продукт `Jackdaw Mail Pro`.
2. Создать варианты `Monthly` и `Yearly` с подпиской.
3. Включить генерацию license keys для обоих вариантов и выбрать допустимое число активаций.
4. Настроить письмо с ключом, receipt и страницу после покупки.
5. Активировать магазин и проверить payout account до публикации ссылок checkout.

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
2. Lemon Squeezy показывает hosted checkout во внешнем браузере.
3. После оплаты Lemon Squeezy создаёт заказ, подписку и license key.
4. Сервер лицензий принимает webhook, проверяет `X-Signature` по исходному телу запроса и идемпотентно обновляет подписку.
5. Сервер выпускает подписанное entitlement только для нужного продуктового аккаунта.
6. Jackdaw проверяет подпись встроенным публичным ключом и открывает Pro-функции.

Почтовые пароли, содержимое писем, локальный кэш и категории не отправляются в Lemon Squeezy или сервер лицензий.

## Публичная конфигурация клиента

В клиент можно передавать только публичные URL:

```text
VITE_LEMON_SQUEEZY_MONTHLY_CHECKOUT_URL=https://<store>.lemonsqueezy.com/checkout/buy/<monthly-variant-id>
VITE_LEMON_SQUEEZY_YEARLY_CHECKOUT_URL=https://<store>.lemonsqueezy.com/checkout/buy/<yearly-variant-id>
VITE_BILLING_LICENSE_API_URL=https://<license-api-host>
```

Для статического сайта те же публичные checkout-ссылки задаются в `site/billing-config.js`. Сейчас там намеренно стоят `null`: до активации собственного магазина сайт не может открыть оплату и не ведёт покупателя в чужой checkout.

Клиент проверяет HTTPS, домен Lemon Squeezy и формат `/checkout/buy/{variant}`. Секрет магазина, API-токен Lemon Squeezy, webhook secret и приватный ключ подписи entitlement никогда не попадают в Vite-переменные или Electron-бандл.

До заполнения этих переменных приложение и сайт остаются в безопасном режиме: ссылки покупки не активируются, а бесплатная почта продолжает работать.

## Контракт сервера лицензий

Провайдер скрыт за серверным адаптером. В клиенте нет SDK Lemon Squeezy и платёжных секретов.

### `POST /v1/checkout-session`

Запрос:

```json
{
  "plan": "monthly",
  "returnToken": "one-time-client-token"
}
```

Ответ:

```json
{
  "checkoutUrl": "https://<store>.lemonsqueezy.com/checkout/buy/<variant-id>",
  "sessionId": "checkout-session-id"
}
```

Сервер принимает только allowlist-планы, не принимает произвольный `variantId` от клиента и не помещает в URL почтовые данные.

### `POST /v1/webhooks/lemon-squeezy`

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

### `GET /v1/entitlement`

Ответ сервера содержит только данные доступа:

```json
{
  "payload": {
    "product": "jackdaw-mail",
    "plan": "monthly",
    "features": ["reports", "live-sla", "working-hours", "reminders", "html-export"],
    "status": "active",
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
- `refunded` — заказ возвращён, доступ отозван после обработки webhook;
- `offline` — сервер временно недоступен, используется последний проверенный entitlement в ограниченном grace period;
- `not-configured` — магазин или сервер лицензий ещё не подключены к конкретной сборке.

Бесплатная почта, календарь и контакты не должны блокироваться из-за отсутствия Pro-entitlement или временного отсутствия сети.

## Перед включением production-оплаты

- подтвердить, что магазин Lemon Squeezy активирован и принимает выплаты;
- создать и опубликовать месячный и годовой варианты;
- включить license keys и определить лимит активаций;
- настроить webhook с секретом на сервере лицензий;
- развернуть базу подписок и идемпотентных событий;
- сгенерировать пару Ed25519 для entitlement;
- настроить публичные URL checkout и API лицензий;
- опубликовать оферту, privacy, условия подписки и возврата;
- прогнать test mode: Visa, Mastercard, успешный платёж, отказ, возврат, повтор webhook, отмену, продление и работу без сети;
- только после этого включить Pro-gate для Reports и Live SLA.

## Официальные материалы

- [Lemon Squeezy: payment methods](https://docs.lemonsqueezy.com/help/checkout/payment-methods)
- [Lemon Squeezy: supported countries](https://docs.lemonsqueezy.com/help/getting-started/supported-countries)
- [Lemon Squeezy: hosted checkout и URL](https://docs.lemonsqueezy.com/guides/developer-guide/taking-payments)
- [Lemon Squeezy: license API](https://docs.lemonsqueezy.com/api/license-api)
- [Lemon Squeezy: webhook requests](https://docs.lemonsqueezy.com/help/webhooks/webhook-requests)
- [Lemon Squeezy: signing requests](https://docs.lemonsqueezy.com/help/webhooks/signing-requests)
