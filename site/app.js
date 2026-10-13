// Jackdaw Mail Landing — Client Interactions

(function () {
  'use strict';

  const EN_TRANSLATIONS = {
    "page.title": "Jackdaw Mail — Mail, Calendar, Contacts and Live SLA Control for Exchange / OWA",
    "page.description": "A fast desktop client for Exchange, OWA, EWS and IMAP with live SLA control, interactive reports, working-calendar support and a local-first architecture.",
    "page.ogTitle": "Jackdaw Mail — Mail, Calendar and Live SLA Control for Exchange / OWA",
    "page.ogDescription": "A fast desktop client for Exchange, OWA, EWS and IMAP with live SLA control, interactive reports and a local-first architecture.",
    "page.twitterTitle": "Jackdaw Mail — Desktop mail client for Exchange and OWA",
    "page.twitterDescription": "Interactive reports, live SLA control, OWA Shared Mailboxes sync and local privacy.",
    "brand.logoAlt": "Jackdaw logo",
    "nav.label": "Main navigation",
    "nav.features": "Features",
    "nav.showcase": "SLA & reports",
    "nav.plans": "Plans",
    "nav.comparison": "Comparison",
    "nav.architecture": "Architecture",
    "nav.downloads": "Downloads",
    "nav.faq": "FAQ",
    "language.label": "Site language",
    "theme.toggle": "Toggle theme",
    "header.githubTitle": "GitHub repository",
    "header.github": "GitHub",
    "header.download": "Download",
    "hero.kicker": "A new level of Exchange & OWA productivity",
    "hero.title": "A desktop client for Exchange and OWA with live SLA control",
    "hero.subtitle": "Fast corporate email, instant Shared Mailboxes sync, interactive response-time reports and a working calendar without cloud intermediaries.",
    "hero.download": "Download Jackdaw Mail",
    "hero.explore": "See how it works",
    "platform.all": "macOS, Windows, Linux",
    "platform.license": "EUPL-1.2 licensed",
    "platform.privacy": "Local-first privacy",
    "spec.privacy.label": "Privacy",
    "spec.privacy.value": "Local-First",
    "spec.privacy.description": "Passwords and conversations stay on your device, without third-party cloud proxies.",
    "spec.sla.label": "SLA control",
    "spec.sla.value": "Working hours",
    "spec.sla.description": "Accurate response-minute calculations that exclude nights and weekends.",
    "spec.integration.label": "Integration",
    "spec.integration.value": "OWA & Shared",
    "spec.integration.description": "Full Shared Mailboxes, categories and notifications synchronization.",
    "spec.performance.label": "Performance",
    "spec.performance.value": "Svelte + Native",
    "spec.performance.description": "Instant UI response, keyboard navigation and low RAM usage.",
    "showcase.tablist": "Interface scenarios",
    "showcase.reports.tab": "Interactive reports",
    "showcase.reports.imageAlt": "Jackdaw Mail activity and SLA reports preview",
    "showcase.reports.title": "Analytics dashboard:",
    "showcase.reports.description": " email volume, hourly load heatmap and average response-time calculation based on the working schedule.",
    "showcase.reports.meta": "Standalone HTML export",
    "showcase.sla.tab": "Live SLA control",
    "showcase.sla.imageAlt": "Live SLA control in the Jackdaw Mail sidebar",
    "showcase.sla.title": "Live queue sidebar:",
    "showcase.sla.description": " personal working-minute timers, deadline indicators and custom reminders.",
    "showcase.sla.meta": "Automatic refresh",
    "showcase.calendar.tab": "Working calendar",
    "showcase.calendar.title": "Individual working-shift schedule",
    "showcase.calendar.description": "Unlike basic mail systems that count astronomical calendar time, Jackdaw Mail knows your team's working hours for every day of the week:",
    "showcase.calendar.weekdays": "Mon – Thu",
    "showcase.calendar.weekdaysHours": "9 working hours",
    "showcase.calendar.friday": "Friday",
    "showcase.calendar.fridayHours": "Short day",
    "showcase.calendar.weekend": "Sat – Sun",
    "showcase.calendar.weekendLabel": "Weekend",
    "showcase.calendar.weekendHours": "Timer paused",
    "showcase.calendar.calloutTitle": "Fair SLA:",
    "showcase.calendar.calloutDescription": " A message received on Friday at 17:50 will not become overdue during Saturday and Sunday. The timer resumes strictly on Monday at 09:00.",
    "showcase.shared.tab": "OWA Shared Mailboxes",
    "showcase.shared.title": "Real OWA Shared Mailboxes",
    "showcase.shared.description": "Work with support, accounting or sales mailboxes without delays or duplicate handling:",
    "showcase.shared.categoriesTitle": "Server-side OWA categories:",
    "showcase.shared.categoriesDescription": " color-category assignments synchronize instantly for every operator.",
    "showcase.shared.deleteTitle": "Safe deletion:",
    "showcase.shared.deleteDescription": " built-in undo and correct movement to the mailbox trash.",
    "showcase.shared.syncTitle": "Background delta sync:",
    "showcase.shared.syncDescription": " only changed message threads, with minimal network traffic.",
    "features.kicker": "Features",
    "features.title": "Built for accountable communication",
    "features.description": "Every tool support specialists, account managers and corporate service teams need.",
    "features.sla.title": "Live SLA queue",
    "features.sla.description": "Visual control of unanswered incoming messages in the sidebar. Deadline and remaining-time indicators.",
    "features.sla.item1": "Individual working-minute target",
    "features.sla.item2": "Reminders before the deadline",
    "features.sla.item3": "Exclude newsletters and CC messages",
    "features.analytics.title": "Interactive analytics",
    "features.analytics.description": "A full built-in dashboard for evaluating team response speed and rhythm without exporting data to third-party services.",
    "features.analytics.item1": "Hourly workload heatmap",
    "features.analytics.item2": "Share of requests handled on time",
    "features.analytics.item3": "Sorting and filtering by category",
    "features.calendar.title": "Working calendar",
    "features.calendar.description": "Precise SLA calculation based only on actual working hours for each day of the week.",
    "features.calendar.item1": "Configure the start and end of each workday",
    "features.calendar.item2": "Exclude non-working hours and weekends",
    "features.calendar.item3": "Fair response-speed metrics",
    "features.sync.title": "OWA & EWS synchronization",
    "features.sync.description": "Native Microsoft Exchange protocol support, from personal profiles to complex corporate Shared Mailboxes.",
    "features.sync.item1": "Instant category and tag changes",
    "features.sync.item2": "Folder tree with delta synchronization",
    "features.sync.item3": "IMAP, JMAP, CalDAV and CardDAV support",
    "features.export.title": "Standalone HTML export",
    "features.export.description": "Save detailed reports as self-contained HTML files for managers or clients.",
    "features.export.item1": "All charts and tables embedded in one file",
    "features.export.item2": "Opens offline in any browser",
    "features.export.item3": "No external links or data leaks",
    "features.privacy.title": "Local-First security",
    "features.privacy.description": "Direct connection to your mail server. No message or password passes through the Jackdaw cloud.",
    "features.privacy.item1": "Open source (EUPL-1.2)",
    "features.privacy.item2": "Local SQLite database",
    "features.privacy.item3": "Designed for 152-FZ and GDPR requirements",
    "plans.kicker": "Jackdaw Pro",
    "plans.title": "See the response deadline before it becomes a problem",
    "plans.description": "Core email remains free. Pro adds a working calendar, live SLA queue, reminders and reports for teams where response time must be measurable.",
    "plans.free.label": "Free",
    "plans.free.title": "Jackdaw Mail",
    "plans.free.description": "A complete local-first mail client for everyday work.",
    "plans.free.item1": "Mail, calendar and contacts",
    "plans.free.item2": "Exchange / OWA, IMAP and JMAP",
    "plans.free.item3": "Local cache and direct connection",
    "plans.free.action": "Download client",
    "plans.pro.label": "Pro",
    "plans.monthly.title": "Monthly",
    "plans.monthly.tag": "Flexible",
    "plans.price": "Price shown at checkout",
    "plans.monthly.description": "Monthly billing with automatic renewal and subscription management.",
    "plans.monthly.item1": "Interactive reports and HTML export",
    "plans.monthly.item2": "Live SLA queue in the sidebar",
    "plans.monthly.item3": "Working calendar and reminders",
    "plans.yearly.title": "Yearly",
    "plans.yearly.tag": "Best value",
    "plans.yearly.description": "One annual payment for a team already working to SLA.",
    "plans.yearly.item1": "Everything in Jackdaw Pro",
    "plans.yearly.item2": "Renewal terms shown before payment",
    "plans.yearly.item3": "License and subscription tied to the purchase",
    "plans.checkout": "Open checkout",
    "plans.paymentNote": "Payment is handled by Lemon Squeezy. Depending on country and device, checkout shows available methods including Visa, Mastercard, PayPal and Apple Pay. Jackdaw Mail never receives your card details.",
    "billing.unavailable": "Checkout will be available after the store is activated.",
    "comparison.kicker": "Solution comparison",
    "comparison.title": "A straightforward capability comparison",
    "comparison.description": "Why teams working to SLA standards and corporate procedures choose Jackdaw Mail.",
    "comparison.header.feature": "Capability",
    "comparison.header.jackdaw": "Jackdaw Mail",
    "comparison.header.outlook": "Classic Outlook",
    "comparison.header.owa": "OWA web client",
    "comparison.row1.feature": "Live SLA timer in working minutes",
    "comparison.row1.jackdaw": "✓ Built into the sidebar",
    "comparison.row1.outlook": "✕ Missing",
    "comparison.row1.owa": "✕ Missing",
    "comparison.row2.feature": "SLA calculation based on the working schedule",
    "comparison.row2.jackdaw": "✓ Automatic",
    "comparison.row2.outlook": "✕ No",
    "comparison.row2.owa": "✕ No",
    "comparison.row3.feature": "Interactive dashboard and heatmap",
    "comparison.row3.jackdaw": "✓ Built in",
    "comparison.row3.outlook": "✕ Requires add-ons",
    "comparison.row3.owa": "✕ No",
    "comparison.row4.feature": "OWA Shared Mailboxes synchronization",
    "comparison.row4.jackdaw": "✓ Native, with categories",
    "comparison.row4.outlook": "Partial (can be delayed)",
    "comparison.row4.owa": "✓ Native",
    "comparison.row5.feature": "Standalone HTML report export",
    "comparison.row5.jackdaw": "✓ One click",
    "comparison.row5.outlook": "✕ No",
    "comparison.row5.owa": "✕ No",
    "comparison.row6.feature": "Data storage architecture",
    "comparison.row6.jackdaw": "Local-First (on device)",
    "comparison.row6.outlook": "Local-First",
    "comparison.row6.owa": "Cloud only",
    "comparison.row7.feature": "License and source availability",
    "comparison.row7.jackdaw": "EUPL-1.2 Open Source",
    "comparison.row7.outlook": "Proprietary",
    "comparison.row7.owa": "Proprietary",
    "architecture.kicker": "Architecture & security",
    "architecture.title": "No cloud intermediaries",
    "architecture.description": "Unlike modern “smart” mail clients, we do not read your messages on third-party servers.",
    "architecture.cardTitle": "Direct protected path",
    "architecture.cardDescription": "Jackdaw Mail connects directly to your corporate Microsoft Exchange (OWA/EWS), IMAP or CalDAV server.",
    "architecture.cardDetails": "All SLA calculations, message-header parsing, chart generation and category storage happen exclusively on your computer in a lightweight embedded database.",
    "architecture.flow.computer": "[Your computer]",
    "architecture.flow.client": "Jackdaw Mail Client",
    "architecture.flow.channel": "Direct TLS/HTTPS channel",
    "architecture.flow.exchange": "[Corporate Exchange / OWA]",
    "architecture.flow.database": "Local SQLite database",
    "architecture.flow.cache": "(encrypted on-disk cache)",
    "architecture.flow.noGateways": "✕ No third-party API gateways",
    "architecture.flow.noAccess": "✕ No access to message contents",
    "architecture.flow.private": "✓ Fully autonomous and private",
    "downloads.kicker": "Downloads",
    "downloads.title": "Install Jackdaw Mail",
    "downloads.description": "Available for macOS, Windows and Linux. Free core features and transparent Pro licensing.",
    "downloads.macos.badge": "Recommended",
    "downloads.macos.platform": "Apple Silicon & Intel",
    "downloads.macos.description": "macOS 12 Monterey and later. A ready-to-install `.dmg` with automatic OTA updates.",
    "downloads.macos.action": "Download DMG",
    "downloads.windows.badge": "x64",
    "downloads.windows.platform": "Windows 10 / 11",
    "downloads.windows.description": "A standard `.exe` installer with background update support.",
    "downloads.windows.action": "Download EXE",
    "downloads.linux.badge": "Universal",
    "downloads.linux.platform": "AppImage / DEB",
    "downloads.linux.description": "Suitable for most distributions (Ubuntu, Debian, Fedora, Arch).",
    "downloads.linux.action": "Download packages",
    "faq.kicker": "Questions & answers",
    "faq.title": "Frequently asked questions",
    "faq.q1": "How is the SLA target and first-response time calculated?",
    "faq.a1": "The timer starts when an incoming message arrives and stops at the first confirmed employee response found on the server or in the linked conversation. Only minutes from the configured working calendar count: off-hours, breaks and weekends do not increase response time.",
    "faq.q2": "Are corporate Shared Mailboxes supported?",
    "faq.a2": "Yes. OWA Shared Mailboxes are one of Jackdaw Mail's core features. The app synchronizes shared-mailbox folders, server-side categories and notifications as quickly and natively as personal mail.",
    "faq.q3": "Where are my passwords and conversations stored?",
    "faq.a3": "Only on your local computer. Passwords are stored in the operating system's secure storage (Keychain on macOS, Credential Manager on Windows), while the mail cache stays in a local database. Data is never sent to third-party servers.",
    "faq.q4": "What is included in the free version and what is in Pro?",
    "faq.a4": "The free version includes the full mail client, calendar, address book and OWA support. Jackdaw Mail Pro adds interactive SLA reports, a live sidebar control queue, flexible weekday working hours and standalone HTML report export.",
    "faq.q5": "How does automatic updating (OTA) work?",
    "faq.a5": "Jackdaw Mail checks GitHub Releases for new versions. When an update is available, the app downloads it in the background and offers a one-click update while keeping your settings.",
    "footer.description": "A specialized desktop client for Exchange, OWA and EWS with live SLA control and local privacy.",
    "footer.product": "Product",
    "footer.releases": "Release history",
    "footer.development": "Development",
    "footer.github": "GitHub repository",
    "footer.issue": "Report an issue",
    "footer.license": "EUPL-1.2 license",
    "footer.author": "Author @Uugsx",
    "footer.copyright": "© 2026 Jackdaw Mail. Open source under the EUPL-1.2 license."
  };

  const RU_DYNAMIC_TRANSLATIONS = {
    "theme.light": "Включить светлую тему",
    "theme.dark": "Включить тёмную тему",
    "billing.unavailable": "Checkout будет доступен после активации магазина.",
    "billing.available": "Откроется защищённая страница Lemon Squeezy.",
    "billing.unavailableTitle": "Checkout будет доступен после активации магазина.",
    "billing.availableTitle": "Откроется защищённая страница Lemon Squeezy.",
    "downloads.hero.mac": "Скачать для macOS",
    "downloads.hero.windows": "Скачать для Windows",
    "downloads.hero.linux": "Скачать для Linux",
    "downloads.hero.other": "Перейти к загрузкам",
    "platform.mac": "macOS 12+ (Apple Silicon и Intel DMG)",
    "platform.windows": "Windows 10 / 11 (64-bit EXE)",
    "platform.linux": "Linux (AppImage / DEB)",
    "platform.other": "macOS, Windows, Linux"
  };

  const EN_DYNAMIC_TRANSLATIONS = {
    "theme.light": "Switch to light theme",
    "theme.dark": "Switch to dark theme",
    "billing.available": "A secure Lemon Squeezy checkout will open.",
    "billing.unavailableTitle": "Checkout will be available after the store is activated.",
    "billing.availableTitle": "A secure Lemon Squeezy checkout will open.",
    "downloads.hero.mac": "Download for macOS",
    "downloads.hero.windows": "Download for Windows",
    "downloads.hero.linux": "Download for Linux",
    "downloads.hero.other": "Go to downloads",
    "platform.mac": "macOS 12+ (Apple Silicon & Intel DMG)",
    "platform.windows": "Windows 10 / 11 (64-bit EXE)",
    "platform.linux": "Linux (AppImage / DEB)",
    "platform.other": "macOS, Windows, Linux"
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
    return localStorage.getItem('jackdaw-theme') || (prefersDark.matches ? 'dark' : 'light');
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('jackdaw-theme', theme);
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
    if (!localStorage.getItem('jackdaw-theme')) {
      applyTheme(e.matches ? 'dark' : 'light');
    }
  });

  const billingCheckoutLinks = document.querySelectorAll('[data-billing-plan]');
  const billingCheckout = window.JACKDAW_BILLING_CONFIG
    && window.JACKDAW_BILLING_CONFIG.checkout
    ? window.JACKDAW_BILLING_CONFIG.checkout
    : {};
  const billingStates = [];

  function validCheckoutURL(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:') return null;
      if (!url.hostname.endsWith('.lemonsqueezy.com')) return null;
      if (!/^\/checkout\/buy\/[^/]+\/?$/.test(url.pathname)) return null;
      return url.toString();
    } catch (_error) {
      return null;
    }
  }

  function updateBillingCopy() {
    billingStates.forEach(({ link, status, available }) => {
      link.setAttribute('title', getLocalized(available ? 'billing.availableTitle' : 'billing.unavailableTitle'));
      if (status) {
        status.textContent = getLocalized(available ? 'billing.available' : 'billing.unavailable');
      }
    });
  }

  billingCheckoutLinks.forEach((link) => {
    const plan = link.getAttribute('data-billing-plan');
    const checkoutURL = validCheckoutURL(billingCheckout[plan]);
    const status = document.getElementById(`billing-${plan}-status`);
    billingStates.push({ link, status, available: Boolean(checkoutURL) });

    if (!checkoutURL) {
      link.classList.add('is-unavailable');
      link.setAttribute('aria-disabled', 'true');
      link.setAttribute('tabindex', '-1');
      link.addEventListener('click', (event) => {
        event.preventDefault();
      });
      return;
    }

    link.setAttribute('href', checkoutURL);
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
  });
  updateBillingCopy();
  languageListeners.push(updateBillingCopy);

  // 2. Showcase Tab Switcher
  const tabs = document.querySelectorAll('.showcase-tab');
  const panels = document.querySelectorAll('.showcase-panel');

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const targetId = tab.getAttribute('data-target');

      tabs.forEach((t) => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      panels.forEach((p) => {
        p.classList.remove('active');
      });

      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      const targetPanel = document.getElementById(targetId);
      if (targetPanel) {
        targetPanel.classList.add('active');
      }
    });
  });

  // 3. Platform Detection for Download Buttons
  function detectOS() {
    const userAgent = window.navigator.userAgent.toLowerCase();
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
      url: 'https://github.com/Uugsx/jackdaw-mail/releases/latest',
      textKey: 'downloads.hero.mac',
      labelKey: 'platform.mac',
      cardId: 'card-macos'
    },
    windows: {
      url: 'https://github.com/Uugsx/jackdaw-mail/releases/latest',
      textKey: 'downloads.hero.windows',
      labelKey: 'platform.windows',
      cardId: 'card-windows'
    },
    linux: {
      url: 'https://github.com/Uugsx/jackdaw-mail/releases/latest',
      textKey: 'downloads.hero.linux',
      labelKey: 'platform.linux',
      cardId: 'card-linux'
    },
    other: {
      url: 'https://github.com/Uugsx/jackdaw-mail/releases/latest',
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
      const target = document.querySelector(href);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

})();
