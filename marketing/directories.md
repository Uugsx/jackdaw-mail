# Каталоги программ

Регистрирует и заполняет владелец (нужны аккаунты). Порядок — по пользе для поиска и аудитории. Требования каталогов меняются: перед отправкой открыть форму и сверить поля.

| Каталог | Что даёт | Как добавить | Особенности |
|---|---|---|---|
| **AlternativeTo** (alternativeto.net) | Люди ищут «alternative to Outlook / Thunderbird / Spark» | Аккаунт → Add application | Отметить как альтернативу Outlook, Thunderbird, Spark, eM Client, Mailbird. Лицензия: Freemium + Open Source |
| **GitHub** (сам репозиторий) | Поиск по темам | Уже есть темы `email-client`, `exchange`, `owa` | Добавить темы `outlook-alternative`, `imap`, `windows` (владелец, Settings репозитория) |
| **SourceForge** | Зеркало и поиск | «Import from GitHub» | Можно импортировать релизы автоматически |
| **Softpedia** (softpedia.com) | Трафик на Windows и Mac-сборки | Форма «Submit program» внизу сайта | Проверяют на вирусы; неподписанный установщик допустим |
| **MacUpdate** (macupdate.com) | Аудитория Mac | Developer → Submit app | Указать «not notarized» в описании |
| **Uptodown** | Windows/Mac, много языков | uptodown.com/developer | Поддерживает описание на нескольких языках |
| **Neowin Software** | Windows-аудитория | Через новостную форму / форум | Новость, а не реклама |
| **Slant** (slant.co) | Ответы на «best email client for Windows/Mac» | Добавить вариант в существующие вопросы | Писать как пользователь-разработчик с раскрытием |
| **Capterra / G2** | Малый бизнес ищет софт | Vendor-аккаунт (бесплатный) | Без покупки платных лидов; поле «отзывы» оставить пустым, не просить фальшивых |
| **winget** (microsoft/winget-pkgs) | Установка `winget install` | Pull request с манифестом | Нужен стабильный URL установщика и SHA256; PR делается только с явного «да» владельца |

## Поля, общие для всех

- **Name:** Jackdaw Mail
- **Website:** https://jackdaw-mail.pro/?ref=directory
- **Download:** https://github.com/Uugsx/jackdaw-mail/releases
- **Category:** Email clients / Communication / Productivity
- **Platforms:** macOS 12+ (Apple Silicon, Intel), Windows 10/11 64-bit
- **License:** Freemium; client source code EUPL-1.2
- **Price:** Free for one mailbox. Pro $9.99/month or $79.99/year per seat (one person, up to 2 devices). 7-day trial without a card.
- **Languages:** 43, including English, Russian, Ukrainian, German, French, Spanish, Chinese, Japanese, Arabic
- **Developer:** Nikita Galkin — support@jackdaw-mail.pro
- **Screenshots:** `site/assets/shot-*-en.jpg` (EN), `shot-*.jpg` (RU)
- **Icon:** `site/assets/icon-jackdaw-github.png`

## Short description (EN, ≤160)

`Desktop email client for Exchange, Gmail and IMAP on Mac and Windows. Reply deadlines in working minutes, reports, calendar, calls and encrypted chat.`

## Long description (EN)

```
Jackdaw Mail is a desktop email client for Exchange (OWA, EWS, ActiveSync),
Gmail and IMAP on macOS and Windows.

Its signature feature is reply-time tracking: Jackdaw counts how many working
minutes each email has waited for a reply, keeps a queue of unanswered emails
next to the open message, sends reminders before the deadline, and builds
reply-speed reports by mailbox or by person, exportable as one HTML file.

Features:
- Exchange: shared mailboxes, large online archives, out-of-office, server
  rules, tasks, notes, room booking, send-as
- Gmail, IMAP, CalDAV and CardDAV; sign-in with Microsoft, Google, Yahoo,
  AOL, Fastmail
- Calendar, contacts and the organization's global address list
- Audio and video calls with screen sharing, and end-to-end encrypted chat
  between Jackdaw users
- Snooze, pin, Focused/Other, quick steps, templates, undo send, send later
- PGP and S/MIME
- Mail is stored locally; passwords in Keychain (macOS) or DPAPI (Windows)
- 43 interface languages

Free for one mailbox. Pro adds more accounts, the unanswered queue, reports,
HTML signatures, calls and chat: $9.99/month or $79.99/year, 7-day free trial
without a card.

Note: builds are not signed by Apple or Microsoft yet. Microsoft 365 via
Graph is in test mode.
```

## Описание (RU)

```
Jackdaw Mail — почтовый клиент для Exchange (OWA, EWS, ActiveSync), Gmail
и IMAP на macOS и Windows.

Главное — контроль срока ответа: программа считает, сколько рабочих минут
письмо ждёт ответа, показывает очередь неотвеченных рядом с открытым письмом,
напоминает до срока и строит отчёты по скорости ответов по ящикам и
сотрудникам с сохранением в HTML.

Также: общие ящики и сетевой архив Exchange, автоответ, правила на сервере,
бронирование переговорных; календарь и контакты; звонки и зашифрованный чат
с коллегами; «Отложить», шаблоны, отмена отправки; PGP и S/MIME; 43 языка.
Почта хранится на вашем компьютере.

Один ящик — бесплатно. Pro — $9.99 в месяц или $79.99 в год, 7 дней без карты.

Сборки пока не заверены Apple и Microsoft.
```
