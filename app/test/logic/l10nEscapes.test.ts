import { describe, expect, test } from "vitest";
import { gt, setUILocale } from "../../l10n/l10n";

// Первый вызов инициализирует локаль; дальше её можно переключать в тестах.
gt`Cancel`;

describe("перевод строк с переносами", () => {
  test("строка с \\n находит русский перевод", () => {
    setUILocale("ru");
    try {
      let text = gt`${"Входящие"}\n\n${1} new, ${2} unread, ${3} total`;
      expect(text).not.toContain("unread");
      expect(text).toContain("\n");
      expect(text).not.toContain("\\n");
    } finally {
      setUILocale("en");
    }
  });

  test("строка без escape-последовательностей переводится как раньше", () => {
    setUILocale("ru");
    try {
      expect(gt`Cancel`).not.toBe("Cancel");
    } finally {
      setUILocale("en");
    }
  });
});
