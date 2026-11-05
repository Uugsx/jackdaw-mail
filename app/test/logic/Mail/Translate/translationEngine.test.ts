import { describe, expect, test } from "vitest";
import {
  capitalizeLanguageName,
  cleanTranslationError,
  normalizeTranslationLanguage,
  sameTranslationLanguage,
  translationLanguageName,
} from "../../../../logic/Mail/Translate/translationEngine";

describe("коды языков перевода", () => {
  test("язык интерфейса приводится к коду движка", () => {
    expect(normalizeTranslationLanguage("ru-RU")).toBe("ru");
    expect(normalizeTranslationLanguage("en_GB")).toBe("en");
    expect(normalizeTranslationLanguage("zh")).toBe("zh-Hans");
    expect(normalizeTranslationLanguage("zh-TW")).toBe("zh-Hant");
    expect(normalizeTranslationLanguage("zh-Hant")).toBe("zh-Hant");
    expect(normalizeTranslationLanguage("no")).toBe("nb");
    expect(normalizeTranslationLanguage("")).toBe("");
    expect(normalizeTranslationLanguage(null)).toBe("");
  });

  test("варианты одного языка — один язык", () => {
    expect(sameTranslationLanguage("en-US", "en-GB")).toBe(true);
    expect(sameTranslationLanguage("ru", "uk")).toBe(false);
    expect(sameTranslationLanguage("", "")).toBe(false);
  });
});

describe("ошибки перевода", () => {
  test("текст письма и ключ из вызова backend не попадают в ошибку", () => {
    let backendError = Object.assign(new Error("DeepL HTTP 403"), {
      code: "TranslationKeyRejected",
      status: 403,
      originalCall: { arg: ["secret-key", "en", "ru", ["Confidential text"], true] },
    });
    let clean = cleanTranslationError(backendError) as any;
    expect(clean.isUserError).toBe(true);
    expect(clean.originalCall).toBeUndefined();
    expect(JSON.stringify(clean)).not.toContain("secret-key");
    expect(JSON.stringify(clean)).not.toContain("Confidential");
  });

  test("неизвестная ошибка сохраняет только сообщение, код и статус", () => {
    let clean = cleanTranslationError(Object.assign(new Error("boom"), {
      code: "EX", status: 500, originalCall: { arg: ["x"] },
    })) as any;
    expect(clean.message).toBe("boom");
    expect(clean.code).toBe("EX");
    expect(clean.status).toBe(500);
    expect(clean.originalCall).toBeUndefined();
  });
});

describe("названия языков во фразах", () => {
  test("русский интерфейс: «с английского», «на английском»", () => {
    expect(translationLanguageName("en", "ru", "genitive")).toBe("английского");
    expect(translationLanguageName("en", "ru-RU", "prepositional")).toBe("английском");
    expect(translationLanguageName("de", "ru", "genitive")).toBe("немецкого");
    expect(translationLanguageName("he", "ru", "genitive")).toBe("иврита");
    expect(translationLanguageName("he", "ru", "prepositional")).toBe("иврите");
    expect(translationLanguageName("hi", "ru", "genitive")).toBe("хинди");
    expect(translationLanguageName("ru", "ru")).toBe("русский");
  });

  test("другие языки интерфейса — без склонения", () => {
    expect(translationLanguageName("en", "en", "genitive")).toBe("English");
    expect(translationLanguageName("en", "fr", "prepositional")).toBe("anglais");
    expect(capitalizeLanguageName("английский", "ru")).toBe("Английский");
  });
});
