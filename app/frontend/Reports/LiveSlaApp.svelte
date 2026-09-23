<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import ChartIcon from "lucide-svelte/icons/chart-column";
  import ClockIcon from "lucide-svelte/icons/clock-3";
  import MailIcon from "lucide-svelte/icons/mail";
  import RefreshIcon from "lucide-svelte/icons/refresh-cw";
  import SettingsIcon from "lucide-svelte/icons/settings";
  import { t, getDateTimeLocale } from "../../l10n/l10n";
  import { appGlobal } from "../../logic/app";
  import {
    DEFAULT_RESPONSE_TARGET_MINUTES,
    MAX_RESPONSE_TARGET_MINUTES,
    MIN_RESPONSE_TARGET_MINUTES,
    loadReportMailAccounts,
    loadReportMailFolders,
    normalizeResponseTargetMinutes,
    type ReportMailAccountOption,
    type ReportMailFolderOption,
  } from "../../logic/Reports/ReportsData";
  import {
    defaultResponderCategoryNames,
    normalizeResponderAttributionConfig,
    type ResponderAttributionConfig,
    type ResponderAttributionMode,
  } from "../../logic/Reports/ReportsPresentation";
  import {
    DEFAULT_RESPONSE_REMINDER_INTERVALS_MINUTES,
    DEFAULT_RESPONSE_REMINDER_NEW_INTERVAL_MINUTES,
    MAX_RESPONSE_REMINDER_INTERVAL_MINUTES,
    MIN_RESPONSE_REMINDER_INTERVAL_MINUTES,
    normalizeResponseReminderConfig,
  } from "../../logic/Reports/ResponseReminder";
  import { loadResponseTrackingCategoryNames } from "../../logic/Reports/ResponseReminderData";
  import {
    getResponseReminderConfig,
    setResponseReminderConfig,
  } from "./ResponseReminderSettings";
  import {
    DEFAULT_WORKING_HOURS_SCHEDULE,
    formatWorkingTime,
    type WorkingHoursSchedule,
  } from "../../logic/Reports/WorkingHours";
  import { getWorkingHoursSchedule } from "./WorkingHoursSettings";
  import { getLocalStorage } from "../Util/LocalStorage";
  import { CollectionObserver } from "svelte-collections";
  import type { MailAccount } from "../../logic/Mail/MailAccount";
  import { openApp } from "../AppsBar/selectedApp";
  import { reportsApp } from "./ReportsJackdawApp";
  import { getReportSession } from "./ReportSession";
  import LiveResponseControl from "./LiveResponseControl.svelte";
  import ResponseEventNotificationSettings from "./ResponseEventNotificationSettings.svelte";

  export let embedded = false;

  const REPORT_MAIL_ACCOUNTS_RETRY_DELAY_MS = 250;
  const REPORT_MAIL_ACCOUNTS_MAX_EMPTY_RETRIES = 20;
  const liveAccountSetting = getLocalStorage<number | null>(
    "reports.live-sla.account.v1",
    null,
  );
  const liveFolderSetting = getLocalStorage<unknown>(
    "reports.live-sla.folders.v1",
    {},
  );
  const liveTargetSetting = getLocalStorage<unknown>(
    "reports.live-sla.target.v1",
    {},
  );
  const responderAttributionSetting = getLocalStorage<unknown>(
    "reports.responder-attribution.v1",
    {},
  );

  let mailAccounts: ReportMailAccountOption[] = [];
  let mailAccountsLoading = false;
  let mailAccountsError: Error | null = null;
  let mailAccountsRequestId = 0;
  let mailAccountsReloadTimer: ReturnType<typeof setTimeout> | null = null;
  let mailAccountsEmptyRetryCount = 0;
  let mailFolders: ReportMailFolderOption[] = [];
  let mailFoldersLoading = false;
  let mailFoldersError: Error | null = null;
  let mailFoldersRequestId = 0;
  let categoryNames: string[] = [];
  let categoryNamesLoading = false;
  let categoryNamesError: Error | null = null;
  let categoryNamesRequestId = 0;
  let selectedMailAccountId: number | null = null;
  let selectedMailFolderId: number | null = null;
  let responseTargetMinutes = DEFAULT_RESPONSE_TARGET_MINUTES;
  let responseTargetError = false;
  let workingHours: WorkingHoursSchedule = cloneDefaultWorkingHours();
  let responderAttributionMode: ResponderAttributionMode = "profile";
  let selectedResponderCategoryNames: string[] = [];
  let excludedResponseCategoryNames: string[] = [];
  let includeUncategorizedResponses = false;
  let responseRemindersEnabled = false;
  let responseReminderIntervals = [
    ...DEFAULT_RESPONSE_REMINDER_INTERVALS_MINUTES,
  ];
  let newResponseReminderMinutes =
    DEFAULT_RESPONSE_REMINDER_NEW_INTERVAL_MINUTES;
  let responseReminderError: "invalid" | "duplicate" | null = null;
  let notifyWhenOverdue = false;
  let notifyWhenTakenInWork = false;
  let mounted = false;
  let scopeRequestId = 0;
  let liveSettingsOpen = false;
  let liveSettingsElement: HTMLDetailsElement | null = null;

  $: selectedMailAccount =
    mailAccounts.find(
      (account) => account.accountId == selectedMailAccountId,
    ) ?? null;
  $: selectedMailFolder =
    mailFolders.find((folder) => folder.folderId == selectedMailFolderId) ??
    null;
  $: scheduleSummary = formatScheduleSummary(workingHours);
  $: responderSummary =
    responderAttributionMode == "category"
      ? selectedResponderCategoryNames.length
        ? selectedResponderCategoryNames.join(", ")
        : $t`No employee category data for this period.`
      : $t`Mail profile`;
  $: responderCategoryOptions = [
    ...new Set([
      ...defaultResponderCategoryNames(categoryNames.map((name) => ({ name }))),
      ...selectedResponderCategoryNames.filter((name) =>
        categoryNames.includes(name),
      ),
    ]),
  ];
  $: liveSettingsLoading = mailFoldersLoading || categoryNamesLoading;

  class LiveSlaMailAccountsObserver extends CollectionObserver<MailAccount> {
    added(): void {
      scheduleMailAccountsReload();
    }

    removed(): void {
      scheduleMailAccountsReload();
    }
  }

  const liveSlaMailAccountsObserver = new LiveSlaMailAccountsObserver();

  // Прямой вызов onMount в production-сборке может быть удалён Rollup как
  // чистый. Косвенная регистрация сохраняет инициализацию этого экрана.
  const registerLiveSlaOnMount = onMount;
  registerLiveSlaOnMount(initializeLiveSla);

  const registerLiveSlaOnDestroy = onDestroy;
  registerLiveSlaOnDestroy(() => {
    mounted = false;
    appGlobal.emailAccounts.unregisterObserver(liveSlaMailAccountsObserver);
    if (mailAccountsReloadTimer != null) {
      clearTimeout(mailAccountsReloadTimer);
      mailAccountsReloadTimer = null;
    }
  });

  async function initializeLiveSla(): Promise<void> {
    mounted = true;
    appGlobal.emailAccounts.registerObserver(liveSlaMailAccountsObserver);
    const session = getReportSession();
    responseTargetMinutes = normalizeResponseTargetMinutes(
      session?.responseTargetMinutes,
    );
    await loadMailAccounts();
    if (!mailAccounts.length || selectedMailAccountId != null) {
      return;
    }
    const storedAccountId = positiveId(liveAccountSetting.value);
    const accountId = mailAccounts.some(
      (account) => account.accountId == storedAccountId,
    )
      ? storedAccountId
      : mailAccounts[0].accountId;
    await selectMailAccount(accountId);
  }

  async function loadMailAccounts(): Promise<void> {
    const requestId = ++mailAccountsRequestId;
    mailAccountsLoading = true;
    mailAccountsError = null;
    try {
      const accounts = await loadReportMailAccounts();
      if (requestId != mailAccountsRequestId) {
        return;
      }
      mailAccounts = accounts;
      if (accounts.length > 0) {
        mailAccountsEmptyRetryCount = 0;
        if (
          selectedMailAccountId == null ||
          !accounts.some(
            (account) => account.accountId == selectedMailAccountId,
          )
        ) {
          const storedAccountId = positiveId(liveAccountSetting.value);
          const accountId = accounts.some(
            (account) => account.accountId == storedAccountId,
          )
            ? storedAccountId
            : accounts[0].accountId;
          void selectMailAccount(accountId);
        }
      } else if (
        mounted &&
        mailAccountsEmptyRetryCount < REPORT_MAIL_ACCOUNTS_MAX_EMPTY_RETRIES
      ) {
        mailAccountsEmptyRetryCount += 1;
        scheduleMailAccountsReload(REPORT_MAIL_ACCOUNTS_RETRY_DELAY_MS);
      }
    } catch (ex) {
      if (requestId == mailAccountsRequestId) {
        mailAccountsError = ex instanceof Error ? ex : new Error(String(ex));
      }
    } finally {
      if (requestId == mailAccountsRequestId) {
        mailAccountsLoading = false;
      }
    }
  }

  function scheduleMailAccountsReload(delayMs = 0): void {
    if (!mounted || mailAccountsReloadTimer != null) {
      return;
    }
    mailAccountsReloadTimer = setTimeout(() => {
      mailAccountsReloadTimer = null;
      void loadMailAccounts();
    }, delayMs);
  }

  async function selectMailAccount(accountId: number | null): Promise<void> {
    const requestId = ++scopeRequestId;
    liveSettingsOpen = false;
    selectedMailAccountId = accountId;
    selectedMailFolderId = null;
    mailFolders = [];
    mailFoldersError = null;
    categoryNames = [];
    categoryNamesError = null;
    if (accountId == null) {
      liveAccountSetting.value = null;
      responseTargetMinutes = DEFAULT_RESPONSE_TARGET_MINUTES;
      responseTargetError = false;
      workingHours = cloneDefaultWorkingHours();
      responderAttributionMode = "profile";
      selectedResponderCategoryNames = [];
      excludedResponseCategoryNames = [];
      includeUncategorizedResponses = false;
      responseRemindersEnabled = false;
      responseReminderIntervals = [
        ...DEFAULT_RESPONSE_REMINDER_INTERVALS_MINUTES,
      ];
      newResponseReminderMinutes =
        DEFAULT_RESPONSE_REMINDER_NEW_INTERVAL_MINUTES;
      responseReminderError = null;
      notifyWhenOverdue = false;
      notifyWhenTakenInWork = false;
      return;
    }

    liveAccountSetting.value = accountId;
    const sessionTargetMinutes = normalizeResponseTargetMinutes(
      getReportSession()?.responseTargetMinutes,
    );
    responseTargetMinutes =
      readStoredTargetMinutes(accountId) ?? sessionTargetMinutes;
    responseTargetError = false;
    workingHours = getWorkingHoursSchedule(accountId);
    const reminderConfig = getResponseReminderConfig(accountId);
    responseRemindersEnabled = reminderConfig.enabled;
    responseReminderIntervals = [...reminderConfig.intervalsMinutes];
    newResponseReminderMinutes = DEFAULT_RESPONSE_REMINDER_NEW_INTERVAL_MINUTES;
    responseReminderError = null;
    excludedResponseCategoryNames = [...reminderConfig.excludedCategoryNames];
    includeUncategorizedResponses = reminderConfig.includeUncategorized;
    notifyWhenOverdue = reminderConfig.notifyWhenOverdue;
    notifyWhenTakenInWork = reminderConfig.notifyWhenTakenInWork;

    const [folders, names] = await Promise.all([
      loadFolders(accountId),
      loadCategoryNames(accountId),
    ]);
    if (requestId != scopeRequestId) {
      return;
    }
    mailFolders = folders;
    categoryNames = names;
    const storedFolderId = readStoredFolderId(accountId);
    selectedMailFolderId = folders.some(
      (folder) => folder.folderId == storedFolderId,
    )
      ? storedFolderId
      : (findInboxFolder(folders)?.folderId ?? null);
    saveStoredFolderId(accountId, selectedMailFolderId);
    syncResponderAttribution(accountId, names);
  }

  async function loadFolders(
    accountId: number,
  ): Promise<ReportMailFolderOption[]> {
    const requestId = ++mailFoldersRequestId;
    mailFoldersLoading = true;
    mailFoldersError = null;
    try {
      const folders = await loadReportMailFolders(accountId);
      if (requestId != mailFoldersRequestId) {
        return [];
      }
      return folders;
    } catch (ex) {
      if (requestId == mailFoldersRequestId) {
        mailFoldersError = ex instanceof Error ? ex : new Error(String(ex));
      }
      return [];
    } finally {
      if (requestId == mailFoldersRequestId) {
        mailFoldersLoading = false;
      }
    }
  }

  async function loadCategoryNames(accountId: number): Promise<string[]> {
    const requestId = ++categoryNamesRequestId;
    categoryNamesLoading = true;
    categoryNamesError = null;
    try {
      const names = await loadResponseTrackingCategoryNames(accountId);
      if (requestId != categoryNamesRequestId) {
        return [];
      }
      return names;
    } catch (ex) {
      if (requestId == categoryNamesRequestId) {
        categoryNamesError = ex instanceof Error ? ex : new Error(String(ex));
      }
      return [];
    } finally {
      if (requestId == categoryNamesRequestId) {
        categoryNamesLoading = false;
      }
    }
  }

  function onAccountChange(event: Event): void {
    const value = Number((event.currentTarget as HTMLSelectElement).value);
    void selectMailAccount(Number.isInteger(value) && value > 0 ? value : null);
  }

  function onFolderChange(event: Event): void {
    const value = Number((event.currentTarget as HTMLSelectElement).value);
    selectedMailFolderId = Number.isInteger(value) && value > 0 ? value : null;
    if (selectedMailAccountId != null) {
      saveStoredFolderId(selectedMailAccountId, selectedMailFolderId);
    }
  }

  function onResponseTargetChange(event: Event): void {
    const value = Number((event.currentTarget as HTMLInputElement).value);
    if (
      !Number.isInteger(value) ||
      value < MIN_RESPONSE_TARGET_MINUTES ||
      value > MAX_RESPONSE_TARGET_MINUTES
    ) {
      responseTargetError = true;
      (event.currentTarget as HTMLInputElement).value = String(
        responseTargetMinutes,
      );
      return;
    }
    responseTargetError = false;
    responseTargetMinutes = value;
    if (selectedMailAccountId != null) {
      saveStoredTargetMinutes(selectedMailAccountId, value);
    }
  }

  function syncResponderAttribution(accountId: number, names: string[]): void {
    const fallbackNames = defaultResponderCategoryNames(
      names.map((name) => ({ name })),
    );
    const fallback: ResponderAttributionConfig = {
      mode: fallbackNames.length ? "category" : "profile",
      categoryNames: fallbackNames,
    };
    const configs = readResponderAttributionConfigs();
    const config = normalizeResponderAttributionConfig(
      configs[String(accountId)],
      fallback,
    );
    responderAttributionMode = config.mode;
    const available = new Set(names);
    selectedResponderCategoryNames = config.categoryNames.filter((name) =>
      available.has(name),
    );
  }

  function readResponderAttributionConfigs(): Record<
    string,
    ResponderAttributionConfig
  > {
    const value = responderAttributionSetting.value;
    if (!value || typeof value != "object" || Array.isArray(value)) {
      return {};
    }
    const result: Record<string, ResponderAttributionConfig> = {};
    for (const [accountId, config] of Object.entries(value)) {
      result[accountId] = normalizeResponderAttributionConfig(config, {
        mode: "profile",
        categoryNames: [],
      });
    }
    return result;
  }

  function saveResponderAttribution(): void {
    if (selectedMailAccountId == null) {
      return;
    }
    const configs = readResponderAttributionConfigs();
    const next = {
      ...configs,
      [String(selectedMailAccountId)]: {
        mode: responderAttributionMode,
        categoryNames: [...selectedResponderCategoryNames],
      },
    };
    responderAttributionSetting.value = next;
  }

  function onResponderModeChange(event: Event): void {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (value != "profile" && value != "category") {
      return;
    }
    responderAttributionMode = value;
    if (value == "category" && selectedResponderCategoryNames.length == 0) {
      selectedResponderCategoryNames = responderCategoryOptions.slice();
    }
    saveResponderAttribution();
  }

  function onResponderCategoryChange(name: string, checked: boolean): void {
    const selected = new Set(selectedResponderCategoryNames);
    if (checked) {
      selected.add(name);
    } else {
      selected.delete(name);
    }
    selectedResponderCategoryNames = [...selected];
    responderAttributionMode = "category";
    saveResponderAttribution();
  }

  function selectAllResponderCategories(): void {
    selectedResponderCategoryNames = responderCategoryOptions.slice();
    responderAttributionMode = "category";
    saveResponderAttribution();
  }

  function clearResponderCategories(): void {
    selectedResponderCategoryNames = [];
    responderAttributionMode = "category";
    saveResponderAttribution();
  }

  function saveResponseReminderConfig(): void {
    if (selectedMailAccountId == null) {
      return;
    }
    const config = normalizeResponseReminderConfig({
      enabled: responseRemindersEnabled,
      intervalsMinutes: responseReminderIntervals,
      excludedCategoryNames: excludedResponseCategoryNames,
      includeUncategorized: includeUncategorizedResponses,
      notifyWhenOverdue,
      notifyWhenTakenInWork,
    });
    responseRemindersEnabled = config.enabled;
    responseReminderIntervals = [...config.intervalsMinutes];
    excludedResponseCategoryNames = [...config.excludedCategoryNames];
    includeUncategorizedResponses = config.includeUncategorized;
    notifyWhenOverdue = config.notifyWhenOverdue;
    notifyWhenTakenInWork = config.notifyWhenTakenInWork;
    setResponseReminderConfig(selectedMailAccountId, config);
    // Watcher уведомлений использует тот же выбор отвечающего, что и очередь.
    saveResponderAttribution();
  }

  function onResponseReminderEnabledChange(event: Event): void {
    responseRemindersEnabled = (event.currentTarget as HTMLInputElement)
      .checked;
    responseReminderError = null;
    saveResponseReminderConfig();
  }

  function onResponseReminderIntervalChange(index: number, event: Event): void {
    const value = Number((event.currentTarget as HTMLInputElement).value);
    if (!isValidResponseReminderInterval(value)) {
      responseReminderError = "invalid";
      return;
    }
    if (
      responseReminderIntervals.some(
        (interval, intervalIndex) =>
          intervalIndex != index && interval == value,
      )
    ) {
      responseReminderError = "duplicate";
      return;
    }
    responseReminderIntervals = [...responseReminderIntervals]
      .map((interval, intervalIndex) =>
        intervalIndex == index ? value : interval,
      )
      .sort((a, b) => a - b);
    responseReminderError = null;
    saveResponseReminderConfig();
  }

  function addResponseReminderInterval(): void {
    if (!isValidResponseReminderInterval(newResponseReminderMinutes)) {
      responseReminderError = "invalid";
      return;
    }
    if (responseReminderIntervals.includes(newResponseReminderMinutes)) {
      responseReminderError = "duplicate";
      return;
    }
    responseReminderIntervals = [
      ...responseReminderIntervals,
      newResponseReminderMinutes,
    ].sort((a, b) => a - b);
    newResponseReminderMinutes = DEFAULT_RESPONSE_REMINDER_NEW_INTERVAL_MINUTES;
    responseReminderError = null;
    saveResponseReminderConfig();
  }

  function removeResponseReminderInterval(index: number): void {
    if (responseReminderIntervals.length <= 1) {
      return;
    }
    responseReminderIntervals = responseReminderIntervals.filter(
      (_interval, intervalIndex) => intervalIndex != index,
    );
    responseReminderError = null;
    saveResponseReminderConfig();
  }

  function isValidResponseReminderInterval(value: number): boolean {
    return (
      Number.isInteger(value) &&
      value >= MIN_RESPONSE_REMINDER_INTERVAL_MINUTES &&
      value <= MAX_RESPONSE_REMINDER_INTERVAL_MINUTES
    );
  }

  function onIncludeUncategorizedChange(event: Event): void {
    includeUncategorizedResponses = (event.currentTarget as HTMLInputElement)
      .checked;
    saveResponseReminderConfig();
  }

  function onExcludedResponseCategoryChange(name: string, event: Event): void {
    const selected = new Set(excludedResponseCategoryNames);
    if ((event.currentTarget as HTMLInputElement).checked) {
      selected.add(name);
    } else {
      selected.delete(name);
    }
    excludedResponseCategoryNames = [...selected].sort((a, b) =>
      a.localeCompare(b),
    );
    saveResponseReminderConfig();
  }

  function openReportsSettings(): void {
    openApp(reportsApp, {});
  }

  async function openLiveSettings(): Promise<void> {
    liveSettingsOpen = true;
    await tick();
    liveSettingsElement?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function onLiveSettingsToggle(event: Event): void {
    liveSettingsOpen = (event.currentTarget as HTMLDetailsElement).open;
  }

  function findInboxFolder(
    folders: ReportMailFolderOption[],
  ): ReportMailFolderOption | null {
    return (
      folders.find(
        (folder) =>
          folder.specialUse?.toLowerCase() == "inbox" ||
          folder.path.toUpperCase() == "INBOX" ||
          folder.name.toLowerCase() == "входящие" ||
          folder.name.toLowerCase() == "inbox",
      ) ?? null
    );
  }

  function readStoredFolderId(accountId: number): number | null {
    const value = liveFolderSetting.value;
    if (!value || typeof value != "object" || Array.isArray(value)) {
      return null;
    }
    const stored = (value as Record<string, unknown>)[String(accountId)];
    return positiveId(stored);
  }

  function saveStoredFolderId(
    accountId: number,
    folderId: number | null,
  ): void {
    const value = liveFolderSetting.value;
    const folders =
      value && typeof value == "object" && !Array.isArray(value)
        ? { ...(value as Record<string, unknown>) }
        : {};
    folders[String(accountId)] = folderId;
    liveFolderSetting.value = folders;
  }

  function readStoredTargetMinutes(accountId: number): number | null {
    const value = liveTargetSetting.value;
    if (!value || typeof value != "object" || Array.isArray(value)) {
      return null;
    }
    const stored = Number(
      (value as Record<string, unknown>)[String(accountId)],
    );
    return Number.isInteger(stored) &&
      stored >= MIN_RESPONSE_TARGET_MINUTES &&
      stored <= MAX_RESPONSE_TARGET_MINUTES
      ? stored
      : null;
  }

  function saveStoredTargetMinutes(
    accountId: number,
    targetMinutes: number,
  ): void {
    const value = liveTargetSetting.value;
    const targets =
      value && typeof value == "object" && !Array.isArray(value)
        ? { ...(value as Record<string, unknown>) }
        : {};
    targets[String(accountId)] = targetMinutes;
    liveTargetSetting.value = targets;
  }

  function positiveId(value: unknown): number | null {
    const result = Number(value);
    return Number.isInteger(result) && result > 0 ? result : null;
  }

  function cloneDefaultWorkingHours(): WorkingHoursSchedule {
    return {
      days: DEFAULT_WORKING_HOURS_SCHEDULE.days.map((day) => ({ ...day })),
    };
  }

  function formatScheduleSummary(schedule: WorkingHoursSchedule): string {
    const weekdayNames = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(2024, 0, index + 1);
      return date.toLocaleDateString(getDateTimeLocale(), { weekday: "short" });
    });
    const enabledDays = schedule.days
      .map((day, index) =>
        day.enabled
          ? `${weekdayNames[index]} ${formatWorkingTime(day.startMinutes)}–${formatWorkingTime(day.endMinutes)}`
          : null,
      )
      .filter((day): day is string => day != null);
    return enabledDays.length ? enabledDays.join(" · ") : $t`No working days`;
  }
</script>

<svelte:head>
  <title>{$t`Live response control`} — Jackdaw Mail</title>
</svelte:head>

<main class="live-page" class:embedded>
  {#if !embedded}
    <header class="live-page-header">
      <div>
        <p class="live-page-kicker">{$t`LIVE SLA`}</p>
        <h1>{$t`Live response control`}</h1>
        <p class="live-page-lead">
          {$t`An operational queue of incoming messages that are waiting for a reply. The timer counts only working minutes according to the selected mailbox schedule.`}
        </p>
      </div>
      <div class="live-page-actions">
        <button
          type="button"
          class="secondary-button"
          on:click={openReportsSettings}
        >
          <ChartIcon size="15px" />
          <span>{$t`Reports`}</span>
        </button>
        <button
          type="button"
          class="refresh-button"
          disabled={mailAccountsLoading || mailFoldersLoading}
          on:click={() => void loadMailAccounts()}
        >
          <RefreshIcon size="15px" />
          <span>{$t`Refresh`}</span>
        </button>
      </div>
    </header>
  {/if}

  {#if mailAccountsLoading && !mailAccounts.length}
    <section class="live-state-panel" aria-live="polite">
      <div class="state-icon"><ClockIcon size="24px" /></div>
      <h2>{$t`Loading…`}</h2>
      <p>{$t`Checking available mail accounts…`}</p>
    </section>
  {:else if mailAccountsError && !mailAccounts.length}
    <section class="live-state-panel" role="alert">
      <div class="state-icon error-icon"><MailIcon size="24px" /></div>
      <h2>{$t`Mail accounts could not be loaded.`}</h2>
      <p>{$t`The local data store returned an error. Try again.`}</p>
      <button
        type="button"
        class="primary-button"
        on:click={() => void loadMailAccounts()}
      >
        <RefreshIcon size="15px" />
        <span>{$t`Try again`}</span>
      </button>
    </section>
  {:else if !mailAccounts.length}
    <section class="live-state-panel">
      <div class="state-icon"><MailIcon size="24px" /></div>
      <h2>{$t`No mail accounts found.`}</h2>
      <p>
        {$t`Add or synchronize a mailbox before opening the live SLA queue.`}
      </p>
    </section>
  {:else}
    <section class="live-scope-panel" aria-labelledby="live-scope-title">
      <div class="live-scope-heading">
        <div>
          <h2 id="live-scope-title">{$t`Control scope`}</h2>
          <p>
            {$t`Choose the mailbox and folder whose unanswered requests should be monitored.`}
          </p>
        </div>
        <button
          type="button"
          class="inline-action"
          on:click={openReportsSettings}
        >
          {$t`Reports`}
        </button>
      </div>
      <div class="live-scope-controls">
        <label>
          <span>{$t`Mail account`}</span>
          <select
            bind:value={selectedMailAccountId}
            disabled={mailAccountsLoading}
            on:change={onAccountChange}
          >
            <option value={null}>{$t`Select a mail account`}</option>
            {#each mailAccounts as account}
              <option value={account.accountId}>
                {account.accountName}{account.email
                  ? ` — ${account.email}`
                  : ""}
              </option>
            {/each}
          </select>
        </label>
        <label>
          <span>{$t`Mail folder`}</span>
          <select
            bind:value={selectedMailFolderId}
            disabled={selectedMailAccountId == null || mailFoldersLoading}
            on:change={onFolderChange}
          >
            <option value={null}>
              {selectedMailAccountId == null
                ? $t`Select a mail account first`
                : $t`All folders`}
            </option>
            {#each mailFolders as folder}
              <option value={folder.folderId}>{folder.name}</option>
            {/each}
          </select>
        </label>
      </div>
      {#if mailFoldersError}
        <p class="scope-error" role="alert">
          {$t`Mail folders could not be loaded.`}
          <button
            type="button"
            class="inline-action"
            on:click={() =>
              selectedMailAccountId != null &&
              void selectMailAccount(selectedMailAccountId)}
          >
            {$t`Try again`}
          </button>
        </p>
      {/if}
      {#if categoryNamesError}
        <p class="scope-error" role="alert">
          {$t`Categories for SLA settings could not be loaded.`}
          <button
            type="button"
            class="inline-action"
            on:click={() =>
              selectedMailAccountId != null &&
              void selectMailAccount(selectedMailAccountId)}
          >
            {$t`Try again`}
          </button>
        </p>
      {/if}
      {#if selectedMailAccountId != null}
        <div class="live-settings-launcher-row">
          <button
            type="button"
            class="live-settings-launcher"
            aria-controls="live-sla-settings"
            aria-expanded={liveSettingsOpen}
            on:click={() => void openLiveSettings()}
          >
            <SettingsIcon size="14px" />
            <span>{$t`Settings`}</span>
          </button>
          <span class="live-settings-launcher-summary">
            {$t`Response target`}: {responseTargetMinutes} {$t`working minutes`}
            · {$t`SLA tracking and reminders`}:
            {responseRemindersEnabled ? $t`Enabled` : $t`Disabled`}
          </span>
        </div>
      {/if}
    </section>

    {#if selectedMailAccountId != null}
      <LiveResponseControl
        accountId={selectedMailAccountId}
        accountName={selectedMailAccount?.accountName ?? ""}
        mailboxAddress={selectedMailAccount?.email ?? null}
        folderId={selectedMailFolderId}
        folderName={selectedMailFolder?.name ?? ""}
        targetMinutes={responseTargetMinutes}
        {workingHours}
        {responderAttributionMode}
        selectedCategoryNames={selectedResponderCategoryNames}
        excludedCategoryNames={excludedResponseCategoryNames}
        includeUncategorized={includeUncategorizedResponses}
      />
      <section class="live-settings-section" aria-label={$t`Settings`}>
        <details
          id="live-sla-settings"
          bind:this={liveSettingsElement}
          class="live-settings-panel"
          open={liveSettingsOpen}
          on:toggle={onLiveSettingsToggle}
        >
          <summary>
            <span>{$t`Settings`}</span>
            <span class="live-settings-summary-text">
              {$t`Who answers`}: {responderSummary}
            </span>
          </summary>
          <div class="live-settings-body">
            <fieldset class="live-setting-block">
              <div class="live-setting-heading">
                <div>
                  <h3>{$t`Responder attribution`}</h3>
                  <p>
                    {$t`For a shared mailbox, select the name tags employees put on incoming requests. One request should have one employee tag.`}
                  </p>
                </div>
                {#if responderAttributionMode == "category"}
                  <span class="live-setting-count">
                    {selectedResponderCategoryNames.length} / {responderCategoryOptions.length}
                  </span>
                {/if}
              </div>
              <label
                class="live-setting-field"
                for="live-responder-attribution-mode"
              >
                <span>{$t`Who answers`}</span>
                <select
                  id="live-responder-attribution-mode"
                  value={responderAttributionMode}
                  on:change={onResponderModeChange}
                >
                  <option value="profile">{$t`Mail profile`}</option>
                  <option value="category">{$t`Employee category`}</option>
                </select>
              </label>
              {#if responderAttributionMode == "category"}
                <div class="live-setting-actions">
                  <button
                    type="button"
                    class="inline-action"
                    on:click={selectAllResponderCategories}
                  >
                    {$t`Select all`}
                  </button>
                  <button
                    type="button"
                    class="inline-action"
                    on:click={clearResponderCategories}
                  >
                    {$t`Clear`}
                  </button>
                </div>
                {#if categoryNamesLoading}
                  <p class="live-setting-help" aria-live="polite">
                    {$t`Loading categories…`}
                  </p>
                {:else if responderCategoryOptions.length}
                  <div
                    class="live-category-grid"
                    aria-label={$t`Choose employee tags`}
                  >
                    {#each responderCategoryOptions as name (name)}
                      <label class="live-category-option">
                        <input
                          type="checkbox"
                          checked={selectedResponderCategoryNames.includes(
                            name,
                          )}
                          on:change={(event) =>
                            onResponderCategoryChange(
                              name,
                              (event.currentTarget as HTMLInputElement).checked,
                            )}
                        />
                        <span>{name}</span>
                      </label>
                    {/each}
                  </div>
                {:else}
                  <p class="live-setting-help">
                    {$t`No categories are used in this period.`}
                  </p>
                {/if}
              {:else}
                <p class="live-setting-help">
                  {$t`Response statistics are grouped by the selected mailbox profile.`}
                </p>
              {/if}
            </fieldset>

            <fieldset class="live-setting-block">
              <div class="live-setting-heading">
                <div>
                  <h3>{$t`SLA tracking and reminders`}</h3>
                  <p>
                    {$t`The timer starts when the incoming message is received. Reminder intervals are measured in working minutes using the schedule configured for the selected mailbox.`}
                  </p>
                </div>
                <span
                  class="live-setting-status"
                  class:enabled={responseRemindersEnabled}
                >
                  {responseRemindersEnabled ? $t`Enabled` : $t`Disabled`}
                </span>
              </div>
              <div class="live-reminder-controls">
                <label class="live-setting-field">
                  <span>{$t`Response target`}</span>
                  <span class="live-number-control">
                    <input
                      type="number"
                      min={MIN_RESPONSE_TARGET_MINUTES}
                      max={MAX_RESPONSE_TARGET_MINUTES}
                      step="1"
                      value={responseTargetMinutes}
                      aria-invalid={responseTargetError}
                      on:change={onResponseTargetChange}
                    />
                    <span>{$t`working minutes`}</span>
                  </span>
                </label>
                <label class="live-checkbox-row">
                  <input
                    type="checkbox"
                    checked={responseRemindersEnabled}
                    disabled={liveSettingsLoading}
                    on:change={onResponseReminderEnabledChange}
                  />
                  <span
                    >{$t`Notify me when an unanswered request reaches a reminder point`}</span
                  >
                </label>
              </div>
              {#if responseTargetError}
                <p class="live-validation-message" role="alert">
                  {$t`Response target must be an integer from 1 minute to 7 days.`}
                </p>
              {/if}
              <div class="live-reminder-list">
                <span class="live-setting-label">{$t`Remind after`}</span>
                {#each responseReminderIntervals as minutes, index}
                  <label class="live-reminder-interval">
                    <input
                      type="number"
                      min={MIN_RESPONSE_REMINDER_INTERVAL_MINUTES}
                      max={MAX_RESPONSE_REMINDER_INTERVAL_MINUTES}
                      step="1"
                      value={minutes}
                      disabled={liveSettingsLoading}
                      aria-label={$t`Reminder interval`}
                      aria-invalid={responseReminderError == "invalid"}
                      on:change={(event) =>
                        onResponseReminderIntervalChange(index, event)}
                    />
                    <span>{$t`working minutes`}</span>
                    <button
                      type="button"
                      class="inline-action"
                      disabled={responseReminderIntervals.length <= 1 ||
                        liveSettingsLoading}
                      on:click={() => removeResponseReminderInterval(index)}
                    >
                      {$t`Remove`}
                    </button>
                  </label>
                {/each}
                <label class="live-reminder-interval">
                  <input
                    type="number"
                    min={MIN_RESPONSE_REMINDER_INTERVAL_MINUTES}
                    max={MAX_RESPONSE_REMINDER_INTERVAL_MINUTES}
                    step="1"
                    bind:value={newResponseReminderMinutes}
                    disabled={liveSettingsLoading}
                    aria-label={$t`New reminder interval`}
                    aria-invalid={responseReminderError == "invalid"}
                  />
                  <span>{$t`working minutes`}</span>
                </label>
                <button
                  type="button"
                  class="inline-action live-add-reminder"
                  disabled={liveSettingsLoading}
                  on:click={addResponseReminderInterval}
                >
                  + {$t`Add reminder`}
                </button>
              </div>
              <p class="live-setting-help">
                {$t`Example: 10, 20 and 25 working minutes. Each point is shown once until the message receives a reply.`}
              </p>
              {#if responseReminderError}
                <p class="live-validation-message" role="alert">
                  {responseReminderError == "duplicate"
                    ? $t`This reminder interval is already in the list.`
                    : $t`Enter whole minutes between 1 minute and 7 days.`}
                </p>
              {/if}
              <ResponseEventNotificationSettings
                bind:notifyWhenOverdue
                bind:notifyWhenTakenInWork
                disabled={liveSettingsLoading}
                on:change={saveResponseReminderConfig}
              />
              {#if responderAttributionMode == "profile"}
                <p class="live-setting-help">
                  {$t`In profile mode, all incoming messages from this mailbox are monitored.`}
                </p>
              {:else}
                <label class="live-checkbox-row">
                  <input
                    type="checkbox"
                    checked={includeUncategorizedResponses}
                    disabled={liveSettingsLoading}
                    on:change={onIncludeUncategorizedChange}
                  />
                  <span>{$t`Track incoming messages without a category`}</span>
                </label>
                <p class="live-setting-help">
                  {$t`Messages without a category are excluded by default because they are not assigned to an employee yet.`}
                </p>
              {/if}
              <div class="live-excluded-heading">
                <span class="live-setting-label"
                  >{$t`Do not track these categories`}</span
                >
                <span class="live-setting-count"
                  >{excludedResponseCategoryNames.length}</span
                >
              </div>
              <p class="live-setting-help">
                {$t`Select the categories that should not require a reply. This choice is saved separately for each mailbox.`}
              </p>
              {#if categoryNamesLoading}
                <p class="live-setting-help" aria-live="polite">
                  {$t`Loading categories…`}
                </p>
              {:else if categoryNames.length}
                <div
                  class="live-category-grid excluded-category-grid"
                  aria-label={$t`Categories excluded from SLA`}
                >
                  {#each categoryNames as name (name)}
                    <label class="live-category-option">
                      <input
                        type="checkbox"
                        checked={excludedResponseCategoryNames.includes(name)}
                        on:change={(event) =>
                          onExcludedResponseCategoryChange(name, event)}
                      />
                      <span>{name}</span>
                    </label>
                  {/each}
                </div>
              {:else}
                <p class="live-setting-help">
                  {$t`No categories found in this mailbox.`}
                </p>
              {/if}
            </fieldset>
          </div>
        </details>
        <div class="live-settings-summary">
          <div>
            <span>{$t`Response target`}</span>
            <strong>{responseTargetMinutes} {$t`working minutes`}</strong>
          </div>
          <div>
            <span>{$t`Working hours for response SLA`}</span>
            <strong>{scheduleSummary}</strong>
          </div>
          <div>
            <span>{$t`Responder attribution`}</span>
            <strong>{responderSummary}</strong>
          </div>
          <div>
            <span>{$t`SLA tracking and reminders`}</span>
            <strong
              >{responseRemindersEnabled ? $t`Enabled` : $t`Disabled`}</strong
            >
          </div>
        </div>
        <p class="live-scope-note">
          {$t`The timer starts when the incoming message is received. Reminder intervals are measured in working minutes using the schedule configured for the selected mailbox.`}
        </p>
      </section>
    {/if}
  {/if}
</main>

<style>
  .live-page {
    min-height: 100%;
    box-sizing: border-box;
    padding: 20px 24px 40px;
    background: var(--main-bg);
    color: var(--main-fg);
  }

  .live-page-header,
  .live-scope-panel {
    max-width: 1440px;
    margin-inline: auto;
  }

  .live-page-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 24px;
    margin-bottom: 18px;
  }

  .live-page-kicker {
    margin: 0 0 6px;
    color: var(--reports-accent, #b97616);
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.14em;
  }

  .live-page h1 {
    margin: 0 0 8px;
    font-size: clamp(24px, 3vw, 32px);
    letter-spacing: -0.03em;
  }

  .live-page-lead {
    max-width: 720px;
    margin: 0;
    color: color-mix(in srgb, var(--main-fg) 68%, transparent);
    font-size: 14px;
    line-height: 1.5;
  }

  .live-page-actions,
  .live-scope-heading,
  .live-scope-controls,
  .live-settings-summary {
    display: flex;
  }

  .live-page-actions {
    flex: 0 0 auto;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
  }

  button {
    font: inherit;
    cursor: pointer;
  }

  button:disabled {
    cursor: default;
    opacity: 0.48;
  }

  .secondary-button,
  .refresh-button,
  .primary-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    min-height: 34px;
    border: 1px solid var(--button-border, var(--border));
    border-radius: var(--border-radius, 8px);
    padding: 7px 12px;
    background: var(--button-bg);
    color: var(--button-fg);
    font-size: 13px;
    transition:
      background-color 150ms ease,
      border-color 150ms ease,
      transform 150ms ease;
  }

  .secondary-button:hover:not(:disabled),
  .refresh-button:hover:not(:disabled) {
    background: var(--hover-bg);
    border-color: color-mix(
      in srgb,
      var(--reports-accent, #b97616) 55%,
      var(--border)
    );
  }

  .primary-button {
    border-color: var(--selected-bg);
    background: var(--selected-bg);
    color: var(--selected-fg);
    font-weight: 700;
  }

  .secondary-button:active:not(:disabled),
  .refresh-button:active:not(:disabled),
  .primary-button:active:not(:disabled) {
    transform: scale(0.98);
  }

  button:focus-visible,
  select:focus-visible,
  input:focus-visible,
  summary:focus-visible,
  .inline-action:focus-visible {
    outline: 2px solid var(--reports-accent, #b97616);
    outline-offset: 2px;
  }

  .live-scope-panel {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    margin-bottom: 14px;
    padding: 14px 16px 12px;
    border: 1px solid var(--border);
    border-radius: var(--border-radius, 8px);
    background: var(--main-bg);
    box-shadow: none;
  }

  .live-scope-heading {
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 14px;
  }

  .live-scope-heading > div {
    min-width: 0;
  }

  .live-scope-heading h2 {
    margin: 0 0 5px;
    font-size: 19px;
  }

  .live-scope-heading p {
    margin: 0;
    color: color-mix(in srgb, var(--main-fg) 60%, transparent);
    font-size: 12px;
  }

  .inline-action {
    border: 0;
    padding: 0;
    background: transparent;
    color: var(--reports-accent, #b97616);
    font-size: 12px;
    font-weight: 750;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .live-scope-controls {
    flex-wrap: wrap;
    min-width: 0;
    max-width: 100%;
    gap: 10px;
  }

  .live-scope-controls label {
    display: grid;
    flex: 1 1 280px;
    gap: 5px;
    color: color-mix(in srgb, var(--main-fg) 62%, transparent);
    font-size: 11px;
    font-weight: 750;
  }

  .live-settings-launcher-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px 12px;
    min-width: 0;
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
  }

  .live-settings-launcher {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 6px;
    min-height: 31px;
    border: 1px solid
      color-mix(in srgb, var(--reports-accent) 45%, var(--border));
    border-radius: 8px;
    padding: 5px 9px;
    background: color-mix(in srgb, var(--reports-accent) 7%, var(--main-bg));
    color: var(--reports-accent);
    font-size: 11px;
    font-weight: 800;
    transition:
      background-color 150ms ease,
      border-color 150ms ease,
      transform 150ms ease;
  }

  .live-settings-launcher:hover {
    border-color: var(--reports-accent);
    background: color-mix(in srgb, var(--reports-accent) 12%, var(--main-bg));
  }

  .live-settings-launcher:active {
    transform: scale(0.98);
  }

  .live-settings-launcher-summary {
    min-width: 0;
    overflow: hidden;
    color: color-mix(in srgb, var(--main-fg) 56%, transparent);
    font-size: 10px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .live-settings-section {
    box-sizing: border-box;
    width: 100%;
    max-width: 1440px;
    min-width: 0;
    margin: 12px auto 14px;
  }

  .live-settings-section .live-settings-panel {
    margin-top: 0;
  }

  select {
    min-height: 36px;
    min-width: 0;
    border: 1px solid var(--border);
    border-radius: 9px;
    padding: 7px 10px;
    background: var(--input-bg);
    color: var(--input-fg);
    font: inherit;
  }

  .live-settings-panel {
    min-width: 0;
    max-width: 100%;
    margin-top: 12px;
    border: 1px solid
      color-mix(in srgb, var(--reports-accent) 30%, var(--border));
    border-radius: 10px;
    background: color-mix(in srgb, var(--reports-accent) 3%, var(--main-bg));
  }

  .live-settings-panel summary {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 38px;
    box-sizing: border-box;
    min-width: 0;
    padding: 8px 11px;
    color: var(--main-fg);
    cursor: pointer;
    font-size: 12px;
    font-weight: 800;
    list-style: none;
  }

  .live-settings-panel summary::-webkit-details-marker {
    display: none;
  }

  .live-settings-panel summary::before {
    flex: 0 0 auto;
    color: var(--reports-accent);
    content: "▸";
    font-size: 14px;
    transition: transform 150ms ease;
  }

  .live-settings-panel[open] summary {
    border-bottom: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
  }

  .live-settings-panel[open] summary::before {
    transform: rotate(90deg);
  }

  .live-settings-summary-text {
    min-width: 0;
    overflow: hidden;
    color: color-mix(in srgb, var(--main-fg) 56%, transparent);
    font-size: 11px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .live-settings-body {
    display: grid;
    min-width: 0;
    grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
    gap: 10px;
    padding: 10px;
  }

  .live-setting-block {
    min-width: 0;
    min-inline-size: 0;
    margin: 0;
    padding: 10px;
    border: 1px solid color-mix(in srgb, var(--border) 78%, transparent);
    border-radius: 8px;
    background: color-mix(in srgb, var(--main-bg) 78%, transparent);
  }

  .live-setting-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
    min-width: 0;
    flex-wrap: wrap;
  }

  .live-setting-heading > div {
    min-width: 0;
  }

  .live-setting-heading h3 {
    margin: 0 0 4px;
    color: var(--main-fg);
    font-size: 12px;
  }

  .live-setting-heading p,
  .live-setting-help {
    margin: 0;
    color: color-mix(in srgb, var(--main-fg) 58%, transparent);
    font-size: 10px;
    line-height: 1.4;
  }

  .live-setting-status {
    flex: 0 0 auto;
    border-radius: 999px;
    padding: 4px 7px;
    background: color-mix(in srgb, var(--main-fg) 8%, transparent);
    color: color-mix(in srgb, var(--main-fg) 62%, transparent);
    font-size: 10px;
    font-weight: 800;
  }

  .live-setting-status.enabled {
    background: color-mix(in srgb, var(--reports-teal) 14%, transparent);
    color: var(--reports-teal);
  }

  .live-setting-count {
    flex: 0 0 auto;
    color: color-mix(in srgb, var(--main-fg) 55%, transparent);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .live-setting-field {
    display: grid;
    gap: 5px;
    margin-top: 10px;
    color: color-mix(in srgb, var(--main-fg) 62%, transparent);
    font-size: 10px;
    font-weight: 750;
  }

  .live-setting-field select {
    width: 100%;
    min-height: 32px;
    padding: 6px 8px;
    font-size: 11px;
  }

  .live-setting-actions {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 9px;
  }

  .live-category-grid {
    display: grid;
    min-width: 0;
    grid-template-columns: repeat(auto-fit, minmax(min(150px, 100%), 1fr));
    gap: 5px;
    max-height: 190px;
    margin-top: 8px;
    overflow-y: auto;
    padding-right: 2px;
  }

  .excluded-category-grid {
    max-height: 150px;
  }

  .live-category-option,
  .live-checkbox-row {
    display: flex;
    align-items: flex-start;
    gap: 7px;
    min-width: 0;
    color: color-mix(in srgb, var(--main-fg) 78%, transparent);
    font-size: 10px;
    line-height: 1.35;
  }

  .live-category-option {
    box-sizing: border-box;
    min-height: 28px;
    padding: 6px 7px;
    border: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
    border-radius: 6px;
    background: color-mix(in srgb, var(--main-fg) 2%, transparent);
    cursor: pointer;
  }

  .live-category-option:hover {
    border-color: color-mix(in srgb, var(--reports-accent) 42%, var(--border));
    background: color-mix(in srgb, var(--reports-accent) 7%, transparent);
  }

  .live-category-option span,
  .live-checkbox-row span {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .live-category-option input,
  .live-checkbox-row input {
    flex: 0 0 auto;
    margin: 1px 0 0;
    accent-color: var(--reports-accent);
  }

  .live-reminder-controls {
    display: grid;
    min-width: 0;
    grid-template-columns: minmax(130px, 0.75fr) minmax(0, 1.25fr);
    align-items: end;
    gap: 10px;
    margin-top: 10px;
  }

  .live-number-control {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    color: color-mix(in srgb, var(--main-fg) 55%, transparent);
    font-size: 10px;
    flex-wrap: wrap;
  }

  .live-number-control input,
  .live-reminder-interval input {
    box-sizing: border-box;
    min-height: 30px;
    width: 74px;
    border: 1px solid var(--border);
    border-radius: 7px;
    padding: 5px 7px;
    background: var(--input-bg);
    color: var(--input-fg);
    font: inherit;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  .live-checkbox-row {
    align-items: center;
    min-height: 30px;
    cursor: pointer;
    font-weight: 700;
  }

  .live-reminder-list {
    display: flex;
    min-width: 0;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 9px;
    margin-top: 10px;
    padding-top: 9px;
    border-top: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
  }

  .live-setting-label {
    color: color-mix(in srgb, var(--main-fg) 62%, transparent);
    font-size: 10px;
    font-weight: 750;
  }

  .live-reminder-interval {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    max-width: 100%;
    flex-wrap: wrap;
    color: color-mix(in srgb, var(--main-fg) 58%, transparent);
    font-size: 10px;
  }

  .live-reminder-interval input {
    width: 58px;
  }

  .live-reminder-interval .inline-action {
    margin-left: 1px;
    font-size: 10px;
  }

  .live-add-reminder {
    font-size: 10px;
  }

  .live-validation-message {
    margin: 7px 0 0;
    color: var(--danger-fg, #b84e3b);
    font-size: 10px;
    line-height: 1.35;
  }

  .live-excluded-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-top: 12px;
    padding-top: 9px;
    border-top: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
  }

  .live-settings-summary {
    min-width: 0;
    max-width: 100%;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 12px;
  }

  .live-settings-summary > div {
    display: grid;
    flex: 1 1 190px;
    gap: 5px;
    min-width: 0;
    padding: 9px 10px;
    border: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
    border-radius: 9px;
    background: color-mix(in srgb, var(--main-fg) 3%, transparent);
  }

  .live-settings-summary span {
    overflow: hidden;
    color: color-mix(in srgb, var(--main-fg) 55%, transparent);
    font-size: 10px;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .live-settings-summary strong {
    overflow: hidden;
    min-width: 0;
    font-size: 12px;
    line-height: 1.35;
    overflow-wrap: anywhere;
    text-overflow: clip;
    white-space: normal;
  }

  .live-scope-note,
  .scope-error {
    min-width: 0;
    max-width: 100%;
    margin: 10px 0 0;
    color: color-mix(in srgb, var(--main-fg) 52%, transparent);
    font-size: 11px;
    line-height: 1.4;
  }

  .scope-error {
    color: var(--danger-fg, #b84e3b);
  }

  .scope-error .inline-action {
    margin-left: 5px;
  }

  .live-state-panel {
    max-width: 680px;
    margin: 42px auto;
    padding: 36px 28px;
    border: 1px solid var(--border);
    border-radius: var(--border-radius, 8px);
    background: var(--main-bg);
    text-align: center;
  }

  .live-state-panel h2 {
    margin: 15px 0 8px;
    font-size: 22px;
  }

  .live-state-panel p {
    max-width: 520px;
    margin: 0 auto 20px;
    color: color-mix(in srgb, var(--main-fg) 65%, transparent);
    font-size: 14px;
    line-height: 1.5;
  }

  .state-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 48px;
    height: 48px;
    border-radius: 14px;
    background: color-mix(
      in srgb,
      var(--reports-accent, #b97616) 15%,
      transparent
    );
    color: var(--reports-accent, #b97616);
  }

  .error-icon {
    background: color-mix(in srgb, var(--danger-fg, #b84e3b) 14%, transparent);
    color: var(--danger-fg, #b84e3b);
  }

  .live-page.embedded {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    min-inline-size: 0;
    height: 100%;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
    container: live-sla / inline-size;
    padding: 8px;
    background: transparent;
    scrollbar-gutter: stable;
  }

  .live-page.embedded .live-scope-panel {
    width: 100%;
    max-width: 100%;
    min-width: 0;
    margin-bottom: 10px;
    padding: 12px;
    border-radius: 12px;
    box-shadow: none;
  }

  .live-page.embedded .live-state-panel {
    margin: 16px 0;
    padding: 22px 12px;
  }

  .live-page.embedded .live-scope-heading {
    flex-direction: column;
    gap: 6px;
    margin-bottom: 10px;
  }

  .live-page.embedded .live-scope-heading h2 {
    font-size: 16px;
  }

  .live-page.embedded .live-scope-heading p {
    line-height: 1.4;
  }

  .live-page.embedded .live-settings-body {
    grid-template-columns: 1fr;
    padding: 8px;
  }

  .live-page.embedded .live-settings-panel summary {
    padding-inline: 9px;
  }

  .live-page.embedded .live-settings-summary-text {
    max-width: 62%;
  }

  .live-page.embedded .live-scope-controls {
    flex-direction: column;
    gap: 8px;
  }

  .live-page.embedded .live-scope-controls label {
    flex-basis: auto;
  }

  .live-page.embedded .live-settings-summary {
    display: none;
  }

  .live-page.embedded .live-settings-section {
    margin-top: 10px;
    margin-bottom: 10px;
  }

  .live-page.embedded .live-settings-launcher-row {
    align-items: flex-start;
    flex-direction: column;
  }

  .live-page.embedded .live-settings-launcher-summary {
    max-width: 100%;
    white-space: normal;
  }

  .live-page.embedded :global(.live-control) {
    width: 100%;
    max-width: 100%;
    min-width: 0;
    margin-top: 10px;
    padding: 12px;
    border-radius: 12px;
  }

  @container live-sla (max-width: 720px) {
    .live-reminder-controls {
      grid-template-columns: 1fr;
    }

    .live-settings-summary-text {
      max-width: 58%;
    }

    :global(.live-control-header) {
      gap: 10px;
    }

    :global(.live-summary) {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    :global(.live-queue-toolbar) {
      flex-wrap: wrap;
    }

    :global(.live-sort-bar) {
      flex: 1 1 100%;
      flex-wrap: wrap;
    }

    :global(.live-sort-controls) {
      flex: 1 1 100%;
    }

    :global(.live-row) {
      grid-template-columns: minmax(0, 1fr);
      gap: 9px;
    }

    :global(.live-row-timer) {
      justify-items: start;
      text-align: left;
    }
  }

  @container live-sla (max-width: 380px) {
    :global(.live-summary) {
      grid-template-columns: 1fr;
    }

    :global(.live-queue-toolbar) {
      display: grid;
    }

    :global(.tracking-archive-toggle) {
      width: 100%;
    }

    .live-settings-summary-text {
      display: none;
    }
  }

  @container live-sla (max-width: 300px) {
    .live-settings-body {
      padding: 6px;
    }

    .live-setting-block {
      padding: 8px;
    }

    :global(.live-control) {
      padding: 10px;
    }

    :global(.live-sort-label) {
      flex-basis: 100%;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .secondary-button,
    .refresh-button,
    .primary-button,
    .live-settings-launcher {
      transition: none;
    }
  }

  @media (max-width: 700px) {
    .live-page {
      padding: 24px 16px 40px;
    }

    .live-page-header {
      flex-direction: column;
    }

    .live-page-actions {
      justify-content: flex-start;
    }

    .live-scope-heading {
      flex-direction: column;
    }

    .live-settings-body,
    .live-reminder-controls {
      grid-template-columns: 1fr;
    }

    .live-settings-summary-text {
      max-width: 52%;
    }
  }
</style>
