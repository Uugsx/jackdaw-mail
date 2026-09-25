<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import ActivityIcon from "lucide-svelte/icons/activity";
  import ArrowUpIcon from "lucide-svelte/icons/arrow-up-right";
  import CalendarIcon from "lucide-svelte/icons/calendar-days";
  import ChartIcon from "lucide-svelte/icons/chart-column";
  import ChatIcon from "lucide-svelte/icons/message-circle";
  import ClockIcon from "lucide-svelte/icons/clock-3";
  import DownloadIcon from "lucide-svelte/icons/download";
  import FilesIcon from "lucide-svelte/icons/files";
  import LayoutDashboardIcon from "lucide-svelte/icons/layout-dashboard";
  import LockIcon from "lucide-svelte/icons/lock-keyhole";
  import MailIcon from "lucide-svelte/icons/mail";
  import RefreshIcon from "lucide-svelte/icons/refresh-cw";
  import SearchIcon from "lucide-svelte/icons/search";
  import TagsIcon from "lucide-svelte/icons/tags";
  import UsersIcon from "lucide-svelte/icons/users";
  import { t, gt, getDateTimeLocale } from "../../l10n/l10n";
  import { appGlobal } from "../../logic/app";
  import {
    DEFAULT_RESPONSE_TARGET_MINUTES,
    MAX_RESPONSE_TARGET_MINUTES,
    MIN_RESPONSE_TARGET_MINUTES,
    buildResponseTimeDays,
    buildResponseTimeStats,
    defaultReportDateRange,
    emptyResponseTimeStats,
    loadReportMailAccounts,
    loadReportMailFolders,
    loadReportData,
    normalizeResponseTargetMinutes,
    reportDateRangeForPreset,
    validateReportDateRange,
    type ReportData,
    type ReportDateRange,
    type ReportDatePreset,
    type ReportMailAccountOption,
    type ReportMailFolderOption,
    type ResponseTimeStatus,
    type ReportTimelinePoint,
    type TimelineGranularity,
  } from "../../logic/Reports/ReportsData";
  import {
    DEFAULT_WORKING_HOURS_SCHEDULE,
    cloneWorkingHoursSchedule,
    formatWorkingTime,
    isWithinWorkingHours,
    normalizeWorkingHoursSchedule,
    parseWorkingTime,
    validateWorkingHoursSchedule,
    type WorkingHoursSchedule,
    type WorkingHoursValidationError,
  } from "../../logic/Reports/WorkingHours";
  import {
    REPORT_DASHBOARD_DEFAULT_LAYOUT,
    buildCategoryRhythmRows,
    buildCategoryResponderRows,
    defaultResponderCategoryNames,
    filterReportResponsesByCategories,
    intersectResponderCategories,
    moveReportDashboardPanel,
    moveReportDashboardPanelBefore,
    normalizeReportDashboardLayout,
    normalizeResponderAttributionConfig,
    reportDashboardWidthColumns,
    responderResponseShare as calculateResponderResponseShare,
    sortCategoryRhythmRows,
    type CategoryRhythmRow,
    type ReportDashboardPanelLayout,
    type ReportDashboardSectionId,
    type ReportDashboardWidth,
    type ResponderAttributionConfig,
    type ResponderAttributionMode,
  } from "../../logic/Reports/ReportsPresentation";
  import {
    sortReportRows,
    toggleReportSort,
    type ReportSortDirection,
    type ReportSortState,
    type ReportSortValue,
  } from "../../logic/Reports/ReportSorting";
  import { getLocalStorage } from "../Util/LocalStorage";
  import { CollectionObserver } from "svelte-collections";
  import type { MailAccount } from "../../logic/Mail/MailAccount";
  import { openApp } from "../AppsBar/selectedApp";
  import {
    getWorkingHoursSchedule,
    setWorkingHoursSchedule,
  } from "./WorkingHoursSettings";
  import {
    getReportSession,
    setReportSession,
    type ReportSessionSnapshot,
  } from "./ReportSession";
  import { openEMailMessage } from "../Mail/open";
  import ReportPanelControls from "./ReportPanelControls.svelte";
  import ReportSortButton from "./ReportSortButton.svelte";
  import { openLiveSlaWidget } from "../Widgets/widgetState";
  import { createReportHTML, downloadTextFile } from "./ReportsExport";

  type PresetID = ReportDatePreset;
  type ResponseDaySortColumn =
    "day" | "answered" | "average" | "maximum" | "overTarget";
  type ResponseDetailSortColumn =
    "received" | "replied" | "responseTime" | "responder" | "topic" | "status";
  type OutsideHoursSortColumn =
    | "replied"
    | "responder"
    | "responseTime"
    | "topic"
    | "status";
  type ResponderSortColumn =
    | "name"
    | "requests"
    | "answered"
    | "rate"
    | "average"
    | "minimum"
    | "maximum"
    | "withinTarget"
    | "overTarget"
    | "sent"
    | "peak"
    | "lastActivity";
  type TopicSortColumn = "topic" | "requests" | "answered";
  type CategorySortColumn =
    | "name"
    | "total"
    | "incoming"
    | "outgoing"
    | "answered"
    | "average"
    | "minimum"
    | "maximum"
    | "withinTarget"
    | "overTarget";
  type AccountSortColumn = "name" | "total" | "incoming" | "outgoing";
  type CalendarSortColumn = "name" | "events" | "hours" | "participants";
  type ChatSortColumn = "room" | "messages" | "sent" | "lastActivity";
  type FileSortColumn = "directory" | "files" | "size";

  const initialRange = defaultReportDateRange();
  const presets: { id: PresetID; label: string }[] = [
    { id: "7d", label: gt`Last 7 days` },
    { id: "30d", label: gt`Last 30 days` },
    { id: "month", label: gt`Current month` },
    { id: "90d", label: gt`Last 90 days` },
    { id: "year", label: gt`This year` },
    { id: "all", label: gt`All time` },
  ];
  const heatmapHours = Array.from({ length: 24 }, (_, index) => index);
  const weekdays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(2024, 0, index + 1);
    return date.toLocaleDateString(getDateTimeLocale(), { weekday: "short" });
  });
  const weekdayNames = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(2024, 0, index + 1);
    return date.toLocaleDateString(getDateTimeLocale(), { weekday: "long" });
  });
  const REPORT_MAIL_ACCOUNTS_RETRY_DELAY_MS = 250;
  const REPORT_MAIL_ACCOUNTS_MAX_EMPTY_RETRIES = 20;
  const REPORT_DETAIL_PAGE_SIZE = 100;

  let fromDate = initialRange.from;
  let toDate = initialRange.to;
  let activePreset: PresetID | null = "30d";
  let report: ReportData | null = null;
  let mailAccounts: ReportMailAccountOption[] = [];
  let mailAccountsLoading = false;
  let mailAccountsError: Error | null = null;
  let mailAccountsRequestId = 0;
  let mailAccountsReloadTimer: ReturnType<typeof setTimeout> | null = null;
  let mailAccountsEmptyRetryCount = 0;
  let selectedMailAccountId: number | null = null;
  let mailFolders: ReportMailFolderOption[] = [];
  let mailFoldersLoading = false;
  let mailFoldersError: Error | null = null;
  let selectedMailFolderId: number | null = null;
  let mailFoldersRequestId = 0;
  let responseTargetMinutes: number | undefined =
    DEFAULT_RESPONSE_TARGET_MINUTES;
  let workingHours: WorkingHoursSchedule = cloneWorkingHoursSchedule(
    DEFAULT_WORKING_HOURS_SCHEDULE,
  );
  let workingHoursError: WorkingHoursValidationError | null = null;
  let error: Error | null = null;
  let loading = false;
  let exportError: Error | null = null;
  let exportNotice = false;
  let downloadedFilename = "";
  let exporting: "html" | null = null;
  let responseOpenError: Error | null = null;
  let openingResponseEmailId: number | null = null;
  let selectedRhythmCategoryName = "";
  let reportRequestId = 0;
  let categoryFilter: string[] | null = null;
  let responderAttributionMode: ResponderAttributionMode = "profile";
  let selectedResponderCategoryNames: string[] = [];
  let responderAttributionConfigs: Record<string, ResponderAttributionConfig> =
    {};
  let responseDaySort: ReportSortState<ResponseDaySortColumn> | null = null;
  let responseDetailSort: ReportSortState<ResponseDetailSortColumn> | null =
    null;
  let outsideHoursSort: ReportSortState<OutsideHoursSortColumn> | null = null;
  let responderSort: ReportSortState<ResponderSortColumn> | null = null;
  let topicSort: ReportSortState<TopicSortColumn> | null = null;
  let categorySort: ReportSortState<CategorySortColumn> | null = null;
  let accountSort: ReportSortState<AccountSortColumn> | null = null;
  let calendarSort: ReportSortState<CalendarSortColumn> | null = null;
  let chatSort: ReportSortState<ChatSortColumn> | null = null;
  let fileSort: ReportSortState<FileSortColumn> | null = null;
  let dashboardLayout: ReportDashboardPanelLayout[] =
    normalizeReportDashboardLayout(REPORT_DASHBOARD_DEFAULT_LAYOUT);
  let dashboardLayoutMode = false;
  let reportViewerOpen = false;
  let reportViewerElement: HTMLElement;
  let reportViewerContentElement: HTMLElement;
  let reportViewerScrollTop = 0;
  let responseDetailVisibleCount = REPORT_DETAIL_PAGE_SIZE;
  let outsideHoursVisibleCount = REPORT_DETAIL_PAGE_SIZE;
  let draggedPanelId: ReportDashboardSectionId | null = null;
  let fromDateInput: HTMLInputElement;
  let toDateInput: HTMLInputElement;
  const dashboardLayoutSetting = getLocalStorage<unknown>(
    "reports.dashboard.layout.v1",
    REPORT_DASHBOARD_DEFAULT_LAYOUT,
  );
  const responderAttributionSetting = getLocalStorage<unknown>(
    "reports.responder-attribution.v1",
    {},
  );

  class ReportMailAccountsObserver extends CollectionObserver<MailAccount> {
    added(): void {
      scheduleMailAccountsReload();
    }

    removed(): void {
      scheduleMailAccountsReload();
    }
  }

  const reportMailAccountsObserver = new ReportMailAccountsObserver();

  $: rangeError = validateReportDateRange({ from: fromDate, to: toDate });
  $: responseTargetError = validateResponseTargetMinutes(responseTargetMinutes);
  $: workingHoursError = validateWorkingHoursSchedule(workingHours);
  $: hasData =
    !!report &&
    (report.summary.mailMessages > 0 ||
      report.summary.chatMessages > 0 ||
      report.summary.calendarEvents > 0 ||
      report.summary.filesChanged > 0);
  $: timelineMax = report
    ? Math.max(1, ...report.timeline.map((point) => point.total))
    : 1;
  $: heatmapMax = report
    ? Math.max(1, ...report.activity.map((cell) => cell.count))
    : 1;
  $: visibleResponseTimes = report
    ? filterReportResponsesByCategories(
        report.mail.responseTimes,
        categoryFilter,
      )
    : [];
  $: visibleResponseTimeStats = report
    ? buildResponseTimeStats(
        visibleResponseTimes,
        report.summary.responseTargetMinutes,
      )
    : emptyResponseTimeStats();
  $: outsideWorkingHoursResponseTimes = visibleResponseTimes
    .filter(
      (response) =>
        !isWithinWorkingHours(
          response.responseAt,
          report?.workingHours ?? workingHours,
        ),
    )
    .sort(
      (a, b) =>
        b.responseAt.getTime() - a.responseAt.getTime() ||
        b.emailId - a.emailId,
    );
  $: outsideWorkingHoursWithinTargetCount =
    outsideWorkingHoursResponseTimes.filter(
      (response) => response.withinTarget === true,
    ).length;
  $: outsideWorkingHoursOverTargetCount =
    outsideWorkingHoursResponseTimes.filter(
      (response) => response.withinTarget === false,
    ).length;
  $: outsideWorkingHoursNotEvaluatedCount =
    outsideWorkingHoursResponseTimes.filter(
      (response) => response.withinTarget == null,
    ).length;
  $: categorizedOutsideWorkingHoursResponseCount =
    outsideWorkingHoursResponseTimes.filter(responseHasEmployeeCategory).length;
  $: visibleResponseTimeDays = report
    ? buildResponseTimeDays(
        visibleResponseTimes,
        report.summary.responseTargetMinutes,
      )
    : [];
  $: responseTimeDaysWithIssues = visibleResponseTimeDays
    .filter((row) => row.overTarget > 0)
    .sort(
      (a, b) =>
        b.overTarget - a.overTarget ||
        (b.maximumSeconds ?? 0) - (a.maximumSeconds ?? 0) ||
        b.day.localeCompare(a.day),
    );
  $: sortedResponseTimeDays = sortReportRows(
    responseTimeDaysWithIssues,
    responseDaySort,
    responseTimeDaySortValue,
  ).slice(0, 12);
  $: sortedResponseTimes = sortReportRows(
    visibleResponseTimes,
    responseDetailSort,
    responseDetailSortValue,
  );
  $: renderedResponseTimes = sortedResponseTimes.slice(
    0,
    responseDetailVisibleCount,
  );
  $: sortedOutsideWorkingHoursResponseTimes = sortReportRows(
    outsideWorkingHoursResponseTimes,
    outsideHoursSort,
    (row, column) =>
      outsideHoursSortValue(row, column, outsideHoursOwnerCategoryNames),
  );
  $: renderedOutsideWorkingHoursResponseTimes =
    sortedOutsideWorkingHoursResponseTimes.slice(0, outsideHoursVisibleCount);
  $: reportCategories = report?.mail.categories ?? [];
  $: selectedMailAccount =
    mailAccounts.find(
      (account) => account.accountId == selectedMailAccountId,
    ) ?? null;
  $: selectedMailFolder =
    mailFolders.find((folder) => folder.folderId == selectedMailFolderId) ??
    null;
  $: visibleReportCategories =
    categoryFilter == null
      ? reportCategories
      : reportCategories.filter((category) =>
          categoryFilter.includes(category.name),
        );
  $: categoryFilterSummaryText =
    categoryFilter == null
      ? `${formatNumber(reportCategories.length)} — ${$t`all categories`}`
      : `${formatNumber(categoryFilter.length)} / ${formatNumber(reportCategories.length)}`;
  $: responderCategoryCandidates = report
    ? defaultResponderCategoryNames(report.mail.categories)
    : [];
  $: effectiveResponderCategoryNames = intersectResponderCategories(
    selectedResponderCategoryNames,
    categoryFilter,
  );
  $: outsideHoursOwnerCategoryNames =
    responderAttributionMode == "category"
      ? effectiveResponderCategoryNames
      : responderCategoryCandidates;
  $: rhythmCategoryNames =
    responderAttributionMode == "category"
      ? effectiveResponderCategoryNames
      : responderCategoryCandidates.length
        ? responderCategoryCandidates.filter(
            (name) => categoryFilter == null || categoryFilter.includes(name),
          )
        : visibleReportCategories.map((category) => category.name);
  $: categoryRhythmRows = report
    ? buildCategoryRhythmRows(
        visibleResponseTimes,
        report.mail.categories,
        report.workingHours,
        rhythmCategoryNames,
      )
    : [];
  $: sortedCategoryRhythmRows = sortCategoryRhythmRows(categoryRhythmRows);
  $: afterHoursCategoryRows = sortedCategoryRhythmRows.filter(
    (row) => row.afterHours > 0,
  );
  $: afterHoursCategoryMax = Math.max(
    1,
    ...afterHoursCategoryRows.map((row) => row.afterHours),
  );
  $: topAfterHoursCategory = afterHoursCategoryRows[0] ?? null;
  $: effectiveRhythmCategoryName = categoryRhythmRows.some(
    (row) => row.name == selectedRhythmCategoryName,
  )
    ? selectedRhythmCategoryName
    : (afterHoursCategoryRows[0]?.name ??
      sortedCategoryRhythmRows[0]?.name ??
      "");
  $: selectedCategoryRhythmRow =
    categoryRhythmRows.find((row) => row.name == effectiveRhythmCategoryName) ??
    null;
  $: categoryRhythmHeatmapMax = selectedCategoryRhythmRow
    ? Math.max(1, ...selectedCategoryRhythmRow.activity)
    : 1;
  $: visibleResponders =
    report &&
    responderAttributionMode == "category" &&
    selectedMailAccountId != null
      ? buildCategoryResponderRows(
          report.mail.categories,
          selectedMailAccountId,
          effectiveResponderCategoryNames,
        )
      : (report?.mail.responders ?? []);
  $: responderAnsweredTotal = visibleResponders.reduce(
    (total, responder) => total + Math.max(0, responder.answered),
    0,
  );
  $: sortedResponders = sortReportRows(
    visibleResponders,
    responderSort,
    responderSortValue,
  );
  $: sortedTopics = report
    ? sortReportRows(report.mail.topics, topicSort, topicSortValue).slice(0, 12)
    : [];
  $: sortedCategories = sortReportRows(
    visibleReportCategories,
    categorySort,
    categorySortValue,
  ).slice(0, 12);
  $: sortedAccounts = report
    ? sortReportRows(report.mail.accounts, accountSort, accountSortValue).slice(
        0,
        10,
      )
    : [];
  $: sortedCalendars = report
    ? sortReportRows(
        report.calendar.calendars,
        calendarSort,
        calendarSortValue,
      ).slice(0, 10)
    : [];
  $: sortedChatRooms = report
    ? sortReportRows(report.chat.rooms, chatSort, chatSortValue).slice(0, 10)
    : [];
  $: sortedFileDirectories = report
    ? sortReportRows(report.files.directories, fileSort, fileSortValue).slice(
        0,
        10,
      )
    : [];

  // Svelte помечает прямой вызов onMount в этом компоненте как чистый,
  // из-за чего Rollup удаляет регистрацию инициализации из production-сборки.
  // Косвенный вызов сохраняет обязательный запуск загрузки при монтировании.
  const registerReportsOnMount = onMount;
  registerReportsOnMount(initializeReportsApp);

  function initializeReportsApp(): void {
    appGlobal.emailAccounts.registerObserver(reportMailAccountsObserver);
    dashboardLayout = readDashboardLayout();
    responderAttributionConfigs = readResponderAttributionConfigs();
    const restoredSession = restoreReportSession();
    if (!restoredSession) {
      workingHours = getWorkingHoursSchedule(null);
    }
    void initializeReports(restoredSession);
  }

  onDestroy(() => {
    appGlobal.emailAccounts.unregisterObserver(reportMailAccountsObserver);
    if (mailAccountsReloadTimer != null) {
      clearTimeout(mailAccountsReloadTimer);
      mailAccountsReloadTimer = null;
    }
    saveReportSession();
  });

  async function initializeReports(
    restoredSession: ReportSessionSnapshot | null,
  ) {
    await loadMailAccounts();
    if (!restoredSession) {
      await runReport();
      return;
    }

    const restoredFolderId = restoredSession.selectedMailFolderId;
    if (selectedMailAccountId != null) {
      await loadMailFoldersForAccount(selectedMailAccountId);
      if (
        restoredFolderId == null ||
        mailFolders.some((folder) => folder.folderId == restoredFolderId)
      ) {
        selectedMailFolderId = restoredFolderId;
      }
    }

    if (reportViewerOpen) {
      await tick();
      reportViewerElement?.focus();
      if (reportViewerContentElement) {
        reportViewerContentElement.scrollTop = reportViewerScrollTop;
      }
    }
  }

  function restoreReportSession(): ReportSessionSnapshot | null {
    const snapshot = getReportSession();
    if (!snapshot?.report) {
      return null;
    }

    report = snapshot.report;
    fromDate = snapshot.fromDate;
    toDate = snapshot.toDate;
    activePreset = isPresetId(snapshot.activePreset)
      ? snapshot.activePreset
      : null;
    selectedMailAccountId = snapshot.selectedMailAccountId;
    selectedMailFolderId = snapshot.selectedMailFolderId;
    responseTargetMinutes = snapshot.responseTargetMinutes;
    workingHours = cloneWorkingHoursSchedule(snapshot.workingHours);
    categoryFilter = snapshot.categoryFilter
      ? [...snapshot.categoryFilter]
      : null;
    responderAttributionMode = snapshot.responderAttributionMode;
    selectedResponderCategoryNames = [
      ...snapshot.selectedResponderCategoryNames,
    ];
    responseDaySort = restoreSortState(snapshot.responseDaySort);
    responseDetailSort = restoreSortState(snapshot.responseDetailSort);
    outsideHoursSort = restoreSortState(snapshot.outsideHoursSort ?? null);
    responderSort = restoreSortState(snapshot.responderSort);
    topicSort = restoreSortState(snapshot.topicSort);
    categorySort = restoreSortState(snapshot.categorySort);
    accountSort = restoreSortState(snapshot.accountSort);
    calendarSort = restoreSortState(snapshot.calendarSort);
    chatSort = restoreSortState(snapshot.chatSort);
    fileSort = restoreSortState(snapshot.fileSort);
    dashboardLayout = normalizeReportDashboardLayout(snapshot.dashboardLayout);
    reportViewerOpen = snapshot.reportViewerOpen;
    dashboardLayoutMode =
      snapshot.reportViewerOpen && snapshot.dashboardLayoutMode;
    reportViewerScrollTop = Math.max(0, snapshot.reportViewerScrollTop || 0);
    return snapshot;
  }

  function isPresetId(value: string | null): value is PresetID {
    return value != null && presets.some((preset) => preset.id == value);
  }

  function restoreSortState<Column extends string>(
    state: ReportSortState<string> | null,
  ): ReportSortState<Column> | null {
    return state as ReportSortState<Column> | null;
  }

  function saveReportSession(): void {
    setReportSession({
      report,
      fromDate,
      toDate,
      activePreset,
      selectedMailAccountId,
      selectedMailFolderId,
      responseTargetMinutes,
      workingHours: cloneWorkingHoursSchedule(workingHours),
      categoryFilter: categoryFilter ? [...categoryFilter] : null,
      responderAttributionMode,
      selectedResponderCategoryNames: [...selectedResponderCategoryNames],
      responseDaySort,
      responseDetailSort,
      outsideHoursSort,
      responderSort,
      topicSort,
      categorySort,
      accountSort,
      calendarSort,
      chatSort,
      fileSort,
      dashboardLayout: dashboardLayout.map((panel) => ({ ...panel })),
      dashboardLayoutMode: reportViewerOpen && dashboardLayoutMode,
      reportViewerOpen,
      reportViewerScrollTop:
        reportViewerContentElement?.scrollTop ?? reportViewerScrollTop,
    });
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
      } else if (
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
    if (mailAccountsReloadTimer != null) {
      return;
    }
    mailAccountsReloadTimer = setTimeout(() => {
      mailAccountsReloadTimer = null;
      void loadMailAccounts();
    }, delayMs);
  }

  async function loadMailFoldersForAccount(accountId: number | null) {
    const requestId = ++mailFoldersRequestId;
    mailFoldersLoading = accountId != null;
    mailFoldersError = null;
    mailFolders = [];
    if (accountId == null) {
      selectedMailFolderId = null;
      mailFoldersLoading = false;
      return;
    }
    try {
      const folders = await loadReportMailFolders(accountId);
      if (requestId != mailFoldersRequestId) {
        return;
      }
      mailFolders = folders;
      selectedMailFolderId = findInboxFolder(folders)?.folderId ?? null;
    } catch (ex) {
      if (requestId == mailFoldersRequestId) {
        mailFoldersError = ex instanceof Error ? ex : new Error(String(ex));
        selectedMailFolderId = null;
      }
    } finally {
      if (requestId == mailFoldersRequestId) {
        mailFoldersLoading = false;
      }
    }
  }

  async function runReport(): Promise<boolean> {
    const range: ReportDateRange = { from: fromDate, to: toDate };
    if (
      validateReportDateRange(range) ||
      validateWorkingHoursSchedule(workingHours)
    ) {
      return false;
    }
    const requestId = ++reportRequestId;
    loading = true;
    error = null;
    exportError = null;
    exportNotice = false;
    downloadedFilename = "";
    responseOpenError = null;
    try {
      const nextReport = await loadReportData(range, {
        mailAccountId: selectedMailAccountId,
        mailboxAddress: selectedMailAccount?.email ?? null,
        mailFolderId: selectedMailFolderId,
        responseTargetMinutes: normalizeResponseTargetMinutes(
          responseTargetMinutes,
        ),
        workingHours: normalizeWorkingHoursSchedule(workingHours),
      });
      if (requestId == reportRequestId) {
        resetResponseDetailVisibility();
        report = nextReport;
        syncResponderAttribution(nextReport);
        return true;
      }
      return false;
    } catch (ex) {
      if (requestId == reportRequestId) {
        error = ex instanceof Error ? ex : new Error(String(ex));
      }
      return false;
    } finally {
      if (requestId == reportRequestId) {
        loading = false;
      }
    }
  }

  async function buildDetailedReport(): Promise<void> {
    const built = await runReport();
    if (built && report) {
      await openReportViewer();
    }
  }

  async function openReportViewer(): Promise<void> {
    if (report && !loading) {
      reportViewerOpen = true;
      reportViewerScrollTop = 0;
      await tick();
      reportViewerElement?.focus();
      if (reportViewerContentElement) {
        reportViewerContentElement.scrollTop = 0;
      }
    }
  }

  function openLiveSlaControl(): void {
    saveReportSession();
    openLiveSlaWidget();
  }

  function closeReportViewer(): void {
    reportViewerOpen = false;
    dashboardLayoutMode = false;
    draggedPanelId = null;
  }

  function resetResponseDetailVisibility(): void {
    responseDetailVisibleCount = REPORT_DETAIL_PAGE_SIZE;
    outsideHoursVisibleCount = REPORT_DETAIL_PAGE_SIZE;
  }

  function showMoreResponseDetails(): void {
    responseDetailVisibleCount = Math.min(
      responseDetailVisibleCount + REPORT_DETAIL_PAGE_SIZE,
      sortedResponseTimes.length,
    );
  }

  function showMoreOutsideHoursResponses(): void {
    outsideHoursVisibleCount = Math.min(
      outsideHoursVisibleCount + REPORT_DETAIL_PAGE_SIZE,
      outsideWorkingHoursResponseTimes.length,
    );
  }

  function onReportViewerKeydown(event: KeyboardEvent): void {
    if (
      (event.key == "Escape" ||
        event.key == "Esc" ||
        event.code == "Escape" ||
        event.keyCode == 27 ||
        event.which == 27) &&
      reportViewerOpen
    ) {
      event.preventDefault();
      closeReportViewer();
    }
  }

  function scrollReportSection(sectionId: string): void {
    const viewer = reportViewerContentElement;
    const section = viewer?.querySelector<HTMLElement>(`#${sectionId}`);
    if (!viewer || !section) {
      return;
    }
    const targetTop =
      section.getBoundingClientRect().top -
      viewer.getBoundingClientRect().top +
      viewer.scrollTop -
      16;
    viewer.scrollTo({
      top: Math.max(0, targetTop),
      behavior: "smooth",
    });
  }

  function responseTimeDaySortValue(
    row: ReportData["mail"]["responseTimeDays"][number],
    column: ResponseDaySortColumn,
  ): ReportSortValue {
    switch (column) {
      case "day":
        return row.day;
      case "answered":
        return row.answered;
      case "average":
        return row.averageSeconds;
      case "maximum":
        return row.maximumSeconds;
      case "overTarget":
        return row.overTarget;
    }
  }

  function responseDetailSortValue(
    row: ReportData["mail"]["responseTimes"][number],
    column: ResponseDetailSortColumn,
  ): ReportSortValue {
    switch (column) {
      case "received":
        return row.requestAt;
      case "replied":
        return row.responseAt;
      case "responseTime":
        return row.durationSeconds ?? row.actualDurationSeconds;
      case "responder":
        return responseResponderLabel(row);
      case "topic":
        return row.subject;
      case "status":
        return responseStatusSortValue(row);
    }
  }

  function outsideHoursSortValue(
    row: ReportData["mail"]["responseTimes"][number],
    column: OutsideHoursSortColumn,
    ownerCategoryNames: string[],
  ): ReportSortValue {
    switch (column) {
      case "replied":
        return row.responseAt;
      case "responder":
        return responseAfterHoursOwnerLabel(row, ownerCategoryNames);
      case "responseTime":
        return row.withinTarget == null
          ? row.actualDurationSeconds
          : row.durationSeconds;
      case "topic":
        return row.subject;
      case "status":
        return responseStatusSortValue(row);
    }
  }

  function responseStatusSortValue(row: {
    withinTarget: boolean | null;
  }): ReportSortValue {
    return row.withinTarget === true
      ? 0
      : row.withinTarget === false
        ? 1
        : 2;
  }

  function responderSortValue(
    row: ReportData["mail"]["responders"][number],
    column: ResponderSortColumn,
  ): ReportSortValue {
    switch (column) {
      case "name":
        return row.accountName;
      case "requests":
        return row.requests;
      case "answered":
        return row.answered;
      case "rate":
        return responderResponseShare(row.answered);
      case "average":
        return row.responseTime.averageSeconds;
      case "minimum":
        return row.responseTime.minimumSeconds;
      case "maximum":
        return row.responseTime.maximumSeconds;
      case "withinTarget":
        return row.responseTime.withinTarget;
      case "overTarget":
        return row.responseTime.overTarget;
      case "sent":
        return row.sent;
      case "peak":
        return row.peakWeekday == null || row.peakHour == null
          ? null
          : row.peakWeekday * 24 + row.peakHour;
      case "lastActivity":
        return row.lastActivity;
    }
  }

  function topicSortValue(
    row: ReportData["mail"]["topics"][number],
    column: TopicSortColumn,
  ): ReportSortValue {
    switch (column) {
      case "topic":
        return row.topic;
      case "requests":
        return row.requests;
      case "answered":
        return row.answered;
    }
  }

  function categorySortValue(
    row: ReportData["mail"]["categories"][number],
    column: CategorySortColumn,
  ): ReportSortValue {
    switch (column) {
      case "name":
        return row.name;
      case "total":
        return row.total;
      case "incoming":
        return row.incoming;
      case "outgoing":
        return row.outgoing;
      case "answered":
        return row.answered;
      case "average":
        return row.responseTime.averageSeconds;
      case "minimum":
        return row.responseTime.minimumSeconds;
      case "maximum":
        return row.responseTime.maximumSeconds;
      case "withinTarget":
        return row.responseTime.withinTarget;
      case "overTarget":
        return row.responseTime.overTarget;
    }
  }

  function accountSortValue(
    row: ReportData["mail"]["accounts"][number],
    column: AccountSortColumn,
  ): ReportSortValue {
    switch (column) {
      case "name":
        return row.accountName;
      case "total":
        return row.total;
      case "incoming":
        return row.incoming;
      case "outgoing":
        return row.outgoing;
    }
  }

  function calendarSortValue(
    row: ReportData["calendar"]["calendars"][number],
    column: CalendarSortColumn,
  ): ReportSortValue {
    switch (column) {
      case "name":
        return row.calendarName;
      case "events":
        return row.events;
      case "hours":
        return row.hours;
      case "participants":
        return row.participants;
    }
  }

  function chatSortValue(
    row: ReportData["chat"]["rooms"][number],
    column: ChatSortColumn,
  ): ReportSortValue {
    switch (column) {
      case "room":
        return row.roomName;
      case "messages":
        return row.total;
      case "sent":
        return row.outgoing;
      case "lastActivity":
        return row.lastActivity;
    }
  }

  function fileSortValue(
    row: ReportData["files"]["directories"][number],
    column: FileSortColumn,
  ): ReportSortValue {
    switch (column) {
      case "directory":
        return row.directoryName;
      case "files":
        return row.files;
      case "size":
        return row.bytes;
    }
  }

  function reportSortAriaValue<Column extends string>(
    state: ReportSortState<Column> | null,
    column: Column,
  ): "ascending" | "descending" | undefined {
    if (!state || state.column !== column) {
      return undefined;
    }
    return state.direction === "asc" ? "ascending" : "descending";
  }

  function reportSortDirection<Column extends string>(
    state: ReportSortState<Column> | null,
    column: Column,
  ): ReportSortDirection | null {
    return state?.column === column ? state.direction : null;
  }

  function applyPreset(id: PresetID) {
    const range = reportDateRangeForPreset(id);
    fromDate = range.from;
    toDate = range.to;
    activePreset = id;
    categoryFilter = null;
    closeReportViewer();
    void runReport();
  }

  function onDateChange() {
    activePreset = null;
    categoryFilter = null;
    closeReportViewer();
  }

  function openDatePicker(input: HTMLInputElement | undefined): void {
    if (!input) {
      return;
    }
    input.focus();
    try {
      input.showPicker?.();
    } catch {
      // В старых версиях Chromium календарь открывается кликом по самому полю.
    }
  }

  async function onMailAccountChange(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    selectedMailAccountId = value ? Number(value) : null;
    selectedMailFolderId = null;
    categoryFilter = null;
    closeReportViewer();
    syncResponderAttribution(null);
    workingHours = getWorkingHoursSchedule(selectedMailAccountId);
    await loadMailFoldersForAccount(selectedMailAccountId);
    void runReport();
  }

  function onMailFolderChange(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    selectedMailFolderId = value ? Number(value) : null;
    categoryFilter = null;
    closeReportViewer();
    void runReport();
  }

  function readDashboardLayout(): ReportDashboardPanelLayout[] {
    try {
      return normalizeReportDashboardLayout(dashboardLayoutSetting.value);
    } catch {
      return normalizeReportDashboardLayout(REPORT_DASHBOARD_DEFAULT_LAYOUT);
    }
  }

  function readResponderAttributionConfigs(): Record<
    string,
    ResponderAttributionConfig
  > {
    try {
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
    } catch {
      return {};
    }
  }

  function syncResponderAttribution(nextReport: ReportData | null): void {
    if (selectedMailAccountId == null || !nextReport) {
      responderAttributionMode = "profile";
      selectedResponderCategoryNames = [];
      return;
    }
    const fallbackNames = defaultResponderCategoryNames(
      nextReport.mail.categories,
    );
    const fallback: ResponderAttributionConfig = {
      mode: fallbackNames.length ? "category" : "profile",
      categoryNames: fallbackNames,
    };
    const saved = responderAttributionConfigs[String(selectedMailAccountId)];
    const config = normalizeResponderAttributionConfig(saved, fallback);
    responderAttributionMode = config.mode;
    selectedResponderCategoryNames = config.categoryNames;
  }

  function saveResponderAttribution(): void {
    if (selectedMailAccountId == null) {
      return;
    }
    const next = {
      ...responderAttributionConfigs,
      [String(selectedMailAccountId)]: {
        mode: responderAttributionMode,
        categoryNames: [...selectedResponderCategoryNames],
      },
    };
    responderAttributionConfigs = next;
    responderAttributionSetting.value = next;
  }

  function persistWorkingHoursSchedule(): void {
    const validation = validateWorkingHoursSchedule(workingHours);
    workingHoursError = validation;
    if (validation || selectedMailAccountId == null) {
      return;
    }
    setWorkingHoursSchedule(selectedMailAccountId, workingHours);
  }

  function onWorkingDayEnabledChange(index: number, event: Event): void {
    const enabled = (event.currentTarget as HTMLInputElement).checked;
    workingHours = {
      days: workingHours.days.map((day, dayIndex) =>
        dayIndex == index ? { ...day, enabled } : day,
      ),
    };
    persistWorkingHoursSchedule();
  }

  function onWorkingTimeChange(
    index: number,
    field: "startMinutes" | "endMinutes",
    event: Event,
  ): void {
    const minutes = parseWorkingTime(
      (event.currentTarget as HTMLInputElement).value,
    );
    if (minutes == null) {
      return;
    }
    workingHours = {
      days: workingHours.days.map((day, dayIndex) =>
        dayIndex == index ? { ...day, [field]: minutes } : day,
      ),
    };
    persistWorkingHoursSchedule();
  }

  function resetWorkingHoursSchedule(): void {
    workingHours = cloneWorkingHoursSchedule(DEFAULT_WORKING_HOURS_SCHEDULE);
    persistWorkingHoursSchedule();
  }

  function onResponderModeChange(event: Event): void {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (value != "profile" && value != "category") {
      return;
    }
    responderAttributionMode = value;
    if (value == "category" && selectedResponderCategoryNames.length == 0) {
      selectedResponderCategoryNames = responderCategoryCandidates.slice();
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
    saveResponderAttribution();
  }

  function onCategoryFilterChange(name: string, checked: boolean): void {
    const allNames = reportCategories.map((category) => category.name);
    const selected = new Set(categoryFilter ?? allNames);
    if (checked) {
      selected.add(name);
    } else {
      selected.delete(name);
    }
    categoryFilter = [...selected];
  }

  function onCategoryCheckboxChange(name: string, event: Event): void {
    onCategoryFilterChange(
      name,
      (event.currentTarget as HTMLInputElement).checked,
    );
  }

  function onResponderCheckboxChange(name: string, event: Event): void {
    onResponderCategoryChange(
      name,
      (event.currentTarget as HTMLInputElement).checked,
    );
  }

  function onRhythmCategoryChange(event: Event): void {
    selectedRhythmCategoryName = (event.currentTarget as HTMLSelectElement)
      .value;
  }

  function selectAllCategories(): void {
    categoryFilter = null;
  }

  function clearCategories(): void {
    categoryFilter = [];
  }

  function dashboardPanel(
    id: ReportDashboardSectionId,
    layout: ReportDashboardPanelLayout[] = dashboardLayout,
  ): ReportDashboardPanelLayout {
    return (
      layout.find((panel) => panel.id == id) ??
      REPORT_DASHBOARD_DEFAULT_LAYOUT.find((panel) => panel.id == id) ??
      REPORT_DASHBOARD_DEFAULT_LAYOUT[0]
    );
  }

  function dashboardPanelStyle(
    id: ReportDashboardSectionId,
    layout: ReportDashboardPanelLayout[],
  ): string {
    const panel = dashboardPanel(id, layout);
    return `order: ${layout.findIndex(
      (item) => item.id == id,
    )}; grid-column: span ${reportDashboardWidthColumns(panel.width)}`;
  }

  function dashboardPanelClass(
    id: ReportDashboardSectionId,
    layout: ReportDashboardPanelLayout[],
  ): string {
    const panel = dashboardPanel(id, layout);
    return `dashboard-item layout-${panel.width}${panel.tall ? " layout-tall" : ""}`;
  }

  function dashboardSectionLabel(id: ReportDashboardSectionId): string {
    switch (id) {
      case "timeline":
        return $t`Activity over time`;
      case "heatmap":
        return $t`When activity happens`;
      case "response-time":
        return $t`First response speed`;
      case "response-details":
        return $t`Response details`;
      case "category-rhythm":
        return $t`Employee work rhythm`;
      case "responders":
        return $t`Who answers`;
      case "topics":
        return $t`Frequent requests`;
      case "categories":
        return $t`Categories and tags`;
      case "mail-breakdown":
        return $t`Mail breakdown`;
      case "calendar":
        return $t`Calendar workload`;
      case "chat":
        return $t`Chat rooms`;
      case "files":
        return $t`Files changed`;
    }
  }

  function persistDashboardLayout(next: ReportDashboardPanelLayout[]): void {
    dashboardLayout = normalizeReportDashboardLayout(next);
    dashboardLayoutSetting.value = dashboardLayout;
  }

  function onDashboardMove(
    id: ReportDashboardSectionId,
    event: CustomEvent<"up" | "down">,
  ): void {
    persistDashboardLayout(
      moveReportDashboardPanel(dashboardLayout, id, event.detail),
    );
  }

  function onDashboardWidth(
    id: ReportDashboardSectionId,
    event: CustomEvent<ReportDashboardWidth>,
  ): void {
    persistDashboardLayout(
      dashboardLayout.map((panel) =>
        panel.id == id ? { ...panel, width: event.detail } : panel,
      ),
    );
  }

  function onDashboardHeight(
    id: ReportDashboardSectionId,
    event: CustomEvent<boolean>,
  ): void {
    persistDashboardLayout(
      dashboardLayout.map((panel) =>
        panel.id == id ? { ...panel, tall: event.detail } : panel,
      ),
    );
  }

  function resetDashboardLayout(): void {
    persistDashboardLayout(REPORT_DASHBOARD_DEFAULT_LAYOUT);
  }

  function onDashboardDragStart(
    id: ReportDashboardSectionId,
    event: DragEvent,
  ): void {
    if (!dashboardLayoutMode) {
      event.preventDefault();
      return;
    }
    draggedPanelId = id;
    event.dataTransfer?.setData("text/plain", id);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
    }
  }

  function onDashboardDrop(
    targetId: ReportDashboardSectionId,
    event: DragEvent,
  ): void {
    event.preventDefault();
    const sourceId =
      draggedPanelId ?? event.dataTransfer?.getData("text/plain");
    if (!sourceId || !isDashboardSectionId(sourceId)) {
      draggedPanelId = null;
      return;
    }
    persistDashboardLayout(
      moveReportDashboardPanelBefore(dashboardLayout, sourceId, targetId),
    );
    draggedPanelId = null;
  }

  function onDashboardDragEnd(): void {
    draggedPanelId = null;
  }

  function isDashboardSectionId(
    value: string,
  ): value is ReportDashboardSectionId {
    return REPORT_DASHBOARD_DEFAULT_LAYOUT.some((panel) => panel.id == value);
  }

  function responseResponderLabel(response: {
    accountName: string;
    responderAccountName?: string | null;
    categoryNames: string[];
  }): string {
    if (responderAttributionMode == "category") {
      const names = response.categoryNames.filter((name) =>
        effectiveResponderCategoryNames.includes(name),
      );
      if (names.length) {
        return names.join(", ");
      }
      return $t`Employee not identified`;
    }
    return response.responderAccountName || response.accountName;
  }

  function currentEmployeeCategoryNames(): string[] {
    return responderAttributionMode == "category"
      ? effectiveResponderCategoryNames
      : responderCategoryCandidates;
  }

  function responseHasEmployeeCategory(response: {
    categoryNames: string[];
  }): boolean {
    return response.categoryNames.some((name) =>
      currentEmployeeCategoryNames().includes(name.trim()),
    );
  }

  function responseAfterHoursOwnerLabel(
    response: {
      accountName: string;
      responderAccountName?: string | null;
      categoryNames: string[];
    },
    ownerCategoryNames = currentEmployeeCategoryNames(),
  ): string {
    const employeeNames = response.categoryNames.filter((name) =>
      ownerCategoryNames.includes(name.trim()),
    );
    return employeeNames.length
      ? employeeNames.join(", ")
      : response.responderAccountName || response.accountName;
  }

  async function openReportEmail(
    response: ReportData["mail"]["responseTimes"][number],
  ) {
    openingResponseEmailId = response.emailId;
    responseOpenError = null;
    try {
      const account = appGlobal.emailAccounts.find(
        (candidate) => String(candidate.dbID) == String(response.accountId),
      );
      if (!account) {
        throw new Error($t`The mailbox for this message is not available.`);
      }
      await account.readFromDB();
      const folder = account.findFolder(
        (candidate) => String(candidate.dbID) == String(response.folderId),
      );
      if (!folder) {
        throw new Error($t`The folder for this message is not available.`);
      }
      let email = folder.messages.find(
        (candidate) => String(candidate.dbID) == String(response.emailId),
      );
      if (!email) {
        email = folder.newEMail();
        email.dbID = response.emailId;
      }
      await email.storage.readMessage(email);
      await openEMailMessage(email);
    } catch (ex) {
      responseOpenError = ex instanceof Error ? ex : new Error(String(ex));
    } finally {
      openingResponseEmailId = null;
    }
  }

  function findInboxFolder(
    folders: ReportMailFolderOption[],
  ): ReportMailFolderOption | null {
    return (
      folders.find(
        (folder) =>
          folder.specialUse?.toLocaleLowerCase() == "inbox" ||
          folder.path.toLocaleUpperCase() == "INBOX" ||
          folder.name.toLocaleLowerCase() == "входящие",
      ) ?? null
    );
  }

  function validateResponseTargetMinutes(
    value: number | undefined,
  ): "invalid" | null {
    return typeof value == "number" &&
      Number.isInteger(value) &&
      value >= MIN_RESPONSE_TARGET_MINUTES &&
      value <= MAX_RESPONSE_TARGET_MINUTES
      ? null
      : "invalid";
  }

  async function exportHTML() {
    if (!report || exporting) return;
    exporting = "html";
    exportError = null;
    exportNotice = false;
    downloadedFilename = "";
    try {
      const exportReport = reportForExport();
      const filename = `jackdaw-mail-report-${report.range.from}-${report.range.to}.html`;
      downloadedFilename = await downloadTextFile(
        createReportHTML(exportReport, exportOptions()),
        filename,
        "text/html;charset=utf-8",
      );
      exportNotice = true;
    } catch (ex) {
      exportError = ex instanceof Error ? ex : new Error(String(ex));
      exportNotice = false;
    } finally {
      exporting = null;
    }
  }

  function reportForExport(): ReportData {
    if (!report) {
      throw new Error("Отчёт ещё не построен");
    }
    const responseTimes = visibleResponseTimes.map((response) => ({
      ...response,
      accountName: responseResponderLabel(response),
    }));
    return {
      ...report,
      summary: {
        ...report.summary,
        responseTime: visibleResponseTimeStats,
      },
      mail: {
        ...report.mail,
        summary: {
          ...report.mail.summary,
          responseTime: visibleResponseTimeStats,
        },
        responders: visibleResponders,
        responseTimes,
        responseTimeDays: visibleResponseTimeDays,
        categories: visibleReportCategories,
      },
    };
  }

  function exportOptions() {
    return {
      categoryFilterLabel:
        categoryFilter == null
          ? undefined
          : `${categoryFilter.length} / ${reportCategories.length}`,
      responderColumnLabel:
        responderAttributionMode == "category" ? "Сотрудник" : "Профиль",
      responderMetricLabel:
        responderAttributionMode == "category"
          ? "Подтверждённые ответы"
          : "Отправлено",
      employeeCategoryNames: currentEmployeeCategoryNames(),
      rhythmCategoryNames,
      rhythmSelectedCategoryName: effectiveRhythmCategoryName,
    };
  }

  function formatNumber(value: number, maximumFractionDigits = 0): string {
    return new Intl.NumberFormat(getDateTimeLocale(), {
      maximumFractionDigits,
    }).format(value || 0);
  }

  function formatBytes(bytes: number): string {
    if (!bytes) return "0 Б";
    const units = getDateTimeLocale().startsWith("ru")
      ? ["Б", "КБ", "МБ", "ГБ", "ТБ"]
      : ["B", "KB", "MB", "GB", "TB"];
    const index = Math.min(
      Math.floor(Math.log(bytes) / Math.log(1024)),
      units.length - 1,
    );
    return `${formatNumber(bytes / Math.pow(1024, index), index ? 1 : 0)} ${units[index]}`;
  }

  function formatHours(hours: number): string {
    return new Intl.NumberFormat(getDateTimeLocale(), {
      style: "unit",
      unit: "hour",
      unitDisplay: "short",
      maximumFractionDigits: 1,
    }).format(hours || 0);
  }

  function formatDuration(seconds: number | null): string {
    if (seconds == null || !Number.isFinite(seconds)) {
      return "—";
    }
    const totalSeconds = Math.max(0, Math.round(seconds));
    const days = Math.floor(totalSeconds / 86_400);
    const hours = Math.floor((totalSeconds % 86_400) / 3_600);
    const minutes = Math.floor((totalSeconds % 3_600) / 60);
    const restSeconds = totalSeconds % 60;
    if (days) {
      return `${formatNumber(days)} д ${formatNumber(hours)} ч`;
    }
    if (hours) {
      return minutes
        ? `${formatNumber(hours)} ч ${formatNumber(minutes)} мин`
        : `${formatNumber(hours)} ч`;
    }
    if (minutes) {
      return restSeconds
        ? `${formatNumber(minutes)} мин ${formatNumber(restSeconds)} с`
        : `${formatNumber(minutes)} мин`;
    }
    return `${formatNumber(restSeconds)} с`;
  }

  function formatResponseDuration(response: {
    durationSeconds: number | null;
    actualDurationSeconds: number | null;
    withinTarget: boolean | null;
  }): string {
    if (response.withinTarget == null) {
      return response.actualDurationSeconds == null
        ? $t`Not evaluated`
        : formatDuration(response.actualDurationSeconds);
    }
    return response.durationSeconds == null
      ? $t`Not evaluated`
      : formatDuration(response.durationSeconds);
  }

  function formatResponseStatus(response: {
    responseTimeStatus: ResponseTimeStatus;
    withinTarget: boolean | null;
  }): string {
    if (response.withinTarget === true) {
      return $t`On time`;
    }
    if (response.withinTarget === false) {
      return $t`Overdue`;
    }
    return $t`Not evaluated`;
  }

  function isResponseOutsideWorkingHours(response: {
    responseAt: Date;
  }): boolean {
    return !isWithinWorkingHours(
      response.responseAt,
      report?.workingHours ?? workingHours,
    );
  }

  function formatPercent(value: number): string {
    const normalized = Number.isFinite(value) ? Math.max(0, value) : 0;
    return new Intl.NumberFormat(getDateTimeLocale(), {
      style: "percent",
      maximumFractionDigits: 2,
    }).format(normalized);
  }

  function responseRate(answered: number, total: number): number {
    return total ? answered / total : 0;
  }

  function responderResponseShare(answered: number): number {
    return calculateResponderResponseShare(answered, responderAnsweredTotal);
  }

  function formatDate(date: Date | null): string {
    return (
      date?.toLocaleDateString(getDateTimeLocale(), {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }) ?? "—"
    );
  }

  function formatDateTime(date: Date): string {
    return date.toLocaleString(getDateTimeLocale(), {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }

  function formatRange(range: ReportDateRange): string {
    const from = parseInputDate(range.from);
    const to = parseInputDate(range.to);
    if (!from || !to) return `${range.from} → ${range.to}`;
    return `${formatDate(from)} → ${formatDate(to)}`;
  }

  function granularityLabel(granularity: TimelineGranularity): string {
    return granularity == "day"
      ? $t`daily`
      : granularity == "week"
        ? $t`weekly`
        : $t`monthly`;
  }

  function timelineLabel(
    value: string,
    granularity: TimelineGranularity,
  ): string {
    const date = parseInputDate(value);
    if (!date) return value;
    if (granularity == "month") {
      return date.toLocaleDateString(getDateTimeLocale(), {
        month: "short",
        year: "numeric",
      });
    }
    if (granularity == "week") {
      return date.toLocaleDateString(getDateTimeLocale(), {
        day: "numeric",
        month: "short",
      });
    }
    return date.toLocaleDateString(getDateTimeLocale(), {
      day: "numeric",
      month: "short",
    });
  }

  function timelineTitle(point: ReportTimelinePoint): string {
    return `${timelineLabel(point.start, report?.granularity ?? "day")}: ${formatNumber(point.total)}`;
  }

  function shouldShowTimelineLabel(
    point: ReportTimelinePoint,
    points: ReportTimelinePoint[],
  ): boolean {
    const index = points.indexOf(point);
    const step = Math.max(1, Math.ceil(points.length / 12));
    return index % step == 0;
  }

  function barHeight(value: number): number {
    return value ? Math.max(3, (value / timelineMax) * 100) : 0;
  }

  function heatmapCount(
    cells: { weekday: number; hour: number; count: number }[],
    weekday: number,
    hour: number,
  ): number {
    return (
      cells.find((cell) => cell.weekday == weekday && cell.hour == hour)
        ?.count ?? 0
    );
  }

  function heatmapOpacity(count: number): number {
    if (!count) return 0;
    return Math.max(0.14, Math.min(1, count / heatmapMax));
  }

  function categoryRhythmHeatmapCount(
    row: CategoryRhythmRow,
    weekday: number,
    hour: number,
  ): number {
    return row.activity[weekday * heatmapHours.length + hour] ?? 0;
  }

  function categoryRhythmHeatmapOpacity(
    count: number,
    maximum: number,
  ): number {
    if (!count) return 0;
    return Math.max(0.14, Math.min(1, count / maximum));
  }

  function rhythmBarWidth(value: number, maximum: number): string {
    if (!value || maximum <= 0) return "0%";
    return `${Math.max(4, Math.round((value / maximum) * 100))}%`;
  }

  function formatHour(hour: number | null): string {
    return hour == null ? "—" : `${String(hour).padStart(2, "0")}:00`;
  }

  function formatWorkingHoursSummary(schedule: WorkingHoursSchedule): string {
    return schedule.days
      .map((day, index) =>
        day.enabled
          ? `${weekdays[index] ?? "—"} ${formatWorkingTime(day.startMinutes)}–${formatWorkingTime(day.endMinutes)}`
          : `${weekdays[index] ?? "—"} — ${$t`Day off`}`,
      )
      .join(" · ");
  }

  function formatPeakDay(weekday: number | null): string {
    return weekday == null ? $t`no peak yet` : (weekdays[weekday] ?? "—");
  }

  function formatPeakHour(hour: number | null): string {
    return hour == null ? $t`no peak yet` : formatHour(hour);
  }

  function formatResponderPeak(
    weekday: number | null,
    hour: number | null,
  ): string {
    if (weekday == null || hour == null) {
      return "—";
    }
    return `${weekdays[weekday] ?? "—"} ${formatHour(hour)}`;
  }

  function formatRhythmSlot(
    weekday: number | null,
    hour: number | null,
  ): string {
    return weekday == null || hour == null
      ? "—"
      : `${weekdays[weekday] ?? "—"} ${formatHour(hour)}`;
  }

  function parseInputDate(value: string): Date | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return null;
    const date = new Date(0);
    date.setHours(0, 0, 0, 0);
    date.setFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return date.getFullYear() == Number(match[1]) &&
      date.getMonth() == Number(match[2]) - 1 &&
      date.getDate() == Number(match[3])
      ? date
      : null;
  }
</script>

<svelte:head>
  <title>{$t`Reports`} — Jackdaw Mail</title>
</svelte:head>

<main class="reports-page" aria-busy={loading}>
  <header
    class="reports-header"
    aria-hidden={reportViewerOpen}
    inert={reportViewerOpen}
  >
    <div class="title-block">
      <p class="eyebrow">{$t`ACTIVITY REPORTS`}</p>
      <h1>{$t`Reports`}</h1>
      <p class="lead">
        {$t`See who answers, which requests repeat, and when work is most active.`}
      </p>
    </div>
    <div class="header-actions" aria-label={$t`Report actions`}>
      {#if !reportViewerOpen && report}
        <button
          type="button"
          class="header-button"
          disabled={loading}
          on:click={openReportViewer}
        >
          <ChartIcon size="15px" />
          <span>{$t`Open detailed report`}</span>
        </button>
      {/if}
    </div>
  </header>

  <section
    class="filter-panel"
    aria-labelledby="report-period-title"
    aria-hidden={reportViewerOpen}
    inert={reportViewerOpen}
  >
    <div class="filter-heading">
      <div>
        <h2 id="report-period-title">{$t`Report period`}</h2>
        <p>{$t`The end date is included in the report.`}</p>
      </div>
      <button
        type="button"
        class="refresh-button"
        disabled={loading}
        on:click={runReport}
      >
        <RefreshIcon size="15px" class={loading ? "spinning" : ""} />
        <span>{$t`Refresh`}</span>
      </button>
    </div>

    <div class="preset-list" role="group" aria-label={$t`Period presets`}>
      {#each presets as preset}
        <button
          type="button"
          class="preset-button"
          class:active={activePreset === preset.id}
          aria-pressed={activePreset === preset.id}
          on:click={() => applyPreset(preset.id)}
        >
          {preset.label}
        </button>
      {/each}
    </div>

    <div class="date-controls">
      <div class="date-field">
        <label for="report-from-date">{$t`From`}</label>
        <div class="date-input-wrap">
          <input
            id="report-from-date"
            bind:this={fromDateInput}
            type="date"
            bind:value={fromDate}
            on:change={onDateChange}
          />
          <button
            type="button"
            class="date-picker-button"
            title={$t`Open calendar`}
            aria-label={$t`Open calendar`}
            on:click={() => openDatePicker(fromDateInput)}
          >
            <CalendarIcon size="15px" />
          </button>
        </div>
      </div>
      <span class="date-separator" aria-hidden="true">→</span>
      <div class="date-field">
        <label for="report-to-date">{$t`To date`}</label>
        <div class="date-input-wrap">
          <input
            id="report-to-date"
            bind:this={toDateInput}
            type="date"
            bind:value={toDate}
            on:change={onDateChange}
          />
          <button
            type="button"
            class="date-picker-button"
            title={$t`Open calendar`}
            aria-label={$t`Open calendar`}
            on:click={() => openDatePicker(toDateInput)}
          >
            <CalendarIcon size="15px" />
          </button>
        </div>
      </div>
      <label class="mail-account-control">
        <span>{$t`Mail account`}</span>
        <select
          bind:value={selectedMailAccountId}
          disabled={mailAccountsLoading || loading}
          on:change={onMailAccountChange}
        >
          <option value={null}>{$t`All mail accounts`}</option>
          {#each mailAccounts as account}
            <option value={account.accountId}
              >{account.accountName}{account.email
                ? ` — ${account.email}`
                : ""}</option
            >
          {/each}
        </select>
      </label>
      <label class="mail-folder-control">
        <span>{$t`Mail folder`}</span>
        <select
          bind:value={selectedMailFolderId}
          disabled={selectedMailAccountId == null ||
            mailFoldersLoading ||
            loading}
          on:change={onMailFolderChange}
        >
          <option value={null}
            >{selectedMailAccountId == null
              ? $t`Select a mail account first`
              : $t`All folders`}</option
          >
          {#each mailFolders as folder}
            <option value={folder.folderId}>{folder.name}</option>
          {/each}
        </select>
      </label>
      <label class="response-target-control">
        <span>{$t`Response target`}</span>
        <span class="number-control">
          <input
            type="number"
            min={MIN_RESPONSE_TARGET_MINUTES}
            max={MAX_RESPONSE_TARGET_MINUTES}
            step="5"
            bind:value={responseTargetMinutes}
            aria-invalid={!!responseTargetError}
            aria-describedby="response-target-help"
          />
          <span>{$t`minutes`}</span>
        </span>
      </label>
      <button
        type="button"
        class="primary-button"
        disabled={loading ||
          !!rangeError ||
          !!responseTargetError ||
          !!workingHoursError}
        on:click={buildDetailedReport}
      >
        <ChartIcon size="16px" />
        <span>{$t`Build detailed report`}</span>
      </button>
    </div>

    <p class="filter-scope-note">
      {$t`The selected mailbox and folder limit mail metrics. When an account is selected, Inbox is used by default; choose All folders to include the full account history. Calendar, chat and files remain combined.`}
    </p>
    <p id="response-target-help" class="filter-scope-note response-target-note">
      {$t`The target applies to the first verified reply when the request or reply is within the working schedule. When both are outside it, the reply is counted but SLA is not evaluated. A category identifies the responsible employee but does not provide a reliable pickup timestamp. Change it and build the report to recalculate SLA metrics.`}
    </p>

    <fieldset class="report-filter-block working-hours-block">
      <legend>{$t`Working hours for response SLA`}</legend>
      <div class="filter-block-heading">
        <span class="filter-count"
          >{formatNumber(workingHours.days.filter((day) => day.enabled).length)}
          {$t`working days`}</span
        >
        <button
          type="button"
          class="inline-action"
          disabled={loading || mailFoldersLoading}
          on:click={resetWorkingHoursSchedule}
          >{$t`Use standard schedule`}</button
        >
      </div>
      <p class="filter-help">
        {$t`Working-calendar response metrics use the selected schedule. If both the request and the reply are outside it, the reply is counted, but SLA is not evaluated. The duration shown for that row is informational.`}
      </p>
      <div class="working-hours-list" aria-label={$t`Working calendar`}>
        {#each workingHours.days as day, index}
          <div class="working-hours-row">
            <label class="working-day-toggle">
              <input
                type="checkbox"
                checked={day.enabled}
                disabled={loading || mailFoldersLoading}
                aria-label={`${weekdayNames[index]}: ${day.enabled ? $t`Working day` : $t`Day off`}`}
                on:change={(event) => onWorkingDayEnabledChange(index, event)}
              />
              <span>{weekdayNames[index]}</span>
            </label>
            {#if day.enabled}
              <label class="working-time-control">
                <span>{$t`Start`}</span>
                <input
                  type="time"
                  value={formatWorkingTime(day.startMinutes)}
                  disabled={loading || mailFoldersLoading}
                  aria-label={`${weekdayNames[index]}: ${$t`Start of workday`}`}
                  aria-invalid={workingHoursError == "invalid"}
                  on:change={(event) =>
                    onWorkingTimeChange(index, "startMinutes", event)}
                />
              </label>
              <span class="working-hours-separator" aria-hidden="true">→</span>
              <label class="working-time-control">
                <span>{$t`End`}</span>
                <input
                  type="time"
                  value={formatWorkingTime(day.endMinutes)}
                  disabled={loading || mailFoldersLoading}
                  aria-label={`${weekdayNames[index]}: ${$t`End of workday`}`}
                  aria-invalid={workingHoursError == "invalid"}
                  on:change={(event) =>
                    onWorkingTimeChange(index, "endMinutes", event)}
                />
              </label>
            {:else}
              <span class="working-day-off">{$t`Day off`}</span>
            {/if}
          </div>
        {/each}
      </div>
      <p class="filter-help">
        {$t`The schedule is saved separately for each selected mailbox and is applied after you build the report. The device time zone is used.`}
      </p>
      {#if workingHoursError == "no-working-days"}
        <p class="validation-message" role="alert">
          {$t`Select at least one working day.`}
        </p>
      {:else if workingHoursError == "invalid"}
        <p class="validation-message" role="alert">
          {$t`For each working day, the end time must be later than the start time.`}
        </p>
      {/if}
    </fieldset>

    {#if reportCategories.length}
      <fieldset class="report-filter-block">
        <legend>{$t`Categories in report`}</legend>
        <div class="filter-block-heading">
          <span class="filter-count" aria-live="polite"
            >{categoryFilterSummaryText}</span
          >
          <div class="filter-block-actions">
            <button
              type="button"
              class="inline-action"
              on:click={selectAllCategories}>{$t`Select all`}</button
            >
            <button
              type="button"
              class="inline-action"
              on:click={clearCategories}>{$t`Clear`}</button
            >
          </div>
        </div>
        <div class="category-options" aria-label={$t`Choose categories`}>
          {#each reportCategories as category (category.name)}
            <label class="category-option">
              <input
                type="checkbox"
                checked={categoryFilter == null ||
                  categoryFilter.includes(category.name)}
                on:change={(event) =>
                  onCategoryCheckboxChange(category.name, event)}
              />
              <span>{category.name}</span>
              <small>{formatNumber(category.incoming)}</small>
            </label>
          {/each}
        </div>
        <p class="filter-help">
          {$t`The category filter also limits the responder table and response-time details. Attribution settings remain saved for this mailbox.`}
        </p>
      </fieldset>
    {/if}

    {#if selectedMailAccountId != null && report}
      <fieldset class="report-filter-block attribution-block">
        <legend>{$t`Responder attribution`}</legend>
        <div class="attribution-heading">
          <label
            class="attribution-mode-control"
            for="responder-attribution-mode"
          >
            <span>{$t`Who answers`}</span>
            <select
              id="responder-attribution-mode"
              value={responderAttributionMode}
              on:change={onResponderModeChange}
            >
              <option value="profile">{$t`Mail profile`}</option>
              <option value="category">{$t`Employee category`}</option>
            </select>
          </label>
          <span class="filter-count"
            >{formatNumber(selectedResponderCategoryNames.length)}
            {$t`employee tags`}</span
          >
        </div>
        {#if responderAttributionMode == "category"}
          <p class="filter-help">
            {$t`For a shared mailbox, select the name tags employees put on incoming requests. One request should have one employee tag.`}
          </p>
          <p class="filter-help">
            {$t`The report category filter also limits this table and the response-time details.`}
          </p>
          <div
            class="category-options responder-options"
            aria-label={$t`Choose employee tags`}
          >
            {#each reportCategories as category (category.name)}
              <label class="category-option">
                <input
                  type="checkbox"
                  checked={selectedResponderCategoryNames.includes(
                    category.name,
                  )}
                  on:change={(event) =>
                    onResponderCheckboxChange(category.name, event)}
                />
                <span>{category.name}</span>
                <small>{formatNumber(category.incoming)}</small>
              </label>
            {:else}
              <span class="filter-help"
                >{$t`No categories are used in this period.`}</span
              >
            {/each}
          </div>
        {:else}
          <p class="filter-help">
            {$t`Response statistics are grouped by the selected mailbox profile.`}
          </p>
        {/if}
      </fieldset>
    {/if}

    <section
      class="live-control-launch"
      aria-labelledby="live-control-launch-title"
    >
      <div class="live-control-launch-icon"><ClockIcon size="18px" /></div>
      <div>
        <h2 id="live-control-launch-title">{$t`Live response control`}</h2>
        <p>
          {$t`Open the operational SLA queue in the right panel next to the open email. Historical metrics remain here in Reports.`}
        </p>
      </div>
      <button
        type="button"
        class="secondary-button"
        on:click={openLiveSlaControl}
      >
        <ClockIcon size="15px" />
        <span>{$t`Open live control`}</span>
      </button>
    </section>

    {#if mailAccountsError}
      <p class="mail-accounts-error" role="alert">
        {$t`Mail accounts could not be loaded.`}
        <button type="button" class="inline-retry" on:click={loadMailAccounts}
          >{$t`Try again`}</button
        >
      </p>
    {/if}

    {#if mailFoldersError}
      <p class="mail-accounts-error" role="alert">
        {$t`Mail folders could not be loaded.`}
        <button
          type="button"
          class="inline-retry"
          on:click={() => loadMailFoldersForAccount(selectedMailAccountId)}
          >{$t`Try again`}</button
        >
      </p>
    {/if}

    {#if rangeError}
      <p class="validation-message" role="alert">
        {rangeError === "reversed"
          ? $t`The start date must be before the end date.`
          : $t`Enter valid dates for the report.`}
      </p>
    {/if}

    {#if responseTargetError}
      <p class="validation-message" role="alert">
        {$t`Response target must be an integer from 1 minute to 7 days.`}
      </p>
    {/if}

    <p class="privacy-note">
      <LockIcon size="14px" />
      <span
        >{$t`Data is read from Jackdaw's local cache and stays on this device.`}</span
      >
    </p>
  </section>

  {#if loading}
    <section class="state-panel loading-panel" aria-live="polite">
      <div class="skeleton skeleton-title"></div>
      <div class="skeleton-grid">
        {#each Array(6) as _}
          <div class="skeleton skeleton-card"></div>
        {/each}
      </div>
      <div class="skeleton skeleton-chart"></div>
      <p>{$t`Collecting statistics from the local cache…`}</p>
    </section>
  {:else if error}
    <section class="state-panel error-panel" role="alert">
      <div class="state-icon error-icon"><ActivityIcon size="24px" /></div>
      <h2>{$t`The report could not be built`}</h2>
      <p>
        {$t`The local data store returned an error. Try again; your messages are not uploaded anywhere.`}
      </p>
      <p class="technical-error">{error.message}</p>
      <button type="button" class="primary-button" on:click={runReport}>
        <RefreshIcon size="16px" />
        <span>{$t`Try again`}</span>
      </button>
    </section>
  {:else if !report}
    <section class="state-panel empty-panel">
      <div class="state-icon"><ChartIcon size="24px" /></div>
      <h2>{$t`Choose a period to start`}</h2>
      <p>
        {$t`The report combines mail, chat, calendar and file activity for the selected dates.`}
      </p>
      <button
        type="button"
        class="primary-button"
        on:click={buildDetailedReport}
      >
        <ChartIcon size="16px" />
        <span>{$t`Build detailed report`}</span>
      </button>
    </section>
  {:else if !hasData}
    <section class="state-panel empty-panel">
      <div class="state-icon"><ChartIcon size="24px" /></div>
      <h2>{$t`No activity in this period`}</h2>
      <p>
        {$t`There is no synchronized activity between the selected dates. Expand the period or sync an account first.`}
      </p>
      <button
        type="button"
        class="secondary-button"
        on:click={() => applyPreset("all")}
      >
        <ChartIcon size="16px" />
        <span>{$t`Show all time`}</span>
      </button>
    </section>
  {:else if reportViewerOpen}
    <div
      class="report-viewer"
      bind:this={reportViewerElement}
      on:keydown|capture={onReportViewerKeydown}
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-viewer-title"
      tabindex="-1"
    >
      <div class="report-viewer-topbar">
        <div class="report-viewer-header">
          <div>
            <p class="eyebrow">{$t`DETAILED REPORT`}</p>
            <h2 id="report-viewer-title">{$t`Detailed report`}</h2>
            <p>
              {$t`Review charts, tables and response details inside Jackdaw. Save an HTML copy when you are ready.`}
            </p>
          </div>
          <div class="header-actions">
            <button
              type="button"
              class="header-button"
              disabled={!report || loading || exporting != null}
              aria-busy={exporting == "html"}
              on:click={exportHTML}
            >
              <DownloadIcon size="15px" />
              <span>{$t`Save HTML`}</span>
            </button>
            <button
              type="button"
              class="header-button"
              on:click={closeReportViewer}
            >
              <span>{$t`Close report`}</span>
            </button>
            <button
              type="button"
              class="header-button"
              class:active={dashboardLayoutMode}
              disabled={!report}
              aria-pressed={dashboardLayoutMode}
              on:click={() => (dashboardLayoutMode = !dashboardLayoutMode)}
            >
              <LayoutDashboardIcon size="15px" />
              <span
                >{dashboardLayoutMode
                  ? $t`Finish layout`
                  : $t`Customize layout`}</span
              >
            </button>
            {#if dashboardLayoutMode}
              <button
                type="button"
                class="header-button"
                on:click={resetDashboardLayout}
                title={$t`Reset dashboard layout`}
              >
                <RefreshIcon size="15px" />
                <span>{$t`Reset layout`}</span>
              </button>
            {/if}
          </div>
        </div>
        <nav class="report-viewer-nav" aria-label={$t`Report sections`}>
          <button
            type="button"
            on:click={() => scrollReportSection("report-summary")}
            >{$t`Summary`}</button
          >
          <button
            type="button"
            on:click={() => scrollReportSection("timeline-title")}
            >{$t`Activity over time`}</button
          >
          <button
            type="button"
            on:click={() => scrollReportSection("heatmap-title")}
            >{$t`When activity happens`}</button
          >
          <button
            type="button"
            on:click={() => scrollReportSection("response-time-title")}
            >{$t`First response speed`}</button
          >
          <button
            type="button"
            on:click={() => scrollReportSection("responders-title")}
            >{$t`Who answers`}</button
          >
          <button
            type="button"
            on:click={() => scrollReportSection("category-rhythm-title")}
            >{$t`Work rhythm by employee`}</button
          >
          <button
            type="button"
            on:click={() => scrollReportSection("topics-title")}
            >{$t`Frequent requests`}</button
          >
          <button
            type="button"
            on:click={() => scrollReportSection("categories-title")}
            >{$t`Categories and tags`}</button
          >
          <button
            type="button"
            on:click={() => scrollReportSection("calendar-title")}
            >{$t`Calendar workload`}</button
          >
        </nav>
      </div>
      <div
        class="report-viewer-content"
        bind:this={reportViewerContentElement}
        on:scroll={() =>
          (reportViewerScrollTop = reportViewerContentElement?.scrollTop ?? 0)}
      >
        <div class="report-meta">
          <span class="period-label">{formatRange(report.range)}</span>
          <span class="meta-divider">·</span>
          {#if report.mailAccountFilter}
            <span class="scope-label"
              >{$t`Mailbox`}: {report.mailAccountFilter.accountName}{report
                .mailAccountFilter.email
                ? ` — ${report.mailAccountFilter.email}`
                : ""}</span
            >
            <span class="meta-divider">·</span>
          {/if}
          {#if report.mailFolderFilter}
            <span class="scope-label"
              >{$t`Folder`}: {report.mailFolderFilter.name}</span
            >
            <span class="meta-divider">·</span>
          {/if}
          <span>{$t`Updated`} {formatDateTime(report.generatedAt)}</span>
          <span class="meta-divider">·</span>
          <span>{$t`Granularity`}: {granularityLabel(report.granularity)}</span>
          <span class="meta-divider">·</span>
          <span
            >{$t`Response target`}: {formatNumber(
              report.summary.responseTargetMinutes,
            )}
            {$t`working minutes`}</span
          >
        </div>

        {#if exportError}
          <p class="export-error" role="alert">
            {$t`The report could not be exported.`}
            {exportError.message}
          </p>
        {/if}
        {#if exportNotice}
          <p class="export-success" role="status">
            {$t`Report downloaded.`}
            <span class="export-file-name">{downloadedFilename}</span> · {$t`Downloads`}
          </p>
        {/if}

        <section
          id="report-summary"
          class="summary-grid"
          aria-label={$t`Summary`}
        >
          <article class="summary-card summary-primary">
            <div class="summary-card-heading">
              <span>{$t`Observed activity`}</span>
              <ActivityIcon size="17px" />
            </div>
            <strong>{formatNumber(report.summary.activityCount)}</strong>
            <p>{$t`outgoing messages, events and file changes`}</p>
          </article>
          <article class="summary-card">
            <div class="summary-card-heading">
              <span>{$t`Mail`}</span>
              <MailIcon size="17px" />
            </div>
            <strong>{formatNumber(report.summary.mailMessages)}</strong>
            <p>
              {formatNumber(report.summary.mailIncoming)}
              {$t`received`} · {formatNumber(report.summary.mailOutgoing)}
              {$t`sent`}
            </p>
          </article>
          <article class="summary-card response-card">
            <div class="summary-card-heading">
              <span>{$t`Requests answered`}</span>
              <ArrowUpIcon size="17px" />
            </div>
            <strong>{formatPercent(report.summary.responseRate)}</strong>
            <p>
              <span class="response-count"
                >{formatNumber(report.summary.mailAnswered)} /
                {formatNumber(report.summary.mailIncoming)}</span
              >
              {$t`incoming requests answered in the selected period`}
            </p>
          </article>
          <article class="summary-card">
            <div class="summary-card-heading">
              <span>{$t`Calendar`}</span>
              <CalendarIcon size="17px" />
            </div>
            <strong>{formatHours(report.summary.calendarHours)}</strong>
            <p>
              {formatNumber(report.summary.calendarEvents)}
              {$t`events`} · {formatNumber(
                report.calendar.summary.onlineMeetings,
              )}
              {$t`online`}
            </p>
          </article>
          <article class="summary-card">
            <div class="summary-card-heading">
              <span>{$t`Chat`}</span>
              <ChatIcon size="17px" />
            </div>
            <strong>{formatNumber(report.summary.chatMessages)}</strong>
            <p>
              {formatNumber(report.summary.chatOutgoing)}
              {$t`sent`} · {formatNumber(report.summary.chatIncoming)}
              {$t`received`}
            </p>
          </article>
          <article class="summary-card">
            <div class="summary-card-heading">
              <span>{$t`Files changed`}</span>
              <FilesIcon size="17px" />
            </div>
            <strong>{formatNumber(report.summary.filesChanged)}</strong>
            <p>
              {formatBytes(report.summary.fileBytes)} · {formatPeakDay(
                report.summary.peakWeekday,
              )}
            </p>
          </article>
        </section>

        {#if dashboardLayoutMode}
          <p class="layout-help" role="status">
            {$t`Drag blocks by the handle, use the arrows to reorder them, and choose a width or height. The layout is saved on this device.`}
          </p>
        {/if}

        <div
          class="dashboard-grid"
          class:layout-editing={dashboardLayoutMode}
          role="list"
        >
          <div
            class={dashboardPanelClass("timeline", dashboardLayout)}
            style={dashboardPanelStyle("timeline", dashboardLayout)}
            role="listitem"
            draggable={dashboardLayoutMode}
            on:dragstart={(event) => onDashboardDragStart("timeline", event)}
            on:dragover|preventDefault
            on:drop={(event) => onDashboardDrop("timeline", event)}
            on:dragend={onDashboardDragEnd}
          >
            {#if dashboardLayoutMode}
              <ReportPanelControls
                sectionId="timeline"
                sectionLabel={dashboardSectionLabel("timeline")}
                width={dashboardPanel("timeline").width}
                tall={dashboardPanel("timeline").tall}
                on:move={(event) => onDashboardMove("timeline", event)}
                on:width={(event) => onDashboardWidth("timeline", event)}
                on:height={(event) => onDashboardHeight("timeline", event)}
              />
            {/if}
            <section
              class="panel timeline-panel"
              aria-labelledby="timeline-title"
            >
              <div class="panel-header">
                <div>
                  <p class="panel-kicker">{$t`TREND`}</p>
                  <h2 id="timeline-title">{$t`Activity over time`}</h2>
                  <p>
                    {$t`Communication, meetings and file changes in one view.`}
                  </p>
                </div>
                <div class="legend" aria-label={$t`Chart legend`}>
                  <span><i class="legend-dot mail-in"></i>{$t`Mail in`}</span>
                  <span><i class="legend-dot mail-out"></i>{$t`Mail out`}</span>
                  <span><i class="legend-dot chat-out"></i>{$t`Chat`}</span>
                  <span><i class="legend-dot calendar"></i>{$t`Calendar`}</span>
                  <span><i class="legend-dot files"></i>{$t`Files`}</span>
                </div>
              </div>
              <div
                class="timeline-scroll"
                tabindex="0"
                aria-label={$t`Activity chart`}
              >
                <div
                  class="timeline-chart"
                  style={`--timeline-columns: ${Math.max(report.timeline.length, 1)}`}
                >
                  {#each report.timeline as point}
                    <div class="timeline-item" title={timelineTitle(point)}>
                      <div class="bar-area">
                        <div class="bar-stack">
                          <span
                            class="bar mail-in"
                            style={`height: ${barHeight(point.mailIncoming)}%`}
                          ></span>
                          <span
                            class="bar mail-out"
                            style={`height: ${barHeight(point.mailOutgoing)}%`}
                          ></span>
                          <span
                            class="bar chat-out"
                            style={`height: ${barHeight(point.chatIncoming + point.chatOutgoing)}%`}
                          ></span>
                          <span
                            class="bar calendar"
                            style={`height: ${barHeight(point.calendarEvents)}%`}
                          ></span>
                          <span
                            class="bar files"
                            style={`height: ${barHeight(point.filesChanged)}%`}
                          ></span>
                        </div>
                      </div>
                      {#if shouldShowTimelineLabel(point, report.timeline)}
                        <span class="timeline-label"
                          >{timelineLabel(
                            point.start,
                            report.granularity,
                          )}</span
                        >
                      {/if}
                    </div>
                  {/each}
                </div>
              </div>
            </section>
          </div>

          <div
            class={dashboardPanelClass("heatmap", dashboardLayout)}
            style={dashboardPanelStyle("heatmap", dashboardLayout)}
            role="listitem"
            draggable={dashboardLayoutMode}
            on:dragstart={(event) => onDashboardDragStart("heatmap", event)}
            on:dragover|preventDefault
            on:drop={(event) => onDashboardDrop("heatmap", event)}
            on:dragend={onDashboardDragEnd}
          >
            {#if dashboardLayoutMode}
              <ReportPanelControls
                sectionId="heatmap"
                sectionLabel={dashboardSectionLabel("heatmap")}
                width={dashboardPanel("heatmap").width}
                tall={dashboardPanel("heatmap").tall}
                on:move={(event) => onDashboardMove("heatmap", event)}
                on:width={(event) => onDashboardWidth("heatmap", event)}
                on:height={(event) => onDashboardHeight("heatmap", event)}
              />
            {/if}
            <section
              class="panel heatmap-panel"
              aria-labelledby="heatmap-title"
            >
              <div class="panel-header heatmap-header">
                <div>
                  <p class="panel-kicker">{$t`WORK RHYTHM`}</p>
                  <h2 id="heatmap-title">{$t`When activity happens`}</h2>
                  <p>
                    {$t`A proxy for working rhythm: outgoing communication, meetings and file changes.`}
                  </p>
                </div>
                <div class="peak-callout">
                  <ClockIcon size="16px" />
                  <span
                    >{$t`Peak`}
                    <strong>{formatPeakDay(report.summary.peakWeekday)}</strong
                    >,
                    <strong>{formatPeakHour(report.summary.peakHour)}</strong
                    ></span
                  >
                </div>
              </div>
              <div class="heatmap-scroll" tabindex="0">
                <div
                  class="heatmap"
                  role="img"
                  aria-label={$t`Activity by weekday and hour`}
                >
                  <span class="heat-corner"></span>
                  {#each heatmapHours as hour}
                    <span class="heat-hour"
                      >{hour % 4 === 0 ? formatHour(hour) : ""}</span
                    >
                  {/each}
                  {#each weekdays as day, weekday}
                    <span class="heat-day">{day}</span>
                    {#each heatmapHours as hour}
                      {@const count = heatmapCount(
                        report.activity,
                        weekday,
                        hour,
                      )}
                      <span
                        class="heat-cell"
                        style={`--cell-opacity: ${heatmapOpacity(count)};`}
                        title={`${day}, ${formatHour(hour)} — ${formatNumber(count)}`}
                        aria-label={`${day}, ${formatHour(hour)} — ${formatNumber(count)}`}
                      >
                      </span>
                    {/each}
                  {/each}
                </div>
              </div>
              <div class="heatmap-scale" aria-hidden="true">
                <span>{$t`Less`}</span><i class="scale-cell low"></i><i
                  class="scale-cell medium"
                ></i><i class="scale-cell high"></i><span>{$t`More`}</span>
              </div>
            </section>
          </div>

          <div
            class={dashboardPanelClass("response-time", dashboardLayout)}
            style={dashboardPanelStyle("response-time", dashboardLayout)}
            role="listitem"
            draggable={dashboardLayoutMode}
            on:dragstart={(event) =>
              onDashboardDragStart("response-time", event)}
            on:dragover|preventDefault
            on:drop={(event) => onDashboardDrop("response-time", event)}
            on:dragend={onDashboardDragEnd}
          >
            {#if dashboardLayoutMode}
              <ReportPanelControls
                sectionId="response-time"
                sectionLabel={dashboardSectionLabel("response-time")}
                width={dashboardPanel("response-time").width}
                tall={dashboardPanel("response-time").tall}
                on:move={(event) => onDashboardMove("response-time", event)}
                on:width={(event) => onDashboardWidth("response-time", event)}
                on:height={(event) => onDashboardHeight("response-time", event)}
              />
            {/if}
            <section
              class="panel response-time-panel"
              aria-labelledby="response-time-title"
            >
              <div class="panel-header">
                <div>
                  <p class="panel-kicker">{$t`RESPONSE TIME`}</p>
                  <h2 id="response-time-title">{$t`First response speed`}</h2>
                  <p>
                    {$t`Time from receiving a request to the first verified reply.`}
                    {$t`Target`}: {formatNumber(
                      report.summary.responseTargetMinutes,
                    )}
                    {$t`working minutes`}.
                    {$t`Working calendar`}: {formatWorkingHoursSummary(
                      report.workingHours,
                    )}.
                  </p>
                  {#if outsideWorkingHoursResponseTimes.length}
                    <p class="response-time-note">
                      {$t`Replies sent outside the working schedule are counted. When both the request and the reply are outside it, SLA is not evaluated; the duration shown in the row is informational and excluded from SLA metrics.`}
                    </p>
                  {/if}
                </div>
                <div class="response-target-callout">
                  <ClockIcon size="16px" />
                  <span
                    >{$t`Within target`}
                    <strong
                      >{formatNumber(visibleResponseTimeStats.withinTarget)} /
                      {formatNumber(visibleResponseTimeStats.answered)}</strong
                    ><small>{$t`for replies with measured response time`}</small></span
                  >
                </div>
              </div>

              <div class="response-metrics">
                <article class="response-metric">
                  <span>{$t`Average response time`}</span>
                  <strong
                    >{formatDuration(
                      visibleResponseTimeStats.averageSeconds,
                    )}</strong
                  >
                  <small>{$t`for replies with measured response time`}</small>
                </article>
                <article class="response-metric">
                  <span>{$t`Minimum response time`}</span>
                  <strong
                    >{formatDuration(
                      visibleResponseTimeStats.minimumSeconds,
                    )}</strong
                  >
                  <small>{$t`fastest first reply`}</small>
                </article>
                <article class="response-metric response-metric-alert">
                  <span>{$t`Maximum response time`}</span>
                  <strong
                    >{formatDuration(
                      visibleResponseTimeStats.maximumSeconds,
                    )}</strong
                  >
                  <small>{$t`slowest first reply`}</small>
                </article>
                <article class="response-metric response-metric-good">
                  <span>{$t`Within target`}</span>
                  <strong
                    >{formatPercent(
                      responseRate(
                        visibleResponseTimeStats.withinTarget,
                        visibleResponseTimeStats.answered,
                      ),
                    )}</strong
                  >
                  <small
                    >{formatNumber(visibleResponseTimeStats.withinTarget)}
                    {$t`on time`}</small
                  >
                </article>
                <article class="response-metric response-metric-alert">
                  <span>{$t`Over target`}</span>
                  <strong
                    >{formatNumber(visibleResponseTimeStats.overTarget)}</strong
                  >
                  <small>{$t`overdue replies`}</small>
                </article>
                <article class="response-metric response-metric-after-hours">
                  <span>{$t`First replies outside working hours`}</span>
                  <strong
                    >{formatNumber(
                      outsideWorkingHoursResponseTimes.length,
                    )}</strong
                  >
                  <small
                    >{formatNumber(categorizedOutsideWorkingHoursResponseCount)}
                    {$t`with an employee category`}</small
                  >
                  <small>
                    {$t`Not evaluated`}: {formatNumber(
                      outsideWorkingHoursNotEvaluatedCount,
                    )}
                  </small>
                  <small>
                    {$t`Within target`}: {formatNumber(
                      outsideWorkingHoursWithinTargetCount,
                    )} · {$t`Over target`}: {formatNumber(
                      outsideWorkingHoursOverTargetCount,
                    )}
                  </small>
                </article>
              </div>

              {#if !visibleResponseTimes.length}
                <div class="response-empty" role="status">
                  <ClockIcon size="18px" />
                  <span
                    >{$t`No verified replies in this period, so response time is not calculated.`}</span
                  >
                </div>
              {/if}
            </section>
          </div>

          {#if visibleResponseTimes.length}
            <div
              class={dashboardPanelClass("response-details", dashboardLayout)}
              style={dashboardPanelStyle("response-details", dashboardLayout)}
              role="listitem"
              draggable={dashboardLayoutMode}
              on:dragstart={(event) =>
                onDashboardDragStart("response-details", event)}
              on:dragover|preventDefault
              on:drop={(event) => onDashboardDrop("response-details", event)}
              on:dragend={onDashboardDragEnd}
            >
              {#if dashboardLayoutMode}
                <ReportPanelControls
                  sectionId="response-details"
                  sectionLabel={dashboardSectionLabel("response-details")}
                  width={dashboardPanel("response-details").width}
                  tall={dashboardPanel("response-details").tall}
                  on:move={(event) =>
                    onDashboardMove("response-details", event)}
                  on:width={(event) =>
                    onDashboardWidth("response-details", event)}
                  on:height={(event) =>
                    onDashboardHeight("response-details", event)}
                />
              {/if}
              <section
                class="panel response-details-panel"
                aria-labelledby="response-details-title"
              >
                <div class="panel-header">
                  <div>
                    <p class="panel-kicker">{$t`RESPONSE TIME`}</p>
                    <h2 id="response-details-title">{$t`Response details`}</h2>
                    <p>
                      {$t`All first-response intervals in the selected period. Click a column to sort.`}
                    </p>
                  </div>
                </div>
                <div class="response-detail-grid">
                  <div class="response-detail-block">
                    <div class="subpanel-heading">
                      <div>
                        <h3>{$t`Days with overdue replies`}</h3>
                        <p>
                          {$t`Days with replies beyond the target. Click a column to sort.`}
                        </p>
                      </div>
                    </div>
                    <div class="table-wrap">
                      <table class="responsive-report-table response-day-table">
                        <caption class="visually-hidden"
                          >{$t`Response time by day`}</caption
                        >
                        <thead>
                          <tr>
                            <th
                              scope="col"
                              aria-sort={reportSortAriaValue(
                                responseDaySort,
                                "day",
                              )}
                            >
                              <ReportSortButton
                                label={$t`Day`}
                                direction={reportSortDirection(
                                  responseDaySort,
                                  "day",
                                )}
                                on:sort={() =>
                                  (responseDaySort = toggleReportSort(
                                    responseDaySort,
                                    "day",
                                  ))}
                              />
                            </th>
                            <th
                              scope="col"
                              class="numeric"
                              aria-sort={reportSortAriaValue(
                                responseDaySort,
                                "answered",
                              )}
                            >
                              <ReportSortButton
                                label={$t`Answered`}
                                align="right"
                                direction={reportSortDirection(
                                  responseDaySort,
                                  "answered",
                                )}
                                on:sort={() =>
                                  (responseDaySort = toggleReportSort(
                                    responseDaySort,
                                    "answered",
                                  ))}
                              />
                            </th>
                            <th
                              scope="col"
                              class="numeric"
                              aria-sort={reportSortAriaValue(
                                responseDaySort,
                                "average",
                              )}
                            >
                              <ReportSortButton
                                label={$t`Average`}
                                align="right"
                                direction={reportSortDirection(
                                  responseDaySort,
                                  "average",
                                )}
                                on:sort={() =>
                                  (responseDaySort = toggleReportSort(
                                    responseDaySort,
                                    "average",
                                  ))}
                              />
                            </th>
                            <th
                              scope="col"
                              class="numeric"
                              aria-sort={reportSortAriaValue(
                                responseDaySort,
                                "maximum",
                              )}
                            >
                              <ReportSortButton
                                label={$t`Maximum`}
                                align="right"
                                direction={reportSortDirection(
                                  responseDaySort,
                                  "maximum",
                                )}
                                on:sort={() =>
                                  (responseDaySort = toggleReportSort(
                                    responseDaySort,
                                    "maximum",
                                  ))}
                              />
                            </th>
                            <th
                              scope="col"
                              class="numeric"
                              aria-sort={reportSortAriaValue(
                                responseDaySort,
                                "overTarget",
                              )}
                            >
                              <ReportSortButton
                                label={$t`Over target`}
                                align="right"
                                direction={reportSortDirection(
                                  responseDaySort,
                                  "overTarget",
                                )}
                                on:sort={() =>
                                  (responseDaySort = toggleReportSort(
                                    responseDaySort,
                                    "overTarget",
                                  ))}
                              />
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {#each sortedResponseTimeDays as day}
                            <tr>
                              <th scope="row" data-label={$t`Day`}
                                >{formatDate(parseInputDate(day.day))}</th
                              >
                              <td class="numeric" data-label={$t`Answered`}
                                >{formatNumber(day.answered)}</td
                              >
                              <td class="numeric" data-label={$t`Average`}
                                >{formatDuration(day.averageSeconds)}</td
                              >
                              <td class="numeric" data-label={$t`Maximum`}
                                >{formatDuration(day.maximumSeconds)}</td
                              >
                              <td
                                class="numeric overdue-value"
                                data-label={$t`Over target`}
                                >{formatNumber(day.overTarget)}</td
                              >
                            </tr>
                          {:else}
                            <tr>
                              <td colspan="5" class="empty-cell"
                                >{$t`No overdue replies in this period.`}</td
                              >
                            </tr>
                          {/each}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div class="response-detail-block">
                    <div class="table-wrap">
                      <table
                        class="responsive-report-table response-detail-table"
                      >
                        <caption class="visually-hidden"
                          >{$t`Response details`}</caption
                        >
                        <thead>
                          <tr>
                            <th
                              scope="col"
                              aria-sort={reportSortAriaValue(
                                responseDetailSort,
                                "received",
                              )}
                            >
                              <ReportSortButton
                                label={$t`Received`}
                                direction={reportSortDirection(
                                  responseDetailSort,
                                  "received",
                                )}
                                on:sort={() =>
                                  (responseDetailSort = toggleReportSort(
                                    responseDetailSort,
                                    "received",
                                  ))}
                              />
                            </th>
                            <th
                              scope="col"
                              aria-sort={reportSortAriaValue(
                                responseDetailSort,
                                "replied",
                              )}
                            >
                              <ReportSortButton
                                label={$t`Replied`}
                                direction={reportSortDirection(
                                  responseDetailSort,
                                  "replied",
                                )}
                                on:sort={() =>
                                  (responseDetailSort = toggleReportSort(
                                    responseDetailSort,
                                    "replied",
                                  ))}
                              />
                            </th>
                            <th
                              scope="col"
                              class="numeric"
                              aria-sort={reportSortAriaValue(
                                responseDetailSort,
                                "responseTime",
                              )}
                            >
                              <ReportSortButton
                                label={$t`Response time`}
                                align="right"
                                direction={reportSortDirection(
                                  responseDetailSort,
                                  "responseTime",
                                )}
                                on:sort={() =>
                                  (responseDetailSort = toggleReportSort(
                                    responseDetailSort,
                                    "responseTime",
                                  ))}
                              />
                            </th>
                            <th
                              scope="col"
                              aria-sort={reportSortAriaValue(
                                responseDetailSort,
                                "responder",
                              )}
                            >
                              <ReportSortButton
                                label={responderAttributionMode == "category"
                                  ? $t`Responder`
                                  : $t`Profile`}
                                direction={reportSortDirection(
                                  responseDetailSort,
                                  "responder",
                                )}
                                on:sort={() =>
                                  (responseDetailSort = toggleReportSort(
                                    responseDetailSort,
                                    "responder",
                                  ))}
                              />
                            </th>
                            <th
                              scope="col"
                              aria-sort={reportSortAriaValue(
                                responseDetailSort,
                                "topic",
                              )}
                            >
                              <ReportSortButton
                                label={$t`Topic`}
                                direction={reportSortDirection(
                                  responseDetailSort,
                                  "topic",
                                )}
                                on:sort={() =>
                                  (responseDetailSort = toggleReportSort(
                                    responseDetailSort,
                                    "topic",
                                  ))}
                              />
                            </th>
                            <th
                              scope="col"
                              aria-sort={reportSortAriaValue(
                                responseDetailSort,
                                "status",
                              )}
                            >
                              <ReportSortButton
                                label={$t`Status`}
                                direction={reportSortDirection(
                                  responseDetailSort,
                                  "status",
                                )}
                                on:sort={() =>
                                  (responseDetailSort = toggleReportSort(
                                    responseDetailSort,
                                    "status",
                                  ))}
                              />
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {#each renderedResponseTimes as response}
                            <tr
                              class:overdue-row={response.withinTarget ===
                                false}
                              class:outside-hours-row={isResponseOutsideWorkingHours(
                                response,
                              )}
                            >
                              <td data-label={$t`Received`}
                                >{formatDateTime(response.requestAt)}</td
                              >
                              <td data-label={$t`Replied`}
                                >{formatDateTime(response.responseAt)}</td
                              >
                              <td class="numeric" data-label={$t`Response time`}
                                >{formatResponseDuration(response)}</td
                              >
                              <td
                                data-label={responderAttributionMode ==
                                "category"
                                  ? $t`Responder`
                                  : $t`Profile`}
                                >{responseResponderLabel(response)}</td
                              >
                              <td
                                class="topic-cell"
                                data-label={$t`Topic`}
                                title={response.subject}
                              >
                                <button
                                  type="button"
                                  class="email-link"
                                  disabled={openingResponseEmailId ==
                                    response.emailId}
                                  aria-label={`${$t`Open email`}: ${response.subject}`}
                                  on:click={() => openReportEmail(response)}
                                >
                                  <MailIcon size="13px" />
                                  <span>{response.subject}</span>
                                </button>
                              </td>
                              <td data-label={$t`Status`}>
                                <div class="response-status-stack">
                                  <span
                                    class="status-pill"
                                    class:within={response.withinTarget ===
                                      true}
                                    class:overdue={response.withinTarget ===
                                      false}
                                    class:outside-hours={response.responseTimeStatus ==
                                      "outside-working-hours" &&
                                      response.withinTarget == null}
                                    >{formatResponseStatus(response)}</span
                                  >
                                  {#if isResponseOutsideWorkingHours(response)}
                                    <span class="outside-hours-marker"
                                      >{$t`Outside working hours`}</span
                                    >
                                  {/if}
                                </div>
                              </td>
                            </tr>
                          {:else}
                            <tr>
                              <td colspan="6" class="empty-cell"
                                >{$t`No verified replies in this period, so response time is not calculated.`}</td
                              >
                            </tr>
                          {/each}
                        </tbody>
                      </table>
                    </div>
                    <p class="table-note">
                      <span aria-live="polite">
                        {#if renderedResponseTimes.length < sortedResponseTimes.length}
                          {$t`Showing ${renderedResponseTimes.length} of ${sortedResponseTimes.length} response details.`}
                        {:else}
                          {$t`All response details for this period are shown here.`}
                        {/if}
                      </span>
                      {#if renderedResponseTimes.length < sortedResponseTimes.length}
                        <button
                          type="button"
                          class="table-more-button"
                          on:click={showMoreResponseDetails}
                        >{$t`Show more`}</button>
                      {/if}
                      <span class="outside-hours-legend"
                        ><i aria-hidden="true"
                        ></i>{$t`Outside working hours`}</span
                      >
                    </p>
                    {#if responseOpenError}
                      <p class="response-open-error" role="alert">
                        {$t`The message could not be opened.`}
                        {responseOpenError.message}
                      </p>
                    {/if}
                  </div>
                </div>
                <div class="response-detail-block after-hours-response-block">
                  <div class="subpanel-heading">
                    <div>
                      <h3>{$t`Who answered outside working hours`}</h3>
                      <p>
                        {$t`First verified replies sent outside the selected schedule. An employee category is shown when available; otherwise the mail profile is shown.`}
                      </p>
                    </div>
                  </div>
                  <div class="table-wrap">
                    <table
                      class="responsive-report-table after-hours-response-table"
                    >
                      <caption class="visually-hidden"
                        >{$t`Replies outside working hours`}</caption
                      >
                      <thead>
                        <tr>
                          <th
                            scope="col"
                            aria-sort={reportSortAriaValue(
                              outsideHoursSort,
                              "replied",
                            )}
                          >
                            <ReportSortButton
                              label={$t`Replied`}
                              direction={reportSortDirection(
                                outsideHoursSort,
                                "replied",
                              )}
                              on:sort={() =>
                                (outsideHoursSort = toggleReportSort(
                                  outsideHoursSort,
                                  "replied",
                                ))}
                            />
                          </th>
                          <th
                            scope="col"
                            aria-sort={reportSortAriaValue(
                              outsideHoursSort,
                              "responder",
                            )}
                          >
                            <ReportSortButton
                              label={$t`Employee / profile`}
                              direction={reportSortDirection(
                                outsideHoursSort,
                                "responder",
                              )}
                              on:sort={() =>
                                (outsideHoursSort = toggleReportSort(
                                  outsideHoursSort,
                                  "responder",
                                ))}
                            />
                          </th>
                          <th
                            scope="col"
                            class="numeric"
                            aria-sort={reportSortAriaValue(
                              outsideHoursSort,
                              "responseTime",
                            )}
                          >
                            <ReportSortButton
                              label={$t`Response time`}
                              align="right"
                              direction={reportSortDirection(
                                outsideHoursSort,
                                "responseTime",
                              )}
                              on:sort={() =>
                                (outsideHoursSort = toggleReportSort(
                                  outsideHoursSort,
                                  "responseTime",
                                ))}
                            />
                          </th>
                          <th
                            scope="col"
                            aria-sort={reportSortAriaValue(
                              outsideHoursSort,
                              "topic",
                            )}
                          >
                            <ReportSortButton
                              label={$t`Topic`}
                              direction={reportSortDirection(
                                outsideHoursSort,
                                "topic",
                              )}
                              on:sort={() =>
                                (outsideHoursSort = toggleReportSort(
                                  outsideHoursSort,
                                  "topic",
                                ))}
                            />
                          </th>
                          <th
                            scope="col"
                            aria-sort={reportSortAriaValue(
                              outsideHoursSort,
                              "status",
                            )}
                          >
                            <ReportSortButton
                              label={$t`Status`}
                              direction={reportSortDirection(
                                outsideHoursSort,
                                "status",
                              )}
                              on:sort={() =>
                                (outsideHoursSort = toggleReportSort(
                                  outsideHoursSort,
                                  "status",
                                ))}
                            />
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {#each renderedOutsideWorkingHoursResponseTimes as response}
                          <tr class="outside-hours-row">
                            <td data-label={$t`Replied`}
                              >{formatDateTime(response.responseAt)}</td
                            >
                            <td data-label={$t`Employee / profile`}
                              >{responseAfterHoursOwnerLabel(response)}</td
                            >
                            <td class="numeric" data-label={$t`Response time`}
                              >{formatResponseDuration(response)}</td
                            >
                            <td
                              class="topic-cell"
                              data-label={$t`Topic`}
                              title={response.subject}
                            >
                              <button
                                type="button"
                                class="email-link"
                                disabled={openingResponseEmailId ==
                                  response.emailId}
                                aria-label={`${$t`Open email`}: ${response.subject}`}
                                title={`${$t`Open email`}: ${response.subject || $t`(no subject)`}`}
                                on:click={() => openReportEmail(response)}
                              >
                                <MailIcon size="13px" />
                                <span>{response.subject}</span>
                              </button>
                            </td>
                            <td data-label={$t`Status`}>
                              <div class="response-status-stack">
                                <span
                                  class="status-pill"
                                  class:within={response.withinTarget === true}
                                  class:overdue={response.withinTarget === false}
                                  class:outside-hours={response.responseTimeStatus ==
                                    "outside-working-hours" &&
                                    response.withinTarget == null}
                                  >{formatResponseStatus(response)}</span
                                >
                                {#if isResponseOutsideWorkingHours(response)}
                                  <span class="outside-hours-marker"
                                    >{$t`Outside working hours`}</span
                                  >
                                {/if}
                              </div>
                            </td>
                          </tr>
                        {:else}
                          <tr>
                            <td colspan="5" class="empty-cell"
                              >{$t`No first replies were sent outside working hours in this period.`}</td
                            >
                          </tr>
                        {/each}
                      </tbody>
                    </table>
                  </div>
                  <p class="table-note">
                    <span aria-live="polite">
                      {#if renderedOutsideWorkingHoursResponseTimes.length < outsideWorkingHoursResponseTimes.length}
                        {$t`Showing ${renderedOutsideWorkingHoursResponseTimes.length} of ${outsideWorkingHoursResponseTimes.length} replies outside working hours.`}
                      {:else if outsideHoursSort}
                        {$t`The list is sorted by the selected column. Click a column to change sorting or a topic to open the email.`}
                      {:else}
                        {$t`The list is sorted by reply time, newest first. Click a topic to open the email.`}
                      {/if}
                    </span>
                    {#if renderedOutsideWorkingHoursResponseTimes.length < outsideWorkingHoursResponseTimes.length}
                      <button
                        type="button"
                        class="table-more-button"
                        on:click={showMoreOutsideHoursResponses}
                      >{$t`Show more`}</button>
                    {/if}
                  </p>
                </div>
              </section>
            </div>
          {/if}

          <div
            class={dashboardPanelClass("category-rhythm", dashboardLayout)}
            style={dashboardPanelStyle("category-rhythm", dashboardLayout)}
            role="listitem"
            draggable={dashboardLayoutMode}
            on:dragstart={(event) =>
              onDashboardDragStart("category-rhythm", event)}
            on:dragover|preventDefault
            on:drop={(event) => onDashboardDrop("category-rhythm", event)}
            on:dragend={onDashboardDragEnd}
          >
            {#if dashboardLayoutMode}
              <ReportPanelControls
                sectionId="category-rhythm"
                sectionLabel={dashboardSectionLabel("category-rhythm")}
                width={dashboardPanel("category-rhythm", dashboardLayout).width}
                tall={dashboardPanel("category-rhythm", dashboardLayout).tall}
                on:move={(event) => onDashboardMove("category-rhythm", event)}
                on:width={(event) => onDashboardWidth("category-rhythm", event)}
                on:height={(event) =>
                  onDashboardHeight("category-rhythm", event)}
              />
            {/if}
            <section
              class="panel category-rhythm-panel"
              aria-labelledby="category-rhythm-title"
            >
              <div class="panel-header category-rhythm-header">
                <div>
                  <p class="panel-kicker">{$t`EMPLOYEE RHYTHM`}</p>
                  <h2 id="category-rhythm-title">
                    {$t`Work rhythm by employee`}
                  </h2>
                  <p>
                    {$t`First verified replies grouped by employee categories. Empty slots mean no recorded reply, not proven absence.`}
                  </p>
                </div>
                <div class="rhythm-leader-callout">
                  <UsersIcon size="16px" />
                  <span>
                    {$t`After-hours leader`}
                    {#if topAfterHoursCategory}
                      <strong>{topAfterHoursCategory.name}</strong>
                      <strong
                        >{formatNumber(
                          topAfterHoursCategory.afterHours,
                        )}</strong
                      >
                    {:else}
                      <strong>—</strong>
                    {/if}
                  </span>
                </div>
              </div>

              {#if categoryRhythmRows.length}
                <div class="category-rhythm-grid">
                  <div class="rhythm-ranking">
                    <div class="subpanel-heading">
                      <div>
                        <h3>{$t`Who answers most outside working hours`}</h3>
                        <p>
                          {$t`Ranked by the number of first replies sent outside the selected schedule.`}
                        </p>
                      </div>
                    </div>
                    <div
                      class="rhythm-bar-chart"
                      role="list"
                      aria-label={$t`After-hours replies by employee`}
                    >
                      {#each afterHoursCategoryRows.slice(0, 12) as row, index}
                        <button
                          type="button"
                          class="rhythm-rank-row"
                          class:active={effectiveRhythmCategoryName == row.name}
                          aria-pressed={effectiveRhythmCategoryName == row.name}
                          aria-label={`${row.name}: ${formatNumber(row.afterHours)} ${$t`after-hours replies`}`}
                          on:click={() =>
                            (selectedRhythmCategoryName = row.name)}
                        >
                          <span class="rhythm-rank-index">{index + 1}</span>
                          <span class="rhythm-rank-name">{row.name}</span>
                          <span class="rhythm-rank-track" aria-hidden="true"
                            ><span
                              style={`width: ${rhythmBarWidth(row.afterHours, afterHoursCategoryMax)}`}
                            ></span></span
                          >
                          <strong class="rhythm-rank-count"
                            >{formatNumber(row.afterHours)}</strong
                          >
                          <small>{formatPercent(row.afterHoursRate)}</small>
                        </button>
                      {:else}
                        <div class="response-empty" role="status">
                          <ClockIcon size="18px" />
                          <span
                            >{$t`No categorized replies were sent outside working hours in this period.`}</span
                          >
                        </div>
                      {/each}
                    </div>
                    <p class="table-note">
                      {$t`One reply with several categories is counted once for each category.`}
                    </p>
                    <p class="table-note">
                      {$t`The ranking uses the number of replies sent outside working hours. The percentage shows their share among the employee's verified replies.`}
                    </p>
                  </div>

                  <div class="category-rhythm-focus">
                    <div class="subpanel-heading rhythm-focus-heading">
                      <div>
                        <h3>{$t`Rhythm for one employee`}</h3>
                        <p>
                          {$t`Choose a category to see its response pattern by weekday and hour.`}
                        </p>
                      </div>
                      <label class="rhythm-category-select">
                        <span class="visually-hidden"
                          >{$t`Employee category`}</span
                        >
                        <select
                          value={effectiveRhythmCategoryName}
                          aria-label={$t`Choose employee category`}
                          on:change={onRhythmCategoryChange}
                        >
                          {#each sortedCategoryRhythmRows as row}
                            <option value={row.name}>{row.name}</option>
                          {/each}
                        </select>
                      </label>
                    </div>
                    {#if selectedCategoryRhythmRow}
                      <div class="rhythm-focus-stats">
                        <div>
                          <span>{$t`Peak`}</span>
                          <strong
                            >{formatRhythmSlot(
                              selectedCategoryRhythmRow.peakWeekday,
                              selectedCategoryRhythmRow.peakHour,
                            )}</strong
                          >
                          <small
                            >{formatNumber(selectedCategoryRhythmRow.peakCount)}
                            {$t`replies`}</small
                          >
                        </div>
                        <div>
                          <span>{$t`Quietest recorded slot`}</span>
                          <strong
                            >{formatRhythmSlot(
                              selectedCategoryRhythmRow.quietSlotWeekday,
                              selectedCategoryRhythmRow.quietSlotHour,
                            )}</strong
                          >
                          <small
                            >{formatNumber(
                              selectedCategoryRhythmRow.quietSlotCount,
                            )}
                            {$t`replies in this slot`}</small
                          >
                        </div>
                        <div>
                          <span>{$t`Active days`}</span>
                          <strong
                            >{formatNumber(
                              selectedCategoryRhythmRow.activeDays,
                            )}</strong
                          >
                          <small
                            >{formatNumber(
                              selectedCategoryRhythmRow.activeWeekdays,
                            )}
                            {$t`weekdays with replies`}</small
                          >
                        </div>
                        <div>
                          <span>{$t`Quiet work slots`}</span>
                          <strong
                            >{formatNumber(
                              selectedCategoryRhythmRow.quietWorkingSlots,
                            )}</strong
                          >
                          <small
                            >{$t`of`}
                            {formatNumber(
                              selectedCategoryRhythmRow.workingSlots,
                            )}
                            {$t`scheduled slots`}</small
                          >
                        </div>
                      </div>
                      <div class="category-rhythm-heatmap-scroll" tabindex="0">
                        <div
                          class="category-rhythm-heatmap"
                          role="img"
                          aria-label={`${selectedCategoryRhythmRow.name}: ${$t`activity by weekday and hour`}`}
                        >
                          <span class="heat-corner"></span>
                          {#each heatmapHours as hour}
                            <span class="heat-hour"
                              >{hour % 4 === 0 ? formatHour(hour) : ""}</span
                            >
                          {/each}
                          {#each weekdays as day, weekday}
                            <span class="heat-day">{day}</span>
                            {#each heatmapHours as hour}
                              {@const count = categoryRhythmHeatmapCount(
                                selectedCategoryRhythmRow,
                                weekday,
                                hour,
                              )}
                              <span
                                class="heat-cell"
                                style={`--cell-opacity: ${categoryRhythmHeatmapOpacity(count, categoryRhythmHeatmapMax)};`}
                                title={`${day}, ${formatHour(hour)} — ${formatNumber(count)}`}
                                aria-label={`${day}, ${formatHour(hour)} — ${formatNumber(count)}`}
                              ></span>
                            {/each}
                          {/each}
                        </div>
                      </div>
                      <div class="heatmap-scale" aria-hidden="true">
                        <span>{$t`Less`}</span><i class="scale-cell low"></i><i
                          class="scale-cell medium"
                        ></i><i class="scale-cell high"></i><span
                          >{$t`More`}</span
                        >
                      </div>
                    {/if}
                  </div>
                </div>

                <div class="rhythm-overview">
                  <div class="subpanel-heading">
                    <div>
                      <h3>{$t`Employee category overview`}</h3>
                      <p>
                        {$t`Use the table to compare response volume, unanswered requests and quiet periods.`}
                      </p>
                    </div>
                  </div>
                  <div class="table-wrap">
                    <table
                      class="responsive-report-table rhythm-overview-table"
                    >
                      <caption class="visually-hidden"
                        >{$t`Employee work rhythm overview`}</caption
                      >
                      <thead>
                        <tr>
                          <th scope="col">{$t`Employee category`}</th>
                          <th scope="col" class="numeric">{$t`Replies`}</th>
                          <th scope="col" class="numeric">{$t`After-hours`}</th>
                          <th scope="col" class="numeric"
                            >{$t`No confirmed reply`}</th
                          >
                          <th scope="col" class="numeric">{$t`Active days`}</th>
                          <th scope="col" class="numeric">{$t`Quiet days`}</th>
                          <th scope="col" class="numeric">{$t`Quiet slots`}</th>
                          <th scope="col">{$t`Peak`}</th>
                          <th scope="col">{$t`Quietest`}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {#each sortedCategoryRhythmRows as row}
                          <tr>
                            <th scope="row" data-label={$t`Employee category`}
                              >{row.name}</th
                            >
                            <td class="numeric" data-label={$t`Replies`}
                              >{formatNumber(row.answered)}</td
                            >
                            <td class="numeric" data-label={$t`After-hours`}
                              >{formatNumber(row.afterHours)}</td
                            >
                            <td
                              class="numeric"
                              data-label={$t`No confirmed reply`}
                              >{formatNumber(row.unanswered)}</td
                            >
                            <td class="numeric" data-label={$t`Active days`}
                              >{formatNumber(row.activeDays)}</td
                            >
                            <td class="numeric" data-label={$t`Quiet days`}
                              >{formatNumber(row.quietWeekdays)}</td
                            >
                            <td class="numeric" data-label={$t`Quiet slots`}
                              >{formatNumber(row.quietWorkingSlots)} /
                              {formatNumber(row.workingSlots)}</td
                            >
                            <td data-label={$t`Peak`}
                              >{formatRhythmSlot(
                                row.peakWeekday,
                                row.peakHour,
                              )}</td
                            >
                            <td data-label={$t`Quietest`}
                              >{formatRhythmSlot(
                                row.quietSlotWeekday,
                                row.quietSlotHour,
                              )}</td
                            >
                          </tr>
                        {/each}
                      </tbody>
                    </table>
                  </div>
                </div>
                <p class="table-note rhythm-disclaimer">
                  {$t`A quiet day or slot means that no first reply was recorded for this category. It is not proof that the employee was absent; compare it with assigned requests and synchronization completeness.`}
                </p>
              {:else}
                <div class="response-empty" role="status">
                  <UsersIcon size="18px" />
                  <span
                    >{$t`No employee categories are available for this period.`}</span
                  >
                </div>
              {/if}
            </section>
          </div>

          <div class="report-columns">
            <div
              class={dashboardPanelClass("responders", dashboardLayout)}
              style={dashboardPanelStyle("responders", dashboardLayout)}
              role="listitem"
              draggable={dashboardLayoutMode}
              on:dragstart={(event) =>
                onDashboardDragStart("responders", event)}
              on:dragover|preventDefault
              on:drop={(event) => onDashboardDrop("responders", event)}
              on:dragend={onDashboardDragEnd}
            >
              {#if dashboardLayoutMode}
                <ReportPanelControls
                  sectionId="responders"
                  sectionLabel={dashboardSectionLabel("responders")}
                  width={dashboardPanel("responders").width}
                  tall={dashboardPanel("responders").tall}
                  on:move={(event) => onDashboardMove("responders", event)}
                  on:width={(event) => onDashboardWidth("responders", event)}
                  on:height={(event) => onDashboardHeight("responders", event)}
                />
              {/if}
              <section
                class="panel wide-panel"
                aria-labelledby="responders-title"
              >
                <div class="panel-header">
                  <div>
                    <p class="panel-kicker">{$t`RESPONSES`}</p>
                    <h2 id="responders-title">{$t`Who answers`}</h2>
                    {#if responderAttributionMode == "category"}
                      <p>
                        {$t`Employees are identified by their selected name tags on the shared mailbox.`}
                      </p>
                    {:else}
                      <p>
                        {$t`Mail profiles with incoming requests, verified replies and visible work rhythm.`}
                      </p>
                    {/if}
                    <p class="report-note">
                      {$t`Share of confirmed replies within the selected period.`}
                    </p>
                  </div>
                  <span class="panel-icon"><UsersIcon size="19px" /></span>
                </div>
                <div class="table-wrap">
                  <table class="responsive-report-table responder-table">
                    <caption class="visually-hidden"
                      >{responderAttributionMode == "category"
                        ? $t`Reply share by employee`
                        : $t`Reply share by mail profile`}</caption
                    >
                    <thead>
                      <tr>
                        <th
                          scope="col"
                          aria-sort={reportSortAriaValue(responderSort, "name")}
                        >
                          <ReportSortButton
                            label={responderAttributionMode == "category"
                              ? $t`Employee`
                              : $t`Profile`}
                            direction={reportSortDirection(
                              responderSort,
                              "name",
                            )}
                            on:sort={() =>
                              (responderSort = toggleReportSort(
                                responderSort,
                                "name",
                              ))}
                          />
                        </th>
                        <th
                          scope="col"
                          class="numeric"
                          aria-sort={reportSortAriaValue(
                            responderSort,
                            "requests",
                          )}
                        >
                          <ReportSortButton
                            label={$t`Requests`}
                            align="right"
                            direction={reportSortDirection(
                              responderSort,
                              "requests",
                            )}
                            on:sort={() =>
                              (responderSort = toggleReportSort(
                                responderSort,
                                "requests",
                              ))}
                          />
                        </th>
                        <th
                          scope="col"
                          class="numeric"
                          aria-sort={reportSortAriaValue(
                            responderSort,
                            "answered",
                          )}
                        >
                          <ReportSortButton
                            label={$t`Answered`}
                            align="right"
                            direction={reportSortDirection(
                              responderSort,
                              "answered",
                            )}
                            on:sort={() =>
                              (responderSort = toggleReportSort(
                                responderSort,
                                "answered",
                              ))}
                          />
                        </th>
                        <th
                          scope="col"
                          class="numeric"
                          aria-sort={reportSortAriaValue(responderSort, "rate")}
                        >
                          <ReportSortButton
                            label={$t`Reply share`}
                            align="right"
                            direction={reportSortDirection(
                              responderSort,
                              "rate",
                            )}
                            on:sort={() =>
                              (responderSort = toggleReportSort(
                                responderSort,
                                "rate",
                              ))}
                          />
                        </th>
                        <th
                          scope="col"
                          class="numeric"
                          aria-sort={reportSortAriaValue(
                            responderSort,
                            "average",
                          )}
                        >
                          <ReportSortButton
                            label={$t`Average`}
                            align="right"
                            direction={reportSortDirection(
                              responderSort,
                              "average",
                            )}
                            on:sort={() =>
                              (responderSort = toggleReportSort(
                                responderSort,
                                "average",
                              ))}
                          />
                        </th>
                        <th
                          scope="col"
                          class="numeric"
                          aria-sort={reportSortAriaValue(
                            responderSort,
                            "minimum",
                          )}
                        >
                          <ReportSortButton
                            label={$t`Minimum`}
                            align="right"
                            direction={reportSortDirection(
                              responderSort,
                              "minimum",
                            )}
                            on:sort={() =>
                              (responderSort = toggleReportSort(
                                responderSort,
                                "minimum",
                              ))}
                          />
                        </th>
                        <th
                          scope="col"
                          class="numeric"
                          aria-sort={reportSortAriaValue(
                            responderSort,
                            "maximum",
                          )}
                        >
                          <ReportSortButton
                            label={$t`Maximum`}
                            align="right"
                            direction={reportSortDirection(
                              responderSort,
                              "maximum",
                            )}
                            on:sort={() =>
                              (responderSort = toggleReportSort(
                                responderSort,
                                "maximum",
                              ))}
                          />
                        </th>
                        <th
                          scope="col"
                          class="numeric"
                          aria-sort={reportSortAriaValue(
                            responderSort,
                            "withinTarget",
                          )}
                        >
                          <ReportSortButton
                            label={$t`Within target`}
                            align="right"
                            direction={reportSortDirection(
                              responderSort,
                              "withinTarget",
                            )}
                            on:sort={() =>
                              (responderSort = toggleReportSort(
                                responderSort,
                                "withinTarget",
                              ))}
                          />
                        </th>
                        <th
                          scope="col"
                          class="numeric"
                          aria-sort={reportSortAriaValue(
                            responderSort,
                            "overTarget",
                          )}
                        >
                          <ReportSortButton
                            label={$t`Over target`}
                            align="right"
                            direction={reportSortDirection(
                              responderSort,
                              "overTarget",
                            )}
                            on:sort={() =>
                              (responderSort = toggleReportSort(
                                responderSort,
                                "overTarget",
                              ))}
                          />
                        </th>
                        <th
                          scope="col"
                          class="numeric"
                          aria-sort={reportSortAriaValue(responderSort, "sent")}
                        >
                          <ReportSortButton
                            label={responderAttributionMode == "category"
                              ? $t`Verified replies`
                              : $t`Sent`}
                            align="right"
                            direction={reportSortDirection(
                              responderSort,
                              "sent",
                            )}
                            on:sort={() =>
                              (responderSort = toggleReportSort(
                                responderSort,
                                "sent",
                              ))}
                          />
                        </th>
                        <th
                          scope="col"
                          class="numeric"
                          aria-sort={reportSortAriaValue(responderSort, "peak")}
                        >
                          <ReportSortButton
                            label={$t`Peak`}
                            align="right"
                            direction={reportSortDirection(
                              responderSort,
                              "peak",
                            )}
                            on:sort={() =>
                              (responderSort = toggleReportSort(
                                responderSort,
                                "peak",
                              ))}
                          />
                        </th>
                        <th
                          scope="col"
                          class="numeric"
                          aria-sort={reportSortAriaValue(
                            responderSort,
                            "lastActivity",
                          )}
                        >
                          <ReportSortButton
                            label={$t`Last activity`}
                            align="right"
                            direction={reportSortDirection(
                              responderSort,
                              "lastActivity",
                            )}
                            on:sort={() =>
                              (responderSort = toggleReportSort(
                                responderSort,
                                "lastActivity",
                              ))}
                          />
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each sortedResponders as responder}
                        <tr>
                          <th
                            scope="row"
                            data-label={responderAttributionMode == "category"
                              ? $t`Employee`
                              : $t`Profile`}
                          >
                            <span class="person-name"
                              >{responder.accountName}</span
                            >
                            {#if responder.email}<span class="person-email"
                                >{responder.email}</span
                              >{/if}
                          </th>
                          <td class="numeric" data-label={$t`Requests`}
                            >{formatNumber(responder.requests)}</td
                          >
                          <td
                            class="numeric emphasized"
                            data-label={$t`Answered`}
                            >{formatNumber(responder.answered)}</td
                          >
                          <td class="numeric" data-label={$t`Reply share`}
                            ><span
                              class="rate-pill"
                              class:good={responderResponseShare(
                                responder.answered,
                              ) >= 0.75}
                              >{formatPercent(
                                responderResponseShare(responder.answered),
                              )}</span
                            ></td
                          >
                          <td
                            class="numeric response-duration"
                            data-label={$t`Average`}
                            >{formatDuration(
                              responder.responseTime.averageSeconds,
                            )}</td
                          >
                          <td
                            class="numeric response-duration"
                            data-label={$t`Minimum`}
                            >{formatDuration(
                              responder.responseTime.minimumSeconds,
                            )}</td
                          >
                          <td
                            class="numeric response-duration"
                            data-label={$t`Maximum`}
                            >{formatDuration(
                              responder.responseTime.maximumSeconds,
                            )}</td
                          >
                          <td
                            class="numeric emphasized"
                            data-label={$t`Within target`}
                            ><span class="table-value"
                              >{formatNumber(
                                responder.responseTime.withinTarget,
                              )}
                              <span class="table-rate"
                                >({formatPercent(
                                  responseRate(
                                    responder.responseTime.withinTarget,
                                    responder.responseTime.answered,
                                  ),
                                )})</span
                              ></span
                            ></td
                          >
                          <td
                            class="numeric overdue-value"
                            data-label={$t`Over target`}
                            >{formatNumber(
                              responder.responseTime.overTarget,
                            )}</td
                          >
                          <td
                            class="numeric"
                            data-label={responderAttributionMode == "category"
                              ? $t`Verified replies`
                              : $t`Sent`}>{formatNumber(responder.sent)}</td
                          >
                          <td class="numeric peak-value" data-label={$t`Peak`}
                            >{formatResponderPeak(
                              responder.peakWeekday,
                              responder.peakHour,
                            )}</td
                          >
                          <td
                            class="numeric muted"
                            data-label={$t`Last activity`}
                            >{formatDate(responder.lastActivity)}</td
                          >
                        </tr>
                      {:else}
                        <tr
                          ><td colspan="12" class="empty-cell"
                            >{responderAttributionMode == "category"
                              ? $t`No employee category data for this period.`
                              : $t`No mail profile data for this period.`}</td
                          ></tr
                        >
                      {/each}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>

            <div
              class={dashboardPanelClass("topics", dashboardLayout)}
              style={dashboardPanelStyle("topics", dashboardLayout)}
              role="listitem"
              draggable={dashboardLayoutMode}
              on:dragstart={(event) => onDashboardDragStart("topics", event)}
              on:dragover|preventDefault
              on:drop={(event) => onDashboardDrop("topics", event)}
              on:dragend={onDashboardDragEnd}
            >
              {#if dashboardLayoutMode}
                <ReportPanelControls
                  sectionId="topics"
                  sectionLabel={dashboardSectionLabel("topics")}
                  width={dashboardPanel("topics").width}
                  tall={dashboardPanel("topics").tall}
                  on:move={(event) => onDashboardMove("topics", event)}
                  on:width={(event) => onDashboardWidth("topics", event)}
                  on:height={(event) => onDashboardHeight("topics", event)}
                />
              {/if}
              <section class="panel" aria-labelledby="topics-title">
                <div class="panel-header">
                  <div>
                    <p class="panel-kicker">{$t`DEMAND`}</p>
                    <h2 id="topics-title">{$t`Frequent requests`}</h2>
                    <p>
                      {$t`Repeated incoming subjects, grouped without Re:/Fwd: prefixes.`}
                    </p>
                  </div>
                  <span class="panel-icon"><SearchIcon size="19px" /></span>
                </div>
                <div class="table-wrap">
                  <table>
                    <caption class="visually-hidden"
                      >{$t`Frequent request topics`}</caption
                    >
                    <thead>
                      <tr>
                        <th
                          scope="col"
                          aria-sort={reportSortAriaValue(topicSort, "topic")}
                        >
                          <ReportSortButton
                            label={$t`Topic`}
                            direction={reportSortDirection(topicSort, "topic")}
                            on:sort={() =>
                              (topicSort = toggleReportSort(
                                topicSort,
                                "topic",
                              ))}
                          />
                        </th>
                        <th
                          scope="col"
                          class="numeric"
                          aria-sort={reportSortAriaValue(topicSort, "requests")}
                        >
                          <ReportSortButton
                            label={$t`Count`}
                            align="right"
                            direction={reportSortDirection(
                              topicSort,
                              "requests",
                            )}
                            on:sort={() =>
                              (topicSort = toggleReportSort(
                                topicSort,
                                "requests",
                              ))}
                          />
                        </th>
                        <th
                          scope="col"
                          class="numeric"
                          aria-sort={reportSortAriaValue(topicSort, "answered")}
                        >
                          <ReportSortButton
                            label={$t`Answered`}
                            align="right"
                            direction={reportSortDirection(
                              topicSort,
                              "answered",
                            )}
                            on:sort={() =>
                              (topicSort = toggleReportSort(
                                topicSort,
                                "answered",
                              ))}
                          />
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each sortedTopics as topic}
                        <tr>
                          <th scope="row" class="topic-cell"
                            >{topic.topic === "(без темы)"
                              ? $t`(no subject)`
                              : topic.topic}</th
                          >
                          <td class="numeric">{formatNumber(topic.requests)}</td
                          >
                          <td class="numeric emphasized"
                            >{formatNumber(topic.answered)}
                            <span class="table-rate"
                              >({formatPercent(
                                responseRate(topic.answered, topic.requests),
                              )})</span
                            ></td
                          >
                        </tr>
                      {:else}
                        <tr
                          ><td colspan="3" class="empty-cell"
                            >{$t`No repeated requests for this period.`}</td
                          ></tr
                        >
                      {/each}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>

            <div
              class={dashboardPanelClass("categories", dashboardLayout)}
              style={dashboardPanelStyle("categories", dashboardLayout)}
              role="listitem"
              draggable={dashboardLayoutMode}
              on:dragstart={(event) =>
                onDashboardDragStart("categories", event)}
              on:dragover|preventDefault
              on:drop={(event) => onDashboardDrop("categories", event)}
              on:dragend={onDashboardDragEnd}
            >
              {#if dashboardLayoutMode}
                <ReportPanelControls
                  sectionId="categories"
                  sectionLabel={dashboardSectionLabel("categories")}
                  width={dashboardPanel("categories").width}
                  tall={dashboardPanel("categories").tall}
                  on:move={(event) => onDashboardMove("categories", event)}
                  on:width={(event) => onDashboardWidth("categories", event)}
                  on:height={(event) => onDashboardHeight("categories", event)}
                />
              {/if}
              <section class="panel" aria-labelledby="categories-title">
                <div class="panel-header">
                  <div>
                    <p class="panel-kicker">{$t`CATEGORIES`}</p>
                    <h2 id="categories-title">{$t`Categories and tags`}</h2>
                    <p>
                      {$t`Each row counts unique messages carrying that tag.`}
                    </p>
                  </div>
                  <span class="panel-icon"><TagsIcon size="19px" /></span>
                </div>
                <div class="table-wrap">
                  <table class="responsive-report-table category-table">
                    <caption class="visually-hidden"
                      >{$t`Mail categories and tags`}</caption
                    >
                    <thead>
                      <tr>
                        <th
                          scope="col"
                          aria-sort={reportSortAriaValue(categorySort, "name")}
                        >
                          <ReportSortButton
                            label={$t`Category`}
                            direction={reportSortDirection(
                              categorySort,
                              "name",
                            )}
                            on:sort={() =>
                              (categorySort = toggleReportSort(
                                categorySort,
                                "name",
                              ))}
                          />
                        </th>
                        <th
                          scope="col"
                          class="numeric"
                          aria-sort={reportSortAriaValue(categorySort, "total")}
                        >
                          <ReportSortButton
                            label={$t`Messages with tag`}
                            align="right"
                            direction={reportSortDirection(
                              categorySort,
                              "total",
                            )}
                            on:sort={() =>
                              (categorySort = toggleReportSort(
                                categorySort,
                                "total",
                              ))}
                          />
                        </th>
                        <th
                          scope="col"
                          class="numeric"
                          aria-sort={reportSortAriaValue(
                            categorySort,
                            "incoming",
                          )}
                        >
                          <ReportSortButton
                            label={$t`Incoming requests`}
                            align="right"
                            direction={reportSortDirection(
                              categorySort,
                              "incoming",
                            )}
                            on:sort={() =>
                              (categorySort = toggleReportSort(
                                categorySort,
                                "incoming",
                              ))}
                          />
                        </th>
                        <th
                          scope="col"
                          class="numeric"
                          aria-sort={reportSortAriaValue(
                            categorySort,
                            "outgoing",
                          )}
                        >
                          <ReportSortButton
                            label={$t`Outgoing`}
                            align="right"
                            direction={reportSortDirection(
                              categorySort,
                              "outgoing",
                            )}
                            on:sort={() =>
                              (categorySort = toggleReportSort(
                                categorySort,
                                "outgoing",
                              ))}
                          />
                        </th>
                        <th
                          scope="col"
                          class="numeric"
                          aria-sort={reportSortAriaValue(
                            categorySort,
                            "answered",
                          )}
                        >
                          <ReportSortButton
                            label={$t`Verified replies`}
                            align="right"
                            direction={reportSortDirection(
                              categorySort,
                              "answered",
                            )}
                            on:sort={() =>
                              (categorySort = toggleReportSort(
                                categorySort,
                                "answered",
                              ))}
                          />
                        </th>
                        <th
                          scope="col"
                          class="numeric"
                          aria-sort={reportSortAriaValue(
                            categorySort,
                            "average",
                          )}
                        >
                          <ReportSortButton
                            label={$t`Average`}
                            align="right"
                            direction={reportSortDirection(
                              categorySort,
                              "average",
                            )}
                            on:sort={() =>
                              (categorySort = toggleReportSort(
                                categorySort,
                                "average",
                              ))}
                          />
                        </th>
                        <th
                          scope="col"
                          class="numeric"
                          aria-sort={reportSortAriaValue(
                            categorySort,
                            "minimum",
                          )}
                        >
                          <ReportSortButton
                            label={$t`Minimum`}
                            align="right"
                            direction={reportSortDirection(
                              categorySort,
                              "minimum",
                            )}
                            on:sort={() =>
                              (categorySort = toggleReportSort(
                                categorySort,
                                "minimum",
                              ))}
                          />
                        </th>
                        <th
                          scope="col"
                          class="numeric"
                          aria-sort={reportSortAriaValue(
                            categorySort,
                            "maximum",
                          )}
                        >
                          <ReportSortButton
                            label={$t`Maximum`}
                            align="right"
                            direction={reportSortDirection(
                              categorySort,
                              "maximum",
                            )}
                            on:sort={() =>
                              (categorySort = toggleReportSort(
                                categorySort,
                                "maximum",
                              ))}
                          />
                        </th>
                        <th
                          scope="col"
                          class="numeric"
                          aria-sort={reportSortAriaValue(
                            categorySort,
                            "withinTarget",
                          )}
                        >
                          <ReportSortButton
                            label={$t`Within target`}
                            align="right"
                            direction={reportSortDirection(
                              categorySort,
                              "withinTarget",
                            )}
                            on:sort={() =>
                              (categorySort = toggleReportSort(
                                categorySort,
                                "withinTarget",
                              ))}
                          />
                        </th>
                        <th
                          scope="col"
                          class="numeric"
                          aria-sort={reportSortAriaValue(
                            categorySort,
                            "overTarget",
                          )}
                        >
                          <ReportSortButton
                            label={$t`Over target`}
                            align="right"
                            direction={reportSortDirection(
                              categorySort,
                              "overTarget",
                            )}
                            on:sort={() =>
                              (categorySort = toggleReportSort(
                                categorySort,
                                "overTarget",
                              ))}
                          />
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each sortedCategories as category}
                        <tr>
                          <th scope="row" data-label={$t`Category`}
                            >{category.name}</th
                          >
                          <td class="numeric" data-label={$t`Messages with tag`}
                            >{formatNumber(category.total)}</td
                          >
                          <td class="numeric" data-label={$t`Incoming requests`}
                            >{formatNumber(category.incoming)}</td
                          >
                          <td class="numeric" data-label={$t`Outgoing`}
                            >{formatNumber(category.outgoing)}</td
                          >
                          <td
                            class="numeric emphasized"
                            data-label={$t`Verified replies`}
                            >{formatNumber(category.answered)}</td
                          >
                          <td
                            class="numeric response-duration"
                            data-label={$t`Average`}
                            >{formatDuration(
                              category.responseTime.averageSeconds,
                            )}</td
                          >
                          <td
                            class="numeric response-duration"
                            data-label={$t`Minimum`}
                            >{formatDuration(
                              category.responseTime.minimumSeconds,
                            )}</td
                          >
                          <td
                            class="numeric response-duration"
                            data-label={$t`Maximum`}
                            >{formatDuration(
                              category.responseTime.maximumSeconds,
                            )}</td
                          >
                          <td
                            class="numeric emphasized"
                            data-label={$t`Within target`}
                            ><span class="table-value"
                              >{formatNumber(
                                category.responseTime.withinTarget,
                              )}
                              <span class="table-rate"
                                >({formatPercent(
                                  responseRate(
                                    category.responseTime.withinTarget,
                                    category.responseTime.answered,
                                  ),
                                )})</span
                              ></span
                            ></td
                          >
                          <td
                            class="numeric overdue-value"
                            data-label={$t`Over target`}
                            >{formatNumber(
                              category.responseTime.overTarget,
                            )}</td
                          >
                        </tr>
                      {:else}
                        <tr
                          ><td colspan="10" class="empty-cell"
                            >{$t`No categories are used in this period.`}</td
                          ></tr
                        >
                      {/each}
                    </tbody>
                  </table>
                </div>
                <p class="table-note">
                  {$t`One message can have multiple tags, so category rows are not additive.`}
                </p>
              </section>
            </div>

            <div
              class={dashboardPanelClass("mail-breakdown", dashboardLayout)}
              style={dashboardPanelStyle("mail-breakdown", dashboardLayout)}
              role="listitem"
              draggable={dashboardLayoutMode}
              on:dragstart={(event) =>
                onDashboardDragStart("mail-breakdown", event)}
              on:dragover|preventDefault
              on:drop={(event) => onDashboardDrop("mail-breakdown", event)}
              on:dragend={onDashboardDragEnd}
            >
              {#if dashboardLayoutMode}
                <ReportPanelControls
                  sectionId="mail-breakdown"
                  sectionLabel={dashboardSectionLabel("mail-breakdown")}
                  width={dashboardPanel("mail-breakdown").width}
                  tall={dashboardPanel("mail-breakdown").tall}
                  on:move={(event) => onDashboardMove("mail-breakdown", event)}
                  on:width={(event) =>
                    onDashboardWidth("mail-breakdown", event)}
                  on:height={(event) =>
                    onDashboardHeight("mail-breakdown", event)}
                />
              {/if}
              <section class="panel" aria-labelledby="mail-breakdown-title">
                <div class="panel-header">
                  <div>
                    <p class="panel-kicker">{$t`MAILBOXES`}</p>
                    <h2 id="mail-breakdown-title">{$t`Mail breakdown`}</h2>
                    <p>{$t`Accounts and folders with the most activity.`}</p>
                  </div>
                  <span class="panel-icon"><MailIcon size="19px" /></span>
                </div>
                <div class="table-wrap">
                  <table>
                    <caption class="visually-hidden"
                      >{$t`Mail activity by account`}</caption
                    >
                    <thead>
                      <tr>
                        <th
                          scope="col"
                          aria-sort={reportSortAriaValue(accountSort, "name")}
                        >
                          <ReportSortButton
                            label={$t`Account`}
                            direction={reportSortDirection(accountSort, "name")}
                            on:sort={() =>
                              (accountSort = toggleReportSort(
                                accountSort,
                                "name",
                              ))}
                          />
                        </th>
                        <th
                          scope="col"
                          class="numeric"
                          aria-sort={reportSortAriaValue(accountSort, "total")}
                        >
                          <ReportSortButton
                            label={$t`Messages`}
                            align="right"
                            direction={reportSortDirection(
                              accountSort,
                              "total",
                            )}
                            on:sort={() =>
                              (accountSort = toggleReportSort(
                                accountSort,
                                "total",
                              ))}
                          />
                        </th>
                        <th
                          scope="col"
                          class="numeric"
                          aria-sort={reportSortAriaValue(
                            accountSort,
                            "incoming",
                          )}
                        >
                          <ReportSortButton
                            label={$t`In`}
                            align="right"
                            direction={reportSortDirection(
                              accountSort,
                              "incoming",
                            )}
                            on:sort={() =>
                              (accountSort = toggleReportSort(
                                accountSort,
                                "incoming",
                              ))}
                          />
                        </th>
                        <th
                          scope="col"
                          class="numeric"
                          aria-sort={reportSortAriaValue(
                            accountSort,
                            "outgoing",
                          )}
                        >
                          <ReportSortButton
                            label={$t`Out`}
                            align="right"
                            direction={reportSortDirection(
                              accountSort,
                              "outgoing",
                            )}
                            on:sort={() =>
                              (accountSort = toggleReportSort(
                                accountSort,
                                "outgoing",
                              ))}
                          />
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each sortedAccounts as account}
                        <tr>
                          <th scope="row">{account.accountName}</th>
                          <td class="numeric">{formatNumber(account.total)}</td>
                          <td class="numeric"
                            >{formatNumber(account.incoming)}</td
                          >
                          <td class="numeric"
                            >{formatNumber(account.outgoing)}</td
                          >
                        </tr>
                      {:else}
                        <tr
                          ><td colspan="4" class="empty-cell"
                            >{$t`No mail data for this period.`}</td
                          ></tr
                        >
                      {/each}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>

            <div
              class={dashboardPanelClass("calendar", dashboardLayout)}
              style={dashboardPanelStyle("calendar", dashboardLayout)}
              role="listitem"
              draggable={dashboardLayoutMode}
              on:dragstart={(event) => onDashboardDragStart("calendar", event)}
              on:dragover|preventDefault
              on:drop={(event) => onDashboardDrop("calendar", event)}
              on:dragend={onDashboardDragEnd}
            >
              {#if dashboardLayoutMode}
                <ReportPanelControls
                  sectionId="calendar"
                  sectionLabel={dashboardSectionLabel("calendar")}
                  width={dashboardPanel("calendar").width}
                  tall={dashboardPanel("calendar").tall}
                  on:move={(event) => onDashboardMove("calendar", event)}
                  on:width={(event) => onDashboardWidth("calendar", event)}
                  on:height={(event) => onDashboardHeight("calendar", event)}
                />
              {/if}
              <section class="panel" aria-labelledby="calendar-title">
                <div class="panel-header">
                  <div>
                    <p class="panel-kicker">{$t`TIME`}</p>
                    <h2 id="calendar-title">{$t`Calendar workload`}</h2>
                    <p>{$t`Time spent in events, by calendar.`}</p>
                  </div>
                  <span class="panel-icon"><CalendarIcon size="19px" /></span>
                </div>
                <div class="table-wrap">
                  <table>
                    <caption class="visually-hidden"
                      >{$t`Calendar workload by calendar`}</caption
                    >
                    <thead>
                      <tr>
                        <th
                          scope="col"
                          aria-sort={reportSortAriaValue(calendarSort, "name")}
                        >
                          <ReportSortButton
                            label={$t`Calendar`}
                            direction={reportSortDirection(
                              calendarSort,
                              "name",
                            )}
                            on:sort={() =>
                              (calendarSort = toggleReportSort(
                                calendarSort,
                                "name",
                              ))}
                          />
                        </th>
                        <th
                          scope="col"
                          class="numeric"
                          aria-sort={reportSortAriaValue(
                            calendarSort,
                            "events",
                          )}
                        >
                          <ReportSortButton
                            label={$t`Events`}
                            align="right"
                            direction={reportSortDirection(
                              calendarSort,
                              "events",
                            )}
                            on:sort={() =>
                              (calendarSort = toggleReportSort(
                                calendarSort,
                                "events",
                              ))}
                          />
                        </th>
                        <th
                          scope="col"
                          class="numeric"
                          aria-sort={reportSortAriaValue(calendarSort, "hours")}
                        >
                          <ReportSortButton
                            label={$t`Hours`}
                            align="right"
                            direction={reportSortDirection(
                              calendarSort,
                              "hours",
                            )}
                            on:sort={() =>
                              (calendarSort = toggleReportSort(
                                calendarSort,
                                "hours",
                              ))}
                          />
                        </th>
                        <th
                          scope="col"
                          class="numeric"
                          aria-sort={reportSortAriaValue(
                            calendarSort,
                            "participants",
                          )}
                        >
                          <ReportSortButton
                            label={$t`People`}
                            align="right"
                            direction={reportSortDirection(
                              calendarSort,
                              "participants",
                            )}
                            on:sort={() =>
                              (calendarSort = toggleReportSort(
                                calendarSort,
                                "participants",
                              ))}
                          />
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each sortedCalendars as calendar}
                        <tr>
                          <th scope="row">{calendar.calendarName}</th>
                          <td class="numeric"
                            >{formatNumber(calendar.events)}</td
                          >
                          <td class="numeric"
                            >{formatNumber(calendar.hours, 1)}</td
                          >
                          <td class="numeric"
                            >{formatNumber(calendar.participants)}</td
                          >
                        </tr>
                      {:else}
                        <tr
                          ><td colspan="4" class="empty-cell"
                            >{$t`No calendar data for this period.`}</td
                          ></tr
                        >
                      {/each}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>

            <div
              class={dashboardPanelClass("chat", dashboardLayout)}
              style={dashboardPanelStyle("chat", dashboardLayout)}
              role="listitem"
              draggable={dashboardLayoutMode}
              on:dragstart={(event) => onDashboardDragStart("chat", event)}
              on:dragover|preventDefault
              on:drop={(event) => onDashboardDrop("chat", event)}
              on:dragend={onDashboardDragEnd}
            >
              {#if dashboardLayoutMode}
                <ReportPanelControls
                  sectionId="chat"
                  sectionLabel={dashboardSectionLabel("chat")}
                  width={dashboardPanel("chat").width}
                  tall={dashboardPanel("chat").tall}
                  on:move={(event) => onDashboardMove("chat", event)}
                  on:width={(event) => onDashboardWidth("chat", event)}
                  on:height={(event) => onDashboardHeight("chat", event)}
                />
              {/if}
              <section class="panel" aria-labelledby="chat-title">
                <div class="panel-header">
                  <div>
                    <p class="panel-kicker">{$t`CONVERSATIONS`}</p>
                    <h2 id="chat-title">{$t`Chat rooms`}</h2>
                    <p>{$t`Rooms with the most messages in the period.`}</p>
                  </div>
                  <span class="panel-icon"><ChatIcon size="19px" /></span>
                </div>
                <div class="table-wrap">
                  <table>
                    <caption class="visually-hidden"
                      >{$t`Chat activity by room`}</caption
                    >
                    <thead>
                      <tr>
                        <th
                          scope="col"
                          aria-sort={reportSortAriaValue(chatSort, "room")}
                        >
                          <ReportSortButton
                            label={$t`Room`}
                            direction={reportSortDirection(chatSort, "room")}
                            on:sort={() =>
                              (chatSort = toggleReportSort(chatSort, "room"))}
                          />
                        </th>
                        <th
                          scope="col"
                          class="numeric"
                          aria-sort={reportSortAriaValue(chatSort, "messages")}
                        >
                          <ReportSortButton
                            label={$t`Messages`}
                            align="right"
                            direction={reportSortDirection(
                              chatSort,
                              "messages",
                            )}
                            on:sort={() =>
                              (chatSort = toggleReportSort(
                                chatSort,
                                "messages",
                              ))}
                          />
                        </th>
                        <th
                          scope="col"
                          class="numeric"
                          aria-sort={reportSortAriaValue(chatSort, "sent")}
                        >
                          <ReportSortButton
                            label={$t`Sent`}
                            align="right"
                            direction={reportSortDirection(chatSort, "sent")}
                            on:sort={() =>
                              (chatSort = toggleReportSort(chatSort, "sent"))}
                          />
                        </th>
                        <th
                          scope="col"
                          class="numeric"
                          aria-sort={reportSortAriaValue(
                            chatSort,
                            "lastActivity",
                          )}
                        >
                          <ReportSortButton
                            label={$t`Last activity`}
                            align="right"
                            direction={reportSortDirection(
                              chatSort,
                              "lastActivity",
                            )}
                            on:sort={() =>
                              (chatSort = toggleReportSort(
                                chatSort,
                                "lastActivity",
                              ))}
                          />
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each sortedChatRooms as room}
                        <tr>
                          <th scope="row"
                            ><span>{room.roomName}</span><span
                              class="person-email">{room.accountName}</span
                            ></th
                          >
                          <td class="numeric">{formatNumber(room.total)}</td>
                          <td class="numeric">{formatNumber(room.outgoing)}</td>
                          <td class="numeric muted"
                            >{formatDate(room.lastActivity)}</td
                          >
                        </tr>
                      {:else}
                        <tr
                          ><td colspan="4" class="empty-cell"
                            >{$t`No chat data for this period.`}</td
                          ></tr
                        >
                      {/each}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>

            <div
              class={dashboardPanelClass("files", dashboardLayout)}
              style={dashboardPanelStyle("files", dashboardLayout)}
              role="listitem"
              draggable={dashboardLayoutMode}
              on:dragstart={(event) => onDashboardDragStart("files", event)}
              on:dragover|preventDefault
              on:drop={(event) => onDashboardDrop("files", event)}
              on:dragend={onDashboardDragEnd}
            >
              {#if dashboardLayoutMode}
                <ReportPanelControls
                  sectionId="files"
                  sectionLabel={dashboardSectionLabel("files")}
                  width={dashboardPanel("files").width}
                  tall={dashboardPanel("files").tall}
                  on:move={(event) => onDashboardMove("files", event)}
                  on:width={(event) => onDashboardWidth("files", event)}
                  on:height={(event) => onDashboardHeight("files", event)}
                />
              {/if}
              <section class="panel" aria-labelledby="files-title">
                <div class="panel-header">
                  <div>
                    <p class="panel-kicker">{$t`DOCUMENTS`}</p>
                    <h2 id="files-title">{$t`Files changed`}</h2>
                    <p>{$t`Directories with the most modified files.`}</p>
                  </div>
                  <span class="panel-icon"><FilesIcon size="19px" /></span>
                </div>
                <div class="table-wrap">
                  <table>
                    <caption class="visually-hidden"
                      >{$t`File changes by directory`}</caption
                    >
                    <thead>
                      <tr>
                        <th
                          scope="col"
                          aria-sort={reportSortAriaValue(fileSort, "directory")}
                        >
                          <ReportSortButton
                            label={$t`Directory`}
                            direction={reportSortDirection(
                              fileSort,
                              "directory",
                            )}
                            on:sort={() =>
                              (fileSort = toggleReportSort(
                                fileSort,
                                "directory",
                              ))}
                          />
                        </th>
                        <th
                          scope="col"
                          class="numeric"
                          aria-sort={reportSortAriaValue(fileSort, "files")}
                        >
                          <ReportSortButton
                            label={$t`Files`}
                            align="right"
                            direction={reportSortDirection(fileSort, "files")}
                            on:sort={() =>
                              (fileSort = toggleReportSort(fileSort, "files"))}
                          />
                        </th>
                        <th
                          scope="col"
                          class="numeric"
                          aria-sort={reportSortAriaValue(fileSort, "size")}
                        >
                          <ReportSortButton
                            label={$t`Size`}
                            align="right"
                            direction={reportSortDirection(fileSort, "size")}
                            on:sort={() =>
                              (fileSort = toggleReportSort(fileSort, "size"))}
                          />
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each sortedFileDirectories as directory}
                        <tr>
                          <th scope="row"
                            ><span>{directory.directoryName}</span><span
                              class="person-email">{directory.accountName}</span
                            ></th
                          >
                          <td class="numeric"
                            >{formatNumber(directory.files)}</td
                          >
                          <td class="numeric">{formatBytes(directory.bytes)}</td
                          >
                        </tr>
                      {:else}
                        <tr
                          ><td colspan="3" class="empty-cell"
                            >{$t`No file data for this period.`}</td
                          ></tr
                        >
                      {/each}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          </div>
        </div>

        <p class="report-footnote">
          {$t`Interpretation note:`}
          {$t`activity is a measurable proxy from synchronized local data, not a time tracker. A reply is counted when the mailbox marks the message as answered or a sent message links to the request or its thread. Response time is measured when a sent-message timestamp or the mailbox's stored answer timestamp is available. A missing history or unsynchronized account will make the report incomplete.`}
          {$t`Response time is measured from receipt to the first verified reply; replies sent after the report end are included when the request arrived inside the selected period.`}
          {$t`Replies sent outside the working schedule are counted. When both the request and the reply are outside it, SLA is not evaluated; the duration shown in the row is informational and excluded from SLA metrics.`}
          {$t`The mail archive stores the current category, not when it was assigned, so the report cannot reconstruct the exact moment a request was taken into work.`}
        </p>
      </div>
    </div>
  {:else}
    <section class="report-ready-panel" aria-labelledby="report-ready-title">
      <div class="report-ready-heading">
        <div class="state-icon"><ChartIcon size="24px" /></div>
        <div>
          <p class="panel-kicker">{$t`REPORT READY`}</p>
          <h2 id="report-ready-title">{$t`Detailed report is ready`}</h2>
          <p>
            {$t`Open the report inside Jackdaw to review all charts, tables and response details.`}
          </p>
        </div>
      </div>
      <div class="report-ready-meta">
        <span class="period-label">{formatRange(report.range)}</span>
        {#if report.mailAccountFilter}
          <span class="meta-divider">·</span>
          <span class="scope-label"
            >{$t`Mailbox`}: {report.mailAccountFilter.accountName}{report
              .mailAccountFilter.email
              ? ` — ${report.mailAccountFilter.email}`
              : ""}</span
          >
        {/if}
        {#if report.mailFolderFilter}
          <span class="meta-divider">·</span>
          <span class="scope-label"
            >{$t`Folder`}: {report.mailFolderFilter.name}</span
          >
        {/if}
      </div>
      <div class="report-ready-stats">
        <div>
          <span>{$t`Mail`}</span>
          <strong>{formatNumber(report.summary.mailMessages)}</strong>
        </div>
        <div>
          <span>{$t`Requests answered`}</span>
          <strong>{formatNumber(report.summary.mailAnswered)}</strong>
        </div>
        <div>
          <span>{$t`Measured replies`}</span>
          <strong>{formatNumber(visibleResponseTimeStats.answered)}</strong>
        </div>
        <div>
          <span>{$t`Within target`}</span>
          <strong
            >{formatPercent(
              responseRate(
                visibleResponseTimeStats.withinTarget,
                visibleResponseTimeStats.answered,
              ),
            )}</strong
          >
        </div>
      </div>
      <button type="button" class="primary-button" on:click={openReportViewer}>
        <ChartIcon size="16px" />
        <span>{$t`Open detailed report`}</span>
      </button>
    </section>
  {/if}
</main>

<style>
  :global(.main-window) {
    --reports-accent: var(--icon-primary);
    --reports-accent-soft: var(--selected-bg);
    --reports-blue: #6688a8;
    --reports-teal: #4c8b7e;
    --reports-purple: #836a9c;
    --reports-green: #6a8f5c;
  }

  .reports-page {
    position: relative;
    height: 100%;
    min-height: 0;
    min-width: 0;
    overflow-y: auto;
    box-sizing: border-box;
    padding: 20px 24px 40px;
    background: var(--main-bg);
    color: var(--main-fg);
    font-variant-numeric: tabular-nums;
    container-type: inline-size;
    container-name: reports-page;
  }

  .reports-page:has(.report-viewer) {
    overflow: hidden;
  }

  .reports-header,
  .filter-heading,
  .panel-header,
  .summary-card-heading,
  .report-meta,
  .date-controls,
  .privacy-note,
  .peak-callout,
  .header-actions,
  .legend,
  .heatmap-scale {
    display: flex;
    align-items: center;
  }

  .reports-header {
    justify-content: space-between;
    gap: 24px;
    max-width: 1440px;
    margin: 0 auto 24px;
  }

  .title-block {
    min-width: 0;
  }

  .eyebrow,
  .panel-kicker {
    margin: 0 0 8px;
    color: var(--reports-accent);
    font-size: 11px;
    font-weight: 750;
    letter-spacing: 0.14em;
  }

  h1,
  h2,
  p {
    margin-top: 0;
  }

  h1 {
    margin-bottom: 8px;
    font-size: clamp(26px, 3vw, 34px);
    line-height: 1.05;
    letter-spacing: -0.03em;
  }

  .lead {
    max-width: 620px;
    margin-bottom: 0;
    color: color-mix(in srgb, var(--main-fg) 68%, transparent);
    font-size: 15px;
  }

  h2 {
    margin-bottom: 5px;
    font-size: 19px;
    line-height: 1.2;
    letter-spacing: -0.02em;
  }

  .header-actions {
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

  button:focus-visible,
  .timeline-scroll:focus-visible,
  .heatmap-scroll:focus-visible {
    outline: 2px solid var(--reports-accent);
    outline-offset: 2px;
  }

  .header-button,
  .refresh-button,
  .primary-button,
  .secondary-button,
  .preset-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
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

  .header-button:hover:not(:disabled),
  .refresh-button:hover:not(:disabled),
  .secondary-button:hover:not(:disabled),
  .preset-button:hover:not(:disabled) {
    background: var(--hover-bg);
    border-color: color-mix(in srgb, var(--reports-accent) 55%, var(--border));
  }

  .header-button.active {
    border-color: var(--reports-accent);
    background: color-mix(in srgb, var(--reports-accent) 14%, var(--main-bg));
    color: var(--main-fg);
  }

  .header-button:active:not(:disabled),
  .refresh-button:active:not(:disabled),
  .primary-button:active:not(:disabled),
  .secondary-button:active:not(:disabled),
  .preset-button:active:not(:disabled) {
    transform: scale(0.98);
  }

  .primary-button {
    min-height: 38px;
    padding-inline: 16px;
    border-color: var(--selected-bg);
    background: var(--selected-bg);
    color: var(--selected-fg);
    font-weight: 700;
  }

  .primary-button:hover:not(:disabled) {
    background: var(--selected-hover-bg, var(--selected-bg));
  }

  .secondary-button {
    min-height: 38px;
    padding-inline: 16px;
  }

  .filter-panel,
  .panel,
  .summary-card,
  .state-panel {
    border: 1px solid var(--border);
    border-radius: var(--border-radius, 8px);
    background: var(--main-bg);
    box-shadow: none;
  }

  .filter-panel {
    max-width: 1440px;
    margin: 0 auto 16px;
    padding: 14px 16px 12px;
  }

  .filter-heading {
    justify-content: space-between;
    gap: 16px;
  }

  .filter-heading p,
  .panel-header p {
    margin-bottom: 0;
    color: color-mix(in srgb, var(--main-fg) 60%, transparent);
    font-size: 13px;
    line-height: 1.4;
  }

  .refresh-button {
    min-height: 32px;
    padding-inline: 11px;
  }

  .preset-list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 16px 0;
  }

  .preset-button {
    min-height: 30px;
    padding: 5px 11px;
    border-color: var(--button-border);
    border-radius: 8px;
    background: var(--button-bg);
    font-size: 12px;
  }

  .preset-button.active {
    border-color: var(--selected-bg);
    background: var(--selected-bg);
    color: var(--selected-fg);
    font-weight: 700;
  }

  .date-controls {
    flex-wrap: wrap;
    gap: 8px;
  }

  .date-field {
    display: grid;
    gap: 5px;
  }

  .date-field > label {
    display: block;
  }

  .date-input-wrap {
    position: relative;
    display: flex;
    align-items: center;
  }

  label {
    display: grid;
    gap: 5px;
    color: color-mix(in srgb, var(--main-fg) 65%, transparent);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.03em;
  }

  input[type="date"] {
    min-height: 36px;
    box-sizing: border-box;
    border: 1px solid var(--input-line);
    border-radius: 9px;
    padding: 7px 36px 7px 9px;
    background: var(--input-bg);
    color: var(--input-fg);
    font: inherit;
    font-size: 13px;
  }

  input[type="time"] {
    width: 100px;
    min-height: 32px;
    box-sizing: border-box;
    border: 1px solid var(--input-line);
    border-radius: 8px;
    padding: 6px 8px;
    background: var(--input-bg);
    color: var(--input-fg);
    font: inherit;
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }

  .date-picker-button {
    position: absolute;
    right: 4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: color-mix(in srgb, var(--main-fg) 58%, transparent);
  }

  .date-picker-button:hover {
    background: color-mix(in srgb, var(--reports-accent) 12%, transparent);
    color: var(--reports-accent);
  }

  .date-picker-button:focus-visible {
    outline: 2px solid var(--reports-accent);
    outline-offset: 1px;
  }

  input[type="number"] {
    width: 92px;
    min-height: 36px;
    box-sizing: border-box;
    border: 1px solid var(--input-line);
    border-radius: 9px;
    padding: 7px 9px;
    background: var(--input-bg);
    color: var(--input-fg);
    font: inherit;
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }

  .mail-account-control {
    min-width: min(340px, 100%);
  }

  .mail-folder-control {
    min-width: min(190px, 100%);
  }

  .response-target-control {
    min-width: 152px;
  }

  .number-control {
    display: flex;
    align-items: center;
    gap: 6px;
    color: color-mix(in srgb, var(--main-fg) 56%, transparent);
    font-size: 12px;
    font-weight: 500;
    letter-spacing: 0;
  }

  select {
    min-height: 36px;
    max-width: min(420px, 100%);
    box-sizing: border-box;
    border: 1px solid var(--input-line);
    border-radius: 9px;
    padding: 7px 30px 7px 9px;
    background: var(--input-bg);
    color: var(--input-fg);
    font: inherit;
    font-size: 13px;
  }

  select:focus-visible {
    border-color: var(--reports-accent);
    outline: 2px solid
      color-mix(in srgb, var(--reports-accent) 34%, transparent);
    outline-offset: 1px;
  }

  input[type="date"]:focus-visible {
    border-color: var(--reports-accent);
    outline: 2px solid
      color-mix(in srgb, var(--reports-accent) 34%, transparent);
    outline-offset: 1px;
  }

  input[type="time"]:focus-visible {
    border-color: var(--reports-accent);
    outline: 2px solid
      color-mix(in srgb, var(--reports-accent) 34%, transparent);
    outline-offset: 1px;
  }

  input[type="number"]:focus-visible {
    border-color: var(--reports-accent);
    outline: 2px solid
      color-mix(in srgb, var(--reports-accent) 34%, transparent);
    outline-offset: 1px;
  }

  input[aria-invalid="true"] {
    border-color: var(--danger-fg, #b84e3b);
  }

  .date-separator {
    align-self: end;
    padding-bottom: 9px;
    color: color-mix(in srgb, var(--main-fg) 42%, transparent);
  }

  .date-controls .primary-button {
    align-self: end;
    margin-left: 4px;
  }

  .report-filter-block {
    min-width: 0;
    margin: 14px 0 0;
    padding: 11px 12px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--main-bg);
  }

  .report-filter-block legend {
    padding: 0 5px;
    color: color-mix(in srgb, var(--main-fg) 72%, transparent);
    font-size: 11px;
    font-weight: 750;
    letter-spacing: 0.04em;
  }

  .filter-block-heading,
  .attribution-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .filter-block-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .filter-count {
    color: color-mix(in srgb, var(--main-fg) 60%, transparent);
    font-size: 11px;
    font-weight: 650;
  }

  .inline-action {
    border: 0;
    padding: 2px 0;
    background: transparent;
    color: var(--reports-accent);
    font-size: 11px;
    font-weight: 700;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .inline-action:focus-visible {
    outline: 2px solid var(--reports-accent);
    outline-offset: 2px;
  }

  .category-options {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    max-height: 128px;
    margin-top: 9px;
    overflow-y: auto;
    padding-right: 4px;
  }

  .responder-options {
    max-height: 170px;
  }

  .category-option {
    display: flex;
    flex: 1 1 210px;
    align-items: center;
    gap: 7px;
    min-width: 180px;
    box-sizing: border-box;
    padding: 6px 8px;
    border: 1px solid color-mix(in srgb, var(--border) 62%, transparent);
    border-radius: 7px;
    background: color-mix(in srgb, var(--main-fg) 3%, transparent);
    color: color-mix(in srgb, var(--main-fg) 76%, transparent);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0;
  }

  .category-option:hover {
    border-color: color-mix(in srgb, var(--reports-accent) 42%, var(--border));
    background: color-mix(in srgb, var(--reports-accent) 8%, transparent);
  }

  .category-option input {
    flex-shrink: 0;
    accent-color: var(--reports-accent);
  }

  .category-option span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .category-option small {
    margin-left: auto;
    color: color-mix(in srgb, var(--main-fg) 48%, transparent);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
  }

  .filter-help {
    margin: 8px 0 0;
    color: color-mix(in srgb, var(--main-fg) 52%, transparent);
    font-size: 11px;
    line-height: 1.4;
  }

  .attribution-mode-control {
    display: grid;
    flex: 0 1 340px;
    gap: 5px;
  }

  .filter-scope-note {
    margin: 11px 0 0;
    color: color-mix(in srgb, var(--main-fg) 54%, transparent);
    font-size: 12px;
    line-height: 1.4;
  }

  .response-target-note {
    margin-top: 5px;
  }

  .working-hours-list {
    display: grid;
    grid-template-columns: repeat(2, minmax(260px, 1fr));
    gap: 6px 10px;
    margin-top: 10px;
  }

  .working-hours-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    min-height: 46px;
    padding: 5px 7px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--main-bg);
  }

  .working-day-toggle {
    display: flex;
    flex: 1 1 auto;
    align-items: center;
    gap: 7px;
    min-width: 75px;
    color: color-mix(in srgb, var(--main-fg) 76%, transparent);
    font-size: 12px;
    letter-spacing: 0;
  }

  .working-day-toggle input {
    flex-shrink: 0;
    accent-color: var(--reports-accent);
  }

  .working-time-control {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 5px;
    color: color-mix(in srgb, var(--main-fg) 52%, transparent);
    font-size: 10px;
    letter-spacing: 0;
  }

  .working-hours-separator {
    flex: 0 0 auto;
    color: color-mix(in srgb, var(--main-fg) 44%, transparent);
    font-size: 13px;
  }

  .working-day-off {
    margin-left: auto;
    color: color-mix(in srgb, var(--main-fg) 48%, transparent);
    font-size: 11px;
    font-weight: 600;
  }

  .mail-accounts-error {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin: 9px 0 0;
    color: var(--danger-fg, #b84e3b);
    font-size: 12px;
  }

  .live-control-launch {
    display: flex;
    align-items: center;
    gap: 12px;
    max-width: 1440px;
    margin: 14px auto 0;
    padding: 12px 14px;
    border: 1px solid var(--border);
    border-radius: var(--border-radius, 8px);
    background: var(--main-bg);
  }

  .live-control-launch-icon {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: var(--border-radius, 8px);
    background: var(--selected-hover-bg);
    color: var(--reports-accent);
  }

  .live-control-launch h2 {
    margin: 0 0 3px;
    font-size: 14px;
  }

  .live-control-launch p {
    margin: 0;
    color: color-mix(in srgb, var(--main-fg) 58%, transparent);
    font-size: 11px;
    line-height: 1.35;
  }

  .live-control-launch .secondary-button {
    flex: 0 0 auto;
    margin-left: auto;
  }

  .inline-retry {
    border: 0;
    padding: 0;
    background: transparent;
    color: var(--reports-accent);
    font: inherit;
    font-weight: 700;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .validation-message {
    margin: 10px 0 0;
    color: var(--danger-fg, #b84e3b);
    font-size: 12px;
  }

  .privacy-note {
    gap: 7px;
    margin: 16px 0 0;
    color: color-mix(in srgb, var(--main-fg) 54%, transparent);
    font-size: 12px;
  }

  .privacy-note :global(svg) {
    flex-shrink: 0;
    color: var(--reports-accent);
  }

  .state-panel {
    max-width: 680px;
    margin: 42px auto;
    padding: 36px 28px;
    text-align: center;
  }

  .state-panel h2 {
    margin: 15px 0 8px;
    font-size: 22px;
  }

  .state-panel p {
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
    background: color-mix(in srgb, var(--reports-accent) 15%, transparent);
    color: var(--reports-accent);
  }

  .error-icon {
    background: color-mix(in srgb, var(--danger-fg, #b84e3b) 14%, transparent);
    color: var(--danger-fg, #b84e3b);
  }

  .technical-error {
    overflow-wrap: anywhere;
    padding: 8px 10px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--danger-fg, #b84e3b) 8%, transparent);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px !important;
    text-align: left;
  }

  .loading-panel {
    max-width: 960px;
    text-align: left;
  }

  .loading-panel > p {
    margin: 18px 0 0;
    text-align: center;
  }

  .skeleton {
    border-radius: 9px;
    background: linear-gradient(
      90deg,
      color-mix(in srgb, var(--main-fg) 7%, transparent),
      color-mix(in srgb, var(--main-fg) 14%, transparent),
      color-mix(in srgb, var(--main-fg) 7%, transparent)
    );
    background-size: 200% 100%;
    animation: skeleton-shimmer 1.4s ease-in-out infinite;
  }

  .skeleton-title {
    width: 32%;
    height: 18px;
    margin-bottom: 18px;
  }

  .skeleton-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
    margin-bottom: 18px;
  }

  .skeleton-card {
    height: 76px;
  }

  .skeleton-chart {
    height: 210px;
  }

  @keyframes skeleton-shimmer {
    from {
      background-position: 100% 0;
    }
    to {
      background-position: -100% 0;
    }
  }

  .report-meta {
    flex-wrap: wrap;
    gap: 8px;
    max-width: 1440px;
    margin: 0 auto 12px;
    color: color-mix(in srgb, var(--main-fg) 56%, transparent);
    font-size: 12px;
  }

  .report-viewer {
    position: absolute;
    z-index: 100;
    inset: 0;
    display: flex;
    flex-direction: column;
    height: 100%;
    max-height: 100%;
    min-width: 0;
    min-height: 0;
    box-sizing: border-box;
    overflow: hidden;
    padding: 18px 24px 40px;
    background: var(--bg);
    color: var(--main-fg);
    isolation: isolate;
    container-type: inline-size;
  }

  /*
   * Шапка окна — отдельный контекст с z-index: 10. Поднимаем оболочку только
   * во время показа отчёта, чтобы его панель не рисовалась под шапкой.
   */
  :global(.content-shell:has(.report-viewer)) {
    z-index: 11;
  }

  .report-viewer:focus {
    outline: none;
  }

  .report-viewer-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 24px;
    max-width: 1440px;
    margin: 0 auto 14px;
  }

  .report-viewer-topbar {
    flex: 0 0 auto;
    min-width: 0;
    padding-top: 2px;
    border-bottom: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
    background: var(--bg);
  }

  .report-viewer-header h2 {
    margin-bottom: 7px;
    font-size: clamp(24px, 3vw, 34px);
    letter-spacing: -0.04em;
  }

  .report-viewer-header p:not(.eyebrow) {
    max-width: 680px;
    margin-bottom: 0;
    color: color-mix(in srgb, var(--main-fg) 64%, transparent);
    font-size: 13px;
    line-height: 1.45;
  }

  .report-viewer-header .header-actions {
    align-items: flex-start;
    flex-shrink: 0;
    min-width: 0;
  }

  .report-viewer-nav {
    display: flex;
    gap: 6px;
    max-width: 1440px;
    margin: 0 auto 12px;
    overflow-x: auto;
    padding: 5px;
    border: 1px solid var(--border);
    border-radius: var(--border-radius, 8px);
    background: var(--headerbar-bg);
    box-shadow: var(--glass-shadow);
  }

  .report-viewer-nav button {
    flex: 0 0 auto;
    border: 1px solid transparent;
    border-radius: var(--border-radius, 8px);
    padding: 6px 9px;
    background: transparent;
    color: color-mix(in srgb, var(--main-fg) 68%, transparent);
    cursor: pointer;
    font-size: 11px;
    font-weight: 650;
    white-space: nowrap;
  }

  .report-viewer-nav button:hover,
  .report-viewer-nav button:focus-visible {
    border-color: color-mix(in srgb, var(--reports-accent) 44%, var(--border));
    background: color-mix(in srgb, var(--reports-accent) 10%, transparent);
    color: var(--main-fg);
  }

  .report-viewer-nav button:focus-visible {
    outline: 2px solid var(--reports-accent);
    outline-offset: 1px;
  }

  .report-viewer-content {
    flex: 1 1 auto;
    width: 100%;
    min-width: 0;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
    scroll-padding-top: 16px;
  }

  .report-ready-panel {
    max-width: 980px;
    margin: 42px auto;
    padding: 24px;
    border: 1px solid var(--border);
    border-radius: var(--border-radius, 8px);
    background: var(--main-bg);
    box-shadow: none;
  }

  .report-ready-heading {
    display: flex;
    align-items: flex-start;
    gap: 14px;
  }

  .report-ready-heading .state-icon {
    flex: 0 0 auto;
  }

  .report-ready-heading h2 {
    margin: 2px 0 6px;
    font-size: 22px;
  }

  .report-ready-heading p:not(.panel-kicker) {
    max-width: 650px;
    margin-bottom: 0;
    color: color-mix(in srgb, var(--main-fg) 64%, transparent);
    font-size: 13px;
    line-height: 1.45;
  }

  .report-ready-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 20px 0 14px;
    color: color-mix(in srgb, var(--main-fg) 58%, transparent);
    font-size: 12px;
  }

  .report-ready-stats {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
    margin-bottom: 18px;
  }

  .report-ready-stats > div {
    min-width: 0;
    padding: 11px 12px;
    border: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
    border-radius: 9px;
    background: color-mix(in srgb, var(--main-fg) 3%, transparent);
  }

  .report-ready-stats span {
    display: block;
    overflow: hidden;
    color: color-mix(in srgb, var(--main-fg) 58%, transparent);
    font-size: 10px;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .report-ready-stats strong {
    display: block;
    margin-top: 6px;
    color: var(--main-fg);
    font-size: 20px;
    line-height: 1;
  }

  .period-label {
    color: var(--main-fg);
    font-weight: 700;
  }

  .scope-label {
    color: var(--main-fg);
    font-weight: 700;
  }

  .meta-divider {
    color: color-mix(in srgb, var(--main-fg) 28%, transparent);
  }

  .export-error {
    max-width: 1440px;
    margin: 0 auto 12px;
    color: var(--danger-fg, #b84e3b);
    font-size: 12px;
  }

  .export-success {
    max-width: 1440px;
    margin: 0 auto 12px;
    color: var(--reports-teal);
    font-size: 12px;
    font-weight: 700;
  }

  .export-file-name {
    margin-left: 4px;
    color: var(--main-fg);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
    font-weight: 600;
  }

  .summary-grid {
    display: grid;
    grid-template-columns: 1.35fr repeat(5, 1fr);
    gap: 10px;
    max-width: 1440px;
    margin: 0 auto 16px;
  }

  .summary-card {
    min-width: 0;
    padding: 15px 16px;
  }

  .summary-card.summary-primary {
    border-color: var(--selected-hover-bg);
    background: var(--selected-bg);
  }

  .summary-card-heading {
    justify-content: space-between;
    gap: 8px;
    color: color-mix(in srgb, var(--main-fg) 62%, transparent);
    font-size: 12px;
    font-weight: 700;
  }

  .summary-card-heading :global(svg) {
    color: var(--reports-accent);
  }

  .summary-card strong {
    display: block;
    margin: 13px 0 4px;
    color: var(--main-fg);
    font-size: clamp(22px, 2vw, 30px);
    line-height: 1;
    letter-spacing: -0.04em;
  }

  .summary-card p {
    min-height: 32px;
    margin: 0;
    color: color-mix(in srgb, var(--main-fg) 54%, transparent);
    font-size: 11px;
    line-height: 1.45;
  }

  .response-card strong {
    color: var(--reports-teal);
  }

  .response-card .response-count {
    color: var(--main-fg);
    font-variant-numeric: tabular-nums;
    font-weight: 700;
  }

  .panel {
    max-width: 1440px;
    margin: 0 auto 16px;
    padding: 20px;
  }

  .panel-header {
    justify-content: space-between;
    align-items: flex-start;
    gap: 18px;
    margin-bottom: 18px;
  }

  .panel-header > div:first-child {
    min-width: 0;
  }

  .panel-icon {
    flex-shrink: 0;
    color: var(--reports-accent);
  }

  .legend {
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px 12px;
    color: color-mix(in srgb, var(--main-fg) 62%, transparent);
    font-size: 11px;
  }

  .legend span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    white-space: nowrap;
  }

  .legend-dot,
  .scale-cell {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 3px;
    background: var(--reports-accent);
  }

  .timeline-scroll,
  .heatmap-scroll {
    overflow-x: auto;
    scrollbar-width: thin;
  }

  .timeline-chart {
    display: grid;
    grid-template-columns: repeat(var(--timeline-columns), minmax(14px, 1fr));
    align-items: end;
    gap: 5px;
    min-width: max(100%, 520px);
    height: 240px;
    padding: 10px 2px 0;
    border-bottom: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
  }

  .timeline-item {
    display: grid;
    grid-template-rows: 1fr 23px;
    min-width: 0;
    height: 100%;
  }

  .bar-area {
    display: flex;
    align-items: end;
    justify-content: center;
    min-height: 0;
  }

  .bar-stack {
    display: flex;
    align-items: end;
    justify-content: center;
    width: min(100%, 22px);
    height: 100%;
    gap: 1px;
  }

  .bar {
    width: 100%;
    min-height: 0;
    border-radius: 3px 3px 0 0;
    opacity: 0.88;
    transition: height 220ms ease;
  }

  .mail-in {
    background: var(--reports-blue);
  }
  .mail-out {
    background: var(--reports-accent);
  }
  .chat-out {
    background: var(--reports-teal);
  }
  .calendar {
    background: var(--reports-purple);
  }
  .files {
    background: var(--reports-green);
  }

  .timeline-label {
    align-self: end;
    overflow: hidden;
    color: color-mix(in srgb, var(--main-fg) 54%, transparent);
    font-size: 10px;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .heatmap-header {
    align-items: center;
  }

  .peak-callout {
    flex-shrink: 0;
    gap: 7px;
    padding: 8px 10px;
    border-radius: 9px;
    background: color-mix(in srgb, var(--reports-accent) 10%, transparent);
    color: color-mix(in srgb, var(--main-fg) 62%, transparent);
    font-size: 12px;
  }

  .peak-callout :global(svg) {
    color: var(--reports-accent);
  }

  .peak-callout strong {
    color: var(--main-fg);
  }

  .heatmap {
    display: grid;
    grid-template-columns: 54px repeat(24, minmax(16px, 1fr));
    grid-auto-rows: 22px;
    gap: 3px;
    min-width: 650px;
  }

  .heat-hour,
  .heat-day {
    color: color-mix(in srgb, var(--main-fg) 54%, transparent);
    font-size: 10px;
  }

  .heat-hour {
    align-self: center;
    text-align: center;
  }

  .heat-day {
    align-self: center;
    font-weight: 700;
    text-align: right;
  }

  .heat-cell {
    position: relative;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--border) 42%, transparent);
    border-radius: 4px;
    background: color-mix(in srgb, var(--main-fg) 4%, transparent);
  }

  .heat-cell::after {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: var(--reports-accent);
    content: "";
    opacity: var(--cell-opacity);
  }

  .heatmap-scale {
    justify-content: flex-end;
    gap: 5px;
    margin-top: 12px;
    color: color-mix(in srgb, var(--main-fg) 52%, transparent);
    font-size: 10px;
  }

  .scale-cell.low {
    opacity: 0.2;
  }
  .scale-cell.medium {
    opacity: 0.55;
  }
  .scale-cell.high {
    opacity: 1;
  }

  .response-time-panel {
    max-width: 1440px;
  }

  .response-target-callout {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 7px;
    padding: 8px 10px;
    border-radius: 9px;
    background: color-mix(in srgb, var(--reports-teal) 11%, transparent);
    color: color-mix(in srgb, var(--main-fg) 62%, transparent);
    font-size: 12px;
  }

  .response-target-callout :global(svg) {
    color: var(--reports-teal);
  }

  .response-target-callout strong {
    display: block;
    margin-top: 2px;
    color: var(--main-fg);
  }

  .response-metrics {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 8px;
    margin-bottom: 18px;
  }

  .response-metric {
    min-width: 0;
    padding: 12px 13px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--main-bg);
  }

  .response-metric > span,
  .response-metric > small {
    display: block;
  }

  .response-metric > span {
    overflow: hidden;
    color: color-mix(in srgb, var(--main-fg) 58%, transparent);
    font-size: 11px;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .response-metric strong {
    display: block;
    margin: 11px 0 4px;
    color: var(--main-fg);
    font-size: clamp(18px, 2vw, 25px);
    line-height: 1;
    letter-spacing: -0.04em;
  }

  .response-metric > small {
    min-height: 29px;
    color: color-mix(in srgb, var(--main-fg) 48%, transparent);
    font-size: 10px;
    line-height: 1.4;
  }

  .response-metric-good strong,
  .response-metric-good > small {
    color: var(--reports-teal);
  }

  .response-metric-alert strong,
  .response-metric-alert > small,
  .overdue-value {
    color: var(--danger-fg, #b84e3b);
  }

  .response-metric-after-hours strong,
  .response-metric-after-hours > small {
    color: var(--reports-accent);
  }

  .response-time-note {
    margin: 7px 0 0;
    color: color-mix(in srgb, var(--reports-accent) 82%, var(--main-fg));
    font-size: 11px;
    line-height: 1.4;
  }

  .response-detail-grid {
    display: grid;
    grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.45fr);
    gap: 16px;
  }

  .response-detail-block {
    min-width: 0;
  }

  .after-hours-response-block {
    margin-top: 20px;
    padding-top: 18px;
    border-top: 1px solid var(--border);
  }

  .after-hours-response-block .table-wrap {
    max-height: min(52vh, 640px);
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: 8px;
  }

  .after-hours-response-block .table-wrap thead {
    position: sticky;
    z-index: 1;
    top: 0;
    background: var(--headerbar-bg);
  }

  .after-hours-response-table {
    table-layout: fixed;
  }

  .after-hours-response-table th:nth-child(1),
  .after-hours-response-table td:nth-child(1) {
    width: 16%;
  }

  .after-hours-response-table th:nth-child(2),
  .after-hours-response-table td:nth-child(2) {
    width: 18%;
  }

  .after-hours-response-table th:nth-child(3),
  .after-hours-response-table td:nth-child(3) {
    width: 14%;
  }

  .after-hours-response-table th:nth-child(4),
  .after-hours-response-table td:nth-child(4) {
    width: 36%;
  }

  .after-hours-response-table th:nth-child(5),
  .after-hours-response-table td:nth-child(5) {
    width: 16%;
  }

  .category-rhythm-panel {
    max-width: 1440px;
  }

  .rhythm-leader-callout {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 7px;
    max-width: min(360px, 100%);
    padding: 8px 10px;
    border-radius: 9px;
    background: color-mix(in srgb, var(--reports-accent) 10%, transparent);
    color: color-mix(in srgb, var(--main-fg) 62%, transparent);
    font-size: 12px;
  }

  .rhythm-leader-callout :global(svg) {
    flex-shrink: 0;
    color: var(--reports-accent);
  }

  .rhythm-leader-callout > span {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0 5px;
  }

  .rhythm-leader-callout strong:first-of-type {
    overflow: hidden;
    color: var(--main-fg);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rhythm-leader-callout strong:last-of-type {
    color: var(--reports-accent);
  }

  .category-rhythm-grid {
    display: grid;
    grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
    gap: 18px;
  }

  .rhythm-ranking,
  .category-rhythm-focus,
  .rhythm-overview {
    min-width: 0;
  }

  .rhythm-bar-chart {
    display: grid;
    gap: 6px;
  }

  .rhythm-rank-row {
    display: grid;
    grid-template-columns:
      22px minmax(110px, 0.8fr) minmax(80px, 1fr)
      34px 48px;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-width: 0;
    border: 1px solid transparent;
    border-radius: 8px;
    padding: 7px 8px;
    background: transparent;
    color: var(--main-fg);
    text-align: left;
    transition:
      background-color 150ms ease,
      border-color 150ms ease,
      transform 150ms ease;
  }

  .rhythm-rank-row:hover {
    border-color: var(--border);
    background: var(--hover-bg);
  }

  .rhythm-rank-row:active {
    transform: scale(0.995);
  }

  .rhythm-rank-row:focus-visible {
    outline: 2px solid var(--reports-accent);
    outline-offset: 2px;
  }

  .rhythm-rank-row.active {
    border-color: color-mix(in srgb, var(--reports-accent) 55%, var(--border));
    background: color-mix(in srgb, var(--reports-accent) 9%, transparent);
  }

  .rhythm-rank-index {
    color: color-mix(in srgb, var(--main-fg) 48%, transparent);
    font-size: 11px;
    font-weight: 750;
    text-align: center;
  }

  .rhythm-rank-name {
    min-width: 0;
    overflow: hidden;
    font-size: 12px;
    font-weight: 650;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rhythm-rank-track {
    display: block;
    height: 9px;
    overflow: hidden;
    border-radius: 999px;
    background: color-mix(in srgb, var(--main-fg) 9%, transparent);
  }

  .rhythm-rank-track > span {
    display: block;
    height: 100%;
    min-width: 0;
    border-radius: inherit;
    background: var(--reports-accent);
  }

  .rhythm-rank-count {
    color: var(--reports-accent);
    font-size: 12px;
    text-align: right;
  }

  .rhythm-rank-row small {
    color: color-mix(in srgb, var(--main-fg) 54%, transparent);
    font-size: 10px;
    text-align: right;
  }

  .rhythm-focus-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  .rhythm-category-select {
    flex: 0 1 260px;
    min-width: 150px;
  }

  .rhythm-category-select select {
    width: 100%;
    max-width: none;
  }

  .rhythm-focus-stats {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 7px;
    margin-bottom: 12px;
  }

  .rhythm-focus-stats > div {
    min-width: 0;
    padding: 9px 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: color-mix(in srgb, var(--main-bg) 88%, var(--reports-accent));
  }

  .rhythm-focus-stats span,
  .rhythm-focus-stats strong,
  .rhythm-focus-stats small {
    display: block;
  }

  .rhythm-focus-stats span {
    overflow: hidden;
    color: color-mix(in srgb, var(--main-fg) 54%, transparent);
    font-size: 10px;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rhythm-focus-stats strong {
    margin: 7px 0 3px;
    overflow: hidden;
    color: var(--main-fg);
    font-size: 13px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rhythm-focus-stats small {
    min-height: 27px;
    color: color-mix(in srgb, var(--main-fg) 48%, transparent);
    font-size: 10px;
    line-height: 1.35;
  }

  .category-rhythm-heatmap-scroll {
    overflow-x: auto;
    scrollbar-width: thin;
  }

  .category-rhythm-heatmap {
    display: grid;
    grid-template-columns: 54px repeat(24, minmax(16px, 1fr));
    grid-auto-rows: 22px;
    gap: 3px;
    min-width: 650px;
  }

  .category-rhythm-heatmap .heat-cell {
    cursor: help;
  }

  .rhythm-overview {
    margin-top: 20px;
    padding-top: 18px;
    border-top: 1px solid var(--border);
  }

  .rhythm-overview-table th:nth-child(1),
  .rhythm-overview-table td:nth-child(1) {
    width: 20%;
  }

  .rhythm-overview-table th:nth-child(2),
  .rhythm-overview-table td:nth-child(2) {
    width: 8%;
  }

  .rhythm-overview-table th:nth-child(3),
  .rhythm-overview-table td:nth-child(3) {
    width: 9%;
  }

  .rhythm-overview-table th:nth-child(4),
  .rhythm-overview-table td:nth-child(4) {
    width: 11%;
  }

  .rhythm-overview-table th:nth-child(5),
  .rhythm-overview-table td:nth-child(5),
  .rhythm-overview-table th:nth-child(6),
  .rhythm-overview-table td:nth-child(6) {
    width: 9%;
  }

  .rhythm-overview-table th:nth-child(7),
  .rhythm-overview-table td:nth-child(7) {
    width: 12%;
  }

  .rhythm-overview-table th:nth-child(8),
  .rhythm-overview-table td:nth-child(8),
  .rhythm-overview-table th:nth-child(9),
  .rhythm-overview-table td:nth-child(9) {
    width: 11%;
  }

  .rhythm-overview-table thead th {
    font-size: clamp(8px, 0.72cqw, 10px);
    letter-spacing: 0.03em;
    line-height: 1.15;
    overflow-wrap: break-word;
    text-wrap: balance;
  }

  .rhythm-overview-table thead .numeric {
    white-space: normal;
  }

  .rhythm-disclaimer {
    color: color-mix(in srgb, var(--reports-accent) 72%, var(--main-fg));
  }

  @container dashboard-item (max-width: 900px) {
    .category-rhythm-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  @container dashboard-item (max-width: 720px) {
    .rhythm-focus-stats {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .rhythm-focus-heading {
      flex-direction: column;
    }

    .rhythm-category-select {
      width: 100%;
    }
  }

  @container dashboard-item (max-width: 520px) {
    .rhythm-focus-stats {
      grid-template-columns: minmax(0, 1fr);
    }

    .rhythm-rank-row {
      grid-template-rows: auto 9px;
    }

    .rhythm-rank-track {
      grid-column: 2;
      grid-row: 2;
    }

    .rhythm-rank-count {
      grid-column: 3;
      grid-row: 1;
    }

    .rhythm-rank-row small {
      grid-column: 3;
      grid-row: 2;
    }
  }

  .subpanel-heading {
    margin-bottom: 9px;
  }

  .subpanel-heading h3 {
    margin: 0 0 4px;
    font-size: 13px;
    line-height: 1.25;
  }

  .subpanel-heading p {
    margin: 0;
    color: color-mix(in srgb, var(--main-fg) 52%, transparent);
    font-size: 11px;
    line-height: 1.4;
  }

  .response-empty {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 15px 13px;
    border: 1px dashed color-mix(in srgb, var(--border) 72%, transparent);
    border-radius: 10px;
    color: color-mix(in srgb, var(--main-fg) 56%, transparent);
    font-size: 12px;
  }

  .response-empty :global(svg) {
    flex-shrink: 0;
    color: var(--reports-accent);
  }

  .status-pill {
    display: inline-block;
    min-width: 64px;
    padding: 3px 6px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--danger-fg, #b84e3b) 12%, transparent);
    color: var(--danger-fg, #b84e3b);
    font-size: 10px;
    font-weight: 700;
    text-align: center;
  }

  .status-pill.within {
    background: color-mix(in srgb, var(--reports-teal) 14%, transparent);
    color: var(--reports-teal);
  }

  .status-pill.outside-hours {
    background: color-mix(in srgb, var(--main-fg) 9%, transparent);
    color: color-mix(in srgb, var(--main-fg) 58%, transparent);
  }

  .response-status-stack {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
  }

  .outside-hours-marker,
  .outside-hours-legend {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: color-mix(in srgb, var(--reports-accent) 82%, var(--main-fg));
    font-size: 10px;
    font-weight: 700;
    line-height: 1.2;
  }

  .outside-hours-marker {
    padding: 3px 6px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--reports-accent) 13%, transparent);
  }

  .outside-hours-legend {
    margin-left: 8px;
    font-weight: 600;
  }

  .outside-hours-legend i {
    width: 8px;
    height: 8px;
    border-radius: 3px;
    background: color-mix(in srgb, var(--reports-accent) 25%, transparent);
    box-shadow: inset 3px 0 0 var(--reports-accent);
  }

  .layout-help {
    max-width: 1440px;
    margin: 0 auto 10px;
    color: color-mix(in srgb, var(--main-fg) 58%, transparent);
    font-size: 11px;
    line-height: 1.45;
  }

  .dashboard-grid {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    align-items: flex-start;
    gap: 16px;
    min-width: 0;
    max-width: 1440px;
    margin: 0 auto;
  }

  .report-columns {
    display: contents;
  }

  .dashboard-item {
    grid-column: span 6;
    min-width: 0;
    max-width: 100%;
    box-sizing: border-box;
    min-height: 0;
    container-type: inline-size;
    container-name: dashboard-item;
  }

  .dashboard-item.layout-full {
    grid-column: 1 / -1;
  }

  .dashboard-item.layout-tall .panel {
    min-height: 430px;
  }

  .dashboard-item .panel {
    width: 100%;
    min-width: 0;
    max-width: none;
    box-sizing: border-box;
  }

  .dashboard-grid.layout-editing {
    gap: 10px 16px;
  }

  .dashboard-grid.layout-editing .dashboard-item {
    cursor: grab;
  }

  .dashboard-grid.layout-editing .dashboard-item:active {
    cursor: grabbing;
  }

  .dashboard-grid.layout-editing .dashboard-item .panel {
    margin-bottom: 0;
  }

  .email-link {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    max-width: 100%;
    border: 0;
    padding: 0;
    overflow: hidden;
    background: transparent;
    color: var(--main-fg);
    font: inherit;
    text-align: left;
    text-decoration: underline;
    text-decoration-color: color-mix(
      in srgb,
      var(--reports-accent) 60%,
      transparent
    );
    text-underline-offset: 2px;
  }

  .email-link :global(svg) {
    flex-shrink: 0;
    color: var(--reports-accent);
  }

  .email-link span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Узкие блоки должны показывать все колонки ответа, а не уводить статус
     за пределы видимой области. Полноширинный блок сохраняет компактную
     двухколоночную компоновку и прежний уровень детализации. */
  .dashboard-item:not(.layout-full) .response-detail-grid {
    grid-template-columns: 1fr;
  }

  .dashboard-item:not(.layout-full) .response-detail-block .table-wrap {
    overflow-x: hidden;
  }

  .response-detail-block .response-day-table,
  .response-detail-block .response-detail-table {
    table-layout: fixed;
    min-width: 0;
  }

  .dashboard-item:not(.layout-full) .response-detail-block thead th,
  .dashboard-item:not(.layout-full) .response-detail-block th,
  .dashboard-item:not(.layout-full) .response-detail-block td {
    overflow-wrap: anywhere;
  }

  .dashboard-item:not(.layout-full) .response-detail-block thead th {
    white-space: normal;
  }

  .dashboard-item:not(.layout-full) .response-detail-block tbody th {
    min-width: 0;
  }

  .dashboard-item:not(.layout-full) .response-detail-block .topic-cell {
    max-width: none;
    overflow: visible;
    text-overflow: clip;
    white-space: normal;
  }

  .dashboard-item:not(.layout-full) .response-detail-block .email-link {
    display: flex;
    align-items: flex-start;
    overflow: visible;
    white-space: normal;
  }

  .dashboard-item:not(.layout-full) .response-detail-block .email-link span {
    overflow: visible;
    text-overflow: clip;
    white-space: normal;
    overflow-wrap: anywhere;
  }

  .dashboard-item:not(.layout-full) .response-detail-block .status-pill {
    min-width: 0;
    max-width: 100%;
    white-space: normal;
  }

  .dashboard-item:not(.layout-full)
    .response-detail-table
    :global(.table-sort-button) {
    flex-wrap: wrap;
    gap: 2px;
    padding-inline: 2px;
  }

  .dashboard-item:not(.layout-full)
    .response-detail-table
    :global(.table-sort-button > span:first-child) {
    min-width: 0;
    overflow-wrap: normal;
    word-break: normal;
    hyphens: none;
  }

  .response-detail-table th:nth-child(1),
  .response-detail-table td:nth-child(1),
  .response-detail-table th:nth-child(2),
  .response-detail-table td:nth-child(2) {
    width: 14%;
  }

  .response-detail-table th:nth-child(3),
  .response-detail-table td:nth-child(3) {
    width: 13%;
  }

  .response-detail-table th:nth-child(4),
  .response-detail-table td:nth-child(4) {
    width: 16%;
  }

  .response-detail-table th:nth-child(5),
  .response-detail-table td:nth-child(5) {
    width: 31%;
  }

  .response-detail-table th:nth-child(6),
  .response-detail-table td:nth-child(6) {
    width: 12%;
  }

  .response-day-table th:first-child,
  .response-day-table td:first-child {
    width: 26%;
  }

  .response-day-table th:not(:first-child),
  .response-day-table td:not(:first-child) {
    width: 18.5%;
  }

  .email-link:hover:not(:disabled) {
    color: var(--reports-accent);
  }

  .email-link:focus-visible {
    outline: 2px solid var(--reports-accent);
    outline-offset: 2px;
  }

  .overdue-row td {
    background: color-mix(in srgb, var(--danger-fg, #b84e3b) 3%, transparent);
  }

  .outside-hours-row td {
    background: color-mix(in srgb, var(--reports-accent) 7%, transparent);
  }

  .outside-hours-row td:first-child {
    box-shadow: inset 3px 0 0 var(--reports-accent);
  }

  .response-open-error {
    margin: 10px 0 0;
    color: var(--danger-fg, #b84e3b);
    font-size: 11px;
    line-height: 1.4;
  }

  .table-wrap {
    min-width: 0;
    max-width: 100%;
    overflow-x: hidden;
    container-type: inline-size;
    container-name: report-table;
  }

  .response-detail-block .table-wrap {
    max-height: min(70vh, 840px);
    overflow-x: hidden;
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: 8px;
  }

  .response-detail-block .table-wrap thead {
    position: sticky;
    z-index: 1;
    top: 0;
    background: var(--headerbar-bg);
  }

  .table-note {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    margin: 12px 0 0;
    color: color-mix(in srgb, var(--main-fg) 54%, transparent);
    font-size: 11px;
    line-height: 1.45;
  }

  .table-more-button {
    border: 0;
    padding: 0;
    background: transparent;
    color: var(--reports-accent);
    cursor: pointer;
    font: inherit;
    font-weight: 700;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .table-more-button:hover {
    color: var(--main-fg);
  }

  .report-note {
    margin: 6px 0 0;
    color: color-mix(in srgb, var(--main-fg) 54%, transparent);
    font-size: 11px;
    line-height: 1.45;
  }

  table {
    width: 100%;
    max-width: 100%;
    table-layout: fixed;
    border-collapse: collapse;
    font-size: 12px;
  }

  /* Заголовок подстраивается под фактическую ширину таблицы. Переносим его
     только между словами: если столбец становится уже, уменьшаем кегль, а
     не превращаем заголовок в вертикальную колонку букв. */
  .table-wrap :global(.table-sort-button) {
    font-size: clamp(8px, 0.58cqw, 10px);
    letter-spacing: 0.02em;
    overflow-wrap: normal;
    word-break: keep-all;
    hyphens: none;
    text-wrap: balance;
  }

  th,
  td {
    min-width: 0;
    padding: 10px 8px;
    border-bottom: 1px solid var(--border);
    text-align: left;
    vertical-align: middle;
    overflow-wrap: normal;
    word-break: normal;
    hyphens: none;
  }

  thead th {
    color: color-mix(in srgb, var(--main-fg) 54%, transparent);
    font-size: 10px;
    font-weight: 750;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    white-space: normal;
    word-break: normal;
    hyphens: none;
  }

  tbody tr:last-child th,
  tbody tr:last-child td {
    border-bottom: 0;
  }

  tbody tr:hover th,
  tbody tr:hover td {
    background: color-mix(in srgb, var(--hover-bg) 55%, transparent);
  }

  tbody th {
    min-width: 0;
    color: var(--main-fg);
    font-weight: 650;
  }

  .numeric {
    text-align: right;
    white-space: nowrap;
  }

  .emphasized {
    color: var(--reports-teal);
    font-weight: 750;
  }

  .muted,
  .person-email,
  .table-rate {
    color: color-mix(in srgb, var(--main-fg) 50%, transparent);
  }

  .person-name,
  .person-email {
    display: block;
  }

  .person-email {
    margin-top: 3px;
    overflow: hidden;
    font-size: 10px;
    font-weight: 400;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rate-pill {
    display: inline-block;
    min-width: 38px;
    padding: 3px 6px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--main-fg) 8%, transparent);
    color: color-mix(in srgb, var(--main-fg) 66%, transparent);
    font-size: 11px;
    text-align: center;
  }

  .rate-pill.good {
    background: color-mix(in srgb, var(--reports-teal) 15%, transparent);
    color: var(--reports-teal);
  }

  .topic-cell {
    max-width: 300px;
    overflow: hidden;
    overflow-wrap: break-word;
    word-break: normal;
    text-overflow: ellipsis;
    white-space: normal;
  }

  .responder-table th:nth-child(1),
  .responder-table td:nth-child(1) {
    width: 14%;
  }

  .responder-table th:nth-child(2),
  .responder-table td:nth-child(2) {
    width: 6%;
  }

  .responder-table th:nth-child(3),
  .responder-table td:nth-child(3) {
    width: 7%;
  }

  .responder-table th:nth-child(4),
  .responder-table td:nth-child(4) {
    width: 8%;
  }

  .responder-table th:nth-child(5),
  .responder-table td:nth-child(5),
  .responder-table th:nth-child(6),
  .responder-table td:nth-child(6),
  .responder-table th:nth-child(7),
  .responder-table td:nth-child(7) {
    width: 8%;
  }

  .responder-table th:nth-child(8),
  .responder-table td:nth-child(8) {
    width: 10%;
  }

  .responder-table th:nth-child(9),
  .responder-table td:nth-child(9) {
    width: 8%;
  }

  .responder-table th:nth-child(10),
  .responder-table td:nth-child(10) {
    width: 10%;
  }

  .responder-table th:nth-child(11),
  .responder-table td:nth-child(11) {
    width: 6%;
  }

  .responder-table th:nth-child(12),
  .responder-table td:nth-child(12) {
    width: 7%;
  }

  .category-table th:nth-child(1),
  .category-table td:nth-child(1) {
    width: 22%;
  }

  .category-table th:nth-child(2),
  .category-table td:nth-child(2) {
    width: 10%;
  }

  .category-table th:nth-child(3),
  .category-table td:nth-child(3) {
    width: 11%;
  }

  .category-table th:nth-child(4),
  .category-table td:nth-child(4) {
    width: 7%;
  }

  .category-table th:nth-child(5),
  .category-table td:nth-child(5) {
    width: 11%;
  }

  .category-table th:nth-child(6),
  .category-table td:nth-child(6),
  .category-table th:nth-child(7),
  .category-table td:nth-child(7),
  .category-table th:nth-child(8),
  .category-table td:nth-child(8) {
    width: 8%;
  }

  .category-table th:nth-child(9),
  .category-table td:nth-child(9) {
    width: 10%;
  }

  .category-table th:nth-child(10),
  .category-table td:nth-child(10) {
    width: 5%;
  }

  .empty-cell {
    padding: 24px 8px;
    color: color-mix(in srgb, var(--main-fg) 50%, transparent);
    text-align: center;
  }

  /* Таблицы с большим числом показателей превращаются в карточки внутри
     узкого виджета. Поэтому ширина виджета не обрезает значения и не требует
     горизонтальной прокрутки. */
  @container dashboard-item (max-width: 1100px) {
    .responsive-report-table,
    .responsive-report-table tbody,
    .responsive-report-table tr,
    .responsive-report-table td,
    .responsive-report-table th {
      display: block;
    }

    .responsive-report-table thead {
      display: none;
    }

    .responsive-report-table tbody tr {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 4px 14px;
      padding: 10px 8px;
    }

    .responsive-report-table tbody tr + tr {
      border-top: 1px solid var(--border);
    }

    .responsive-report-table tbody td,
    .responsive-report-table tbody th {
      display: grid;
      grid-template-columns: minmax(84px, 42%) minmax(0, 1fr);
      gap: 8px;
      width: auto;
      min-width: 0;
      padding: 3px 0;
      border-bottom: 0;
      text-align: left;
      white-space: normal;
    }

    .responsive-report-table tbody td::before,
    .responsive-report-table tbody th::before {
      color: color-mix(in srgb, var(--main-fg) 52%, transparent);
      content: attr(data-label);
      font-size: 9px;
      font-weight: 750;
      letter-spacing: 0.04em;
      line-height: 1.35;
      text-transform: uppercase;
    }

    .responsive-report-table tbody .numeric {
      text-align: left;
      white-space: normal;
    }

    .responsive-report-table tbody .person-email {
      overflow-wrap: anywhere;
      white-space: normal;
    }

    .responsive-report-table tbody .person-name,
    .responsive-report-table tbody .person-email,
    .responsive-report-table tbody .table-value {
      grid-column: 2;
    }

    .responsive-report-table tbody .person-name {
      grid-row: 1;
    }

    .responsive-report-table tbody .person-email {
      grid-row: 2;
      margin-top: 0;
    }

    .responsive-report-table tbody td.empty-cell {
      display: block;
      grid-column: 1 / -1;
      padding: 16px 8px;
      text-align: center;
    }

    .responsive-report-table tbody td.empty-cell::before {
      display: none;
    }
  }

  @container dashboard-item (max-width: 520px) {
    .responsive-report-table tbody tr {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  /* Width controls must remain useful even when the browser does not apply
     container queries to a nested dashboard item. Every non-full widget uses
     a compact card table, so long headings never become a column of letters
     and the user never needs horizontal scrolling to reach the last value. */
  .dashboard-item:not(.layout-full) .responsive-report-table,
  .dashboard-item:not(.layout-full) .responsive-report-table tbody,
  .dashboard-item:not(.layout-full) .responsive-report-table tr,
  .dashboard-item:not(.layout-full) .responsive-report-table td,
  .dashboard-item:not(.layout-full) .responsive-report-table th {
    display: block;
  }

  .dashboard-item:not(.layout-full) .responsive-report-table thead {
    display: none;
  }

  .dashboard-item:not(.layout-full) .responsive-report-table tbody tr {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 4px 14px;
    padding: 10px 8px;
  }

  .dashboard-item:not(.layout-full) .responsive-report-table tbody tr + tr {
    border-top: 1px solid var(--border);
  }

  .dashboard-item:not(.layout-full) .responsive-report-table tbody td,
  .dashboard-item:not(.layout-full) .responsive-report-table tbody th {
    display: grid;
    grid-template-columns: minmax(0, 42%) minmax(0, 1fr);
    gap: 8px;
    width: auto;
    min-width: 0;
    padding: 3px 0;
    border-bottom: 0;
    text-align: left;
    white-space: normal;
    overflow-wrap: normal;
    word-break: normal;
    hyphens: none;
  }

  .dashboard-item:not(.layout-full) .responsive-report-table tbody td::before,
  .dashboard-item:not(.layout-full) .responsive-report-table tbody th::before {
    min-width: 0;
    color: color-mix(in srgb, var(--main-fg) 52%, transparent);
    content: attr(data-label);
    font-size: 9px;
    font-weight: 750;
    letter-spacing: 0.04em;
    line-height: 1.35;
    text-transform: uppercase;
    overflow-wrap: normal;
    word-break: normal;
    hyphens: none;
  }

  .dashboard-item:not(.layout-full) .responsive-report-table tbody .numeric {
    text-align: left;
    white-space: normal;
  }

  .dashboard-item:not(.layout-full) .responsive-report-table tbody .person-name,
  .dashboard-item:not(.layout-full)
    .responsive-report-table
    tbody
    .person-email,
  .dashboard-item:not(.layout-full)
    .responsive-report-table
    tbody
    .table-value {
    grid-column: 2;
  }

  .dashboard-item:not(.layout-full)
    .responsive-report-table
    tbody
    .person-email {
    margin-top: 0;
    white-space: normal;
    overflow-wrap: break-word;
  }

  .dashboard-item:not(.layout-full) .responsive-report-table tbody .topic-cell {
    max-width: none;
    overflow: visible;
    text-overflow: clip;
    white-space: normal;
  }

  .dashboard-item:not(.layout-full) .responsive-report-table tbody .email-link {
    display: flex;
    align-items: flex-start;
    min-width: 0;
    width: 100%;
    overflow: visible;
    white-space: normal;
  }

  .dashboard-item:not(.layout-full)
    .responsive-report-table
    tbody
    .email-link
    span {
    min-width: 0;
    overflow: visible;
    text-overflow: clip;
    white-space: normal;
    overflow-wrap: break-word;
  }

  .dashboard-item:not(.layout-full)
    .responsive-report-table
    tbody
    .status-pill {
    justify-self: start;
    min-width: 0;
    max-width: 100%;
    white-space: normal;
  }

  .dashboard-item:not(.layout-full)
    .responsive-report-table
    tbody
    td.empty-cell {
    display: block;
    grid-column: 1 / -1;
    padding: 16px 8px;
    text-align: center;
  }

  .dashboard-item:not(.layout-full)
    .responsive-report-table
    tbody
    td.empty-cell::before {
    display: none;
  }

  .dashboard-item:not(.layout-full)
    .responsive-report-table
    :global(.table-sort-button) {
    font-size: clamp(8px, 0.72cqw, 10px);
    white-space: normal;
    word-break: keep-all;
    overflow-wrap: normal;
    hyphens: none;
    text-wrap: balance;
  }

  @container dashboard-item (max-width: 520px) {
    .dashboard-item:not(.layout-full) .responsive-report-table tbody tr {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  .report-footnote {
    max-width: 1440px;
    margin: 4px auto 0;
    color: color-mix(in srgb, var(--main-fg) 52%, transparent);
    font-size: 11px;
    line-height: 1.5;
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  :global(.spinning) {
    animation: spin 0.9s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .skeleton,
    :global(.spinning) {
      animation: none;
    }

    .bar,
    .header-button,
    .refresh-button,
    .primary-button,
    .secondary-button,
    .preset-button {
      transition: none;
    }
  }

  @media (max-width: 1180px) {
    .summary-grid {
      grid-template-columns: repeat(3, 1fr);
    }

    .response-metrics {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }

  @container reports-page (max-width: 1180px) {
    .dashboard-grid {
      gap: 12px;
    }
  }

  @container dashboard-item (max-width: 1180px) {
    .response-metrics {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }

  @container dashboard-item (max-width: 1100px) {
    .response-detail-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  @container reports-page (max-width: 640px) {
    .dashboard-grid {
      grid-template-columns: minmax(0, 1fr);
      gap: 12px;
    }

    .dashboard-item {
      grid-column: 1 / -1 !important;
    }
  }

  @container dashboard-item (max-width: 720px) {
    .response-metrics {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .dashboard-item:not(.layout-full) .response-detail-block .table-wrap {
      overflow-x: hidden;
    }

    .dashboard-item:not(.layout-full) .response-detail-block table,
    .dashboard-item:not(.layout-full) .response-detail-block tbody,
    .dashboard-item:not(.layout-full) .response-detail-block tr,
    .dashboard-item:not(.layout-full) .response-detail-block td,
    .dashboard-item:not(.layout-full) .response-detail-block th {
      display: block;
    }

    .dashboard-item:not(.layout-full) .response-detail-block thead {
      display: none;
    }

    .dashboard-item:not(.layout-full) .response-detail-block tbody tr {
      display: grid;
      gap: 4px;
      padding: 10px 8px;
    }

    .dashboard-item:not(.layout-full) .response-detail-block tbody td,
    .dashboard-item:not(.layout-full) .response-detail-block tbody th {
      display: grid;
      grid-template-columns: minmax(86px, 34%) minmax(0, 1fr);
      gap: 8px;
      width: auto;
      min-width: 0;
      padding: 3px 0;
      border-bottom: 0;
      text-align: left;
      white-space: normal;
    }

    .dashboard-item:not(.layout-full) .response-detail-block tbody td::before,
    .dashboard-item:not(.layout-full) .response-detail-block tbody th::before {
      color: color-mix(in srgb, var(--main-fg) 52%, transparent);
      content: attr(data-label);
      font-size: 9px;
      font-weight: 750;
      letter-spacing: 0.04em;
      line-height: 1.35;
      text-transform: uppercase;
    }

    .dashboard-item:not(.layout-full) .response-detail-block tbody .numeric {
      text-align: left;
      white-space: normal;
    }

    .dashboard-item:not(.layout-full) .response-detail-block tbody .topic-cell {
      display: grid;
    }

    .dashboard-item:not(.layout-full) .response-detail-block tbody .email-link {
      min-width: 0;
      width: 100%;
    }

    .dashboard-item:not(.layout-full)
      .response-detail-block
      tbody
      .status-pill {
      justify-self: start;
    }

    .dashboard-item:not(.layout-full)
      .response-detail-block
      tbody
      td.empty-cell {
      display: block;
      padding: 16px 8px;
      text-align: center;
    }

    .dashboard-item:not(.layout-full)
      .response-detail-block
      tbody
      td.empty-cell::before {
      display: none;
    }
  }

  @container dashboard-item (max-width: 420px) {
    .response-metrics {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 800px) {
    .reports-page {
      padding: 24px 16px 40px;
    }

    .report-viewer {
      padding: 24px 16px 40px;
    }

    .report-viewer-header {
      flex-direction: column;
      gap: 16px;
    }

    .report-viewer-header .header-actions {
      justify-content: flex-start;
    }

    .live-control-launch {
      align-items: flex-start;
      flex-wrap: wrap;
    }

    .live-control-launch .secondary-button {
      margin-left: 44px;
    }

    .report-ready-stats {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .reports-header {
      align-items: flex-start;
      flex-direction: column;
      gap: 16px;
    }

    .header-actions {
      justify-content: flex-start;
    }

    .summary-grid {
      grid-template-columns: 1fr;
    }

    .panel {
      padding: 16px;
    }

    .panel-header,
    .heatmap-header {
      align-items: flex-start;
      flex-direction: column;
    }

    .legend {
      justify-content: flex-start;
    }

    .peak-callout {
      align-self: stretch;
    }

    .response-target-callout {
      align-self: stretch;
    }

    .skeleton-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  @media (max-width: 480px) {
    .summary-grid {
      grid-template-columns: repeat(2, 1fr);
    }

    .summary-card:first-child {
      grid-column: 1 / -1;
    }

    .summary-card {
      padding: 13px;
    }

    .response-metrics {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .date-separator {
      display: none;
    }

    .date-controls .date-field,
    .date-controls .mail-account-control,
    .date-controls .mail-folder-control,
    .date-controls .response-target-control {
      flex: 1 1 120px;
    }

    .date-controls .primary-button {
      flex: 1 1 100%;
      margin: 4px 0 0;
    }

    .working-hours-list {
      grid-template-columns: 1fr;
    }

    .working-hours-row {
      flex-wrap: wrap;
    }

    .working-day-toggle {
      flex-basis: 100%;
    }

    .working-day-off {
      margin-left: 0;
    }
  }
</style>
