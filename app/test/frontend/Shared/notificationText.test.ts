import { afterEach, beforeAll, expect, test } from "vitest";
import {
  newMailNotificationText,
  notificationBody,
  notificationSubject,
  notificationTitle,
  tidyNotificationText,
} from "../../../frontend/Shared/notificationText";
import { setUILocale } from "../../../l10n/l10n";
import { loadLanguageMessages } from "../../../l10n/messagesLoader";

beforeAll(() => loadLanguageMessages("ru"));

afterEach(() => {
  setUILocale("en");
});

test("схлопывает пробелы и переводы строк из текста письма", () => {
  expect(notificationBody("  Здравствуйте,\n\n\tвот   отчёт  ")).toBe("Здравствуйте, вот отчёт");
});

test("обрезает длинный текст по границе слова с многоточием", () => {
  let text = tidyNotificationText("один два три четыре пять шесть семь", 17);
  expect(text.length).toBeLessThanOrEqual(17);
  expect(text.endsWith("…")).toBe(true);
  expect(text).toBe("один два три…");
});

test("пустой заголовок заменяется названием приложения", () => {
  expect(notificationTitle("   ")).toBe("Jackdaw Mail");
  expect(notificationTitle(null)).toBe("Jackdaw Mail");
});

test("пустая тема — «(no subject)» на языке интерфейса", () => {
  expect(notificationSubject("")).toBe("(no subject)");
  setUILocale("ru");
  expect(notificationSubject("  ")).toBe("(без темы)");
});

test("одно письмо: тема и начало текста", () => {
  expect(newMailNotificationText([{ subject: "Счёт за октябрь", text: "Добрый день!\nВо вложении счёт." }]))
    .toEqual({ title: "Счёт за октябрь", body: "Добрый день! Во вложении счёт." });
});

test("несколько писем: число и темы, а не склейка обрывков", () => {
  let result = newMailNotificationText([
    { subject: "Счёт за октябрь", text: "…" },
    { subject: "", text: "…" },
    { subject: "Встреча в четверг", text: "…" },
    { subject: "Отчёт", text: "…" },
  ], 7);
  expect(result.title).toBe("New messages: 7");
  expect(result.body).toBe("Счёт за октябрь · (no subject) · Встреча в четверг · and 4 more");
});

test("несколько писем по-русски", () => {
  setUILocale("ru");
  let result = newMailNotificationText([{ subject: "А" }, { subject: "Б" }], 2);
  expect(result.title).toBe("Новых писем: 2");
  expect(result.body).toBe("А · Б");
  expect(newMailNotificationText([{ subject: "А" }, { subject: "Б" }, { subject: "В" }, { subject: "Г" }], 5).body)
    .toBe("А · Б · В · и ещё 2");
});
