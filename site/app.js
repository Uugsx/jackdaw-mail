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
    "hero.lead": "For every unanswered message, Jackdaw Mail shows how much working time has passed and when the reply is due, and it builds a response-time report for any period. Mail is downloaded straight from your server and stays on your computer.",
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
    "features.mail.text": "Folders, search, quick filters, categories and tags, flags, archive, undo for delete, keyboard shortcuts for categories and a customizable toolbar.",
    "features.calendar.title": "Calendar and contacts",
    "features.calendar.text": "Events, invitations and reminders; personal address books, groups and the organization's global address list.",
    "features.protocols.title": "Protocols",
    "features.protocols.text": "Exchange via OWA, EWS and ActiveSync; IMAP; calendars and contacts via CalDAV and CardDAV. Microsoft Graph and JMAP are experimental.",
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
    "data.storage": "Messages, accounts, calendars and contacts are stored in local SQLite databases in the app's data folder. Nothing sits between the app and your mail server, and reports and deadlines are calculated on your computer.",
    "data.hidden": "The video meeting and chat modules are hidden by default. If you turn them on, they connect to the servers of the service you choose.",
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
    "plans.paymentNote": "Payment is handled by Lemon Squeezy, and the key is sent to the email used for the purchase. Jackdaw Mail never sees your card details. When a subscription ends, your connected accounts stay; only the Pro features switch off.",
    "billing.unavailable": "The purchase link is not configured yet.",
    "billing.storeUnavailable": "The payment store is not connected yet.",
    "billing.checking": "Checking the payment store…",
    "billing.network": "The payment status is temporarily unavailable.",
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
    "faq.a3": "On your computer, in the app's data folder. Passwords and mail are never sent to Jackdaw servers.",
    "faq.q4": "What happens when Pro ends?",
    "faq.a4": "Mail keeps working and your connected accounts stay. You cannot add a new account, and reports, the unanswered queue and HTML signatures switch off until you renew.",
    "faq.q5": "How does the app update?",
    "faq.a5": "The app checks GitHub for new versions and tells you when one is available. On macOS the update downloads automatically, on Windows when you click the button. Installation starts after you confirm, then the app restarts. Your settings and mail are kept.",
    "footer.copyright": "© 2026 Jackdaw Mail",
    "footer.label": "Project links",
    "footer.github": "Source code",
    "footer.releases": "Release history",
    "footer.issue": "Report an issue",
    "footer.license": "License",
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
    billingStates.forEach(({ link, status, state }) => {
      const available = state === 'available';
      const statusKey = state === 'available'
        ? 'billing.available'
        : state === 'checking'
          ? 'billing.checking'
          : state === 'store-unavailable'
            ? 'billing.storeUnavailable'
            : state === 'network-error'
              ? 'billing.network'
              : 'billing.unavailable';
      const titleKey = state === 'available' ? 'billing.availableTitle' : statusKey;
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
    if (available) {
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

  billingCheckoutLinks.forEach((link) => {
    const plan = link.getAttribute('data-billing-plan');
    const checkoutURL = validCheckoutURL(billingCheckout[plan]);
    const status = document.getElementById(`billing-${plan}-status`);
    const state = checkoutURL
      ? (new URL(checkoutURL).hostname.endsWith('.lemonsqueezy.com') ? 'available' : 'checking')
      : 'unavailable';
    const item = { link, status, plan, checkoutURL, state };
    billingStates.push(item);
    linkState(item, state === 'available');
    link.addEventListener('click', (event) => {
      if (item.state !== 'available') event.preventDefault();
    });
  });
  updateBillingCopy();
  void resolveOwnCheckoutAvailability();
  languageListeners.push(updateBillingCopy);

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
