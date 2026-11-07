# Show HN (Hacker News)

Публикует владелец со своего аккаунта HN. Правила Show HN: проект можно попробовать без регистрации и без письма с запросом доступа; без маркетингового тона; автор сам отвечает в комментариях. Голоса не просить и не публиковать ссылку «проголосуйте» — HN за это штрафует.

Лучшее время: вторник–четверг, 16:00–18:00 по Ташкенту зимой, 15:00–17:00 летом (6–8 утра по восточному времени США). Первые 2–3 часа отвечать на каждый комментарий.

## Заголовок (≤80)

`Show HN: Jackdaw Mail – open-source email client that tracks unanswered mail`

Запасной: `Show HN: Jackdaw Mail – desktop client for Exchange with reply deadlines`

## URL

`https://github.com/Uugsx/jackdaw-mail` — на HN к репозиторию относятся лучше, чем к лендингу. Сайт дать в тексте.

## Текст

```
Hi HN, I'm Nikita, a solo developer. Jackdaw Mail is a desktop email client
for macOS and Windows (Electron + Svelte, EUPL-licensed).

The part I care most about: most clients show unread mail, but teams that
answer customers by email need to see unanswered mail. Jackdaw counts reply
time in working minutes (per-weekday schedule, holidays), keeps a queue of
unanswered messages next to the open email, and builds reply-speed reports
per mailbox or per person (exportable as a single HTML file). A "reply" is the
first sent message in the thread; if it's not on this machine, it falls back
to the server's "answered" flag.

Other things that may be interesting:
- New mail arrives when the server gets it, not on a timer: EWS/OWA
  streaming notifications for Exchange, IMAP IDLE on the inbox for IMAP and
  Gmail (with a 5-minute safety check).
- Exchange via OWA, EWS and ActiveSync, including shared mailboxes and large
  online archives that load in the background; IMAP; CalDAV/CardDAV.
- Mail goes directly between your server and your machine and is stored in
  local SQLite. Every network connection the app makes is listed here:
  https://jackdaw-mail.pro/#data
- Audio/video calls and an end-to-end encrypted chat between Jackdaw users,
  addressed by email (verified via a code or a reply from your own mailbox).
  WebRTC peer-to-peer, with a relay that can't decrypt when P2P fails.
- 43 UI languages, including RTL.

Limitations, up front: builds are not signed by Apple or Microsoft yet, so
Gatekeeper/SmartScreen will warn on first launch. Microsoft is retiring EWS for
Exchange Online, and our Graph backend is still in test mode, so today it is
best with on-prem Exchange, Gmail and IMAP. No Linux or mobile builds yet.

One mailbox is free with no time limit. Pro (more accounts, the unanswered
queue, reports, calls/chat) is $9.99/month or $79.99/year, with a 7-day trial
that needs no card.

It's based on prior open-source work by Ben Bucksch, Beonex GmbH and
contributors. Site: https://jackdaw-mail.pro

I'd appreciate feedback, especially on the reply-time model and on what's
missing for people leaving Outlook.
```

## Заготовки ответов

- **"Why Electron?"** — One codebase for Mac and Windows from a solo developer, and the mail engine is in TypeScript. Memory use is the trade-off; I'd rather hear concrete numbers from your setup than argue in general.
- **"Why not just use Thunderbird?"** — Thunderbird is great and free. If you need one mailbox, Jackdaw is free too. The paid part is what Thunderbird doesn't do: reply deadlines, the unanswered queue, reports, Exchange calendar/contacts without add-ons, calls and chat.
- **"Open source but paid?"** — The client code is EUPL. Pro features check a license server; the license and call servers are a separate closed repo. You can read exactly what the client sends.
- **"Unsigned binaries?"** — Fair concern. Builds come from GitHub Actions in the public repo, update checksums are verified before install. Signing is a paid certificate.
- **"How do you handle my password?"** — Windows: DPAPI. macOS: Keychain. Passwords never go to our servers.
