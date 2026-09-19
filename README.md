<div align="center">

<img src="desktop/build/icon-jackdaw-github.png" width="120" alt="Jackdaw Mail">

# Jackdaw Mail

**Почта · Пространства · Календарь · Контакты · Файлы · Чаты · Встречи · SLA-отчёты**

Desktop-клиент для Exchange / OWA и связанных протоколов с интерактивными отчётами и живым контролем SLA.

[![License: EUPL-1.2](https://img.shields.io/badge/License-EUPL--1.2-blue.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux%20%7C%20iOS%20%7C%20Android-lightgrey)
![Stack](https://img.shields.io/badge/stack-Electron%20%7C%20Svelte%20%7C%20TypeScript-646cff)

[Русский](#-русский) · [English](#-english) · [Скачать Android](https://github.com/SpliffRa/jackdaw-mail-android/releases/latest) · [Сайт](https://jackdaw.app)

</div>

---

## Визуальный обзор

Отчёты открываются внутри Jackdaw Mail как полноценная рабочая страница: графики, таблицы и сортировка доступны до сохранения копии в HTML. Живой контроль SLA можно держать в правой боковой панели рядом с открытым письмом.

Все данные на превью ниже синтетические: используются только вымышленные имена, темы и адрес `demo.example`. Реальные почтовые аккаунты, адреса и содержимое писем в репозиторий не добавляются.

<p align="center">
  <img src="docs/screenshots/reports-demo.svg" alt="Демонстрационный интерактивный отчёт Jackdaw Mail" width="920">
</p>

<p align="center">
  <img src="docs/screenshots/sla-control-demo.svg" alt="Демонстрационный живой контроль SLA в правой боковой панели Jackdaw Mail" width="920">
</p>

<p align="center"><sub>Демонстрационные экраны · synthetic demo data</sub></p>

## 🇷🇺 Русский

### О проекте

**Jackdaw Mail** — почтовый клиент с календарём и адресной книгой для Exchange / OWA, EWS, ActiveSync, Graph, IMAP/JMAP и CardDAV/CalDAV.

В этом репозитории desktop на **Electron**, mobile на **Capacitor**, UI — **Svelte + TypeScript**. Разработка — **[uugsx](https://github.com/Uugsx)**.

### Нативный Android-клиент

Отдельный нативный Android-клиент Jackdaw Mail разрабатывает **[SpliffRa](https://github.com/SpliffRa)**. **[Скачать последнюю Android-версию](https://github.com/SpliffRa/jackdaw-mail-android/releases/latest)** можно на странице релизов, а исходный код и инструкции по сборке находятся в репозитории **[jackdaw-mail-android](https://github.com/SpliffRa/jackdaw-mail-android)**. Это самостоятельное приложение на Kotlin и Jetpack Compose, связанное с концепцией Jackdaw Mail.

### Особенности

- **Рабочие пространства** — раздельные контексты для почты, календарей, контактов, файлов и чатов; последнее выбранное пространство восстанавливается после перезапуска
- **Почта** — несколько аккаунтов, дополнительные OWA-ящики, дерево папок, поиск, быстрые фильтры, smart views, категории и массовые действия
- **Связанные письма** — поиск запускается только по кнопке в открытом письме, результаты группируются по номеру обращения, переписке и теме
- **Композер** — плавающий редактор, HTML или plain text, форматирование, вложения, drag-and-drop, черновики, подписи, уведомления о прочтении и шифрование при наличии ключей
- **Управление почтой** — архив, спам, корзина, перенос, undo удаления, флаги, статусы прочтения, настраиваемая ribbon-панель и сочетания клавиш для категорий
- **Боковая панель** — виджеты, календарь, живой контроль SLA, встречи и встроенные web-приложения
- **Отчёты и SLA** — интерактивный дашборд, рабочий календарь по дням недели, живой таймер ответа и настраиваемые напоминания
- **Календарь и контакты** — события, приглашения, онлайн-встречи, личные адресные книги, группы и глобальные адресные списки
- **Файлы и коммуникации** — локальное файловое хранилище, WebDAV/Nextcloud/OpenCloud, чаты и видеовстречи с поддерживаемыми аккаунтами
- **Обновлённый UI** — адаптивные layout'ы почты, ribbon, тёмная тема писем, масштабирование и сохранение пользовательских настроек
- **Desktop OTA** — автообновление через GitHub Releases (Mac + Windows); см. [`docs/systems/desktop-build/ota-jackdaw.md`](docs/systems/desktop-build/ota-jackdaw.md)
- **Roadmap** — [jackdaw.app](https://jackdaw.app), дальнейшие OWA-фичи

### Возможности

Перед подключением аккаунта возможности зависят от его протокола, прав доступа и типа сборки. В таблице `✅` означает реализованный сценарий, `◐` — функцию, зависящую от сервера, ключей или proprietary-модуля, а `🚧` — ещё развиваемый сценарий.

| Модуль | Что умеет | Статус |
|--------|-----------|--------|
| **Почта** | IMAP, JMAP, EWS, OWA, ActiveSync и MS Graph (beta); несколько аккаунтов, shared mailboxes, папки, поиск, smart views «Непрочитанные/С флажком/Вложения», быстрые фильтры, категории, теги, архив, спам, корзина, перенос и уведомления | ✅ / ◐ протокол |
| **Композер** | Плавающее окно, HTML/plain text, форматирование, цитирование, подписи, вложения и inline-изображения, drag-and-drop, черновики, read receipt, PGP/S/MIME UI | ✅ / ◐ ключи и сервер |
| **Связанные письма** | Поиск по кнопке в заголовке письма; точные дубликаты, цепочка, номера обращения/клиента, одинаковая тема и похожий текст; сворачиваемые группы и переход к письму | ✅ локальный индекс |
| **Рабочие пространства** | Фильтрация связанных данных по контексту «Все/Работа/…» и восстановление последнего выбранного пространства | ✅ |
| **UI и производительность** | Перестраиваемые layout'ы, ribbon, масштаб письма, корректный горизонтальный overflow, быстрый виртуализированный список, защита от двойного срабатывания горячих клавиш | ✅ desktop |
| **Отчёты и SLA** | Интерактивные графики и таблицы, сортировка, фильтры ящика/папки/категорий, рабочие часы по каждому дню, атрибуция ответственного, живой контроль, напоминания, архив контроля и HTML-экспорт | ✅ Pro |
| **Календарь** | Локальные и серверные календари, представления дня/недели/месяца, события, приглашения, вложения, напоминания и онлайн-встречи | ✅ / ◐ протокол |
| **Контакты** | Личная адресная книга, GAL, группы, поиск, история взаимодействия, PGP/S/MIME-ключи; EWS, OWA, ActiveSync, CardDAV и JMAP | ✅ / ◐ протокол |
| **Файлы** | Локальное хранилище, WebDAV, Nextcloud и OpenCloud; каталоги, теги, поиск, таблица/галерея, загрузка, скачивание и предпросмотр | ✅ / ◐ сервер |
| **Чаты** | XMPP, Matrix, WhatsApp, Signal и MS Graph (beta); комнаты, поиск, вложения, emoji/GIF/stickers и реакции | ✅ / ◐ протокол |
| **Meet** | Аудио/видео, участники, микрофон/камера, демонстрация экрана и приглашения; LiveKit, M3, SIP и WhatsApp backends | ◐ backend / proprietary |
| **Web Apps** | Каталог и личный список встроенных web-приложений, запуск рядом с почтой и сохранение выбранных приложений | ✅ / ◐ каталог |
| **Темы** | Дерево и граф рабочих тем с вложенными подтемами | ◐ рабочая область |
| **Desktop / mobile** | Electron для macOS, Windows и Linux; Capacitor для iOS и Android; OTA для desktop | ✅ desktop / 🚧 mobile |

#### Поиск связанных писем по запросу

Кнопка со значком цепочки в заголовке письма открывает компактное окно и запускает поиск только после действия пользователя. При обычном открытии письма тяжёлый поиск не выполняется.

Алгоритм использует локальный индекс текущего почтового аккаунта и несколько сигналов: `Message-ID`/`References`, идентификаторы цепочки, номера обращения или клиента, нормализованную тему и похожесть текста. Новые тела писем для этой проверки не скачиваются. Выдача не ограничивается шестью карточками: совпадения собираются в пределах безопасного лимита и группируются по найденному признаку, поэтому можно раскрыть нужную группу, не просматривая длинный плоский список.

Широкое совпадение по домену компании намеренно не считается связью: иначе рабочий домен вроде `dpd.ru` объединял бы сотни нерелевантных сообщений. Технические коды ошибок вроде `ORA-20201` также не принимаются за номер обращения. Это уменьшает ложные совпадения и нагрузку на интерфейс.

### Отчёты и живой контроль SLA

Отчёт сначала формируется и просматривается прямо в приложении. HTML — необязательная сохранённая копия, которую можно скачать после проверки данных.

- **Дашборд:** сводные карточки, активность во времени, тепловая карта рабочего ритма, скорость первого ответа, частые запросы, категории и теги, календарная загрузка и подробные таблицы.
- **Фильтры:** период, почтовый аккаунт, папка, норматив в рабочих минутах и категории, попавшие в отчёт.
- **Ответственный:** группировка по почтовому профилю или по именным категориям сотрудников с выбором конкретных категорий.
- **Рабочий календарь:** отдельные часы начала и конца для каждого дня недели; выходные и время вне графика не увеличивают SLA.
- **Корректный расчёт:** время ответа считается до первого подтверждённого ответа, найденного на сервере или в связанном отправленном письме. Ответы без рабочего интервала помечаются как «вне рабочего времени» и не искажают средние показатели.
- **Живая очередь:** новые неотвеченные письма появляются в правой боковой панели рядом с почтой. Для каждого письма видны статус, прошедшее время, дедлайн и оставшееся время.
- **Старт SLA:** норматив всегда считается от момента получения письма и расходует только рабочие минуты по календарю. Прочтение или назначение категории показывает, кто взял письмо в работу, но не сбрасывает SLA.
- **Напоминания:** интервалы задаются в рабочих минутах (например, 10, 20 и 25), каждое уведомление приходит один раз до появления ответа и открывает нужное письмо.
- **Правила очереди:** можно исключить категории вроде «Переписка (мы в копии)», отдельно включить или не включать письма без категории, сортировать очередь и убрать неактуальное письмо в архив контроля с возможностью восстановления.

Настройки живого контроля сохраняются отдельно для выбранного почтового ящика. Очередь обновляется сразу после изменения письма или категории; периодическая проверка служит резервным механизмом.

### Jackdaw Mail Pro

Отчёты и живой контроль SLA подготовлены как Pro-модуль: в него входят рабочий календарь, таймеры, напоминания, правила очереди, архив контроля, подробный просмотр и HTML-экспорт. Для российского запуска выбран внешний checkout ЮKassa; платёжные данные не проходят через Jackdaw Mail, а доступ выдаётся подписанным серверным entitlement. План интеграции и список обязательных шагов находятся в [`docs/PRO-BILLING.md`](docs/PRO-BILLING.md).

### Платформы

| Платформа | Статус |
|-----------|--------|
| macOS (arm64 / universal) | ✅ основная |
| Windows / Linux | ✅ desktop |
| iOS / Android | 🚧 mobile |

### Сборка (dev)

```bash
# зависимости
(cd app && npm install)
(cd desktop && npm install)
(cd desktop/backend && npm install)

# терминал 1 — UI
cd app && npm run dev

# терминал 2 — Electron
cd desktop && npm run dev
```

**Release (macOS):**

```bash
cd app && npm run build
cd desktop && npm run build:mac
```

Подробнее: [`docs/INSTALL.md`](docs/INSTALL.md) · [`docs/systems/desktop-build/`](docs/systems/desktop-build/) · **OTA:** [`ota-jackdaw.md`](docs/systems/desktop-build/ota-jackdaw.md)

### Структура репозитория

```
app/        — Svelte UI + бизнес-логика
desktop/    — Electron shell + backend
mobile/     — Capacitor (iOS / Android)
docs/       — документация по сборке и архитектуре
lib/        — общие библиотеки (JPC protocol)
```

### Лицензия

[EUPL-1.2](LICENSE). Отдельные модули (Exchange, WebMail, Meet) — proprietary, см. LICENSE.

### Контакты

- **Maintainer:** [uugsx](https://github.com/Uugsx)
- **Android-клиент:** [скачать последнюю версию](https://github.com/SpliffRa/jackdaw-mail-android/releases/latest) · [репозиторий](https://github.com/SpliffRa/jackdaw-mail-android) · [SpliffRa](https://github.com/SpliffRa)
- **Сайт:** [jackdaw.app](https://jackdaw.app)
- **Репозиторий:** [github.com/Uugsx/jackdaw-mail](https://github.com/Uugsx/jackdaw-mail)

---

## 🇬🇧 English

### About

**Jackdaw Mail** is a mail client with calendar, contacts, interactive reports and live SLA control for Exchange / OWA, EWS, ActiveSync, Graph, IMAP/JMAP, and CardDAV/CalDAV.

This repository contains the **Electron** desktop client, the **Capacitor** mobile shell and the **Svelte + TypeScript** UI. Maintained by **[uugsx](https://github.com/Uugsx)**.

### Native Android client

The standalone native Android client for Jackdaw Mail is developed by **[SpliffRa](https://github.com/SpliffRa)**. **[Download the latest Android release](https://github.com/SpliffRa/jackdaw-mail-android/releases/latest)** from the releases page; the source code and build instructions are available in the **[jackdaw-mail-android](https://github.com/SpliffRa/jackdaw-mail-android)** repository. It is a Kotlin and Jetpack Compose application related to the Jackdaw Mail concept.

### Highlights

- **Workspaces** — separate contexts for mail, calendars, contacts, files and chats; the last selected workspace is restored after restart
- **Mail** — multiple accounts, additional OWA mailboxes, folder tree, search, quick filters, smart views, categories and bulk actions
- **Related messages** — search starts only from the button in an open message; results are grouped by reference number, conversation and topic
- **Composer** — floating editor, HTML or plain text, formatting, attachments, drag-and-drop, drafts, signatures, read receipts and encryption when keys are available
- **Mail workflow** — archive, junk, trash, move, delete undo, flags, read state, customizable ribbon and category keyboard shortcuts
- **Sidebar** — widgets, calendar, live SLA control, meetings and embedded web apps
- **Reports & SLA** — interactive dashboard, per-weekday working calendar, live response timers and configurable reminders
- **Calendar & contacts** — events, invitations, online meetings, personal address books, groups and global address lists
- **Files & communication** — local file storage, WebDAV/Nextcloud/OpenCloud, chats and video meetings with supported accounts
- **Updated UI** — responsive mail layouts, ribbon, dark-mode email rendering, zoom and persisted user preferences
- **Desktop OTA** — auto-update via GitHub Releases (Mac + Windows); see [`docs/systems/desktop-build/ota-jackdaw.md`](docs/systems/desktop-build/ota-jackdaw.md)
- **Roadmap** — [jackdaw.app](https://jackdaw.app), more OWA work

### Features

Before an account is connected, the available features depend on its protocol, permissions and build type. In the table, `✅` means implemented, `◐` means dependent on a server, keys or a proprietary module, and `🚧` means the scenario is still being expanded.

| Module | Highlights | Status |
|--------|------------|--------|
| **Mail** | IMAP, JMAP, EWS, OWA, ActiveSync and MS Graph (beta); multiple accounts, shared mailboxes, folders, search, Unread/Flagged/Attachments smart views, quick filters, categories, tags, archive, junk, trash, move and notifications | ✅ / ◐ protocol |
| **Composer** | Floating window, HTML/plain text, formatting, quoting, signatures, attachments and inline images, drag-and-drop, drafts, read receipts and PGP/S/MIME UI | ✅ / ◐ keys and server |
| **Related messages** | On-demand button in the message header; exact duplicates, conversation links, case/customer identifiers, same subject and similar text; collapsible groups and open-message navigation | ✅ local index |
| **Workspaces** | Context filtering for “All/Work/…” and restoration of the last selected workspace | ✅ |
| **UI & performance** | Reworked layouts, ribbon, message zoom, horizontal overflow handling, virtualized fast lists and protection against duplicate keyboard shortcut actions | ✅ desktop |
| **Reports & SLA** | Interactive charts and tables, sorting, mailbox/folder/category filters, per-day working hours, responder attribution, live control, reminders, tracking archive and HTML export | ✅ Pro |
| **Calendar** | Local and server calendars, day/week/month views, events, invitations, attachments, reminders and online meetings | ✅ / ◐ protocol |
| **Contacts** | Personal address books, GAL, groups, search, contact history, PGP/S/MIME keys; EWS, OWA, ActiveSync, CardDAV and JMAP | ✅ / ◐ protocol |
| **Files** | Local storage, WebDAV, Nextcloud and OpenCloud; directories, tags, search, table/gallery views, upload, download and preview | ✅ / ◐ server |
| **Chat** | XMPP, Matrix, WhatsApp, Signal and MS Graph (beta); rooms, search, attachments, emoji/GIF/stickers and reactions | ✅ / ◐ protocol |
| **Meet** | Audio/video, participants, microphone/camera, screen sharing and invitations; LiveKit, M3, SIP and WhatsApp backends | ◐ backend / proprietary |
| **Web Apps** | Catalog and personal list of embedded web apps, launch beside mail and persisted app selection | ✅ / ◐ catalog |
| **Topics** | Tree and graph of work topics with nested subtopics | ◐ workspace |
| **Desktop / mobile** | Electron for macOS, Windows and Linux; Capacitor for iOS and Android; desktop OTA updates | ✅ desktop / 🚧 mobile |

#### On-demand related-message search

The chain button in a message header opens a compact popup and starts searching only after the user asks for it. Opening a message does not trigger the expensive search.

The classifier uses the local index for the current mail account and combines `Message-ID`/`References`, thread identifiers, case or customer numbers, normalized subjects and text similarity. It does not download new message bodies for this check. Results are not capped at six cards: matches are collected within a safe limit and grouped by the strongest shared signal, so users can expand only the relevant group instead of scanning a flat list.

Broad company-domain matching is intentionally not treated as a relationship: a work domain such as `dpd.ru` would otherwise join hundreds of unrelated messages. Technical error codes such as `ORA-20201` are also excluded from reference-number extraction, reducing false positives and UI workload.

### Reports and live SLA control

Reports are generated and reviewed inside the app first. HTML is an optional saved copy that can be downloaded after the data has been checked.

- **Dashboard:** summary cards, activity over time, work-rhythm heatmap, first-response speed, frequent requests, categories and tags, calendar load, and detailed tables.
- **Filters:** date range, mailbox, folder, response target in working minutes, and the categories included in the report.
- **Responder attribution:** group results by mailbox profile or by named employee categories, with an explicit category selection.
- **Working calendar:** set a different start and end time for every weekday; weekends and time outside the schedule do not add SLA time.
- **Reliable timing:** response time ends at the first confirmed reply found by the server or in a linked sent message. Replies with no working interval are marked outside working hours and kept out of averages.
- **Live queue:** unanswered mail appears in the right sidebar next to the open message. Each item shows status, elapsed time, deadline, and remaining time.
- **SLA start:** the target is anchored to the message's received time and counts only working minutes. Reading the message or assigning an employee category identifies who took it into work but never resets the target.
- **Reminders:** configure working-minute checkpoints such as 10, 20 and 25; each reminder is shown once until the request receives a reply and opens the relevant message.
- **Queue rules:** exclude categories such as “Переписка (мы в копии)”, choose whether uncategorized messages are included, sort the queue, and archive stale requests with restore support.

Live-control settings are persisted per mailbox. The queue refreshes immediately after a message or category change, with a periodic safety check as a fallback.

### Jackdaw Mail Pro

Reports and live SLA control are prepared as a Pro module covering the working calendar, timers, reminders, queue rules, tracking archive, in-app detailed view and HTML export. YooKassa is the selected checkout for a Russian launch; payment details never pass through Jackdaw Mail, and access is issued by a signed server entitlement. See [`docs/PRO-BILLING.md`](docs/PRO-BILLING.md) for the integration plan and launch checklist.

### Platforms

| Platform | Status |
|----------|--------|
| macOS (arm64 / universal) | ✅ primary |
| Windows / Linux | ✅ desktop |
| iOS / Android | 🚧 mobile |

### Build (dev)

```bash
# install dependencies
(cd app && npm install)
(cd desktop && npm install)
(cd desktop/backend && npm install)

# terminal 1 — UI
cd app && npm run dev

# terminal 2 — Electron shell
cd desktop && npm run dev
```

**Release (macOS):**

```bash
cd app && npm run build
cd desktop && npm run build:mac
```

See also: [`docs/INSTALL.md`](docs/INSTALL.md) · [`docs/systems/desktop-build/`](docs/systems/desktop-build/) · **OTA:** [`ota-jackdaw.md`](docs/systems/desktop-build/ota-jackdaw.md)

### Repository layout

```
app/        — Svelte UI + business logic
desktop/    — Electron shell + backend
mobile/     — Capacitor (iOS / Android)
docs/       — build & architecture docs
lib/        — shared libraries (JPC protocol)
```

### License

[EUPL-1.2](LICENSE). Some modules (Exchange, WebMail, Meet) are proprietary — see LICENSE.

### Links

- **Maintainer:** [uugsx](https://github.com/Uugsx)
- **Android client:** [download the latest release](https://github.com/SpliffRa/jackdaw-mail-android/releases/latest) · [repository](https://github.com/SpliffRa/jackdaw-mail-android) · [SpliffRa](https://github.com/SpliffRa)
- **Website:** [jackdaw.app](https://jackdaw.app)
- **Repository:** [github.com/Uugsx/jackdaw-mail](https://github.com/Uugsx/jackdaw-mail)

---

<div align="center">

<sub>Jackdaw Mail · <a href="https://github.com/Uugsx">uugsx</a> · <a href="LICENSE">EUPL-1.2</a></sub><br>
<sub>Based on prior open-source work by Ben Bucksch, Beonex GmbH and contributors.</sub>

</div>
