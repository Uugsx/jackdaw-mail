import type {
  ReportData,
  ReportDateRange,
  MailResponseRow,
  ReportTimelinePoint,
  TimelineGranularity,
} from "../../logic/Reports/ReportsData";
import {
  formatWorkingTime,
  isWithinWorkingHours,
} from "../../logic/Reports/WorkingHours";
import {
  buildCategoryRhythmRows,
  defaultResponderCategoryNames,
  responderResponseShare,
  sortCategoryRhythmRows,
  type CategoryRhythmRow,
} from "../../logic/Reports/ReportsPresentation";
import { appGlobal } from "../../logic/app";
import { sanitize } from "../../../lib/util/sanitizeDatatypes";
import {
  DEFAULT_EXPORT_LANGUAGE,
  exportText,
  type ExportLanguage,
} from "./ReportsExportText";

const EXPORT_LOCALES: Record<ExportLanguage, string> = {
  ru: "ru-RU",
  en: "en-US",
};
const WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const RHYTHM_HOURS = 24;
const MAX_DOWNLOAD_FILENAME_ATTEMPTS = 100;
const RHYTHM_EXPORT_SELECT_ID = "report-rhythm-select";
const RHYTHM_EXPORT_PANEL_PREFIX = "report-rhythm-panel-";

export interface ReportExportOptions {
  /** Язык отчёта. По умолчанию русский, как и раньше. */
  language?: ExportLanguage;
  categoryFilterLabel?: string;
  responderColumnLabel?: string;
  responderMetricLabel?: string;
  employeeCategoryNames?: string[];
  rhythmCategoryNames?: string[];
  rhythmSelectedCategoryName?: string;
}

function isFileExistsError(ex: unknown): boolean {
  return (
    typeof ex == "object" &&
    ex != null &&
    (ex as { code?: unknown }).code == "EEXIST"
  );
}

async function saveTextFileToDownloads(
  content: string,
  filename: string,
): Promise<string | null> {
  const remoteApp = appGlobal.remoteApp;
  if (
    typeof remoteApp?.directory != "function" ||
    typeof remoteApp?.path?.join != "function" ||
    typeof remoteApp?.fs?.writeFile != "function"
  ) {
    return null;
  }

  const downloadsDir = await remoteApp.directory("downloads");
  const extensionStart = filename.lastIndexOf(".");
  const basename =
    extensionStart > 0 ? filename.slice(0, extensionStart) : filename;
  const extension = extensionStart > 0 ? filename.slice(extensionStart) : "";

  for (let attempt = 0; attempt < MAX_DOWNLOAD_FILENAME_ATTEMPTS; attempt++) {
    const suffix = attempt == 0 ? "" : ` (${attempt + 1})`;
    const candidate = `${basename}${suffix}${extension}`;
    const filepath = await remoteApp.path.join(downloadsDir, candidate);
    try {
      await remoteApp.fs.writeFile(filepath, content, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      return candidate;
    } catch (ex) {
      if (!isFileExistsError(ex)) {
        throw ex;
      }
    }
  }

  throw new Error(
    "Не удалось сохранить отчёт: слишком много одноимённых файлов.",
  );
}

export async function downloadTextFile(
  content: string,
  filename: string,
  mimeType: string,
): Promise<string> {
  const safeFilename = sanitize.filename(filename, "report");
  const savedFilename = await saveTextFileToDownloads(content, safeFilename);
  if (savedFilename != null) {
    return savedFilename;
  }

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = safeFilename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return safeFilename;
}

/** Язык отчёта, который сейчас собирается. Сборка синхронная, поэтому состояние не пересекается между вызовами. */
let exportLanguage: ExportLanguage = DEFAULT_EXPORT_LANGUAGE;

function x(ru: string, params?: Record<string, string>): string {
  return exportText(ru, exportLanguage, params);
}

function exportLocale(): string {
  return EXPORT_LOCALES[exportLanguage];
}

export function createReportHTML(
  report: ReportData,
  options: ReportExportOptions = {},
): string {
  const previousLanguage = exportLanguage;
  exportLanguage = options.language ?? DEFAULT_EXPORT_LANGUAGE;
  try {
    return buildReportHTML(report, options);
  } finally {
    exportLanguage = previousLanguage;
  }
}

function buildReportHTML(
  report: ReportData,
  options: ReportExportOptions,
): string {
  const title = x("Отчёт об активности Jackdaw Mail");
  const maxTimeline = Math.max(
    1,
    ...report.timeline.map((point) => point.total),
  );
  const maxHeatmap = Math.max(1, ...report.activity.map((cell) => cell.count));
  const maxResponderRequests = Math.max(
    1,
    ...report.mail.responders.map((responder) => responder.requests),
  );
  const responderAnsweredTotal = report.mail.responders.reduce(
    (total, responder) => total + Math.max(0, responder.answered),
    0,
  );
  const maxCategoryRequests = Math.max(
    1,
    ...report.mail.categories.map((category) => category.incoming),
  );
  const maxResponseDayAnswers = Math.max(
    1,
    ...report.mail.responseTimeDays.map((day) => day.answered),
  );
  const weekdays = WEEKDAY_LABELS.map((label) => x(label));
  const outsideWorkingHoursResponseTimes = report.mail.responseTimes
    .filter(
      (response) =>
        !isWithinWorkingHours(response.responseAt, report.workingHours),
    )
    .sort(
      (a, b) =>
        b.responseAt.getTime() - a.responseAt.getTime() ||
        b.emailId - a.emailId,
    );
  const outsideWorkingHoursWithoutCategoryCount =
    outsideWorkingHoursResponseTimes.filter(
      (response) => response.categoryNames.length == 0,
    ).length;
  const outsideWorkingHoursWithinTargetCount =
    outsideWorkingHoursResponseTimes.filter(
      (response) => response.withinTarget === true,
    ).length;
  const outsideWorkingHoursOverTargetCount =
    outsideWorkingHoursResponseTimes.filter(
      (response) => response.withinTarget === false,
    ).length;
  const outsideWorkingHoursNotEvaluatedCount =
    outsideWorkingHoursResponseTimes.filter(
      (response) => response.withinTarget == null,
    ).length;
  const employeeCategoryNames = normalizeEmployeeCategoryNames(
    options.employeeCategoryNames ??
      defaultResponderCategoryNames(report.mail.categories),
  );
  const categorizedOutsideWorkingHoursResponseCount =
    outsideWorkingHoursResponseTimes.filter((response) =>
      response.categoryNames.some((name) =>
        employeeCategoryNames.includes(name.trim()),
      ),
    ).length;
  const rhythmCategoryNames = normalizeEmployeeCategoryNames(
    options.rhythmCategoryNames ??
      (options.employeeCategoryNames !== undefined
        ? employeeCategoryNames
        : employeeCategoryNames.length
          ? employeeCategoryNames
          : report.mail.categories.map((category) => category.name)),
  );
  const categoryRhythmRows = sortCategoryRhythmRows(
    buildCategoryRhythmRows(
      report.mail.responseTimes,
      report.mail.categories,
      report.workingHours,
      rhythmCategoryNames,
    ),
  );
  const afterHoursCategoryRows = categoryRhythmRows.filter(
    (row) => row.afterHours > 0,
  );
  const afterHoursCategoryMax = Math.max(
    1,
    ...afterHoursCategoryRows.map((row) => row.afterHours),
  );
  const categoryRhythmRanking = afterHoursCategoryRows.length
    ? afterHoursCategoryRows
        .slice(0, 12)
        .map((row) =>
          barChartRow(
            row.name,
            row.afterHours,
            afterHoursCategoryMax,
            x("{answered} ответов · {rate} вне графика", { answered: formatNumber(row.answered), rate: formatPercent(row.afterHoursRate) }),
            "accent",
          ),
        )
        .join("")
    : emptyChart(x("Нет ответов категорий вне рабочего времени."));
  const selectedRhythmPanelIndex = Math.max(
    0,
    categoryRhythmRows.findIndex(
      (row) => row.name == options.rhythmSelectedCategoryName,
    ),
  );
  const categoryRhythmSelector = categoryRhythmRows.length
    ? `<div class="rhythm-picker"><label for="${RHYTHM_EXPORT_SELECT_ID}">${x("Сотрудник")}</label><select id="${RHYTHM_EXPORT_SELECT_ID}" aria-label="${x("Выберите сотрудника")}">${categoryRhythmRows
        .map(
          (row, index) =>
            `<option value="${RHYTHM_EXPORT_PANEL_PREFIX}${index}"${index == selectedRhythmPanelIndex ? " selected" : ""}>${escapeHTML(row.name)}</option>`,
        )
        .join("")}</select></div>`
    : "";
  const categoryRhythmHeatmapPanels = categoryRhythmRows.length
    ? categoryRhythmRows
        .map((row, index) => {
          const panelId = `${RHYTHM_EXPORT_PANEL_PREFIX}${index}`;
          return `<div class="rhythm-heatmap-panel" data-rhythm-panel="${panelId}"><h3>${x("Ритм: {name}", { name: escapeHTML(row.name) })}</h3><div class="chart-scroll">${categoryRhythmHeatmap(row)}</div></div>`;
        })
        .join("")
    : emptyChart(x("Нет данных по ритму категорий."));
  const categoryRhythmScript = categoryRhythmRows.length
    ? `<script>
    (() => {
      const select = document.getElementById("${RHYTHM_EXPORT_SELECT_ID}");
      if (!select) return;
      const panels = document.querySelectorAll("[data-rhythm-panel]");
      const updateSelectedPanel = () => {
        panels.forEach((panel) => {
          panel.hidden = panel.getAttribute("data-rhythm-panel") !== select.value;
        });
      };
      select.addEventListener("change", updateSelectedPanel);
      updateSelectedPanel();
    })();
  </script>`
    : "";
  const summaryRows = [
    [x("Наблюдаемая активность"), formatNumber(report.summary.activityCount)],
    [x("Сообщения почты"), formatNumber(report.summary.mailMessages)],
    [
      x("Запросы с подтверждённым ответом"),
      `${formatNumber(report.summary.mailAnswered)} / ${formatNumber(report.summary.mailIncoming)} (${formatPercent(report.summary.responseRate)})`,
    ],
    [
      x("Норматив первого ответа"),
      x("{n} рабочих мин", { n: formatNumber(report.summary.responseTargetMinutes) }),
    ],
    [
      x("Среднее время ответа"),
      formatDuration(report.summary.responseTime.averageSeconds),
    ],
    [
      x("Ответов в срок"),
      `${formatNumber(report.summary.responseTime.withinTarget)} (${formatPercent(responseRate(report.summary.responseTime.withinTarget, report.summary.responseTime.answered))})`,
    ],
    [
      x("Просроченных ответов"),
      formatNumber(report.summary.responseTime.overTarget),
    ],
    [
      x("Ответы вне рабочего времени без категории"),
      formatNumber(outsideWorkingHoursWithoutCategoryCount),
    ],
    [
      x("Ответы вне рабочего времени"),
      formatNumber(outsideWorkingHoursResponseTimes.length),
    ],
    [
      x("Ответы вне рабочего времени с категорией сотрудника"),
      formatNumber(categorizedOutsideWorkingHoursResponseCount),
    ],
    [
      x("Ответы вне рабочего времени без оценки SLA"),
      formatNumber(outsideWorkingHoursNotEvaluatedCount),
    ],
    [
      x("SLA ответов вне рабочего времени"),
      x("{within} в срок · {over} просрочек", { within: formatNumber(outsideWorkingHoursWithinTargetCount), over: formatNumber(outsideWorkingHoursOverTargetCount) }),
    ],
    [x("Сообщения чатов"), formatNumber(report.summary.chatMessages)],
    [x("Часы в календаре"), formatNumber(report.summary.calendarHours, 1)],
    [
      x("Изменено файлов"),
      `${formatNumber(report.summary.filesChanged)} (${formatBytes(report.summary.fileBytes)})`,
    ],
  ];
  const timeline = report.timeline
    .map((point) => timelineColumn(point, maxTimeline))
    .join("");
  const heatmap = weekdays
    .map((weekday, index) => {
      const cells = Array.from({ length: 24 }, (_, hour) => {
        const count =
          report.activity.find(
            (cell) => cell.weekday == index && cell.hour == hour,
          )?.count ?? 0;
        const opacity = count
          ? Math.max(0.14, Math.min(1, count / maxHeatmap))
          : 0;
        return `<span class="heat-cell" style="--cell-opacity:${numberStyle(opacity)}" title="${escapeHTML(`${weekday} ${String(hour).padStart(2, "0")}:00 — ${count}`)}"></span>`;
      }).join("");
      return `<div class="heat-row"><span class="heat-day">${weekday}</span>${cells}</div>`;
    })
    .join("");
  const responderChart = report.mail.responders.length
    ? report.mail.responders
        .slice(0, 12)
        .map((responder) =>
          barChartRow(
            responder.accountName,
            responder.requests,
            maxResponderRequests,
            x("{n} с ответом · {share}", { n: formatNumber(responder.answered), share: formatPercent(responderResponseShare(responder.answered, responderAnsweredTotal)) }),
            responder.responseTime.overTarget ? "alert" : "accent",
          ),
        )
        .join("")
    : emptyChart(x("Нет данных по отвечающим за этот период."));
  const categoryChart = report.mail.categories.length
    ? report.mail.categories
        .slice(0, 12)
        .map((category) =>
          barChartRow(
            category.name,
            category.incoming,
            maxCategoryRequests,
            x("{n} с ответом · {over} просрочек", { n: formatNumber(category.answered), over: formatNumber(category.responseTime.overTarget) }),
            category.responseTime.overTarget ? "alert" : "good",
          ),
        )
        .join("")
    : emptyChart(x("Нет категорий за этот период."));
  const responseDayChart = report.mail.responseTimeDays.length
    ? report.mail.responseTimeDays
        .slice(-14)
        .map((day) =>
          barChartRow(
            formatDate(parseInputDate(day.day)),
            day.answered,
            maxResponseDayAnswers,
            x("{within} в срок · {over} просрочек", { within: formatNumber(day.withinTarget), over: formatNumber(day.overTarget) }),
            day.overTarget ? "alert" : "good",
          ),
        )
        .join("")
    : emptyChart(x("Нет подтверждённых ответов по дням."));
  const responseDetailRows = report.mail.responseTimes.map((response) => [
    formatDateTime(response.requestAt),
    formatDateTime(response.responseAt),
    formatResponseDuration(response),
    response.accountName,
    response.subject,
    formatResponseStatusWithSchedule(response, report.workingHours),
  ]);
  const responseDetailRowClasses = report.mail.responseTimes.map((response) =>
    !isWithinWorkingHours(response.responseAt, report.workingHours)
      ? "outside-hours-row"
      : "",
  );

  return `<!doctype html>
<html lang="${exportLanguage}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHTML(title)} — ${escapeHTML(report.range.from)} — ${escapeHTML(report.range.to)}</title>
  <style>
    :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #1B1C1D; background: #F6F5F2; }
    * { box-sizing: border-box; }
    body { max-width: 1440px; margin: 0 auto; padding: 36px 40px 60px; background: #F6F5F2; }
    h1 { margin: 0 0 8px; font-size: 38px; letter-spacing: -0.04em; }
    h2 { margin: 0 0 5px; font-size: 20px; letter-spacing: -0.02em; }
    p { margin: 0; color: #6A655D; font-size: 13px; line-height: 1.5; }
    .eyebrow { margin-bottom: 9px; color: #B97616; font-size: 11px; font-weight: 800; letter-spacing: .14em; }
    .meta { margin-bottom: 25px; color: #6A655D; font-size: 13px; }
    .summary { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; margin: 0 0 16px; }
    .summary-card, section { border: 1px solid #C4BEB4; border-radius: 14px; background: #FFF; }
    .summary-card { min-height: 100px; padding: 14px; }
    .summary-card span { display: block; color: #6A655D; font-size: 12px; font-weight: 700; }
    .summary-card strong { display: block; margin-top: 15px; font-size: 25px; letter-spacing: -.04em; }
    section { margin-bottom: 16px; padding: 20px; break-inside: avoid; }
    .section-head { display: flex; justify-content: space-between; gap: 20px; align-items: flex-start; margin-bottom: 17px; }
    .section-kicker { margin-bottom: 8px; color: #B97616; font-size: 10px; font-weight: 800; letter-spacing: .14em; }
    .legend { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px 13px; color: #6A655D; font-size: 11px; }
    .legend span { display: inline-flex; align-items: center; gap: 5px; }
    .dot { width: 8px; height: 8px; border-radius: 3px; display: inline-block; }
    .mail-in { background: #6688A8; } .mail-out { background: #B97616; } .chat { background: #4C8B7E; } .calendar { background: #836A9C; } .files { background: #6A8F5C; }
    .chart-scroll, .table-scroll { overflow-x: auto; }
    .chart { display: flex; align-items: flex-end; gap: 5px; min-width: max(100%, 600px); height: 250px; padding: 8px 2px 0; border-bottom: 1px solid #D8D2C8; }
    .column { display: flex; flex: 1 0 14px; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; gap: 5px; }
    .stack { display: flex; width: min(100%, 23px); height: 216px; flex-direction: column; justify-content: flex-end; }
    .segment { display: block; width: 100%; min-height: 0; opacity: .88; }
    .segment:first-child { border-radius: 3px 3px 0 0; }
    .axis { overflow: hidden; width: 100%; color: #6A655D; font-size: 9px; text-align: center; text-overflow: ellipsis; white-space: nowrap; }
    .heatmap { min-width: 700px; }
    .heat-hours, .heat-row { display: grid; grid-template-columns: 45px repeat(24, minmax(16px, 1fr)); gap: 3px; }
    .heat-hours { margin-bottom: 3px; color: #6A655D; font-size: 9px; text-align: center; }
    .heat-row { grid-auto-rows: 20px; margin-bottom: 3px; }
    .heat-day { align-self: center; color: #6A655D; font-size: 10px; font-weight: 700; text-align: right; }
    .heat-cell { position: relative; border: 1px solid #E1DDD6; border-radius: 4px; background: #F4F2EE; }
    .heat-cell::after { position: absolute; inset: 0; border-radius: inherit; background: #B97616; content: ""; opacity: var(--cell-opacity); }
    .chart-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; }
    .chart-block { min-width: 0; }
    .response-day-chart { margin-bottom: 20px; }
    .chart-block h3 { margin: 0 0 11px; font-size: 13px; }
    .bar-chart { display: grid; gap: 10px; }
    .bar-row { display: grid; grid-template-columns: minmax(120px, .62fr) minmax(120px, 1fr) auto; gap: 9px; align-items: center; }
    .bar-label { overflow: hidden; color: #1B1C1D; font-size: 11px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
    .bar-track { height: 10px; overflow: hidden; border-radius: 999px; background: #EEEAE4; }
    .bar-fill { display: block; height: 100%; min-width: 0; border-radius: inherit; }
    .bar-fill.accent { background: #B97616; }
    .bar-fill.good { background: #4C8B7E; }
    .bar-fill.alert { background: #B84E3B; }
    .bar-value { min-width: 26px; color: #1B1C1D; font-size: 11px; font-variant-numeric: tabular-nums; text-align: right; }
    .bar-meta { grid-column: 1 / -1; margin-top: -5px; color: #6A655D; font-size: 10px; }
    .chart-empty { padding: 15px 0; color: #6A655D; font-size: 12px; }
    .rhythm-picker { display: grid; gap: 6px; margin-bottom: 14px; }
    .rhythm-picker label { color: #6A655D; font-size: 10px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; }
    .rhythm-picker select { width: 100%; max-width: 100%; padding: 8px 10px; border: 1px solid #C4BEB4; border-radius: 8px; color: #1B1C1D; background: #FFF; font: inherit; font-size: 12px; }
    .rhythm-picker select:focus-visible { outline: 2px solid #B97616; outline-offset: 2px; }
    .rhythm-heatmap-panel[hidden] { display: none; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { padding: 9px 8px; border-bottom: 1px solid #E1DDD6; text-align: left; vertical-align: top; }
    thead th { color: #6A655D; font-size: 10px; letter-spacing: .05em; text-transform: uppercase; white-space: nowrap; }
    tbody tr:last-child th, tbody tr:last-child td { border-bottom: 0; }
    .numeric { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .muted { color: #6A655D; }
    tr.outside-hours-row td { background: #F8F1E7; }
    .rate { color: #4C8B7E; font-weight: 700; }
    .response-summary { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; margin: 0 0 18px; }
    .response-summary .summary-card { min-height: 86px; }
    .response-summary .summary-card strong { margin-top: 11px; font-size: 21px; }
    .response-summary .summary-card small { display: block; margin-top: 7px; color: #6A655D; font-size: 10px; line-height: 1.3; }
    .response-good { color: #4C8B7E; }
    .response-alert { color: #B84E3B; }
    .note { margin-top: 22px; color: #6A655D; font-size: 11px; line-height: 1.5; }
    .schedule-note { margin-top: 7px; }
    @media (max-width: 1000px) { .summary { grid-template-columns: repeat(3, 1fr); } .response-summary { grid-template-columns: repeat(3, 1fr); } .chart-grid { grid-template-columns: 1fr; } }
    @media (max-width: 620px) { body { padding: 22px 16px 40px; } .summary { grid-template-columns: repeat(2, 1fr); } .summary-card:first-child { grid-column: 1 / -1; } }
    @media (max-width: 620px) { .response-summary { grid-template-columns: repeat(2, 1fr); } }
    @media print { body { padding: 0; background: #fff; } section, .summary-card { box-shadow: none; } }
  </style>
</head>
<body>
  <header>
    <p class="eyebrow">${x("ОТЧЁТЫ ОБ АКТИВНОСТИ")}</p>
    <h1>${escapeHTML(title)}</h1>
  <p class="meta">${escapeHTML(formatRange(report.range))} · ${escapeHTML(report.mailAccountFilter ? x("почтовый аккаунт: {name}", { name: `${report.mailAccountFilter.accountName}${report.mailAccountFilter.email ? ` — ${report.mailAccountFilter.email}` : ""}` }) : x("все почтовые аккаунты"))} · ${escapeHTML(report.mailFolderFilter ? x("папка: {name}", { name: report.mailFolderFilter.name }) : x("все папки"))}${options.categoryFilterLabel ? ` · ${escapeHTML(x("фильтр категорий: {label}", { label: options.categoryFilterLabel }))}` : ""} · ${x("сформирован {date}", { date: escapeHTML(formatDateTime(report.generatedAt)) })}</p>
  </header>
  <div class="summary">${summaryRows.map(([label, value]) => `<div class="summary-card"><span>${escapeHTML(label)}</span><strong>${escapeHTML(value)}</strong></div>`).join("")}</div>
  <section>
    <div class="section-head"><div><p class="section-kicker">${x("ДИНАМИКА")}</p><h2>${x("Активность во времени")}</h2><p>${x("Почта, чаты, календарь и файлы по {unit}.", { unit: escapeHTML(granularityLabel(report.granularity)) })}</p></div><div class="legend"><span><i class="dot mail-in"></i>${x("Входящие письма")}</span><span><i class="dot mail-out"></i>${x("Исходящие письма")}</span><span><i class="dot chat"></i>${x("Чаты")}</span><span><i class="dot calendar"></i>${x("Календарь")}</span><span><i class="dot files"></i>${x("Файлы")}</span></div></div>
    <div class="chart-scroll"><div class="chart">${timeline}</div></div>
  </section>
  <section>
    <div class="section-head"><div><p class="section-kicker">${x("РИТМ РАБОТЫ")}</p><h2>${x("Когда происходит активность")}</h2><p>${x("Исходящие сообщения, встречи и изменения файлов по дням недели и часам.")}</p></div></div>
    <div class="chart-scroll"><div class="heatmap"><div class="heat-hours"><span></span>${Array.from({ length: 24 }, (_, hour) => `<span>${hour % 4 == 0 ? `${String(hour).padStart(2, "0")}:00` : ""}</span>`).join("")}</div>${heatmap}</div></div>
  </section>
  <section><div class="section-head"><div><p class="section-kicker">${x("ВРЕМЯ ОТВЕТА")}</p><h2>${x("Скорость первого ответа")}</h2><p>${x("От получения запроса до первого подтверждённого ответа. Норматив: {target}", { target: escapeHTML(x("{n} рабочих мин.", { n: formatNumber(report.summary.responseTargetMinutes) })) })}</p><p class="schedule-note">${x("Рабочий календарь: {schedule}. Ответы считаются по рабочим минутам, если запрос или ответ пришёл в рабочем графике. Если оба момента вне графика, ответ засчитывается сотруднику, но SLA не оценивается; показанное время является справочным.", { schedule: escapeHTML(formatWorkingHoursSummary(report.workingHours)) })}</p></div></div>
    <div class="response-summary">
      <div class="summary-card"><span>${x("Среднее время ответа")}</span><strong>${escapeHTML(formatDuration(report.summary.responseTime.averageSeconds))}</strong></div>
      <div class="summary-card"><span>${x("Минимальное время ответа")}</span><strong>${escapeHTML(formatDuration(report.summary.responseTime.minimumSeconds))}</strong></div>
      <div class="summary-card"><span>${x("Максимальное время ответа")}</span><strong class="response-alert">${escapeHTML(formatDuration(report.summary.responseTime.maximumSeconds))}</strong></div>
      <div class="summary-card"><span>${x("В срок")}</span><strong class="response-good">${escapeHTML(formatPercent(responseRate(report.summary.responseTime.withinTarget, report.summary.responseTime.answered)))}</strong></div>
      <div class="summary-card"><span>${x("Просрочки")}</span><strong class="response-alert">${escapeHTML(formatNumber(report.summary.responseTime.overTarget))}</strong></div>
      <div class="summary-card"><span>${x("Ответы вне рабочего времени")}</span><strong class="response-alert">${escapeHTML(formatNumber(outsideWorkingHoursResponseTimes.length))}</strong><small>${escapeHTML(x("SLA не оценивается: {n}", { n: formatNumber(outsideWorkingHoursNotEvaluatedCount) }))}</small><small>${escapeHTML(x("{within} в срок · {over} просрочек", { within: formatNumber(outsideWorkingHoursWithinTargetCount), over: formatNumber(outsideWorkingHoursOverTargetCount) }))}</small></div>
    </div>
    <div class="chart-block response-day-chart"><h3>${x("Ответы по дням и SLA")}</h3><div class="bar-chart" role="img" aria-label="${x("Ответы по дням и SLA")}">${responseDayChart}</div></div>
    <div class="section-head"><div><p class="section-kicker">${x("ДНИ С ПРОСРОЧКАМИ")}</p><h2>${x("Когда были задержки")}</h2><p>${x("Дни отсортированы по количеству ответов позже норматива.")}</p></div></div>
    <div class="table-scroll">${table(
      [
        x("День"),
        x("Ответов"),
        x("Среднее время"),
        x("Минимум"),
        x("Максимум"),
        x("В срок"),
        x("Просрочки"),
      ],
      report.mail.responseTimeDays
        .filter((day) => day.overTarget > 0)
        .sort(
          (a, b) =>
            b.overTarget - a.overTarget ||
            (b.maximumSeconds ?? 0) - (a.maximumSeconds ?? 0) ||
            b.day.localeCompare(a.day),
        )
        .map((day) => [
          formatDate(parseInputDate(day.day)),
          formatNumber(day.answered),
          formatDuration(day.averageSeconds),
          formatDuration(day.minimumSeconds),
          formatDuration(day.maximumSeconds),
          formatNumber(day.withinTarget),
          formatNumber(day.overTarget),
        ]),
      [1, 2, 3, 4, 5, 6],
    )}</div>
    <div class="section-head"><div><p class="section-kicker">${x("ПОДРОБНОСТИ")}</p><h2>${x("Самые долгие ответы")}</h2><p>${x("Полный список ответов за выбранный период.")}</p></div></div>
    <div class="table-scroll">${table(
      [
        x("Поступило"),
        x("Ответ"),
        x("Время ответа"),
        x(options.responderColumnLabel ?? "Профиль"),
        x("Тема"),
        x("Статус SLA"),
      ],
      responseDetailRows,
      [0, 1, 2],
      responseDetailRowClasses,
    )}</div>
  </section>
  <section><div class="section-head"><div><p class="section-kicker">${x("ВНЕ РАБОЧЕГО ВРЕМЕНИ")}</p><h2>${x("Кто отвечал вне графика")}</h2><p>${x("Первые подтверждённые ответы, отправленные вне выбранного графика. При наличии категории показывается сотрудник, иначе — почтовый профиль.")}</p></div></div><div class="table-scroll">${table(
    [x("Ответ"), x("Сотрудник / профиль"), x("Время ответа"), x("Тема"), x("Статус SLA")],
    outsideWorkingHoursResponseTimes.map((response) => [
      formatDateTime(response.responseAt),
      responseAfterHoursOwnerLabel(response, employeeCategoryNames),
      formatResponseDuration(response),
      response.subject,
      formatResponseStatusWithSchedule(response, report.workingHours),
    ]),
    [0, 2],
    outsideWorkingHoursResponseTimes.map(() => "outside-hours-row"),
  )}</div></section>
  <section><div class="section-head"><div><p class="section-kicker">${x("ОТВЕТЫ")}</p><h2>${x("Кто отвечает")}</h2><p>${x("Сотрудники или почтовые профили с запросами, ответами и самым активным днём/часом.")}</p></div></div><div class="chart-grid"><div class="chart-block"><h3>${x("Запросы по сотрудникам")}</h3><div class="bar-chart" role="img" aria-label="${x("Запросы по сотрудникам")}">${responderChart}</div></div><div class="chart-block"><h3>${x("Запросы по категориям")}</h3><div class="bar-chart" role="img" aria-label="${x("Запросы по категориям")}">${categoryChart}</div></div></div><div class="table-scroll">${table(
    [
      x(options.responderColumnLabel ?? "Профиль"),
      x("Электронная почта"),
      x("Запросы"),
      x("С ответом"),
      x("Доля ответов"),
      x("Среднее время"),
      x("Минимум"),
      x("Максимум"),
      x("В срок"),
      x("Доля в срок"),
      x("Просрочки"),
      x(options.responderMetricLabel ?? "Отправлено"),
      x("Пиковый день"),
      x("Пиковый час"),
      x("Последняя активность"),
    ],
    report.mail.responders.map((responder) => [
      responder.accountName,
      responder.email,
      formatNumber(responder.requests),
      formatNumber(responder.answered),
      formatPercent(
        responderResponseShare(responder.answered, responderAnsweredTotal),
      ),
      formatDuration(responder.responseTime.averageSeconds),
      formatDuration(responder.responseTime.minimumSeconds),
      formatDuration(responder.responseTime.maximumSeconds),
      formatNumber(responder.responseTime.withinTarget),
      formatPercent(
        responseRate(
          responder.responseTime.withinTarget,
          responder.responseTime.answered,
        ),
      ),
      formatNumber(responder.responseTime.overTarget),
      formatNumber(responder.sent),
      responder.peakWeekday == null ? "—" : weekdayLabel(responder.peakWeekday),
      responder.peakHour == null ? "—" : formatHour(responder.peakHour),
      formatDate(responder.lastActivity),
    ]),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
  )}</div></section>
  <section><div class="section-head"><div><p class="section-kicker">${x("РИТМ СОТРУДНИКОВ")}</p><h2>${x("Кто и когда отвечает")}</h2><p>${x("Рейтинг ответов вне графика и ритм каждой категории по дням недели и часам. Выберите сотрудника, чтобы посмотреть его тепловую карту.")}</p></div></div><div class="chart-grid"><div class="chart-block"><h3>${x("Кто отвечает чаще вне графика")}</h3><div class="bar-chart" role="img" aria-label="${x("Ответы категорий вне рабочего времени")}">${categoryRhythmRanking}</div></div><div class="chart-block"><h3>${x("Ритм сотрудника")}</h3>${categoryRhythmSelector}<div class="rhythm-heatmap-panels">${categoryRhythmHeatmapPanels}</div></div></div><div class="table-scroll">${table(
    [
      x("Категория сотрудника"),
      x("Ответы"),
      x("Вне графика"),
      x("Доля вне графика"),
      x("Без подтверждённого ответа"),
      x("Активные дни"),
      x("Тихие дни"),
      x("Тихие рабочие слоты"),
      x("Пик"),
      x("Тише всего"),
    ],
    categoryRhythmRows.map((row) => [
      row.name,
      formatNumber(row.answered),
      formatNumber(row.afterHours),
      formatPercent(row.afterHoursRate),
      formatNumber(row.unanswered),
      formatNumber(row.activeDays),
      formatNumber(row.quietWeekdays),
      `${formatNumber(row.quietWorkingSlots)} / ${formatNumber(row.workingSlots)}`,
      formatCategoryRhythmSlot(row.peakWeekday, row.peakHour),
      formatCategoryRhythmSlot(row.quietSlotWeekday, row.quietSlotHour),
    ]),
    [1, 2, 3, 4, 5, 6, 7],
  )}</div><p class="note">${x("В селекторе доступны все сотрудники из текущего отчёта. Если одно письмо имеет несколько категорий, оно учитывается в каждой из них. «Без подтверждённого ответа» — входящие запросы категории, для которых не найден первый подтверждённый ответ.")}</p></section>
  <section><div class="section-head"><div><p class="section-kicker">${x("ИСТОЧНИКИ ЗАПРОСОВ")}</p><h2>${x("Кто создаёт спрос")}</h2><p>${x("Отправители с наибольшим количеством входящих запросов.")}</p></div></div><div class="table-scroll">${table(
    [
      x("Человек"),
      x("Электронная почта"),
      x("Запросы"),
      x("С ответом"),
      x("Доля"),
      x("Отправлено"),
      x("Последняя активность"),
    ],
    report.mail.correspondents.map((person) => [
      person.name || person.email || x("Неизвестный контакт"),
      person.email,
      formatNumber(person.incoming),
      formatNumber(person.answered),
      formatPercent(person.incoming ? person.answered / person.incoming : 0),
      formatNumber(person.outgoing),
      formatDate(person.lastActivity),
    ]),
    [0, 1, 2, 3, 4, 5, 6],
  )}</div></section>
  <section><div class="section-head"><div><p class="section-kicker">${x("СПРОС")}</p><h2>${x("Частые запросы")}</h2><p>${x("Повторяющиеся темы входящих писем без префиксов ответа и пересылки.")}</p></div></div><div class="table-scroll">${table(
    [x("Тема"), x("Запросы"), x("С ответом"), x("Доля"), x("Последняя активность")],
    report.mail.topics.map((topic) => [
      topic.topic,
      formatNumber(topic.requests),
      formatNumber(topic.answered),
      formatPercent(topic.requests ? topic.answered / topic.requests : 0),
      formatDate(topic.lastActivity),
    ]),
    [0, 1, 2, 3, 4],
  )}</div></section>
  <section><div class="section-head"><div><p class="section-kicker">${x("КАТЕГОРИИ")}</p><h2>${x("Категории и теги")}</h2><p>${x("Уникальные письма с каждой меткой; одно письмо может попасть в несколько строк.")}</p></div></div><div class="table-scroll">${table(
    [
      x("Категория"),
      x("Письма с меткой"),
      x("Входящие запросы"),
      x("Исходящие"),
      x("Подтверждённые ответы"),
      x("Среднее время"),
      x("Минимум"),
      x("Максимум"),
      x("В срок"),
      x("Доля в срок"),
      x("Просрочки"),
    ],
    report.mail.categories.map((category) => [
      category.name,
      formatNumber(category.total),
      formatNumber(category.incoming),
      formatNumber(category.outgoing),
      formatNumber(category.answered),
      formatDuration(category.responseTime.averageSeconds),
      formatDuration(category.responseTime.minimumSeconds),
      formatDuration(category.responseTime.maximumSeconds),
      formatNumber(category.responseTime.withinTarget),
      formatPercent(
        responseRate(
          category.responseTime.withinTarget,
          category.responseTime.answered,
        ),
      ),
      formatNumber(category.responseTime.overTarget),
    ]),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  )}</div></section>
  <section><div class="section-head"><div><p class="section-kicker">${x("ПОЧТОВЫЕ ЯЩИКИ")}</p><h2>${x("Почтовые аккаунты")}</h2><p>${x("Активность по аккаунтам и папкам.")}</p></div></div><div class="table-scroll">${table(
    [
      x("Аккаунт"),
      x("Сообщения"),
      x("Входящие"),
      x("Исходящие"),
      x("С ответом"),
      x("Размер, байт"),
      x("Последняя активность"),
    ],
    report.mail.accounts.map((account) => [
      account.accountName,
      formatNumber(account.total),
      formatNumber(account.incoming),
      formatNumber(account.outgoing),
      formatNumber(account.answered),
      formatBytes(account.totalBytes),
      formatDate(account.lastActivity),
    ]),
    [0, 1, 2, 3, 4, 5, 6],
  )}</div></section>
  <section><div class="section-head"><div><p class="section-kicker">${x("ПАПКИ")}</p><h2>${x("Почтовые папки")}</h2><p>${x("Где хранится почтовая активность.")}</p></div></div><div class="table-scroll">${table(
    [x("Аккаунт"), x("Папка"), x("Путь"), x("Сообщения"), x("Входящие"), x("Исходящие")],
    report.mail.folders.map((folder) => [
      folder.accountName,
      folder.folderName,
      folder.folderPath,
      formatNumber(folder.total),
      formatNumber(folder.incoming),
      formatNumber(folder.outgoing),
    ]),
    [0, 1, 2, 3, 4, 5],
  )}</div></section>
  <section><div class="section-head"><div><p class="section-kicker">${x("ВРЕМЯ")}</p><h2>${x("Загрузка календаря")}</h2><p>${x("Время в событиях и встречах.")}</p></div></div><div class="table-scroll">${table(
    [x("Календарь"), x("События"), x("Часы"), x("Онлайн-встречи"), x("Участники")],
    report.calendar.calendars.map((calendar) => [
      calendar.calendarName,
      formatNumber(calendar.events),
      formatNumber(calendar.hours, 1),
      formatNumber(calendar.onlineMeetings),
      formatNumber(calendar.participants),
    ]),
    [0, 1, 2, 3, 4],
  )}</div></section>
  <section><div class="section-head"><div><p class="section-kicker">${x("УЧАСТНИКИ")}</p><h2>${x("Участники календаря")}</h2><p>${x("Люди, участвовавшие во встречах за период.")}</p></div></div><div class="table-scroll">${table(
    [x("Человек"), x("Электронная почта"), x("События")],
    report.calendar.participants.map((person) => [
      person.name,
      person.email,
      formatNumber(person.events),
    ]),
    [0, 1, 2],
  )}</div></section>
  <section><div class="section-head"><div><p class="section-kicker">${x("ДИАЛОГИ")}</p><h2>${x("Чаты")}</h2><p>${x("Чаты с наибольшим количеством сообщений.")}</p></div></div><div class="table-scroll">${table(
    [
      x("Чат"),
      x("Аккаунт"),
      x("Сообщения"),
      x("Входящие"),
      x("Исходящие"),
      x("Последняя активность"),
    ],
    report.chat.rooms.map((room) => [
      room.roomName,
      room.accountName,
      formatNumber(room.total),
      formatNumber(room.incoming),
      formatNumber(room.outgoing),
      formatDate(room.lastActivity),
    ]),
    [0, 1, 2, 3, 4, 5],
  )}</div></section>
  <section><div class="section-head"><div><p class="section-kicker">${x("ДОКУМЕНТЫ")}</p><h2>${x("Изменённые файлы")}</h2><p>${x("Папки с наибольшим количеством изменённых файлов.")}</p></div></div><div class="table-scroll">${table(
    [x("Аккаунт"), x("Папка"), x("Путь"), x("Файлы"), x("Размер")],
    report.files.directories.map((directory) => [
      directory.accountName,
      directory.directoryName,
      directory.directoryPath,
      formatNumber(directory.files),
      formatBytes(directory.bytes),
    ]),
    [0, 1, 2, 3, 4],
  )}</div></section>
  <p class="note">${x("Важно для интерпретации: активность — это измеряемый ориентир по синхронизированным локальным данным, а не учёт рабочего времени. Ответ считается подтверждённым, если почтовый сервер пометил письмо как отвеченное или найдено отправленное письмо, связанное с запросом по In-Reply-To или с той же цепочкой. SLA считается в рабочих минутах по выбранному графику, если запрос или ответ пришёл в рабочее время. Если и запрос, и ответ вне графика, ответ засчитывается сотруднику, но SLA не оценивается; в строке показывается фактическое время как справочное. Такие ответы выделены отдельно и исключены из SLA-агрегатов. Ответ после конца периода учитывается, если запрос пришёл в выбранный период. Одно письмо может иметь несколько меток, поэтому строки категорий не складываются. Архив почты хранит текущую категорию, но не время её назначения, поэтому отчёт не может восстановить точный момент, когда запрос взяли в работу. Отсутствующая история или несинхронизированный аккаунт делают отчёт неполным.")}</p>
  ${categoryRhythmScript}
</body>
</html>`;
}

function timelineColumn(point: ReportTimelinePoint, max: number): string {
  const values = [
    [point.mailIncoming, "mail-in"],
    [point.mailOutgoing, "mail-out"],
    [point.chatIncoming + point.chatOutgoing, "chat"],
    [point.calendarEvents, "calendar"],
    [point.filesChanged, "files"],
  ] as const;
  const segments = values
    .map(
      ([value, className]) =>
        `<i class="segment ${className}" style="height:${numberStyle((value / max) * 100)}%"></i>`,
    )
    .join("");
  return `<div class="column" title="${escapeHTML(`${point.start}: ${point.total}`)}"><div class="stack">${segments}</div><span class="axis">${escapeHTML(timelineLabel(point.start))}</span></div>`;
}

function barChartRow(
  label: string,
  value: number,
  max: number,
  meta: string,
  fillClass: "accent" | "good" | "alert",
): string {
  const percentage = max > 0 ? (Math.max(0, value) / max) * 100 : 0;
  return `<div class="bar-row" title="${escapeHTML(`${label}: ${formatNumber(value)}`)}"><span class="bar-label">${escapeHTML(label)}</span><span class="bar-track"><i class="bar-fill ${fillClass}" style="width:${numberStyle(percentage)}%"></i></span><strong class="bar-value">${escapeHTML(formatNumber(value))}</strong><span class="bar-meta">${escapeHTML(meta)}</span></div>`;
}

function categoryRhythmHeatmap(row: CategoryRhythmRow): string {
  const maximum = Math.max(1, ...row.activity);
  const hours = Array.from(
    { length: RHYTHM_HOURS },
    (_, hour) => `<span>${hour % 4 == 0 ? formatHour(hour) : ""}</span>`,
  ).join("");
  const rows = WEEKDAY_LABELS.map((label, index) => {
    const weekday = x(label);
    const cells = Array.from({ length: RHYTHM_HOURS }, (_, hour) => {
      const count = row.activity[index * RHYTHM_HOURS + hour] ?? 0;
      const opacity = count ? Math.max(0.14, count / maximum) : 0;
      return `<span class="heat-cell" style="--cell-opacity:${numberStyle(opacity)}" title="${escapeHTML(`${weekday} ${formatHour(hour)} — ${formatNumber(count)}`)}"></span>`;
    }).join("");
    return `<div class="heat-row"><span class="heat-day">${weekday}</span>${cells}</div>`;
  }).join("");
  return `<div class="heatmap rhythm-heatmap"><div class="heat-hours"><span></span>${hours}</div>${rows}</div>`;
}

function emptyChart(message: string): string {
  return `<p class="chart-empty">${escapeHTML(message)}</p>`;
}

function normalizeEmployeeCategoryNames(names: string[]): string[] {
  return [
    ...new Set(
      names
        .map((name) => name.trim())
        .filter(Boolean),
    ),
  ];
}

function table(
  headers: string[],
  rows: unknown[][],
  numericColumns: number[],
  rowClasses: string[] = [],
): string {
  const headerHTML = headers
    .map(
      (header, index) =>
        `<th scope="col"${numericColumns.includes(index) ? ` class="numeric"` : ""}>${escapeHTML(header)}</th>`,
    )
    .join("");
  const bodyHTML = rows.length
    ? rows
        .map(
          (row, index) =>
            `<tr${rowClasses[index] ? ` class="${escapeHTML(rowClasses[index])}"` : ""}>${row.map((value, cellIndex) => `<td${numericColumns.includes(cellIndex) ? ` class="numeric"` : ""}>${escapeHTML(value)}</td>`).join("")}</tr>`,
        )
        .join("")
    : `<tr><td class="muted" colspan="${headers.length}">${x("Нет данных за этот период.")}</td></tr>`;
  return `<table><thead><tr>${headerHTML}</tr></thead><tbody>${bodyHTML}</tbody></table>`;
}

function escapeHTML(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function numberStyle(value: number): string {
  return String(Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0);
}

function formatNumber(value: number, maximumFractionDigits = 0): string {
  return new Intl.NumberFormat(exportLocale(), { maximumFractionDigits }).format(
    value || 0,
  );
}

function formatPercent(value: number): string {
  const normalized = Number.isFinite(value) ? Math.max(0, value) : 0;
  return new Intl.NumberFormat(exportLocale(), {
    style: "percent",
    maximumFractionDigits: 2,
  }).format(normalized);
}

function responseRate(answered: number, total: number): number {
  return total ? answered / total : 0;
}

function formatWorkingHoursSummary(
  schedule: ReportData["workingHours"],
): string {
  return schedule.days
    .map((day, index) =>
      day.enabled
        ? `${x(WEEKDAY_LABELS[index])} ${formatWorkingTime(day.startMinutes)}–${formatWorkingTime(day.endMinutes)}`
        : x("{day} — выходной", { day: x(WEEKDAY_LABELS[index]) }),
    )
    .join(" · ");
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
    return `${formatNumber(days)} ${x("д")} ${formatNumber(hours)} ${x("ч")}`;
  }
  if (hours) {
    return minutes
      ? `${formatNumber(hours)} ${x("ч")} ${formatNumber(minutes)} ${x("мин")}`
      : `${formatNumber(hours)} ${x("ч")}`;
  }
  if (minutes) {
    return restSeconds
      ? `${formatNumber(minutes)} ${x("мин")} ${formatNumber(restSeconds)} ${x("с")}`
      : `${formatNumber(minutes)} ${x("мин")}`;
  }
  return `${formatNumber(restSeconds)} ${x("с")}`;
}

function formatResponseDuration(
  response: Pick<
    MailResponseRow,
    "durationSeconds" | "actualDurationSeconds" | "withinTarget"
  >,
): string {
  if (response.withinTarget == null) {
    return response.actualDurationSeconds == null
      ? x("Не оценивается")
      : formatDuration(response.actualDurationSeconds);
  }
  return response.durationSeconds == null
    ? x("Не оценивается")
    : formatDuration(response.durationSeconds);
}

function responseAfterHoursOwnerLabel(
  response: Pick<
    MailResponseRow,
    "accountName" | "responderAccountName" | "categoryNames"
  >,
  employeeCategoryNames: string[],
): string {
  const categoryNames = response.categoryNames.filter((name) =>
    employeeCategoryNames.includes(name.trim()),
  );
  return categoryNames.length
    ? categoryNames.join(", ")
    : response.accountName;
}

function formatResponseStatus(
  response: Pick<MailResponseRow, "responseTimeStatus" | "withinTarget">,
): string {
  if (response.withinTarget === true) {
    return x("В срок");
  }
  if (response.withinTarget === false) {
    return x("Просрочка");
  }
  return x("Не оценивается");
}

function formatResponseStatusWithSchedule(
  response: Pick<
    MailResponseRow,
    "responseAt" | "responseTimeStatus" | "withinTarget"
  >,
  workingHours: ReportData["workingHours"],
): string {
  const status = formatResponseStatus(response);
  const outsideWorkingHours = !isWithinWorkingHours(
    response.responseAt,
    workingHours,
  );
  return outsideWorkingHours && status != x("Вне рабочего времени")
    ? `${status} · ${x("Вне рабочего времени")}`
    : status;
}

function formatBytes(bytes: number): string {
  if (!bytes) return x("0 Б");
  const units = [x("Б"), x("КБ"), x("МБ"), x("ГБ"), x("ТБ")];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  return `${formatNumber(bytes / Math.pow(1024, index), index ? 1 : 0)} ${units[index]}`;
}

function formatDate(date: Date | null): string {
  return (
    date?.toLocaleDateString(exportLocale(), {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }) ?? "—"
  );
}

function formatDateTime(date: Date): string {
  return date.toLocaleString(exportLocale(), {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatRange(range: ReportDateRange): string {
  const from = parseInputDate(range.from);
  const to = parseInputDate(range.to);
  return from && to
    ? `${formatDate(from)} → ${formatDate(to)}`
    : `${range.from} → ${range.to}`;
}

function timelineLabel(value: string): string {
  const date = parseInputDate(value);
  return date
    ? date.toLocaleDateString(exportLocale(), { day: "numeric", month: "short" })
    : value;
}

function weekdayLabel(weekday: number): string {
  const label = WEEKDAY_LABELS[weekday];
  return label ? x(label) : "—";
}

function formatCategoryRhythmSlot(
  weekday: number | null,
  hour: number | null,
): string {
  return weekday == null || hour == null
    ? "—"
    : `${weekdayLabel(weekday)} ${formatHour(hour)}`;
}

function formatHour(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

function granularityLabel(granularity: TimelineGranularity): string {
  return granularity == "day"
    ? x("дням")
    : granularity == "week"
      ? x("неделям")
      : x("месяцам");
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
