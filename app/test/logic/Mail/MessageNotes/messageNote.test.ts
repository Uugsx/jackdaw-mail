import { isValidTrackerTemplate, issueLink, kMaxNoteLength, noteTooltip, normalizeNoteText, tokenizeNote } from "../../../../logic/Mail/MessageNotes/MessageNote";
import { describe, expect, test } from "vitest";

const kJira = "https://jira.example.com/browse/{key}";

describe("normalizeNoteText", () => {
  test("обрезает края и приводит переводы строк", () => {
    expect(normalizeNoteText("  a\r\nb \n")).toBe("a\nb");
    expect(normalizeNoteText(null)).toBe("");
  });
  test("ограничивает длину", () => {
    expect(normalizeNoteText("x".repeat(kMaxNoteLength + 50)).length).toBe(kMaxNoteLength);
  });
});

describe("шаблон трекера", () => {
  test("валидность", () => {
    expect(isValidTrackerTemplate(kJira)).toBe(true);
    expect(isValidTrackerTemplate("https://x.io/")).toBe(false);
    expect(isValidTrackerTemplate("javascript:{key}")).toBe(false);
    expect(isValidTrackerTemplate("")).toBe(false);
  });
  test("подстановка ключа", () => {
    expect(issueLink("PROJ-123", kJira)).toBe("https://jira.example.com/browse/PROJ-123");
    expect(issueLink("PROJ-123", null)).toBeNull();
  });
});

describe("tokenizeNote", () => {
  test("ключ становится ссылкой при заданном шаблоне", () => {
    expect(tokenizeNote("Отправил в Jira, номер PROJ-123.", kJira)).toEqual([
      { kind: "text", text: "Отправил в Jira, номер ", href: null },
      { kind: "issue", text: "PROJ-123", href: "https://jira.example.com/browse/PROJ-123" },
      { kind: "text", text: ".", href: null },
    ]);
  });
  test("без шаблона ключ остаётся текстом", () => {
    expect(tokenizeNote("PROJ-123")).toEqual([{ kind: "text", text: "PROJ-123", href: null }]);
  });
  test("URL без хвостовой пунктуации; ключ внутри URL не разбивается", () => {
    let tokens = tokenizeNote("см. https://a.io/browse/AB-1, ок", kJira);
    expect(tokens.map(t => t.kind)).toEqual(["text", "url", "text"]);
    expect(tokens[1]).toEqual({ kind: "url", text: "https://a.io/browse/AB-1", href: "https://a.io/browse/AB-1" });
    expect(tokens[2].text).toBe(", ок");
  });
  test("строчные и слишком короткие ключи не совпадают", () => {
    expect(tokenizeNote("abc-123 A-1 ABC-", kJira).every(t => t.kind == "text")).toBe(true);
  });
  test("склеивает текст обратно без потерь", () => {
    let text = "AB-1 и https://x.io/y. потом CD-22!";
    expect(tokenizeNote(text, kJira).map(t => t.text).join("")).toBe(text);
  });
});

test("noteTooltip обрезает длинный текст", () => {
  expect(noteTooltip("abc")).toBe("abc");
  expect(noteTooltip("x".repeat(300)).length).toBe(200);
});
