import { readFileSync } from "node:fs";
import { beforeAll, expect, test } from "vitest";
import {
  createReportHTML,
  downloadTextFile,
} from "../../../frontend/Reports/ReportsExport";
import type { ReportData } from "../../../logic/Reports/ReportsData";
import { DEFAULT_WORKING_HOURS_SCHEDULE } from "../../../logic/Reports/WorkingHours";
import { appGlobal } from "../../../logic/app";
import { loadUILocale, setUILocale } from "../../../l10n/l10n";
import { loadLanguageMessages } from "../../../l10n/messagesLoader";

// Ожидания ниже написаны для русского интерфейса: тексты отчёта берутся из каталога ru.
beforeAll(async () => {
  await Promise.all([loadLanguageMessages("en"), loadLanguageMessages("fr")]);
  await loadUILocale("ru");
});

function fixture(): ReportData {
  const date = new Date("2026-09-09T12:00:00Z");
  return {
    range: { from: "2026-09-01", to: "2026-09-09" },
    generatedAt: date,
    granularity: "day",
    workingHours: DEFAULT_WORKING_HOURS_SCHEDULE,
    summary: {
      mailMessages: 4,
      mailIncoming: 2,
      mailOutgoing: 2,
      mailAnswered: 1,
      responseTargetMinutes: 30,
      responseTime: {
        answered: 1,
        averageSeconds: 3_600,
        minimumSeconds: 3_600,
        maximumSeconds: 3_600,
        withinTarget: 0,
        overTarget: 1,
      },
      chatMessages: 1,
      chatIncoming: 1,
      chatOutgoing: 0,
      calendarEvents: 1,
      calendarHours: 1.5,
      filesChanged: 2,
      fileBytes: 2048,
      activityCount: 4,
      responseRate: 0.5,
      peakWeekday: 2,
      peakHour: 14,
    },
    timeline: [
      {
        key: "2026-09-09",
        start: "2026-09-09",
        mailIncoming: 2,
        mailOutgoing: 2,
        chatIncoming: 1,
        chatOutgoing: 0,
        calendarEvents: 1,
        filesChanged: 2,
        total: 8,
      },
    ],
    activity: [{ weekday: 2, hour: 14, count: 4 }],
    mail: {
      summary: {
        total: 4,
        incoming: 2,
        outgoing: 2,
        answered: 1,
        withAttachments: 0,
        totalBytes: 2048,
        responseTime: {
          answered: 1,
          averageSeconds: 3_600,
          minimumSeconds: 3_600,
          maximumSeconds: 3_600,
          withinTarget: 0,
          overTarget: 1,
        },
      },
      accounts: [
        {
          accountId: 1,
          accountName: "Main profile",
          total: 4,
          incoming: 2,
          outgoing: 2,
          answered: 1,
          totalBytes: 2048,
          lastActivity: date,
        },
      ],
      responders: [
        {
          accountId: 1,
          accountName: "Main profile",
          email: "me@example.com",
          requests: 2,
          answered: 1,
          sent: 2,
          lastActivity: date,
          peakWeekday: 2,
          peakHour: 14,
          responseTime: {
            answered: 1,
            averageSeconds: 3_600,
            minimumSeconds: 3_600,
            maximumSeconds: 3_600,
            withinTarget: 0,
            overTarget: 1,
          },
        },
      ],
      responseTargetMinutes: 30,
      responseTimes: [
        {
          emailId: 11,
          folderId: 201,
          accountId: 1,
          accountName: "Main profile",
          subject: "Access request",
          contactName: "Requester",
          contactEmail: "requester@example.com",
          requestAt: new Date("2026-09-09T09:00:00Z"),
          responseAt: new Date("2026-09-09T10:00:00Z"),
          actualDurationSeconds: 3_600,
          durationSeconds: 3_600,
          withinTarget: false,
          responseTimeStatus: "measured",
          categoryNames: ["Никита Левченко"],
        },
        {
          emailId: 12,
          folderId: 201,
          accountId: 1,
          accountName: "Main profile",
          subject: "Письмо вне графика",
          contactName: "Requester",
          contactEmail: "requester@example.com",
          requestAt: new Date(2026, 8, 11, 17, 55),
          responseAt: new Date(2026, 8, 12, 12, 5),
          responderAccountName: "Personal profile",
          actualDurationSeconds: 65_400,
          durationSeconds: 300,
          withinTarget: true,
          responseTimeStatus: "outside-working-hours",
          categoryNames: ["Никита Левченко"],
        },
        {
          emailId: 13,
          folderId: 201,
          accountId: 1,
          accountName: "Main profile",
          subject: "Без категории",
          contactName: "Requester",
          contactEmail: "requester@example.com",
          requestAt: new Date(2026, 8, 12, 12, 10),
          responseAt: new Date(2026, 8, 12, 12, 41),
          actualDurationSeconds: 31 * 60,
          durationSeconds: null,
          withinTarget: null,
          responseTimeStatus: "outside-working-hours",
          categoryNames: [],
        },
      ],
      responseTimeDays: [
        {
          day: "2026-09-09",
          answered: 1,
          averageSeconds: 3_600,
          minimumSeconds: 3_600,
          maximumSeconds: 3_600,
          withinTarget: 0,
          overTarget: 1,
        },
      ],
      folders: [],
      correspondents: [],
      topics: [
        {
          topic: "<script>alert(1)</script>",
          requests: 2,
          answered: 1,
          lastActivity: date,
        },
      ],
      categories: [
        {
          name: "Никита Левченко",
          total: 2,
          incoming: 2,
          outgoing: 0,
          answered: 2,
          lastActivity: date,
          peakWeekday: 2,
          peakHour: 12,
          responseTime: {
            answered: 1,
            averageSeconds: 3_600,
            minimumSeconds: 3_600,
            maximumSeconds: 3_600,
            withinTarget: 0,
            overTarget: 1,
          },
        },
      ],
      daily: [],
      activity: [],
    },
    calendar: {
      summary: { events: 1, hours: 1.5, onlineMeetings: 1, participants: 0 },
      calendars: [],
      participants: [],
      daily: [],
      activity: [],
    },
    chat: {
      summary: { total: 1, incoming: 1, outgoing: 0 },
      rooms: [],
      daily: [],
      activity: [],
    },
    files: {
      summary: { changed: 2, bytes: 2048, directories: 1 },
      directories: [],
      daily: [],
      activity: [],
    },
  };
}

test("escapes report values in standalone HTML", () => {
  const html = createReportHTML(fixture());

  expect(html).toContain('<div class="chart">');
  expect(html).toContain('<html lang="ru">');
  expect(html).toContain("Отчёт об активности Jackdaw");
  expect(html).toContain("Письма с меткой");
  expect(html).toContain("Скорость первого ответа");
  expect(html).toContain("Рабочий календарь:");
  expect(html).toContain("Пн 09:00–18:00");
  expect(html).toContain("Среднее время ответа");
  expect(html).toContain("Запросы по сотрудникам");
  expect(html).toContain("Запросы по категориям");
  expect(html).toContain("Ответы по дням и SLA");
  expect(html).toContain("Ответы вне рабочего времени");
  expect(html).toContain("Ответы вне рабочего времени без оценки SLA");
  expect(html).toContain("Ответы вне рабочего времени с категорией сотрудника");
  expect(html).toContain("Кто отвечал вне графика");
  expect(html).toContain("Кто отвечает чаще вне графика");
  expect(html).toContain("Тихие рабочие слоты");
  expect(html).toContain(
    "Первые подтверждённые ответы, отправленные вне выбранного графика.",
  );
  expect(html).toContain("В срок · Вне рабочего времени");
  expect(html).toContain("Не оценивается · Вне рабочего времени");
  expect(html).toContain("31 мин");
  expect(html).toContain("1 в срок · 0 просрочек");
  expect(html).toContain('<tr class="outside-hours-row">');
  expect(html).toContain("Main profile");
  expect(html).not.toContain("Personal profile");
  expect(html).toContain("Вне рабочего времени");
  expect(html).not.toContain("CSV");
  expect(html).toContain(
    "Ответ считается подтверждённым, если почтовый сервер пометил письмо как отвеченное",
  );
  expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  expect(html).not.toContain("<script>alert(1)</script>");
  expect(html).not.toContain("Activity over time");
});

test("includes selected mailbox scope in exports", () => {
  const report = fixture();
  report.mailAccountFilter = {
    accountId: 2,
    accountName: "integrators",
    email: "integrators@example.com",
  };
  report.mailFolderFilter = {
    accountId: 2,
    folderId: 201,
    name: "Входящие",
    path: "INBOX",
    specialUse: "inbox",
  };

  const html = createReportHTML(report);

  expect(html).toContain("integrators — integrators@example.com");
  expect(html).toContain("папка: Входящие");
});

test("exports a selectable rhythm heatmap for every visible employee", () => {
  const report = fixture();
  report.mail.categories = [
    ...report.mail.categories,
    {
      ...report.mail.categories[0],
      name: "Елена Силантьева",
      incoming: 1,
      answered: 1,
    },
  ];
  report.mail.responseTimes = [
    ...report.mail.responseTimes,
    {
      ...report.mail.responseTimes[0],
      emailId: 14,
      subject: "Ответ другого сотрудника",
      responseAt: new Date("2026-09-09T11:00:00Z"),
      categoryNames: ["Елена Силантьева"],
    },
  ];

  const html = createReportHTML(report, {
    rhythmCategoryNames: ["Никита Левченко", "Елена Силантьева"],
    rhythmSelectedCategoryName: "Елена Силантьева",
  });
  const rhythmPosition = html.indexOf("РИТМ СОТРУДНИКОВ");
  const requestSourcesPosition = html.indexOf("ИСТОЧНИКИ ЗАПРОСОВ");

  expect(html).toContain('<select id="report-rhythm-select"');
  expect(html).toContain(">Никита Левченко</option>");
  expect(html).toContain(">Елена Силантьева</option>");
  expect(html).toMatch(
    /<option value="report-rhythm-panel-\d+" selected>Елена Силантьева<\/option>/,
  );
  expect(
    html.match(/data-rhythm-panel="report-rhythm-panel-/g) ?? [],
  ).toHaveLength(2);
  expect(html).toContain('select.addEventListener("change"');
  expect(rhythmPosition).toBeGreaterThanOrEqual(0);
  expect(requestSourcesPosition).toBeGreaterThan(rhythmPosition);
});

test("keeps the category responder metric semantically labeled", () => {
  const html = createReportHTML(fixture(), {
    responderColumnLabel: "Сотрудник",
    responderMetricLabel: "Подтверждённые ответы",
    employeeCategoryNames: ["Никита Левченко"],
  });

  expect(html).toContain("Подтверждённые ответы");
  expect(html).not.toContain('<th scope="col">Отправлено</th>');
});

test("includes the complete response detail list in the HTML report", () => {
  const report = fixture();
  const response = report.mail.responseTimes[0];
  report.mail.responseTimes = Array.from({ length: 201 }, (_, index) => ({
    ...response,
    emailId: index + 1,
    subject: `Письмо ${index + 1}`,
  }));

  const html = createReportHTML(report);

  expect(html).toContain("Письмо 201");
  expect(html).not.toContain("CSV");
});

test("saves desktop HTML exports in Downloads without overwriting an existing file", async () => {
  const files = new Map<string, string>();
  const previousRemoteApp = appGlobal.remoteApp;
  appGlobal.remoteApp = {
    directory: async () => "/Users/test/Downloads",
    path: {
      join: (directory: string, filename: string) => `${directory}/${filename}`,
    },
    fs: {
      writeFile: async (
        filepath: string,
        content: string,
        options: { flag?: string },
      ) => {
        if (options.flag == "wx" && files.has(filepath)) {
          const error = new Error("File exists") as Error & { code: string };
          error.code = "EEXIST";
          throw error;
        }
        files.set(filepath, content);
      },
    },
  };

  let firstFilename: string;
  let secondFilename: string;

  try {
    firstFilename = await downloadTextFile(
      "первый",
      "jackdaw-report-2026-09-09.html",
      "text/html;charset=utf-8",
    );
    secondFilename = await downloadTextFile(
      "второй",
      "jackdaw-report-2026-09-09.html",
      "text/html;charset=utf-8",
    );
  } finally {
    appGlobal.remoteApp = previousRemoteApp;
  }

  expect(
    files.get("/Users/test/Downloads/jackdaw-report-2026-09-09.html"),
  ).toBe("первый");
  expect(
    files.get("/Users/test/Downloads/jackdaw-report-2026-09-09 (2).html"),
  ).toBe("второй");
  expect(firstFilename).toBe("jackdaw-report-2026-09-09.html");
  expect(secondFilename).toBe("jackdaw-report-2026-09-09 (2).html");
});

/** Собирает отчёт на другом языке интерфейса и возвращает русский, на котором идут остальные тесты. */
function createReportHTMLIn(language: string): string {
  setUILocale(language);
  try {
    return createReportHTML(fixture());
  } finally {
    setUILocale("ru");
  }
}

test("builds the English report without Russian interface text", () => {
  const html = createReportHTMLIn("en");
  const cyrillicText = html.replace(/Никита Левченко|Письмо вне графика|Без категории/g, "");

  expect(html).toContain('<html lang="en">');
  expect(html).toContain("Jackdaw Mail activity report");
  expect(html).toContain("Mon 09:00–18:00");
  expect(html).toContain("First-reply speed");
  expect(cyrillicText).not.toMatch(/[А-Яа-яЁё]/);
});

test("builds the French report from the interface language", () => {
  const html = createReportHTMLIn("fr");
  const cyrillicText = html.replace(/Никита Левченко|Письмо вне графика|Без категории/g, "");

  expect(html).toContain('<html lang="fr">');
  expect(html).not.toContain("Jackdaw Mail activity report");
  expect(cyrillicText).not.toMatch(/[А-Яа-яЁё]/);
});

test("returns to the Russian report after another interface language", () => {
  const before = createReportHTML(fixture());
  createReportHTMLIn("en");
  const after = createReportHTML(fixture());

  expect(after).toBe(before);
  expect(after).toContain('<html lang="ru">');
});

test("keeps report interface text out of hardcoded Russian literals", () => {
  const source = readFileSync(
    new URL("../../../frontend/Reports/ReportsExport.ts", import.meta.url),
    "utf8",
  );
  const literals = [...source.matchAll(/"[^"\n]*"|`[^`\n]*`/g)].map(
    (match) => match[0],
  );

  expect(literals.filter((literal) => /[А-Яа-яЁё]/.test(literal))).toEqual([]);
});
