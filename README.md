<div align="center">

<img src="desktop/build/icon-jackdaw-github.png" width="120" alt="Jackdaw Mail">

# Jackdaw Mail

**Почта · Пространства · Календарь · Контакты · Файлы · Чаты · Встречи · SLA-отчёты**

Desktop-клиент для Exchange / OWA и связанных протоколов с интерактивными отчётами и живым контролем SLA.

[![License: EUPL-1.2](https://img.shields.io/badge/License-EUPL--1.2-blue.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux%20%7C%20iOS%20%7C%20Android-lightgrey)

[Русский](#русский) · [English](#english) · [Скачать Android](https://github.com/SpliffRa/jackdaw-mail-android/releases/latest) · [Сайт](https://jackdaw-mail.pro)

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

## Русский

### О проекте

**Jackdaw Mail** — почтовый клиент с календарём и адресной книгой для Exchange / OWA, EWS, ActiveSync, Graph, IMAP/JMAP и CardDAV/CalDAV.

В этом репозитории desktop на **Electron**, mobile на **Capacitor**, UI — **Svelte + TypeScript**. Разработка — **[uugsx](https://github.com/Uugsx)**.

### Нативный Android-клиент

Отдельный нативный Android-клиент Jackdaw Mail разрабатывает **[SpliffRa](https://github.com/SpliffRa)**. **[Скачать последнюю Android-версию](https://github.com/SpliffRa/jackdaw-mail-android/releases/latest)** можно на странице релизов, а исходный код и инструкции по сборке находятся в репозитории **[jackdaw-mail-android](https://github.com/SpliffRa/jackdaw-mail-android)**. Это самостоятельное приложение на Kotlin и Jetpack Compose, связанное с концепцией Jackdaw Mail.

### Особенности

- **Рабочие пространства** — раздельные контексты для почты, календарей, контактов, файлов и чатов; последнее выбранное пространство восстанавливается после перезапуска
- **Почта** — один аккаунт в бесплатной версии; несколько аккаунтов и дополнительные OWA-ящики доступны в Pro, вместе с деревом папок, поиском, быстрыми фильтрами, smart views, категориями и массовыми действиями
- **Связанные письма** — поиск запускается только по кнопке в открытом письме, результаты группируются по номеру обращения, переписке и теме
- **Композер** — плавающий редактор, HTML или plain text, форматирование, Pro-подписи с ссылками и изображениями, вложения, drag-and-drop, черновики, уведомления о прочтении и шифрование при наличии ключей
- **Управление почтой** — архив, спам, корзина, перенос, undo удаления, флаги, статусы прочтения, настраиваемая ribbon-панель и сочетания клавиш для категорий
- **Боковая панель** — виджеты, календарь, живой контроль SLA, встречи и встроенные web-приложения
- **Отчёты и SLA** — интерактивный дашборд, рабочий календарь по дням недели, живой таймер ответа и настраиваемые напоминания
- **Календарь и контакты** — события, приглашения, онлайн-встречи, личные адресные книги, группы и глобальные адресные списки
- **Файлы** — локальное файловое хранилище, WebDAV и Nextcloud; теги, поиск, таблица и галерея. Сторонние чаты (XMPP, Matrix, WhatsApp, Signal) и видеовстречи LiveKit/SIP в этой сборке скрыты
- **Звонки и чат Jackdaw** (Pro и пробный период) — аудио- и видеозвонки с показом экрана между пользователями Jackdaw Mail по email-адресу и чат со сквозным шифрованием (X25519 + XChaCha20-Poly1305): личные переписки и группы до 50 человек, до 10 файлов по 25 МБ в сообщении, статус доставки. Голос идёт напрямую (WebRTC), а при закрытой сети — через свой TURN-ретранслятор с временными учётными данными. Адрес подтверждается кодом из письма (30 минут) или ответным письмом со своего ящика (DKIM/SPF), один раз для всех устройств лицензии; сервер: [`call_server/`](call_server/README.md)
- **Большие ящики** — общие ящики и сетевой архив Exchange на десятки тысяч писем: старая история догружается в фоне порциями, перенос, удаление и отмена удаления идут пачками; база SQLite работает в отдельном процессе и не блокирует сеть и окна
- **43 языка** — интерфейс полностью переведён на 43 языка (полнота проверяется тестом `catalogCompleteness`), поддерживается письмо справа налево
- **Пароли и ошибки** — пароли и токены входа шифруются системным хранилищем (Связка ключей macOS, DPAPI Windows); ошибки входа, сети и сервера показываются понятным текстом с подсказкой, что делать, а техническая деталь доступна по кнопке
- **Обратная связь** — форма в «Настройки → О программе»: письмо разработчикам, Telegram и задача в GitHub для ошибок (без адреса пользователя); сервер: [`feedback_server/`](feedback_server/README.md)
- **Обновлённый UI** — адаптивные layout'ы почты, ribbon, тёмная тема писем, масштабирование и сохранение пользовательских настроек
- **Desktop OTA** — автообновление через GitHub Releases (Mac + Windows); см. [`docs/systems/desktop-build/ota-jackdaw.md`](docs/systems/desktop-build/ota-jackdaw.md)
- **Roadmap** — [jackdaw-mail.pro](https://jackdaw-mail.pro), дальнейшие OWA-фичи

### Возможности

Перед подключением аккаунта возможности зависят от его протокола, прав доступа и типа сборки. В колонке «Статус» «готово» означает реализованный сценарий, «зависит от…» — функцию, которой нужен сервер, ключи или proprietary-модуль, «в работе» — сценарий, который ещё развивается.

| Модуль | Что умеет | Статус |
|--------|-----------|--------|
| **Почта** | IMAP, JMAP, EWS, OWA, ActiveSync и MS Graph (beta); Pro-доступ к нескольким аккаунтам и shared mailboxes, папки, поиск, smart views «Непрочитанные/С флажком/Вложения», быстрые фильтры, категории, теги, архив, спам, корзина, перенос и уведомления; «Отложить», закрепление, вкладки «Отсортированные/Другие», «Очистка» беседы и папки, «Быстрые действия», надёжные и заблокированные отправители, «Сообщить о фишинге», перетаскивание письма на рабочий стол как `.eml`, предпросмотр вложений (PDF, Word, Excel, OpenDocument) | готово; зависит от протокола; Pro |
| **Exchange (EWS/OWA)** | Автоответ «Нет на месте», правила входящих на сервере, задачи To Do и флажки со сроком, заметки, поиск на сервере со страницами (EWS), раскрытие рассылок, руководитель и подчинённые из каталога, «Отправить как / от имени» | готово; зависит от сервера |
| **Композер** | Плавающее окно, HTML/plain text, форматирование, Pro-подписи с ссылками и изображениями, цитирование, вложения и inline-изображения, drag-and-drop, черновики, read receipt, PGP/S/MIME UI; отмена отправки и «Отправить позже» (для EWS — на сервере, иначе — очередь программы), шаблоны, @упоминания, кнопки голосования, большие файлы ссылкой через Nextcloud/openCloud | готово; зависит от ключей и сервера; Pro |
| **Связанные письма** | Поиск по кнопке в заголовке письма; точные дубликаты, цепочка, номера обращения/клиента, одинаковая тема и похожий текст; сворачиваемые группы и переход к письму | готово, локальный индекс |
| **Рабочие пространства** | Фильтрация связанных данных по контексту «Все/Работа/…» и восстановление последнего выбранного пространства | готово |
| **UI и производительность** | Перестраиваемые layout'ы, ribbon, единый вид полей ввода и выпадающих списков, масштаб письма, корректный горизонтальный overflow, быстрый виртуализированный список, защита от двойного срабатывания горячих клавиш | готово на desktop |
| **Отчёты и SLA** | Интерактивные графики и таблицы, сортировка, фильтры ящика/папки/категорий, рабочие часы по каждому дню, атрибуция ответственного, живой контроль, напоминания, архив контроля и HTML-экспорт | готово, Pro |
| **Календарь** | Локальные и серверные календари, представления дня/недели/месяца, события, приглашения, вложения, напоминания и онлайн-встречи; «Предложить другое время», рабочие часы (из Exchange или вручную), бронирование переговорных Exchange, печать дня/недели/месяца | готово; зависит от протокола |
| **Контакты** | Личная адресная книга, GAL, группы, поиск, история взаимодействия, PGP/S/MIME-ключи; EWS, OWA, ActiveSync, CardDAV и JMAP | готово; зависит от протокола |
| **Файлы** | Локальное хранилище, WebDAV, Nextcloud и OpenCloud; каталоги, теги, поиск, таблица/галерея, загрузка, скачивание и предпросмотр | готово; зависит от сервера |
| **Чаты** | XMPP, Matrix, WhatsApp, Signal и MS Graph (beta); комнаты, поиск, вложения, emoji/GIF/stickers и реакции. **Чат Jackdaw** между пользователями приложения: сквозное шифрование (X25519 + XChaCha20-Poly1305), личные чаты и группы до 50 человек, файлы до 25 МБ; ответ с цитатой, правка и удаление у всех, реакции, «печатает…» и отметка «прочитано», чат в правой боковой панели, отправка письма или события в чат | готово; зависит от протокола; чат Jackdaw — Pro |
| **Meet** | Аудио/видео, участники, микрофон/камера, демонстрация экрана и приглашения; LiveKit, M3, SIP и WhatsApp backends. **Звонки Jackdaw** между пользователями приложения — голос, видео и показ экрана, напрямую (P2P WebRTC), без медиасервера; журнал звонков и статус «В сети / Занят / Не беспокоить», общий для всех устройств | зависит от backend, proprietary; звонки Jackdaw — Pro |
| **Web Apps** | Каталог и личный список встроенных web-приложений, запуск рядом с почтой и сохранение выбранных приложений | готово; зависит от каталога |
| **Темы** | Дерево и граф рабочих тем с вложенными подтемами | зависит от рабочей области |
| **Desktop / mobile** | Electron для macOS, Windows и Linux; Capacitor для iOS и Android; OTA для desktop | desktop готово, mobile в работе |

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

Jackdaw Mail Pro включает рабочий календарь, таймеры, напоминания, правила очереди, архив контроля, подробный просмотр, HTML-экспорт, несколько почтовых аккаунтов, форматированные HTML-подписи с ссылками и изображениями, а также аудио- и видеозвонки и чат со сквозным шифрованием между пользователями Jackdaw Mail. Публичные цены Pro — **$9.99 / month** или **$79.99 / year**. Оплата проходит через Paddle (сейчас подключена тестовая среда Sandbox, Lemon Squeezy остаётся запасным провайдером на сервере); платёжные данные не проходят через Jackdaw Mail, а доступ выдаётся подписанным серверным entitlement. Первый почтовый аккаунт остаётся бесплатным, а существующие аккаунты не удаляются при окончании Pro. План интеграции и список обязательных шагов находятся в [`docs/PRO-BILLING.md`](docs/PRO-BILLING.md).

### Платформы

| Платформа | Статус |
|-----------|--------|
| macOS (universal) | готово, основная платформа |
| Windows 10/11 x64 | готово |
| Linux | сборка из исходников; готовых пакетов в релизах пока нет |
| iOS / Android | в работе |

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
- **Сайт:** [jackdaw-mail.pro](https://jackdaw-mail.pro)
- **Репозиторий:** [github.com/Uugsx/jackdaw-mail](https://github.com/Uugsx/jackdaw-mail)

---

## English

### About

**Jackdaw Mail** is a mail client with calendar, contacts, interactive reports and live SLA control for Exchange / OWA, EWS, ActiveSync, Graph, IMAP/JMAP, and CardDAV/CalDAV.

This repository contains the **Electron** desktop client, the **Capacitor** mobile shell and the **Svelte + TypeScript** UI. Maintained by **[uugsx](https://github.com/Uugsx)**.

### Native Android client

The standalone native Android client for Jackdaw Mail is developed by **[SpliffRa](https://github.com/SpliffRa)**. **[Download the latest Android release](https://github.com/SpliffRa/jackdaw-mail-android/releases/latest)** from the releases page; the source code and build instructions are available in the **[jackdaw-mail-android](https://github.com/SpliffRa/jackdaw-mail-android)** repository. It is a Kotlin and Jetpack Compose application related to the Jackdaw Mail concept.

### Highlights

- **Workspaces** — separate contexts for mail, calendars, contacts, files and chats; the last selected workspace is restored after restart
- **Mail** — one account on Free; multiple accounts and additional OWA mailboxes on Pro, plus folder tree, search, quick filters, smart views, categories and bulk actions
- **Related messages** — search starts only from the button in an open message; results are grouped by reference number, conversation and topic
- **Composer** — floating editor, HTML or plain text, formatting, Pro signatures with links and images, attachments, drag-and-drop, drafts, read receipts and encryption when keys are available
- **Mail workflow** — archive, junk, trash, move, delete undo, flags, read state, customizable ribbon and category keyboard shortcuts
- **Sidebar** — widgets, calendar, live SLA control, meetings and embedded web apps
- **Reports & SLA** — interactive dashboard, per-weekday working calendar, live response timers and configurable reminders
- **Calendar & contacts** — events, invitations, online meetings, personal address books, groups and global address lists
- **Files** — local file storage, WebDAV and Nextcloud; tags, search, table and gallery views. Third-party chats (XMPP, Matrix, WhatsApp, Signal) and LiveKit/SIP video meetings are hidden in this build
- **Jackdaw calls & chat** (Pro and trial) — audio and video calls with screen sharing between Jackdaw Mail users by email address and end-to-end encrypted chat (X25519 + XChaCha20-Poly1305): one-to-one chats and groups of up to 50 people, up to 10 files of 25 MB per message, delivery status. Voice goes directly (WebRTC), or through our own TURN relay with short-lived credentials when the network blocks a direct path. The address is confirmed with an emailed code (valid 30 minutes) or a reply sent from your own mailbox (DKIM/SPF), once for all devices on the licence; server: [`call_server/`](call_server/README.md)
- **Large mailboxes** — shared mailboxes and the Exchange online archive with tens of thousands of messages: older history loads in the background in batches; move, delete and undo run in batches; SQLite runs in a separate process and does not block networking or windows
- **43 languages** — the interface is fully translated into 43 languages (checked by the `catalogCompleteness` test), with right-to-left support
- **Passwords and errors** — passwords and sign-in tokens are encrypted with the system keychain (macOS Keychain, Windows DPAPI); sign-in, network and server errors are shown in plain words with what to do next, and the technical detail is one click away
- **Feedback** — a form in Settings → About: email to the developers, Telegram, and a GitHub issue for bug reports (without the user's address); server: [`feedback_server/`](feedback_server/README.md)
- **Updated UI** — responsive mail layouts, ribbon, dark-mode email rendering, zoom and persisted user preferences
- **Desktop OTA** — auto-update via GitHub Releases (Mac + Windows); see [`docs/systems/desktop-build/ota-jackdaw.md`](docs/systems/desktop-build/ota-jackdaw.md)
- **Roadmap** — [jackdaw-mail.pro](https://jackdaw-mail.pro), more OWA work

### Features

Before an account is connected, the available features depend on its protocol, permissions and build type. In the Status column, “ready” means implemented, “depends on…” means the feature needs a server, keys or a proprietary module, and “in progress” means the scenario is still being built.

| Module | Highlights | Status |
|--------|------------|--------|
| **Mail** | IMAP, JMAP, EWS, OWA, ActiveSync and MS Graph (beta); multiple accounts and shared mailboxes with Pro, folders, search, Unread/Flagged/Attachments smart views, quick filters, categories, tags, archive, junk, trash, move and notifications; snooze, pinning, Focused/Other tabs, conversation and folder clean-up, Quick Steps, safe and blocked senders, “Report phishing”, drag a message to the desktop as `.eml`, attachment preview (PDF, Word, Excel, OpenDocument) | ready; depends on the protocol; Pro |
| **Exchange (EWS/OWA)** | Out-of-office auto-replies, server-side inbox rules, To Do tasks and flags with due dates, notes, server search with paging (EWS), distribution-list expansion, manager and direct reports from the directory, “Send as / on behalf of” | ready; depends on the server |
| **Composer** | Floating window, HTML/plain text, formatting, Pro signatures with links and images, quoting, attachments and inline images, drag-and-drop, drafts, read receipts and PGP/S/MIME UI; undo send and “Send later” (server-side for EWS, local queue otherwise), templates, @mentions, voting buttons, large files sent as a Nextcloud/openCloud link | ready; depends on keys and server; Pro |
| **Related messages** | On-demand button in the message header; exact duplicates, conversation links, case/customer identifiers, same subject and similar text; collapsible groups and open-message navigation | ready, local index |
| **Workspaces** | Context filtering for “All/Work/…” and restoration of the last selected workspace | ready |
| **UI & performance** | Reworked layouts, ribbon, unified text fields and dropdowns, message zoom, horizontal overflow handling, virtualized fast lists and protection against duplicate keyboard shortcut actions | готово на desktop |
| **Reports & SLA** | Interactive charts and tables, sorting, mailbox/folder/category filters, per-day working hours, responder attribution, live control, reminders, tracking archive and HTML export | готово, Pro |
| **Calendar** | Local and server calendars, day/week/month views, events, invitations, attachments, reminders and online meetings; “Propose new time”, working hours (loaded from Exchange or set manually), Exchange room booking, printing day/week/month | ready; depends on the protocol |
| **Contacts** | Personal address books, GAL, groups, search, contact history, PGP/S/MIME keys; EWS, OWA, ActiveSync, CardDAV and JMAP | ready; depends on the protocol |
| **Files** | Local storage, WebDAV, Nextcloud and OpenCloud; directories, tags, search, table/gallery views, upload, download and preview | ready; depends on the server |
| **Chat** | XMPP, Matrix, WhatsApp, Signal and MS Graph (beta); rooms, search, attachments, emoji/GIF/stickers and reactions. **Jackdaw chat** between app users: end-to-end encryption (X25519 + XChaCha20-Poly1305), direct chats and groups of up to 50 people, files up to 25 MB; replies with quotes, edit and delete for everyone, reactions, typing and read indicators, chat in the right sidebar, sending a message or event to chat | ready; depends on the protocol; Jackdaw chat — Pro |
| **Meet** | Audio/video, participants, microphone/camera, screen sharing and invitations; LiveKit, M3, SIP and WhatsApp backends. **Jackdaw calls** between app users — audio, video and screen sharing, direct (P2P WebRTC), no media server; call history and an “Online / Busy / Do not disturb” status shared across devices | depends on the backend, proprietary; Jackdaw calls — Pro |
| **Web Apps** | Catalog and personal list of embedded web apps, launch beside mail and persisted app selection | ready; depends on the catalog |
| **Topics** | Tree and graph of work topics with nested subtopics | depends on the workspace |
| **Desktop / mobile** | Electron for macOS, Windows and Linux; Capacitor for iOS and Android; desktop OTA updates | desktop готово, mobile в работе |

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

Jackdaw Mail Pro covers the working calendar, timers, reminders, queue rules, tracking archive, in-app detailed view, HTML export, multiple mail accounts, formatted HTML signatures with links and images, and audio/video calls and end-to-end encrypted chat between Jackdaw Mail users. Public Pro pricing is **$9.99 / month** or **$79.99 / year**. The first mail account remains free and existing accounts are preserved after Pro expires. Payments go through Paddle (currently the Sandbox test environment; Lemon Squeezy stays supported on the server as a fallback); payment details never pass through Jackdaw Mail, and access is issued by a signed server entitlement. See [`docs/PRO-BILLING.md`](docs/PRO-BILLING.md) for the integration plan and launch checklist.

### Platforms

| Platform | Status |
|----------|--------|
| macOS (universal) | ready, primary platform |
| Windows 10/11 x64 | ready |
| Linux | build from source; no ready-made packages in releases yet |
| iOS / Android | in progress |

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
- **Website:** [jackdaw-mail.pro](https://jackdaw-mail.pro)
- **Repository:** [github.com/Uugsx/jackdaw-mail](https://github.com/Uugsx/jackdaw-mail)

---

<div align="center">

<sub>Jackdaw Mail · <a href="https://github.com/Uugsx">uugsx</a> · <a href="LICENSE">EUPL-1.2</a></sub><br>
<sub>Based on prior open-source work by Ben Bucksch, Beonex GmbH and contributors.</sub>

</div>
