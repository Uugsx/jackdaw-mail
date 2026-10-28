// Jackdaw Mail Landing — Client Interactions

(function () {
  'use strict';

  const EN_TRANSLATIONS = {
    "page.title": "Jackdaw Mail — an Exchange and OWA mail client that tracks response time",
    "page.description": "A desktop client for Exchange, OWA, EWS and IMAP. It counts response time in working minutes, shows a queue of unanswered mail and builds response-time reports.",
    "page.ogTitle": "Jackdaw Mail — mail for Exchange and OWA with response-time tracking",
    "page.ogDescription": "Counts response time in working minutes, shows a queue of unanswered mail and builds response-time reports.",
    "page.twitterTitle": "Jackdaw Mail — a mail client for Exchange and OWA",
    "page.twitterDescription": "Response time in working minutes, a queue of unanswered mail and response-time reports.",
    "brand.logoAlt": "Jackdaw Mail logo",
    "nav.label": "Main navigation",
    "nav.menu": "Open navigation menu",
    "nav.close": "Close navigation menu",
    "nav.sla": "How the deadline works",
    "nav.features": "Features",
    "nav.data": "Your data",
    "nav.plans": "Pricing",
    "nav.downloads": "Download",
    "nav.faq": "FAQ",
    "language.label": "Site language",
    "theme.toggle": "Toggle theme",
    "header.github": "GitHub",
    "header.download": "Download",
    "hero.title": "An Exchange and OWA mail client that counts response time in working minutes",
    "hero.lead": "For every unanswered message, Jackdaw Mail shows how much working time has passed and when the reply is due, and it builds a response-time report for any period. You can call colleagues who use Jackdaw Mail or message them in an encrypted chat, right from an email. Mail is downloaded straight from your server and stays on your computer.",
    "hero.download": "Download Jackdaw Mail",
    "hero.allBuilds": "All builds on GitHub",
    "hero.free": "free for one mailbox",
    "hero.pro": "Pro is $9.99 a month",
    "platform.all": "macOS and Windows",
    "showcase.heading": "App screens",
    "showcase.tablist": "App screens",
    "showcase.reports.tab": "Report",
    "showcase.reports.imageAlt": "A Jackdaw Mail report: message count, reply rate, average response time, an activity chart, an hourly heatmap and a reply table",
    "showcase.reports.caption": "A report for a chosen period: how many messages arrived, how many got a reply and how fast. The heatmap shows which hours are the busiest. The data on screen is made up.",
    "showcase.sla.tab": "Unanswered queue",
    "showcase.sla.imageAlt": "The unanswered-mail queue in the Jackdaw Mail right sidebar next to an open message",
    "showcase.sla.caption": "The queue sits in the right sidebar next to the open message: each item shows the time passed, the due time and the time left. The data on screen is made up.",
    "sla.title": "How the reply deadline is counted",
    "sla.aside": "An example with the default settings and reminders turned on",
    "sla.intro": "The timer runs only during working hours. By default that is Monday to Friday, 09:00 to 18:00, and the reply target is 30 working minutes. Reminders are turned on in settings and by default arrive at minutes 10, 20 and 25. Hours are set separately for each weekday.",
    "sla.caption": "A message arrives on Friday at 17:45",
    "sla.step1.time": "Fri 17:45",
    "sla.step1.text": "A message arrives. The clock starts.",
    "sla.step2.time": "Fri 17:55",
    "sla.step2.text": "First reminder: 10 working minutes have passed.",
    "sla.step3.time": "Fri 18:00",
    "sla.step3.text": "The working day ends at minute 15. The weekend does not count.",
    "sla.step4.time": "Mon 09:05",
    "sla.step4.text": "The clock resumed from minute 15. Reminder: 20 minutes.",
    "sla.step5.time": "Mon 09:10",
    "sla.step5.text": "Last reminder: 25 minutes.",
    "sla.step6.time": "Mon 09:15",
    "sla.step6.text": "The reply is due. If there is still no reply, the message is marked overdue in the queue.",
    "sla.reply": "A reply is the first sent message in the conversation. If it is not on your computer, the reply time comes from the server's “replied” flag. Reading a message or assigning a category shows who picked it up, but it does not reset the deadline.",
    "sla.offHours": "If a message arrives outside working hours, the clock starts when the working day begins. If someone picks such a message up earlier, the deadline runs from that moment without pauses.",
    "sla.limits": "Public holidays and lunch breaks are not supported yet: the schedule has one working interval per day.",
    "features.title": "What the app does",
    "features.aside": "Items marked Pro require a subscription or the trial.",
    "features.queue.title": "Unanswered queue · Pro",
    "features.queue.text": "Lives in the right sidebar next to the open message. You can exclude categories (for example, “we are in CC”), decide whether uncategorized mail is included, and move a message to the tracking archive and restore it later.",
    "features.reports.title": "Reports · Pro",
    "features.reports.text": "Filters by period, mailbox, folder and category. Activity by day, an hourly heatmap, first-response time, the share of on-time replies and a sortable table of every message. A finished report can be saved as a single HTML file.",
    "features.owner.title": "Who replied · Pro",
    "features.owner.text": "Results are grouped by mailbox or by categories named after employees.",
    "features.accounts.title": "Several mailboxes · Pro",
    "features.accounts.text": "A second account and beyond, plus OWA shared mailboxes with their folders and server-side categories. A category set by one colleague appears for the others after their client syncs.",
    "features.signatures.title": "Signatures · Pro",
    "features.signatures.text": "HTML signatures with links and images.",
    "features.related.title": "Related messages",
    "features.related.text": "A button in the message header finds messages with the same case number, from the same conversation or with a similar subject. The search runs only when you click it, so opening a message stays fast.",
    "features.mail.title": "Mail",
    "features.mail.text": "Folders, search and saved searches, rules, quick filters, categories and tags, flags, archive, undo for delete, notifications set per folder, keyboard shortcuts that act on the message under the mouse pointer without changing the selection, a customisable toolbar. Emptying Exchange Deleted Items also removes meetings, contacts, tasks, notes and subfolders. PGP and S/MIME encryption if you have keys.",
    "features.exchange.title": "Exchange features",
    "features.exchange.text": "Out-of-office replies with a schedule and a separate text for external senders, server-side inbox rules, tasks and flags with due dates, notes, server search across the mailbox, distribution list members, manager and direct reports from the directory, sending on behalf of a shared mailbox or a manager. All of this is stored on the Exchange server, so Outlook shows it too.",
    "features.sending.title": "Sending",
    "features.sending.text": "Undo send for a few seconds and “Send later”, message templates, @mentions, voting buttons, replies to read-receipt requests. A large file can go as a link from Nextcloud or openCloud.",
    "features.inbox.title": "Inbox triage",
    "features.inbox.text": "Snooze a message until a set time, pin it to the top of the list, Focused and Other tabs, clean-up of messages fully quoted in later replies, multi-step Quick Steps, safe and blocked sender lists, “Report phishing”. PDF, Word and Excel attachments open for preview inside the app: zoom, rotate and copy images, search and print PDFs.",
    "features.calendar.title": "Calendar and contacts",
    "features.calendar.text": "Events, invitations and reminders; “Propose new time”, working hours, Exchange room booking and printing a day, week or month. Personal address books, groups and the organization's global address list.",
    "features.calls.title": "Calls and chat · Pro",
    "features.calls.text": "End-to-end encrypted audio and video calls with screen sharing, and chat between Jackdaw Mail users, by email address. One-to-one chats and groups of up to 50 people; the group creator can rename it and change who is in it. Replies with quotes, editing and deleting for everyone, reactions, GIFs; you can see whether a message was delivered and read, and which members are online. Up to 10 files of 25 MB per message. Chat opens in the sidebar next to your mail; the sidebar splits into two parts and remembers the open chat. You can send a message or an event to a chat. The “Do not disturb” status declines calls and mutes notifications. Calls go directly between computers, or through our relay when the network does not allow that; the relay cannot decrypt the call. You confirm your address once for all devices on your licence, with an emailed code or by sending a reply from your own mailbox.",
    "features.archive.title": "Large mailboxes and online archive",
    "features.archive.text": "Shared mailboxes and the Exchange online archive with tens of thousands of messages. Older messages load in the background in batches without getting in your way. Moving, deleting and undoing the deletion of hundreds of messages happens in batches.",
    "features.languages.title": "43 languages",
    "features.languages.text": "The interface is fully translated into 43 languages, including English, Russian, French, German, Spanish, Ukrainian, Chinese and Japanese. Arabic, Hebrew, Persian and Urdu are shown right to left.",
    "features.security.title": "Passwords and security",
    "features.security.text": "Passwords and sign-in tokens are encrypted with the system keychain: Keychain on macOS and DPAPI on Windows. Sign-in and network errors are explained in plain words, with what to do next. Updates are verified before they are installed; remote email content is isolated from the app, and opened attachments are marked by the system as downloaded from the internet. Our servers limit confirmation-code guessing and bulk requests.",
    "features.protocols.title": "Protocols",
    "features.protocols.text": "Exchange via OWA, EWS and ActiveSync, including shared mailboxes and the online archive; IMAP; calendars and contacts via CalDAV and CardDAV. Sign in with Microsoft, Google, Yahoo, AOL, Fastmail and Mail.ru. Microsoft Graph and JMAP are in testing.",
    "data.title": "Where your data goes",
    "data.aside": "The app's network connections, apart from your own actions such as opening links",
    "data.header.host": "Destination",
    "data.header.what": "What is sent",
    "data.header.when": "When",
    "data.mail.host": "Your mail server",
    "data.mail.what": "Messages, folders, calendars and contacts; your login and password to sign in",
    "data.mail.when": "While the app is running",
    "data.domain.host": "Your mail domain's website",
    "data.domain.what": "Your email address, to find the server settings (autoconfig, autodiscover); the site icon",
    "data.domain.when": "When you add an account",
    "data.lookup.what": "Only the mail domain: a settings directory lookup and a Cloudflare DNS query",
    "data.lookup.when": "When you add an account",
    "data.oauth.host": "Microsoft, Google, Yahoo, AOL, Fastmail, Mail.ru",
    "data.oauth.what": "Sign-in on the provider's page (OAuth)",
    "data.oauth.when": "If you choose that sign-in method",
    "data.license.what": "Your license key, a random device ID and the User-Agent string. No messages or addresses",
    "data.license.when": "When you activate Pro or the trial, then every 15 minutes",
    "data.errors.what": "An error report: the error text and technical details of the crash",
    "data.errors.when": "When an error occurs in the app",
    "data.updates.what": "A check for a new version and the update download",
    "data.updates.when": "When checking for updates",
    "data.pgp.what": "The recipient's address",
    "data.pgp.when": "Only when you look up an encryption key",
    "data.calls.label": "(calls and chat)",
    "data.calls.what": "Confirmed email addresses, display name, call setup signals and encrypted chat messages and files. The server cannot read message text or file names; undelivered items are kept for up to 30 days",
    "data.calls.when": "If you confirmed an address for calls and chat (Pro or trial)",
    "data.verify.what": "A short email from your mailbox, to confirm the address",
    "data.verify.when": "Only if you choose “Confirm by email”",
    "data.stun.what": "Your IP address, to connect the call directly. The other person also sees your IP address",
    "data.stun.when": "During a Jackdaw call",
    "data.turn.label": "(call relay)",
    "data.turn.what": "Your IP address and the encrypted voice and video. The server passes them on to the other person and cannot decrypt it",
    "data.turn.when": "Only when the call cannot connect directly",
    "data.gif.label": "(GIFs in chat)",
    "data.gif.what": "Your IP address when GIF images load. The search query goes to KLIPY through our server, with a hash instead of your licence key",
    "data.gif.when": "Only when you search for or send a GIF in Jackdaw chat",
    "data.feedback.label": "(feedback)",
    "data.feedback.what": "Your message, a reply address (if you give one), app version, platform and language (if you allow it), and an anonymised device fingerprint. A bug report becomes a GitHub issue without your address",
    "data.feedback.when": "Only when you send feedback",
    "data.storage": "Messages, accounts, calendars and contacts are stored in local SQLite databases in the app's data folder. Nothing sits between the app and your mail server, and reports and deadlines are calculated on your computer.",
    "data.hidden": "The video meeting and third-party chat modules are hidden by default. If you turn them on, they connect to the servers of the service you choose. Jackdaw chat and calls appear after you confirm your address.",
    "plans.title": "Pricing",
    "plans.aside": "Mail for one mailbox is free with no time limit.",
    "plans.header.feature": "Feature",
    "plans.header.free": "Free",
    "plans.row.mail": "Mail, calendar, contacts",
    "plans.row.accounts": "Mail accounts",
    "plans.row.queue": "Unanswered queue and reminders",
    "plans.row.schedule": "Working hours per weekday",
    "plans.row.reports": "Reports and HTML export",
    "plans.row.signatures": "HTML signatures",
    "plans.row.calls": "Jackdaw calls and chat",
    "plans.yes": "yes",
    "plans.no": "no",
    "plans.accounts.free": "one",
    "plans.accounts.pro": "several, including shared mailboxes",
    "plans.monthly.title": "Pro, monthly",
    "plans.monthly.price": "$9.99 a month",
    "plans.monthly.note": "Billed every month.",
    "plans.yearly.title": "Pro, yearly",
    "plans.yearly.price": "$79.99 a year",
    "plans.yearly.note": "$6.67 a month, a third less than paying monthly.",
    "plans.checkout": "Buy a key",
    "plans.trialNote": "You can try Pro free for 7 days. The trial starts inside the app and needs no card. While it runs, the app needs internet access because the trial is checked online.",
    "plans.paymentNote": "Payment is handled by Paddle. The key appears on this page as soon as the payment is confirmed, so save it somewhere safe. Jackdaw Mail never sees your card details. When a subscription ends, your connected accounts stay; only the Pro features switch off.",
    "billing.unavailable": "The purchase link is not configured yet.",
    "billing.storeUnavailable": "The payment store is not connected yet.",
    "billing.checking": "Checking the payment store…",
    "billing.network": "The payment status is temporarily unavailable.",
    "purchase.title": "Jackdaw Pro key",
    "purchase.copy": "Copy",
    "purchase.hint": "Paste the key into Jackdaw Mail: Settings → Jackdaw Pro. Save it: you will need it to connect another device.",
    "purchase.close": "Done",
    "downloads.title": "Download",
    "downloads.aside": "Builds are published on GitHub.",
    "downloads.header.system": "System",
    "downloads.header.file": "File",
    "downloads.header.requirements": "Requirements",
    "downloads.header.link": "Link",
    "downloads.action": "Download",
    "downloads.macos.requirements": "macOS 12 or later, Apple Silicon and Intel",
    "downloads.windows.requirements": "Windows 10 and 11, 64-bit",
    "downloads.note.prerelease": "Only preview builds are available right now; versions marked -dev are updated often.",
    "downloads.note.macos": "The macOS build is not notarized by Apple. macOS will block it on first launch; allow it in System Settings, in the security section.",
    "downloads.note.windows": "The Windows installer is not signed, so SmartScreen may show a warning: click “More info”, then “Run anyway”.",
    "downloads.note.linux": "There are no ready-made Linux builds yet. The iOS and Android versions in this repository are still in progress.",
    "faq.title": "FAQ",
    "faq.q1": "What counts as a reply?",
    "faq.a1": "The first sent message in the conversation. If it is not on your computer, the reply time comes from the server's “replied” flag. A reply sent outside working hours is marked separately in the report and left out of the average.",
    "faq.q2": "Does reading a message reset the deadline?",
    "faq.a2": "No. Reading a message or assigning a category with an employee's name shows who picked it up, but the deadline is still counted from when the message arrived.",
    "faq.q3": "Where are my passwords and mail stored?",
    "faq.a3": "Mail stays on your computer, in the app's data folder. Passwords and sign-in tokens are also encrypted with the system keychain: Keychain on macOS and DPAPI on Windows. Passwords and mail are never sent to Jackdaw servers.",
    "faq.q4": "What happens when Pro ends?",
    "faq.a4": "Mail keeps working and your connected accounts stay. You cannot add a new account, and reports, the unanswered queue, HTML signatures, and Jackdaw calls and chat switch off until you renew.",
    "faq.q5": "How does the app update?",
    "faq.a5": "The app checks GitHub for new versions and tells you when one is available. On macOS the update downloads automatically, on Windows when you click the button. Installation starts after you confirm, then the app restarts. Your settings and mail are kept.",
    "footer.copyright": "© 2026 Jackdaw Mail",
    "footer.label": "Project links",
    "footer.github": "Source code",
    "footer.releases": "Release history",
    "footer.issue": "Report an issue",
    "footer.license": "License",
    "footer.terms": "Terms of Use",
    "footer.privacy": "Privacy Policy",
    "footer.author": "Author: @Uugsx",
    "footer.credit": "Based on open-source work by Ben Bucksch, Beonex GmbH and other contributors."
  };

  const RU_DYNAMIC_TRANSLATIONS = {
    "nav.menu": "Открыть меню",
    "nav.close": "Закрыть меню",
    "theme.light": "Включить светлую тему",
    "theme.dark": "Включить тёмную тему",
    "billing.unavailable": "Ссылка на покупку ещё не настроена.",
    "billing.storeUnavailable": "Платёжный магазин ещё не подключён.",
    "billing.checking": "Проверяем состояние платёжного магазина…",
    "billing.network": "Статус платёжного магазина временно недоступен.",
    "billing.available": "Откроется защищённая страница покупки.",
    "billing.unavailableTitle": "Ссылка на покупку ещё не настроена.",
    "billing.availableTitle": "Откроется защищённая страница покупки.",
    "billing.paddleAvailable": "Оплата откроется в защищённом окне Paddle.",
    "billing.paddleSandbox": "Тестовая среда Paddle Sandbox: настоящие деньги не списываются.",
    "purchase.waiting": "Оплата получена. Ждём подтверждения от Paddle и выпускаем ключ…",
    "purchase.ready": "Ключ готов.",
    "purchase.copied": "Ключ скопирован.",
    "purchase.timeout": "Подтверждение оплаты задерживается. Обновите страницу через минуту — ключ появится здесь же.",
    "purchase.failed": "Не удалось открыть оплату. Обновите страницу и попробуйте ещё раз.",
    "purchase.revoked": "Эта покупка отменена или возвращена, ключ неактивен.",
    "purchase.expired": "Срок получения ключа на этой странице истёк. Напишите в поддержку, чтобы получить ключ.",
    "downloads.hero.mac": "Скачать для macOS",
    "downloads.hero.windows": "Скачать для Windows",
    "downloads.hero.other": "Перейти к загрузкам",
    "platform.mac": "macOS 12 и новее, Apple Silicon и Intel",
    "platform.windows": "Windows 10 и 11, 64-бит",
    "platform.linux": "Linux: готовых сборок пока нет",
    "platform.other": "macOS и Windows"
  };

  const EN_DYNAMIC_TRANSLATIONS = {
    "nav.menu": "Open navigation menu",
    "nav.close": "Close navigation menu",
    "theme.light": "Switch to light theme",
    "theme.dark": "Switch to dark theme",
    "billing.available": "A secure purchase page will open.",
    "billing.unavailableTitle": "The purchase link is not configured yet.",
    "billing.availableTitle": "A secure purchase page will open.",
    "billing.storeUnavailable": "The payment store is not connected yet.",
    "billing.checking": "Checking the payment store…",
    "billing.network": "The payment status is temporarily unavailable.",
    "billing.paddleAvailable": "Payment opens in a secure Paddle window.",
    "billing.paddleSandbox": "Paddle Sandbox test environment: no real money is charged.",
    "purchase.waiting": "Payment received. Waiting for Paddle to confirm it and issuing your key…",
    "purchase.ready": "Your key is ready.",
    "purchase.copied": "Key copied.",
    "purchase.timeout": "Payment confirmation is taking longer than usual. Reload the page in a minute and the key will appear here.",
    "purchase.failed": "The payment window could not be opened. Reload the page and try again.",
    "purchase.revoked": "This purchase was cancelled or refunded, so the key is inactive.",
    "purchase.expired": "The key can no longer be collected on this page. Contact support to receive it.",
    "downloads.hero.mac": "Download for macOS",
    "downloads.hero.windows": "Download for Windows",
    "downloads.hero.other": "Go to downloads",
    "platform.mac": "macOS 12 or later, Apple Silicon and Intel",
    "platform.windows": "Windows 10 and 11, 64-bit",
    "platform.linux": "Linux: no ready-made builds yet",
    "platform.other": "macOS and Windows"
  };

  const LANGUAGE_STORAGE_KEY = 'jackdaw-language';
  const languageListeners = [];
  const originalTranslations = new WeakMap();
  let currentLanguage = 'ru';

  function getSavedLanguage() {
    try {
      const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
      if (saved === 'ru' || saved === 'en') return saved;
    } catch (_error) {
      // Storage may be unavailable in a restricted browser context.
    }
    return navigator.language?.toLowerCase().startsWith('ru') ? 'ru' : 'en';
  }

  function getLocalized(key) {
    if (currentLanguage === 'en') {
      return EN_DYNAMIC_TRANSLATIONS[key] || EN_TRANSLATIONS[key] || key;
    }
    return RU_DYNAMIC_TRANSLATIONS[key] || key;
  }

  function updateLocalizedShowcaseImages() {
    document.querySelectorAll('[data-language-image]').forEach((element) => {
      const imageSource = element.getAttribute(`data-image-${currentLanguage}`);
      if (imageSource && element.getAttribute('src') !== imageSource) {
        element.setAttribute('src', imageSource);
      }
    });
  }

  function applyLanguage(language) {
    if (language !== 'ru' && language !== 'en') return;
    currentLanguage = language;
    document.documentElement.lang = language;
    document.documentElement.dataset.language = language;

    document.querySelectorAll('[data-i18n]').forEach((element) => {
      const key = element.getAttribute('data-i18n');
      if (!key) return;
      const attribute = element.getAttribute('data-i18n-attr');
      let russianValue = originalTranslations.get(element);
      if (russianValue === undefined) {
        russianValue = attribute ? element.getAttribute(attribute) || '' : element.textContent || '';
        originalTranslations.set(element, russianValue);
      }
      const value = language === 'en' ? (EN_TRANSLATIONS[key] || russianValue) : russianValue;
      if (attribute) {
        element.setAttribute(attribute, value);
      } else {
        element.textContent = value;
      }
    });

    document.querySelectorAll('[data-language-option]').forEach((option) => {
      const isActive = option.getAttribute('data-language-option') === language;
      option.classList.toggle('active', isActive);
      option.setAttribute('aria-pressed', String(isActive));
    });

    updateLocalizedShowcaseImages();

    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch (_error) {
      // The page remains functional when persistent storage is unavailable.
    }

    languageListeners.forEach((listener) => listener());
  }

  document.querySelectorAll('[data-language-option]').forEach((option) => {
    option.addEventListener('click', () => {
      applyLanguage(option.getAttribute('data-language-option'));
    });
  });

  applyLanguage(getSavedLanguage());

  // 1. Theme Management
  const themeToggle = document.getElementById('theme-toggle');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');

  function getSavedTheme() {
    try {
      const saved = localStorage.getItem('jackdaw-theme');
      if (saved === 'dark' || saved === 'light') return saved;
    } catch (_error) {
      // Storage can be disabled without making the theme switch unusable.
    }
    return prefersDark.matches ? 'dark' : 'light';
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('jackdaw-theme', theme);
    } catch (_error) {
      // The selected theme remains active for the current page.
    }
    if (themeToggle) {
      themeToggle.setAttribute('aria-label', getLocalized(theme === 'dark' ? 'theme.light' : 'theme.dark'));
      themeToggle.innerHTML = theme === 'dark'
        ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
        : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
    }
  }

  const initialTheme = getSavedTheme();
  applyTheme(initialTheme);
  languageListeners.push(() => applyTheme(document.documentElement.getAttribute('data-theme') || 'light'));

  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'light';
      applyTheme(current === 'dark' ? 'light' : 'dark');
    });
  }

  prefersDark.addEventListener('change', (e) => {
    let savedTheme = null;
    try {
      savedTheme = localStorage.getItem('jackdaw-theme');
    } catch (_error) {
      savedTheme = null;
    }
    if (!savedTheme) {
      applyTheme(e.matches ? 'dark' : 'light');
    }
  });

  // Мобильная навигация остаётся клавиатурно доступной и не меняет разметку
  // десктопного меню.
  const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
  const siteNav = document.getElementById('site-nav');

  function setMobileMenu(open) {
    if (!mobileMenuToggle || !siteNav) return;
    mobileMenuToggle.setAttribute('aria-expanded', String(open));
    mobileMenuToggle.setAttribute('aria-label', getLocalized(open ? 'nav.close' : 'nav.menu'));
    siteNav.classList.toggle('is-open', open);
  }

  mobileMenuToggle?.addEventListener('click', () => {
    setMobileMenu(mobileMenuToggle.getAttribute('aria-expanded') !== 'true');
  });
  siteNav?.querySelectorAll('.nav-link').forEach((link) => {
    link.addEventListener('click', () => setMobileMenu(false));
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setMobileMenu(false);
  });
  languageListeners.push(() => {
    if (mobileMenuToggle) {
      mobileMenuToggle.setAttribute(
        'aria-label',
        getLocalized(mobileMenuToggle.getAttribute('aria-expanded') === 'true' ? 'nav.close' : 'nav.menu'),
      );
    }
  });

  const billingCheckoutLinks = document.querySelectorAll('[data-billing-plan]');
  const billingCheckout = window.JACKDAW_BILLING_CONFIG
    && window.JACKDAW_BILLING_CONFIG.checkout
    ? window.JACKDAW_BILLING_CONFIG.checkout
    : {};
  const billingApiBaseUrl = window.JACKDAW_BILLING_CONFIG
    && typeof window.JACKDAW_BILLING_CONFIG.apiBaseUrl === 'string'
    ? window.JACKDAW_BILLING_CONFIG.apiBaseUrl
    : '';
  const ownBillingHosts = new Set(['jackdaw-mail.pro', 'www.jackdaw-mail.pro', 'license.jackdaw-mail.pro']);
  const billingStates = [];
  const paddleSiteConfig = window.JACKDAW_BILLING_CONFIG && window.JACKDAW_BILLING_CONFIG.paddle
    ? window.JACKDAW_BILLING_CONFIG.paddle
    : null;
  // Окружение Paddle задаёт префикс клиентского токена: test_ для Sandbox, live_ для Live.
  const PADDLE_TOKEN_PREFIXES = { sandbox: 'test_', production: 'live_' };
  const PADDLE_TOKEN_RE = /^(?:test|live)_[A-Za-z0-9_]{8,128}$/;
  const PADDLE_PRICE_RE = /^pri_[a-z0-9]{26}$/;
  const PADDLE_TRANSACTION_RE = /^txn_[a-z0-9]{26}$/;
  const PADDLE_SCRIPT_HOST = 'cdn.paddle.com';
  const CLAIM_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
  const LICENSE_KEY_RE = /^JACKDAW-PRO-(?:[A-Z0-9]{4}-){3}[A-Z0-9]{4}$/;
  const PURCHASE_STORAGE_KEY = 'jackdaw-paddle-purchase';
  const PURCHASE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
  const CLAIM_POLL_INTERVAL_MS = 3000;
  const CLAIM_POLL_ATTEMPTS = 40;
  const purchaseResult = document.getElementById('purchase-result');
  const purchaseMessage = document.getElementById('purchase-result-message');
  const purchaseKeyRow = document.getElementById('purchase-key-row');
  const purchaseKey = document.getElementById('purchase-key');
  const purchaseKeyHint = document.getElementById('purchase-key-hint');
  const purchaseCopy = document.getElementById('purchase-key-copy');
  const purchaseClose = document.getElementById('purchase-result-close');
  let paddleLoading = null;
  let paddleCheckout = null;
  let currentPurchase = null;
  let purchaseMessageKey = '';
  let purchaseFinal = false;

  function validCheckoutURL(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:') return null;
      const isLemonSqueezy = url.hostname.endsWith('.lemonsqueezy.com')
        && /^\/checkout\/buy\/[^/]+\/?$/.test(url.pathname);
      const isOwnLicenseCheckout = ownBillingHosts.has(url.hostname)
        && /^\/buy\/(monthly|yearly)\/?$/.test(url.pathname);
      if (!isLemonSqueezy && !isOwnLicenseCheckout) return null;
      return url.toString();
    } catch (_error) {
      return null;
    }
  }

  function updateBillingCopy() {
    billingStates.forEach(({ link, status, state, mode }) => {
      const paddleStatusKey = paddleCheckout && paddleCheckout.environment === 'sandbox'
        ? 'billing.paddleSandbox'
        : 'billing.paddleAvailable';
      const statusKey = state === 'available'
        ? (mode === 'paddle' ? paddleStatusKey : 'billing.available')
        : state === 'checking'
          ? 'billing.checking'
          : state === 'store-unavailable'
            ? 'billing.storeUnavailable'
            : state === 'network-error'
              ? 'billing.network'
              : 'billing.unavailable';
      const titleKey = state === 'available'
        ? (mode === 'paddle' ? 'billing.paddleAvailable' : 'billing.availableTitle')
        : statusKey;
      link.setAttribute('title', getLocalized(titleKey));
      if (status) {
        status.textContent = getLocalized(statusKey);
      }
    });
  }

  function setBillingState(item, state) {
    item.state = state;
    const available = state === 'available';
    linkState(item, available);
    updateBillingCopy();
  }

  function linkState(item, available) {
    const { link, checkoutURL } = item;
    link.classList.toggle('is-unavailable', !available);
    if (available && item.mode === 'paddle') {
      // Paddle.js открывает checkout поверх страницы, переход по ссылке не нужен.
      link.setAttribute('href', '#plans');
      link.removeAttribute('target');
      link.removeAttribute('rel');
      link.removeAttribute('aria-disabled');
      link.removeAttribute('tabindex');
    } else if (available) {
      link.setAttribute('href', checkoutURL);
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
      link.removeAttribute('aria-disabled');
      link.removeAttribute('tabindex');
    } else {
      link.setAttribute('href', '#plans');
      link.setAttribute('aria-disabled', 'true');
      link.setAttribute('tabindex', '-1');
    }
  }

  function validBillingAPIURL(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || !ownBillingHosts.has(url.hostname)) return null;
      return url.toString().replace(/\/$/, '');
    } catch (_error) {
      return null;
    }
  }

  async function resolveOwnCheckoutAvailability() {
    const pending = billingStates.filter((item) => item.state === 'checking');
    if (!pending.length) return;
    const apiURL = validBillingAPIURL(billingApiBaseUrl);
    if (!apiURL) {
      pending.forEach((item) => setBillingState(item, 'network-error'));
      return;
    }

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeout = window.setTimeout(() => controller?.abort(), 5000);
    try {
      const response = await fetch(`${apiURL}/v1/public-config`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: controller?.signal,
      });
      const config = await response.json().catch(() => null);
      if (!response.ok || !config || typeof config.checkout !== 'object') throw new Error('billing-config');
      const paddle = resolvePaddleConfig(config.paddle);
      if (paddle) {
        await loadPaddle(paddle);
        pending.forEach((item) => {
          item.mode = 'paddle';
          setBillingState(item, 'available');
        });
        openRequestedCheckout();
        return;
      }
      if (config.paddle && config.paddle.configured === true) {
        // Сервер настроен на другое окружение или другие цены: webhook не выдал бы ключ.
        pending.forEach((item) => setBillingState(item, 'unavailable'));
        return;
      }
      pending.forEach((item) => {
        const configured = config.checkout?.[item.plan]?.configured === true;
        setBillingState(item, configured ? 'available' : 'store-unavailable');
      });
    } catch (_error) {
      pending.forEach((item) => setBillingState(item, 'network-error'));
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function resolvePaddleConfig(serverConfig) {
    if (!paddleSiteConfig || !serverConfig || serverConfig.configured !== true) return null;
    // Окружение и цены задаёт сервер (license.env), переход Sandbox → Live не требует правки сайта.
    // Если в billing-config.js они всё же закреплены, они должны совпасть с серверными.
    const environment = serverConfig.environment;
    const expectedPrefix = PADDLE_TOKEN_PREFIXES[environment];
    const token = serverConfig.clientToken;
    const serverPrices = serverConfig.prices || {};
    const pinnedPrices = paddleSiteConfig.prices || null;
    if (!expectedPrefix) return null;
    if (paddleSiteConfig.environment && paddleSiteConfig.environment !== environment) return null;
    if (typeof token !== 'string' || !PADDLE_TOKEN_RE.test(token) || !token.startsWith(expectedPrefix)) return null;
    const prices = {};
    const pricesMatch = ['monthly', 'yearly'].every((plan) => {
      prices[plan] = serverPrices[plan];
      return PADDLE_PRICE_RE.test(prices[plan] || '')
        && (!pinnedPrices || !pinnedPrices[plan] || pinnedPrices[plan] === prices[plan]);
    });
    if (!pricesMatch || prices.monthly === prices.yearly) return null;
    let scriptUrl;
    try {
      scriptUrl = new URL(paddleSiteConfig.scriptUrl);
    } catch (_error) {
      return null;
    }
    if (scriptUrl.protocol !== 'https:' || scriptUrl.hostname !== PADDLE_SCRIPT_HOST) return null;
    return {
      environment,
      token,
      prices: { monthly: prices.monthly, yearly: prices.yearly },
      scriptUrl: scriptUrl.toString(),
    };
  }

  function loadPaddle(paddle) {
    if (paddleLoading) return paddleLoading;
    paddleLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = paddle.scriptUrl;
      script.async = true;
      script.onload = () => {
        const Paddle = window.Paddle;
        if (!Paddle || !Paddle.Checkout || !Paddle.Environment || typeof Paddle.Initialize !== 'function') {
          reject(new Error('paddle-unavailable'));
          return;
        }
        try {
          // Paddle.Initialize допускается только один раз на странице.
          if (paddle.environment === 'sandbox') Paddle.Environment.set('sandbox');
          Paddle.Initialize({ token: paddle.token, eventCallback: handlePaddleEvent });
        } catch (error) {
          reject(error);
          return;
        }
        paddleCheckout = paddle;
        resolve(paddle);
      };
      script.onerror = () => reject(new Error('paddle-unavailable'));
      document.head.appendChild(script);
    });
    return paddleLoading;
  }

  function createClaimToken() {
    if (!window.crypto || typeof window.crypto.getRandomValues !== 'function') return null;
    const bytes = window.crypto.getRandomValues(new Uint8Array(32));
    let binary = '';
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function savePurchase(purchase) {
    currentPurchase = purchase;
    try {
      localStorage.setItem(PURCHASE_STORAGE_KEY, JSON.stringify(purchase));
    } catch (_error) {
      // Без хранилища ключ всё равно выдаётся в этой вкладке.
    }
  }

  function forgetPurchase() {
    currentPurchase = null;
    try {
      localStorage.removeItem(PURCHASE_STORAGE_KEY);
    } catch (_error) {
      // Удалять нечего, если хранилище недоступно.
    }
  }

  function readPurchase() {
    try {
      const purchase = JSON.parse(localStorage.getItem(PURCHASE_STORAGE_KEY) || 'null');
      if (!purchase || !CLAIM_TOKEN_RE.test(purchase.claimToken || '')) return null;
      if (typeof purchase.startedAt !== 'number' || Date.now() - purchase.startedAt > PURCHASE_MAX_AGE_MS) return null;
      return purchase;
    } catch (_error) {
      return null;
    }
  }

  function showPurchaseMessage(messageKey) {
    if (!purchaseResult || !purchaseMessage) return;
    purchaseMessageKey = messageKey;
    purchaseMessage.textContent = getLocalized(messageKey);
    purchaseResult.hidden = false;
  }

  function showPurchaseKey(licenseKey) {
    if (!purchaseKey || !purchaseKeyRow) return;
    purchaseKey.textContent = licenseKey;
    purchaseKeyRow.hidden = false;
    if (purchaseKeyHint) purchaseKeyHint.hidden = false;
    purchaseFinal = true;
    showPurchaseMessage('purchase.ready');
  }

  function finishPurchase(messageKey) {
    purchaseFinal = true;
    forgetPurchase();
    showPurchaseMessage(messageKey);
  }

  async function claimPurchaseKey(purchase, attempt) {
    const apiURL = validBillingAPIURL(billingApiBaseUrl);
    if (!apiURL || currentPurchase !== purchase) return;
    let status = 0;
    let payload = null;
    try {
      const response = await fetch(`${apiURL}/v1/paddle/claim`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ transactionId: purchase.transactionId, claimToken: purchase.claimToken }),
      });
      status = response.status;
      payload = await response.json().catch(() => null);
    } catch (_error) {
      status = 0;
    }
    if (currentPurchase !== purchase) return;
    if (status === 200 && payload && LICENSE_KEY_RE.test(payload.licenseKey || '')) {
      showPurchaseKey(payload.licenseKey);
      return;
    }
    if (status === 403) {
      finishPurchase('purchase.revoked');
      return;
    }
    if (status === 410) {
      finishPurchase('purchase.expired');
      return;
    }
    // Webhook Paddle может прийти позже события checkout.completed: ждём и повторяем.
    if (attempt + 1 >= CLAIM_POLL_ATTEMPTS) {
      showPurchaseMessage('purchase.timeout');
      return;
    }
    window.setTimeout(() => {
      void claimPurchaseKey(purchase, attempt + 1);
    }, CLAIM_POLL_INTERVAL_MS);
  }

  function startPurchaseClaim(purchase) {
    purchaseFinal = false;
    if (purchaseKeyRow) purchaseKeyRow.hidden = true;
    if (purchaseKeyHint) purchaseKeyHint.hidden = true;
    showPurchaseMessage('purchase.waiting');
    void claimPurchaseKey(purchase, 0);
  }

  function handlePaddleEvent(event) {
    if (!event || !currentPurchase) return;
    if (event.name === 'checkout.completed') {
      const transactionId = event.data && event.data.transaction_id;
      if (typeof transactionId !== 'string' || !PADDLE_TRANSACTION_RE.test(transactionId)) return;
      const purchase = { ...currentPurchase, transactionId };
      savePurchase(purchase);
      startPurchaseClaim(purchase);
    } else if (event.name === 'checkout.closed' && !currentPurchase.transactionId) {
      forgetPurchase();
    }
  }

  function openPaddleCheckout(plan) {
    const priceId = paddleCheckout && paddleCheckout.prices[plan];
    const claimToken = createClaimToken();
    if (!priceId || !claimToken || !window.Paddle) {
      showPurchaseMessage('purchase.failed');
      return;
    }
    savePurchase({ claimToken, plan, transactionId: null, startedAt: Date.now() });
    try {
      window.Paddle.Checkout.open({
        items: [{ priceId, quantity: 1 }],
        // Токен только связывает оплату с этой вкладкой. Ключ выдаёт сервер
        // после подписанного webhook, а не по данным из браузера.
        customData: { jackdaw_claim: claimToken },
        settings: {
          displayMode: 'overlay',
          theme: document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light',
          locale: currentLanguage,
          allowLogout: true,
        },
      });
    } catch (_error) {
      forgetPurchase();
      showPurchaseMessage('purchase.failed');
    }
  }

  function openRequestedCheckout() {
    // Ссылки /buy/{plan} из приложения ведут сюда с ?checkout=monthly|yearly.
    let requestedPlan = null;
    try {
      const url = new URL(window.location.href);
      requestedPlan = url.searchParams.get('checkout');
      if (requestedPlan) {
        url.searchParams.delete('checkout');
        window.history.replaceState(null, '', url.toString());
      }
    } catch (_error) {
      requestedPlan = null;
    }
    if (requestedPlan === 'monthly' || requestedPlan === 'yearly') {
      openPaddleCheckout(requestedPlan);
    }
  }

  purchaseCopy?.addEventListener('click', async () => {
    const licenseKey = purchaseKey ? purchaseKey.textContent || '' : '';
    if (!licenseKey) return;
    try {
      await navigator.clipboard.writeText(licenseKey);
      showPurchaseMessage('purchase.copied');
    } catch (_error) {
      // Без доступа к буферу обмена выделяем ключ, чтобы его скопировали вручную.
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(purchaseKey);
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  });

  purchaseClose?.addEventListener('click', () => {
    if (purchaseFinal) forgetPurchase();
    if (purchaseResult) purchaseResult.hidden = true;
  });

  billingCheckoutLinks.forEach((link) => {
    const plan = link.getAttribute('data-billing-plan');
    const checkoutURL = validCheckoutURL(billingCheckout[plan]);
    const status = document.getElementById(`billing-${plan}-status`);
    const state = checkoutURL
      ? (new URL(checkoutURL).hostname.endsWith('.lemonsqueezy.com') ? 'available' : 'checking')
      : 'unavailable';
    const item = { link, status, plan, checkoutURL, state, mode: 'link' };
    billingStates.push(item);
    linkState(item, state === 'available');
    link.addEventListener('click', (event) => {
      if (item.state !== 'available') {
        event.preventDefault();
      } else if (item.mode === 'paddle') {
        event.preventDefault();
        openPaddleCheckout(plan);
      }
    });
  });
  updateBillingCopy();
  void resolveOwnCheckoutAvailability();
  languageListeners.push(updateBillingCopy);
  languageListeners.push(() => {
    if (purchaseMessageKey && purchaseMessage) purchaseMessage.textContent = getLocalized(purchaseMessageKey);
  });

  // Покупка, начатая до перезагрузки страницы, продолжает ждать ключ.
  const resumedPurchase = readPurchase();
  if (resumedPurchase && PADDLE_TRANSACTION_RE.test(resumedPurchase.transactionId || '')) {
    currentPurchase = resumedPurchase;
    startPurchaseClaim(resumedPurchase);
  } else {
    forgetPurchase();
  }

  // 2. Showcase Tab Switcher
  const tabs = document.querySelectorAll('.showcase-tab');
  const panels = document.querySelectorAll('.showcase-panel');

  function activateTab(tab, moveFocus = false) {
    const targetId = tab.getAttribute('data-target');
    const targetPanel = targetId ? document.getElementById(targetId) : null;
    if (!targetPanel) return;

    tabs.forEach((currentTab) => {
      const isActive = currentTab === tab;
      currentTab.classList.toggle('active', isActive);
      currentTab.setAttribute('aria-selected', String(isActive));
      currentTab.setAttribute('tabindex', isActive ? '0' : '-1');
    });
    panels.forEach((panel) => {
      const isActive = panel === targetPanel;
      panel.classList.toggle('active', isActive);
      panel.hidden = !isActive;
    });
    if (moveFocus) tab.focus();
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => {
      activateTab(tab);
    });
    tab.addEventListener('keydown', (event) => {
      let nextIndex = index;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + tabs.length) % tabs.length;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = tabs.length - 1;
      if (nextIndex === index) return;
      event.preventDefault();
      activateTab(tabs[nextIndex], true);
    });
  });
  const initiallyActiveTab = document.querySelector('.showcase-tab.active');
  if (initiallyActiveTab) activateTab(initiallyActiveTab);

  // 3. Platform Detection for Download Buttons
  function detectOS() {
    const userAgent = window.navigator.userAgent.toLowerCase();
    // У iOS и Android в User-Agent есть «Mac OS X» и «Linux», но десктопные сборки им не подходят.
    if (/android|iphone|ipad|ipod/.test(userAgent)) return 'other';
    if (userAgent.includes('mac')) return 'mac';
    if (userAgent.includes('win')) return 'windows';
    if (userAgent.includes('linux')) return 'linux';
    return 'other';
  }

  const detectedOS = detectOS();
  const heroDownloadBtn = document.getElementById('hero-download-btn');
  const detectedLabel = document.getElementById('detected-os-label');

  const DOWNLOAD_LINKS = {
    mac: {
      url: 'https://github.com/Uugsx/jackdaw-mail/releases',
      textKey: 'downloads.hero.mac',
      labelKey: 'platform.mac',
      cardId: 'card-macos'
    },
    windows: {
      url: 'https://github.com/Uugsx/jackdaw-mail/releases',
      textKey: 'downloads.hero.windows',
      labelKey: 'platform.windows',
      cardId: 'card-windows'
    },
    linux: {
      url: '#downloads',
      textKey: 'downloads.hero.other',
      labelKey: 'platform.linux',
      cardId: null
    },
    other: {
      url: 'https://github.com/Uugsx/jackdaw-mail/releases',
      textKey: 'downloads.hero.other',
      labelKey: 'platform.other',
      cardId: 'card-macos'
    }
  };

  const currentPlatform = DOWNLOAD_LINKS[detectedOS] || DOWNLOAD_LINKS.other;
  const heroDownloadLabel = document.getElementById('hero-download-label');

  function updatePlatformCopy() {
    if (heroDownloadLabel) {
      heroDownloadLabel.textContent = getLocalized(currentPlatform.textKey);
    }
    if (detectedLabel) {
      detectedLabel.textContent = getLocalized(currentPlatform.labelKey);
    }
  }

  if (heroDownloadBtn) {
    heroDownloadBtn.href = currentPlatform.url;
  }
  updatePlatformCopy();
  languageListeners.push(updatePlatformCopy);

  if (currentPlatform.cardId) {
    const primaryCard = document.getElementById(currentPlatform.cardId);
    if (primaryCard) {
      primaryCard.classList.add('primary-os');
    }
  }

  // 4. Smooth scrolling for anchor links
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener('click', function (e) {
      const href = this.getAttribute('href');
      if (href === '#' || !href) return;
      let target = null;
      try {
        target = document.querySelector(href);
      } catch (_error) {
        return;
      }
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

})();
