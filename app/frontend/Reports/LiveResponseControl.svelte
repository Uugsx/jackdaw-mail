<script lang="ts">
  import { onMount } from "svelte";
  import ClockIcon from "lucide-svelte/icons/clock-3";
  import ArchiveIcon from "lucide-svelte/icons/archive";
  import MailIcon from "lucide-svelte/icons/mail";
  import RefreshIcon from "lucide-svelte/icons/refresh-cw";
  import UndoIcon from "lucide-svelte/icons/undo-2";
  import { t, getDateTimeLocale } from "../../l10n/l10n";
  import { loadPendingResponseRequests } from "../../logic/Reports/ResponseReminderData";
  import {
    getResponseSlaProgress,
    type PendingResponseRequest,
    type ResponseSlaProgress,
  } from "../../logic/Reports/ResponseReminder";
  import {
    sortLiveResponseRows,
    type LiveResponseSortColumn,
    type LiveResponseSortRow,
  } from "../../logic/Reports/LiveResponseSorting";
  import {
    toggleReportSort,
    type ReportSortState,
  } from "../../logic/Reports/ReportSorting";
  import {
    filterUnarchivedResponseTrackingRequests,
    normalizeResponseTrackingArchive,
    type ResponseTrackingArchiveEntry,
  } from "../../logic/Reports/ResponseTrackingArchive";
  import type { ResponderAttributionMode } from "../../logic/Reports/ReportsPresentation";
  import {
    DEFAULT_WORKING_HOURS_SCHEDULE,
    type WorkingHoursSchedule,
  } from "../../logic/Reports/WorkingHours";
  import ReportSortButton from "./ReportSortButton.svelte";
  import { getLocalStorage } from "../Util/LocalStorage";
  import { openPendingResponseMessage } from "../Mail/openPendingResponse";
  import {
    getResponseReminderSlaStartAt,
    responseReminderMailEpoch,
  } from "../Mail/ResponseReminderWatcher";
  import {
    archiveResponseRequest,
    restoreArchivedResponseRequest,
    responseTrackingArchiveSetting,
  } from "./ResponseTrackingArchiveSettings";

  export let accountId: number | null = null;
  export let accountName = "";
  export let mailboxAddress: string | null = null;
  export let folderId: number | null = null;
  export let folderName = "";
  export let targetMinutes = 30;
  export let workingHours: WorkingHoursSchedule =
    DEFAULT_WORKING_HOURS_SCHEDULE;
  export let responderAttributionMode: ResponderAttributionMode = "profile";
  export let selectedCategoryNames: string[] = [];
  export let excludedCategoryNames: string[] = [];
  export let includeUncategorized = false;

  type LiveResponseRow = LiveResponseSortRow;
  type LiveResponseRequest = PendingResponseRequest & {
    slaStartedAt: Date;
  };

  let requests: LiveResponseRequest[] = [];
  let now = new Date();
  let loading = false;
  let error: Error | null = null;
  let openError: Error | null = null;
  let openingEmailId: number | null = null;
  let lastUpdatedAt: Date | null = null;
  let mounted = false;
  let loadedScopeKey = "";
  let currentScopeKey = "";
  let refreshRequestId = 0;
  let mailChangeRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  let showTrackingArchive = false;
  const liveSortSetting = getLocalStorage<unknown>(
    "reports.live-response.sort.v1",
    null,
  );
  let liveSort: ReportSortState<LiveResponseSortColumn> | null =
    restoreLiveSortState(liveSortSetting.value);

  $: currentScopeKey = JSON.stringify({
    accountId,
    folderId,
    responderAttributionMode,
    selectedCategoryNames,
    excludedCategoryNames,
    includeUncategorized,
  });
  $: trackingArchive = normalizeResponseTrackingArchive(
    $responseTrackingArchiveSetting.value,
  );
  $: archivedEntries = Object.values(trackingArchive)
    .filter(
      (entry) =>
        entry.accountId == accountId &&
        (folderId == null || entry.folderId == folderId),
    )
    .sort((left, right) => right.archivedAt - left.archivedAt);
  $: trackedRequests = filterUnarchivedResponseTrackingRequests(
    requests,
    trackingArchive,
  ) as LiveResponseRequest[];
  $: if (mounted && currentScopeKey !== loadedScopeKey) {
    loadedScopeKey = currentScopeKey;
    requests = [];
    lastUpdatedAt = null;
    void refreshLiveRequests();
  }
  $: liveRows = trackedRequests.map((request): LiveResponseRow => ({
    request,
    progress: getResponseSlaProgress(
      request,
      targetMinutes,
      now,
      workingHours,
      request.slaStartedAt,
    ),
    assignee: assigneeLabel(request),
  }));
  $: sortedLiveRows = sortLiveResponseRows(liveRows, liveSort);
  $: overdueCount = liveRows.filter(
    (row) => row.progress.status == "over-target",
  ).length;
  $: waitingCount = liveRows.filter(
    (row) => row.progress.status == "waiting-for-working-hours",
  ).length;
  $: withinCount = liveRows.length - overdueCount - waitingCount;

  onMount(() => {
    mounted = true;
    loadedScopeKey = currentScopeKey;
    void refreshLiveRequests();
    let isInitialMailEpoch = true;
    const unsubscribeMailEpoch = responseReminderMailEpoch.subscribe(() => {
      if (isInitialMailEpoch) {
        isInitialMailEpoch = false;
        return;
      }
      scheduleMailChangeRefresh();
    });
    const clockTimer = setInterval(() => {
      now = new Date();
    }, 1_000);
    const refreshTimer = setInterval(() => {
      void refreshLiveRequests();
    }, 15_000);
    return () => {
      unsubscribeMailEpoch();
      clearInterval(clockTimer);
      clearInterval(refreshTimer);
      if (mailChangeRefreshTimer != null) {
        clearTimeout(mailChangeRefreshTimer);
        mailChangeRefreshTimer = null;
      }
    };
  });

  function scheduleMailChangeRefresh(): void {
    if (!mounted || accountId == null || mailChangeRefreshTimer != null) {
      return;
    }
    mailChangeRefreshTimer = setTimeout(() => {
      mailChangeRefreshTimer = null;
      void refreshLiveRequests();
    }, 300);
  }

  async function refreshLiveRequests(): Promise<void> {
    if (accountId == null) {
      requests = [];
      error = null;
      lastUpdatedAt = null;
      return;
    }
    const requestId = ++refreshRequestId;
    // Показываем состояние обновления и при уже заполненной очереди. Иначе
    // ручная кнопка визуально ничего не делает, пока запрос к базе выполняется.
    loading = true;
    error = null;
    try {
      const refreshNow = new Date();
      const nextRequests = await loadPendingResponseRequests(
        accountId,
        responderAttributionMode == "category" ? selectedCategoryNames : null,
        refreshNow,
        undefined,
        folderId,
        {
          mailboxAddress,
          excludedCategoryNames,
          includeUncategorized,
        },
      );
      if (requestId !== refreshRequestId) {
        return;
      }
      requests = nextRequests.map((request) => ({
        ...request,
        slaStartedAt: getResponseReminderSlaStartAt(
          request,
          refreshNow,
          workingHours,
          excludedCategoryNames,
        ),
      }));
      lastUpdatedAt = new Date();
    } catch (ex) {
      if (requestId === refreshRequestId) {
        error = ex instanceof Error ? ex : new Error(String(ex));
      }
    } finally {
      if (requestId === refreshRequestId) {
        loading = false;
      }
    }
  }

  async function openRequest(request: PendingResponseRequest): Promise<void> {
    openingEmailId = request.emailId;
    openError = null;
    try {
      await openPendingResponseMessage(request);
    } catch (ex) {
      openError = ex instanceof Error ? ex : new Error(String(ex));
    } finally {
      openingEmailId = null;
    }
  }

  function onLiveSort(column: LiveResponseSortColumn): void {
    liveSort = toggleReportSort(liveSort, column);
    liveSortSetting.value = liveSort;
  }

  function stopTracking(request: PendingResponseRequest): void {
    archiveResponseRequest(request);
  }

  function restoreTracking(entry: ResponseTrackingArchiveEntry): void {
    restoreArchivedResponseRequest(`${entry.accountId}:${entry.emailId}`);
  }

  function liveSortDirection(
    column: LiveResponseSortColumn,
  ): "asc" | "desc" | null {
    return liveSort?.column === column ? liveSort.direction : null;
  }

  function restoreLiveSortState(
    value: unknown,
  ): ReportSortState<LiveResponseSortColumn> | null {
    if (!value || typeof value != "object" || Array.isArray(value)) {
      return null;
    }
    const source = value as Record<string, unknown>;
    const columns: LiveResponseSortColumn[] = [
      "status",
      "received",
      "deadline",
      "elapsed",
      "assignee",
      "subject",
    ];
    if (
      !columns.includes(source.column as LiveResponseSortColumn) ||
      (source.direction != "asc" && source.direction != "desc")
    ) {
      return null;
    }
    const direction: "asc" | "desc" =
      source.direction == "asc" ? "asc" : "desc";
    return {
      column: source.column as LiveResponseSortColumn,
      direction,
    };
  }

  function assigneeLabel(request: PendingResponseRequest): string {
    if (request.categoryNames.length) {
      return request.categoryNames.join(", ");
    }
    return responderAttributionMode == "category"
      ? $t`Not assigned`
      : accountName || $t`Mail profile`;
  }

  function statusLabel(progress: ResponseSlaProgress): string {
    switch (progress.status) {
      case "over-target":
        return $t`Overdue by ${formatDuration(progress.overdueSeconds)}`;
      case "waiting-for-working-hours":
        return $t`Waiting for working hours`;
      case "within-target":
        return $t`Time remaining: ${formatDuration(progress.remainingSeconds)}`;
    }
  }

  function elapsedLabel(progress: ResponseSlaProgress): string {
    return $t`Elapsed ${formatDuration(progress.elapsedSeconds)} of ${formatDuration(progress.targetSeconds)}`;
  }

  function formatDuration(seconds: number): string {
    const total = Math.max(
      0,
      Math.floor(Number.isFinite(seconds) ? seconds : 0),
    );
    const hours = Math.floor(total / 3_600);
    const minutes = Math.floor((total % 3_600) / 60);
    const restSeconds = total % 60;
    if (hours > 0) {
      return `${hours} ${$t`h`} ${String(minutes).padStart(2, "0")} ${$t`min`}`;
    }
    if (minutes > 0) {
      return `${minutes} ${$t`min`} ${String(restSeconds).padStart(2, "0")} ${$t`s`}`;
    }
    return `${restSeconds} ${$t`s`}`;
  }

  function formatReceived(date: Date): string {
    return `${date.toLocaleDateString(getDateTimeLocale(), {
      day: "2-digit",
      month: "short",
    })}, ${formatClock(date)}`;
  }

  function formatArchivedAt(timestamp: number): string {
    return formatReceived(new Date(timestamp));
  }

  function formatClock(date: Date | null): string {
    return date
      ? date.toLocaleTimeString(getDateTimeLocale(), {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "—";
  }
</script>

<section class="live-control" aria-labelledby="live-control-title">
  <div class="live-control-header">
    <div>
      <p class="live-control-kicker">{$t`LIVE SLA`}</p>
      <h2 id="live-control-title">{$t`Live response control`}</h2>
      <p>
        {$t`The timer follows the selected mailbox schedule until a message is taken into work. If it is taken outside working hours, the timer continues without pausing from that moment.`}
      </p>
    </div>
    <button
      type="button"
      class="live-refresh-button"
      disabled={accountId == null || loading}
      aria-busy={loading}
      on:click={() => void refreshLiveRequests()}
    >
      <span class:spinning={loading}><RefreshIcon size="14px" /></span>
      <span>{$t`Refresh`}</span>
    </button>
  </div>

  {#if accountId == null}
    <div class="live-empty" role="status">
      <ClockIcon size="18px" />
      <span>{$t`Select a mailbox to start live SLA control.`}</span>
    </div>
  {:else if loading && !requests.length}
    <div class="live-loading" aria-live="polite">
      {#each Array(3) as _}
        <div class="live-skeleton-row"></div>
      {/each}
      <span>{$t`Checking unanswered requests…`}</span>
    </div>
  {:else if error && !requests.length}
    <div class="live-error" role="alert">
      <span>{$t`Live SLA data could not be loaded.`}</span>
      <button
        type="button"
        class="inline-retry"
        on:click={() => void refreshLiveRequests()}
      >
        {$t`Try again`}
      </button>
    </div>
  {:else}
    <div class="live-summary" aria-live="polite">
      <div>
        <strong class="live-number">{liveRows.length}</strong>
        <span>{$t`without a reply`}</span>
      </div>
      <div class:alert={overdueCount > 0}>
        <strong class="live-number">{overdueCount}</strong>
        <span>{$t`overdue`}</span>
      </div>
      <div>
        <strong class="live-number">{withinCount}</strong>
        <span>{$t`within SLA`}</span>
      </div>
      <div>
        <strong class="live-number">{waitingCount}</strong>
        <span>{$t`waiting for working hours`}</span>
      </div>
    </div>

    <div class="live-queue-toolbar">
      {#if liveRows.length}
        <div class="live-sort-bar">
          <span class="live-sort-label">{$t`Sort messages`}</span>
          <div
            class="live-sort-controls"
            role="group"
            aria-label={$t`Sort messages`}
          >
            <ReportSortButton
              label={$t`Status`}
              direction={liveSortDirection("status")}
              on:sort={() => onLiveSort("status")}
            />
            <ReportSortButton
              label={$t`Received`}
              direction={liveSortDirection("received")}
              on:sort={() => onLiveSort("received")}
            />
            <ReportSortButton
              label={$t`SLA deadline`}
              direction={liveSortDirection("deadline")}
              on:sort={() => onLiveSort("deadline")}
            />
            <ReportSortButton
              label={$t`Response time`}
              direction={liveSortDirection("elapsed")}
              on:sort={() => onLiveSort("elapsed")}
            />
            <ReportSortButton
              label={$t`Assigned to`}
              direction={liveSortDirection("assignee")}
              on:sort={() => onLiveSort("assignee")}
            />
            <ReportSortButton
              label={$t`Subject`}
              direction={liveSortDirection("subject")}
              on:sort={() => onLiveSort("subject")}
            />
          </div>
        </div>
      {/if}
      <button
        type="button"
        class="tracking-archive-toggle"
        class:active={showTrackingArchive}
        aria-pressed={showTrackingArchive}
        on:click={() => (showTrackingArchive = !showTrackingArchive)}
      >
        <ArchiveIcon size="13px" />
        <span>{$t`Tracking archive`}</span>
        <strong>{archivedEntries.length}</strong>
      </button>
    </div>

    {#if liveRows.length}
      <div class="live-list" role="list" aria-label={$t`Unanswered requests`}>
        {#each sortedLiveRows as row (row.request.emailId)}
          <article
            class="live-row"
            class:overdue={row.progress.status == "over-target"}
            class:waiting={row.progress.status == "waiting-for-working-hours"}
            role="listitem"
          >
            <div class="live-row-content">
              <button
                type="button"
                class="live-email-link"
                disabled={openingEmailId == row.request.emailId}
                aria-label={`${$t`Open email`}: ${row.request.subject}`}
                title={`${$t`Open email`}: ${row.request.subject || $t`(no subject)`}`}
                on:click={() => void openRequest(row.request)}
              >
                <MailIcon size="14px" />
                <span>{row.request.subject || $t`(no subject)`}</span>
              </button>
              <div class="live-row-meta">
                <span
                  >{$t`Received`} {formatReceived(row.request.receivedAt)}</span
                >
                <span aria-hidden="true">·</span>
                <span>{$t`Assigned to`} {row.assignee}</span>
              </div>
            </div>
            <div class="live-row-timer">
              <span
                class="live-status"
                class:overdue={row.progress.status == "over-target"}
                class:waiting={row.progress.status ==
                  "waiting-for-working-hours"}
              >
                {statusLabel(row.progress)}
              </span>
              <small>{elapsedLabel(row.progress)}</small>
              {#if row.progress.deadlineAt}
                <small
                  >{$t`SLA deadline`}
                  {formatClock(row.progress.deadlineAt)}</small
                >
              {/if}
              <button
                type="button"
                class="live-archive-button"
                title={$t`Stop tracking this request`}
                aria-label={`${$t`Stop tracking this request`}: ${row.request.subject}`}
                on:click={() => stopTracking(row.request)}
              >
                <ArchiveIcon size="13px" />
                <span>{$t`Stop tracking`}</span>
              </button>
            </div>
          </article>
        {/each}
      </div>
    {:else}
      <div class="live-empty" role="status">
        <ClockIcon size="18px" />
        <span
          >{$t`No unanswered requests in the selected mailbox and folder.`}</span
        >
      </div>
    {/if}

    {#if showTrackingArchive}
      <section
        class="tracking-archive"
        aria-labelledby="tracking-archive-title"
      >
        <div class="tracking-archive-heading">
          <div>
            <h3 id="tracking-archive-title">{$t`Tracking archive`}</h3>
            <p>
              {$t`Archived requests are hidden from the live SLA queue but remain in the mailbox.`}
            </p>
          </div>
        </div>
        {#if archivedEntries.length}
          <div class="tracking-archive-list">
            {#each archivedEntries as entry (entry.accountId + ":" + entry.emailId)}
              <article class="tracking-archive-row">
                <div class="tracking-archive-info">
                  <strong title={entry.subject}
                    >{entry.subject || $t`(no subject)`}</strong
                  >
                  <small
                    >{$t`Received`}
                    {formatReceived(new Date(entry.receivedAt))} · {$t`Removed`}
                    {formatArchivedAt(entry.archivedAt)}</small
                  >
                </div>
                <button
                  type="button"
                  class="tracking-restore-button"
                  title={$t`Restore tracking`}
                  on:click={() => restoreTracking(entry)}
                >
                  <UndoIcon size="13px" />
                  <span>{$t`Restore`}</span>
                </button>
              </article>
            {/each}
          </div>
        {:else}
          <div class="tracking-archive-empty">
            {$t`The tracking archive is empty.`}
          </div>
        {/if}
      </section>
    {/if}
  {/if}

  {#if error && requests.length}
    <p class="live-inline-error" role="alert">
      {$t`The last live refresh failed; showing the previous list.`}
    </p>
  {/if}
  {#if openError}
    <p class="live-inline-error" role="alert">{openError.message}</p>
  {/if}
  {#if accountId != null}
    <p class="live-control-note">
      {$t`Mailbox`}: {accountName || $t`Mail profile`}
      {#if folderName}
        · {$t`Folder`}: {folderName}{/if}
      {#if lastUpdatedAt}
        · {$t`Updated`} {formatClock(lastUpdatedAt)}{/if}
      · {$t`Excluded categories and unassigned messages follow the SLA settings.`}
      · {$t`The list refreshes immediately after a mail or category change; every 15 seconds a safety check runs.`}
    </p>
  {/if}
</section>

<style>
  .live-control {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    margin-top: 14px;
    padding: 18px;
    border: 1px solid var(--border);
    border-radius: var(--border-radius, 8px);
    background: var(--main-bg);
    box-shadow: none;
  }

  .live-control-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    min-width: 0;
    max-width: 100%;
    margin-bottom: 14px;
  }

  .live-control-header > div {
    min-width: 0;
  }

  .live-control-kicker {
    margin: 0 0 4px;
    color: var(--reports-accent);
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.12em;
  }

  .live-control h2 {
    margin: 0 0 6px;
    color: var(--main-fg);
    font-size: 18px;
  }

  .live-control-header p:not(.live-control-kicker) {
    max-width: 760px;
    margin: 0;
    color: color-mix(in srgb, var(--main-fg) 60%, transparent);
    font-size: 12px;
    line-height: 1.45;
  }

  .live-refresh-button {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 6px;
    min-height: 29px;
    border: 1px solid var(--button-border, var(--border));
    border-radius: 8px;
    padding: 5px 9px;
    background: var(--button-bg);
    color: var(--button-fg);
    font-size: 11px;
    font-weight: 700;
  }

  .live-refresh-button:hover:not(:disabled) {
    border-color: var(--reports-accent);
    color: var(--reports-accent);
  }

  .live-refresh-button:focus-visible,
  .live-email-link:focus-visible,
  .inline-retry:focus-visible {
    outline: 2px solid var(--reports-accent);
    outline-offset: 2px;
  }

  .live-summary {
    display: grid;
    min-width: 0;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
    margin-bottom: 12px;
  }

  .live-summary > div {
    min-width: 0;
    max-width: 100%;
    padding: 9px 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--main-bg);
  }

  .live-summary > div.alert {
    border-color: color-mix(
      in srgb,
      var(--danger-fg, #b84e3b) 45%,
      var(--border)
    );
    background: color-mix(in srgb, var(--danger-fg, #b84e3b) 6%, transparent);
  }

  .live-summary strong,
  .live-summary span {
    display: block;
  }

  .live-summary strong {
    color: var(--main-fg);
    font-size: 19px;
    line-height: 1;
  }

  .live-summary .alert strong {
    color: var(--danger-fg, #b84e3b);
  }

  .live-summary span {
    margin-top: 5px;
    overflow: hidden;
    color: color-mix(in srgb, var(--main-fg) 55%, transparent);
    font-size: 10px;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .live-number,
  .live-row-timer {
    font-variant-numeric: tabular-nums;
  }

  .live-sort-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    max-width: 100%;
    padding: 5px 7px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--headerbar-bg);
  }

  .live-sort-label {
    flex: 0 0 auto;
    color: color-mix(in srgb, var(--main-fg) 58%, transparent);
    font-size: 10px;
    font-weight: 750;
  }

  .live-sort-controls {
    display: flex;
    flex: 1 1 auto;
    min-width: 0;
    max-width: 100%;
    gap: 2px;
    overflow-x: auto;
  }

  .live-sort-controls :global(.table-sort-button) {
    width: auto;
    min-height: 25px;
    margin: 0;
    padding: 3px 6px;
    color: color-mix(in srgb, var(--main-fg) 62%, transparent);
    font-size: 10px;
    white-space: nowrap;
  }

  .live-queue-toolbar {
    display: flex;
    align-items: stretch;
    gap: 8px;
    min-width: 0;
    max-width: 100%;
    margin-bottom: 8px;
  }

  .live-queue-toolbar .live-sort-bar {
    flex: 1 1 auto;
  }

  .tracking-archive-toggle,
  .live-archive-button,
  .tracking-restore-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    border: 1px solid var(--button-border, var(--border));
    border-radius: 8px;
    background: var(--button-bg);
    color: var(--button-fg);
    font: inherit;
    font-size: 10px;
    font-weight: 750;
    cursor: pointer;
    transition:
      background-color 150ms ease,
      border-color 150ms ease,
      color 150ms ease,
      transform 150ms ease;
  }

  .tracking-archive-toggle {
    flex: 0 0 auto;
    max-width: 100%;
    min-height: 31px;
    padding: 5px 8px;
    white-space: nowrap;
  }

  .tracking-archive-toggle strong {
    min-width: 1.25em;
    padding: 1px 4px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--main-fg) 9%, transparent);
    font-variant-numeric: tabular-nums;
    text-align: center;
  }

  .tracking-archive-toggle:hover,
  .tracking-archive-toggle:focus-visible,
  .tracking-archive-toggle.active,
  .live-archive-button:hover,
  .live-archive-button:focus-visible,
  .tracking-restore-button:hover,
  .tracking-restore-button:focus-visible {
    border-color: color-mix(in srgb, var(--reports-accent) 58%, var(--border));
    background: color-mix(in srgb, var(--reports-accent) 9%, var(--input-bg));
    color: var(--reports-accent);
  }

  .tracking-archive-toggle:active,
  .live-archive-button:active,
  .tracking-restore-button:active {
    transform: scale(0.98);
  }

  .live-list {
    display: grid;
    min-width: 0;
    max-width: 100%;
    gap: 6px;
    max-height: min(58vh, 720px);
    overflow-y: auto;
    padding-right: 3px;
  }

  .live-row {
    display: grid;
    min-width: 0;
    max-width: 100%;
    grid-template-columns: minmax(0, 1fr) minmax(0, auto);
    align-items: center;
    gap: 14px;
    padding: 10px 11px;
    border: 1px solid var(--border);
    border-left: 3px solid var(--reports-teal);
    border-radius: 8px;
    background: var(--main-bg);
  }

  .live-row:hover {
    border-color: color-mix(in srgb, var(--reports-accent) 42%, var(--border));
    background: color-mix(in srgb, var(--reports-accent) 4%, var(--main-bg));
  }

  .live-row.overdue {
    border-left-color: var(--danger-fg, #b84e3b);
  }

  .live-row.waiting {
    border-left-color: color-mix(in srgb, var(--main-fg) 38%, transparent);
  }

  .live-row-content {
    min-width: 0;
  }

  .live-email-link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 100%;
    border: 0;
    padding: 0;
    overflow: hidden;
    background: transparent;
    color: var(--main-fg);
    font: inherit;
    font-size: 12px;
    font-weight: 700;
    text-align: left;
    text-decoration: underline;
    text-decoration-color: color-mix(
      in srgb,
      var(--reports-accent) 55%,
      transparent
    );
    text-underline-offset: 2px;
  }

  .live-email-link:hover:not(:disabled) {
    color: var(--reports-accent);
  }

  .live-email-link :global(svg) {
    flex: 0 0 auto;
    color: var(--reports-accent);
  }

  .live-email-link span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .live-row-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 7px;
    margin-top: 5px;
    color: color-mix(in srgb, var(--main-fg) 52%, transparent);
    font-size: 10px;
    line-height: 1.35;
  }

  .live-row-timer {
    display: grid;
    justify-items: end;
    gap: 3px;
    min-width: 0;
    max-width: 100%;
    text-align: right;
  }

  .live-status {
    display: inline-block;
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
    border-radius: 999px;
    padding: 4px 8px;
    background: color-mix(in srgb, var(--reports-teal) 14%, transparent);
    color: var(--reports-teal);
    font-size: 11px;
    font-weight: 800;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .live-status.overdue {
    background: color-mix(in srgb, var(--danger-fg, #b84e3b) 13%, transparent);
    color: var(--danger-fg, #b84e3b);
  }

  .live-status.waiting {
    background: color-mix(in srgb, var(--main-fg) 9%, transparent);
    color: color-mix(in srgb, var(--main-fg) 62%, transparent);
  }

  .live-row-timer small {
    color: color-mix(in srgb, var(--main-fg) 52%, transparent);
    font-size: 10px;
    line-height: 1.3;
  }

  .live-archive-button {
    margin-top: 4px;
    padding: 4px 7px;
    color: color-mix(in srgb, var(--danger-fg, #b84e3b) 82%, var(--main-fg));
  }

  .live-archive-button:hover,
  .live-archive-button:focus-visible {
    border-color: color-mix(
      in srgb,
      var(--danger-fg, #b84e3b) 52%,
      var(--border)
    );
    background: color-mix(
      in srgb,
      var(--danger-fg, #b84e3b) 8%,
      var(--input-bg)
    );
    color: var(--danger-fg, #b84e3b);
  }

  .tracking-archive {
    margin-top: 10px;
    padding: 10px;
    border: 1px solid
      color-mix(in srgb, var(--reports-accent) 30%, var(--border));
    border-radius: 9px;
    background: color-mix(in srgb, var(--reports-accent) 3%, var(--main-bg));
  }

  .tracking-archive-heading h3 {
    margin: 0 0 4px;
    color: var(--main-fg);
    font-size: 13px;
  }

  .tracking-archive-heading p {
    margin: 0;
    color: color-mix(in srgb, var(--main-fg) 56%, transparent);
    font-size: 10px;
    line-height: 1.4;
  }

  .tracking-archive-list {
    display: grid;
    gap: 5px;
    max-height: 360px;
    margin-top: 8px;
    overflow-y: auto;
    padding-right: 2px;
  }

  .tracking-archive-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 7px 8px;
    border: 1px solid color-mix(in srgb, var(--border) 66%, transparent);
    border-radius: 7px;
    background: color-mix(in srgb, var(--main-bg) 76%, transparent);
  }

  .tracking-archive-info {
    display: grid;
    min-width: 0;
    gap: 3px;
  }

  .tracking-archive-info strong {
    overflow: hidden;
    color: var(--main-fg);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tracking-archive-info small {
    color: color-mix(in srgb, var(--main-fg) 52%, transparent);
    font-size: 9px;
    line-height: 1.3;
  }

  .tracking-restore-button {
    flex: 0 0 auto;
    padding: 4px 7px;
    white-space: nowrap;
  }

  .tracking-archive-empty {
    margin-top: 8px;
    color: color-mix(in srgb, var(--main-fg) 58%, transparent);
    font-size: 11px;
  }

  .live-empty,
  .live-error,
  .live-loading {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 54px;
    padding: 12px;
    border: 1px dashed color-mix(in srgb, var(--border) 74%, transparent);
    border-radius: 9px;
    color: color-mix(in srgb, var(--main-fg) 58%, transparent);
    font-size: 12px;
  }

  .live-empty :global(svg) {
    flex: 0 0 auto;
    color: var(--reports-accent);
  }

  .live-error,
  .live-inline-error {
    color: var(--danger-fg, #b84e3b);
  }

  .inline-retry {
    border: 0;
    padding: 0;
    background: transparent;
    color: var(--reports-accent);
    font: inherit;
    font-weight: 750;
    text-decoration: underline;
    cursor: pointer;
  }

  .live-loading {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 7px;
  }

  .live-loading > span {
    grid-column: 1 / -1;
  }

  .live-skeleton-row {
    height: 33px;
    border-radius: 7px;
    background: color-mix(in srgb, var(--main-fg) 8%, transparent);
    animation: live-pulse 1.2s ease-in-out infinite alternate;
  }

  .live-inline-error,
  .live-control-note {
    margin: 9px 0 0;
    font-size: 10px;
    line-height: 1.4;
  }

  .live-control-note {
    color: color-mix(in srgb, var(--main-fg) 48%, transparent);
  }

  .spinning {
    animation: live-spin 0.9s linear infinite;
  }

  @keyframes live-pulse {
    from {
      opacity: 0.55;
    }
    to {
      opacity: 1;
    }
  }

  @keyframes live-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .live-skeleton-row,
    .spinning {
      animation: none;
    }
  }

  @media (max-width: 640px) {
    .live-sort-bar {
      align-items: flex-start;
      flex-direction: column;
    }

    .live-queue-toolbar {
      flex-direction: column;
    }

    .tracking-archive-toggle {
      align-self: flex-start;
    }

    .live-control-header {
      flex-direction: column;
    }

    .live-refresh-button {
      align-self: flex-start;
    }

    .live-summary {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .live-row {
      grid-template-columns: 1fr;
      gap: 8px;
    }

    .live-row-timer {
      justify-items: start;
      text-align: left;
    }

    .tracking-archive-row {
      align-items: flex-start;
      flex-direction: column;
    }
  }
</style>
