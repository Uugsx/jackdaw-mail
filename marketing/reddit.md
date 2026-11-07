# Reddit

Публикует владелец со своего аккаунта. На Reddit самореклама жёстко ограничена: аккаунт должен быть живым (комментарии в сабреддите до поста), правило «не больше 10% своих ссылок», в некоторых сабреддитах — только в специальных тредах. **Перед каждым постом открыть правила сабреддита (sidebar → Rules)** — они меняются. Один сабреддит в день, не копировать один текст во все.

## Куда и в каком порядке

| Сабреддит | Формат | Заметки |
|---|---|---|
| r/SideProject | пост о проекте | Самый дружелюбный к авторам, начать отсюда |
| r/opensource | пост со ссылкой на GitHub | Делать упор на открытый код и список сетевых подключений |
| r/macapps | пост, флейр по правилам | Обязательно сказать о неподписанной сборке и цене |
| r/sysadmin | только если разрешено правилами; лучше в еженедельном треде / как ответ в обсуждении про новый Outlook | Аудитория Exchange, но очень не любит рекламу |
| r/exchangeserver | вопрос-обсуждение, а не реклама | Только с разрешения модераторов |
| r/Outlook | не постить рекламу; отвечать в темах «чем заменить новый Outlook» | Только полезный ответ с раскрытием, что вы автор |
| r/privacy, r/software, r/windows | по правилам, обычно запрещают самопиар | Пропустить, если в правилах нет исключения |

Всегда раскрывать: «I'm the developer».

## r/SideProject

**Title:** `I built a desktop email client that tracks unanswered emails in working minutes`

```
Hi! I'm a solo developer, and I've been building Jackdaw Mail,
a desktop email client for macOS and Windows.

The idea: most clients show unread mail, but if your job is answering customers,
you need to see *unanswered* mail. Jackdaw counts reply time in working minutes
(nights and weekends don't count), shows a queue of emails waiting for a reply,
and builds reports on reply speed.

New mail shows up instantly (Exchange push notifications, IMAP IDLE for Gmail
and IMAP). It also does Exchange (OWA/EWS/ActiveSync with shared mailboxes), Gmail and IMAP,
calendar, and calls + end-to-end encrypted chat between Jackdaw users.

- Free for one mailbox, Pro is $9.99/mo or $79.99/yr, 7-day trial without a card
- Open source (EUPL): https://github.com/Uugsx/jackdaw-mail
- Site: https://jackdaw-mail.pro/?ref=reddit

Not signed by Apple/Microsoft yet, so expect a warning on first launch.
What would you want from a mail client before switching to it?
```

## r/opensource

**Title:** `Jackdaw Mail – EUPL desktop email client for Exchange, Gmail and IMAP`

```
I'm the developer. Jackdaw Mail is an open-source (EUPL-1.2) email client for
macOS and Windows, Electron + Svelte, based on prior open-source work by Ben
Bucksch, Beonex GmbH and contributors.

Things that might matter to this sub:
- mail goes directly from your server to your machine, stored in local SQLite
- new mail arrives via Exchange push notifications and IMAP IDLE, no polling timer
- every network connection the app makes is documented in one table:
  https://jackdaw-mail.pro/#data
- Exchange via OWA/EWS/ActiveSync, IMAP, CalDAV/CardDAV, PGP and S/MIME
- 43 UI languages

Business model, to be transparent: the client is open, and some features
(multiple accounts, reply-time queue and reports, calls/chat) need a paid
license checked by a separate server. One mailbox is free.

Repo: https://github.com/Uugsx/jackdaw-mail
Feedback and issues welcome.
```

## r/macapps

**Title:** `[Freemium] Jackdaw Mail – email client for Exchange, Gmail and IMAP`

(Проверить, какой формат заголовка и флейр требуют правила на момент публикации.)

```
Developer here. Jackdaw Mail is a mail client for macOS 12+ (Apple Silicon and Intel)
and Windows.

Why you might care on a Mac:
- Exchange with shared mailboxes, online archive, out-of-office, server rules
  and room booking — the stuff Apple Mail and Thunderbird don't fully cover
- New mail arrives instantly (Exchange push, IMAP IDLE for Gmail/IMAP)
- Passwords in Keychain, mail stored locally
- Unanswered-mail queue with reply deadlines in working minutes, and reports
- Calls and encrypted chat with colleagues who also use Jackdaw

Pricing: free for one mailbox; Pro $9.99/month or $79.99/year (one person,
up to 2 devices), 7-day trial without a card.

Heads-up: the app is not notarized yet, so macOS blocks the first launch —
allow it in System Settings → Privacy & Security.

https://jackdaw-mail.pro/?ref=reddit
```

## Ответ в теме «чем заменить новый Outlook» (r/Outlook, r/sysadmin и т. п.)

```
Disclosure: I'm the developer of Jackdaw Mail, so take this with that in mind.
If you're on on-prem Exchange, it talks OWA/EWS/ActiveSync directly (shared
mailboxes, archive, out-of-office, server rules, room booking), gets new mail
through Exchange push notifications instead of a polling timer, and keeps mail
local instead of syncing it through a cloud. Mac and Windows, free for one
mailbox. For Microsoft 365 our Graph support is still in test mode, so I
wouldn't recommend it there yet.
https://jackdaw-mail.pro/#compare
```
