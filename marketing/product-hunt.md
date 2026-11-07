# Product Hunt

Публикует владелец со своего аккаунта (мейкер). Аккаунт лучше завести за 1–2 недели до запуска и немного побыть активным: комментировать чужие запуски. Запуск — во вторник–четверг, в 00:01 по тихоокеанскому времени (PT) = 13:01 по Ташкенту зимой, 12:01 летом. Не просить голосовать напрямую («upvote please») — это нарушает правила; можно сообщить, что запуск идёт, и дать ссылку.

## Поля карточки

**Name:** Jackdaw Mail

**Tagline (≤60):** `Outlook alternative for Exchange, Gmail and IMAP — Mac & Win`

Запасные варианты:
- `Email client that makes sure no important email goes unanswered`
- `Desktop mail for Exchange with reply deadlines and reports`

**Links:** https://jackdaw-mail.pro/?ref=producthunt · https://github.com/Uugsx/jackdaw-mail

**Topics:** Email, Productivity, Mac, Windows, Open Source

**Pricing:** Freemium (free for one mailbox; Pro $9.99/mo or $79.99/yr per seat; 7-day free trial, no card)

**Description (≤500):**

> Jackdaw Mail is a desktop email client for Exchange (OWA, EWS, ActiveSync), Gmail and IMAP on macOS and Windows. Mail, calendar, contacts, calls and encrypted chat live in one window. Its signature feature: it counts reply time in working minutes, keeps a queue of unanswered emails and builds reply-speed reports, so a team can see what is overdue. Mail goes straight from your server to your computer. Free for one mailbox; Pro unlocks more accounts, the queue, reports, calls and chat.

**Gallery (порядок):** снимки уже есть в `site/assets/` (английские — с суффиксом `-en`, разрешение 1800×1007, а Product Hunt рекомендует 1270×760 — можно загрузить как есть, он масштабирует):
1. `shot-mail-en.jpg` — почта
2. `shot-sla-en.jpg` — очередь неотвеченных и срок ответа
3. `shot-report-en.jpg` — отчёт по скорости ответов
4. `shot-calendar-en.jpg` — календарь
5. `shot-chat-en.jpg` — чат
6. `shot-meeting-en.jpg` — встреча
7. `shot-dark-en.jpg` — тёмная тема

Иконка: `site/assets/icon-jackdaw-github.png` (квадратная, нужна 240×240 — уменьшить).

## Первый комментарий мейкера

> Hi Product Hunt! I'm Nikita, a solo developer from Uzbekistan, and this is Jackdaw Mail.
>
> [ВЛАДЕЛЕЦ: 1–2 предложения своими словами — почему начали делать. Не выдумывать, если истории нет; тогда оставить абзац ниже как есть.]
>
> Most email clients show you *unread* mail. Teams that answer customers need to see *unanswered* mail. Jackdaw Mail counts reply time in **working minutes** — nights and weekends don't count — keeps a queue of unanswered emails next to the open message, and builds reports on how fast each mailbox replies.
>
> Around that is a full desktop client:
> - Exchange via OWA, EWS and ActiveSync, including shared mailboxes and the online archive; Gmail, IMAP, CalDAV/CardDAV
> - Calendar with room booking, out-of-office, server-side rules
> - Audio/video calls and end-to-end encrypted chat between Jackdaw users, right from an email
> - 43 interface languages
> - Mail goes directly between your server and your computer; the client is open source (EUPL)
>
> Honest limitations: macOS and Windows only for now, the builds are not signed by Apple or Microsoft yet (you'll see a Gatekeeper/SmartScreen warning on first launch), and Microsoft 365 via Graph is still in test mode — self-hosted Exchange is where it works best today.
>
> One mailbox is free forever. Pro is $9.99/month or $79.99/year per person (up to 2 devices), and you can try it for 7 days without a card.
>
> I'd love feedback — especially from people moving away from Outlook. What would stop you from switching?

## Короткие ответы на частые вопросы (EN)

- **Is it based on Thunderbird?** No. It's based on prior open-source work by Ben Bucksch, Beonex GmbH and contributors; Electron + Svelte.
- **Microsoft 365?** Microsoft is retiring EWS for Exchange Online; our Graph support is in test mode. On-premises Exchange works fully.
- **Linux / mobile?** Not yet. No dates to promise.
- **Where is my data?** On your computer. Our servers only see the license key and, if you use calls/chat, your verified address and encrypted messages. Full table: https://jackdaw-mail.pro/#data
