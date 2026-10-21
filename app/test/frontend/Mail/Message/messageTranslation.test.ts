// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

let localStorageValues = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => localStorageValues.get(key) ?? null,
    setItem: (key: string, value: string) => localStorageValues.set(key, value),
    removeItem: (key: string) => localStorageValues.delete(key),
    clear: () => localStorageValues.clear(),
  },
});

const { appGlobal } = await import("../../../../logic/app");
const { EMail } = await import("../../../../logic/Mail/EMail");
const {
  getDeepLConsentSetting,
  getTranslationEngineSetting,
  getTranslationNeverSuggestSetting,
  getTranslationTargetSetting,
  MessageTranslation,
  neverSuggestLanguage,
  translationSuggestionFor,
} = await import("../../../../frontend/Mail/Message/messageTranslation");
type EMail = InstanceType<typeof EMail>;

const kEnglish = "<p>Hello team, the delivery of the parcel is delayed until Monday. " +
  "Please confirm that you have received the report.</p>";

function mail(html: string): EMail {
  let email = new EMail({ account: { isMyEMailAddress: () => false } } as any);
  email.html = html;
  // DOMPurify с WHOLE_DOCUMENT не работает в happy-dom; HTML здесь и так безопасный
  (email as any)._sanitizedHTML = html;
  (email as any)._text = new DOMParser().parseFromString(html, "text/html").body.textContent;
  email.loadedBody = true;
  return email;
}

let previousRemoteApp: any;
let translateMailTexts: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  getTranslationTargetSetting().value = "ru";
  getTranslationEngineSetting().value = "local";
  previousRemoteApp = appGlobal.remoteApp;
  translateMailTexts = vi.fn(async (_from: string, _to: string, texts: string[]) => texts.map(text => `RU:${text}`));
  appGlobal.remoteApp = {
    translateMailTexts,
    translateMailTextsWithDeepL: vi.fn(async (_key, _from, _to, texts: string[]) => ({ texts, detectedLanguage: "EN" })),
    getMailTranslationLanguages: async () => ({ from: ["de", "en"], to: ["en", "ru"] }),
    getMailTranslationProgress: async () => ({ phase: "idle", loadedBytes: 0, totalBytes: 0 }),
  };
});

afterEach(() => {
  appGlobal.remoteApp = previousRemoteApp;
});

describe("перевод письма в окне просмотра", () => {
  test("перевести, показать оригинал и вернуть перевод без повторного запроса", async () => {
    let email = mail(kEnglish);
    let translation = new MessageTranslation(email);
    translation.setDisplayed("html", email.html);
    await translation.translate();
    expect(translation.current.status).toBe("translated");
    expect(translation.current.sourceLanguage).toBe("en");
    expect(translation.resultFor("html", email.html)).toContain("RU:Hello team");
    expect(translateMailTexts).toHaveBeenCalledWith("en", "ru", expect.any(Array), true);

    translation.showOriginal();
    expect(translation.resultFor("html", email.html)).toBeNull();
    translation.showTranslation();
    expect(translation.resultFor("html", email.html)).toContain("RU:Hello team");
    expect(translateMailTexts).toHaveBeenCalledTimes(1);
  });

  test("кнопка на панели: перевести → оригинал → перевод", async () => {
    let email = mail(kEnglish);
    let translation = new MessageTranslation(email);
    translation.setDisplayed("html", email.html);
    translation.toggle();
    await vi.waitFor(() => expect(translation.current.status).toBe("translated"));
    translation.toggle();
    expect(translation.current.showOriginal).toBe(true);
    translation.toggle();
    expect(translation.current.showOriginal).toBe(false);
    expect(translateMailTexts).toHaveBeenCalledTimes(1);
  });

  test("письмо уже на нужном языке — движок не вызывается", async () => {
    let email = mail("<p>Добрый день! Прошу подтвердить получение отчёта о доставке до пятницы. Спасибо.</p>");
    let translation = new MessageTranslation(email);
    translation.setDisplayed("html", email.html);
    await translation.translate();
    expect(translation.current.status).toBe("same-language");
    expect(translateMailTexts).not.toHaveBeenCalled();
  });

  test("язык не определён — предлагается выбрать, затем перевод с выбранного", async () => {
    let email = mail("<p>OK 12</p>");
    let translation = new MessageTranslation(email);
    translation.setDisplayed("html", email.html);
    await translation.translate();
    expect(translation.current.status).toBe("choose-language");
    await translation.translate("de");
    expect(translateMailTexts).toHaveBeenCalledWith("de", "ru", ["OK 12"], true);
  });

  test("ошибка движка — состояние ошибки без текста письма в ошибке", async () => {
    translateMailTexts.mockRejectedValue(Object.assign(new Error("HTTP 503"), {
      code: "TranslationDownloadFailed",
      originalCall: { arg: ["en", "ru", ["Confidential"], true] },
    }));
    let email = mail(kEnglish);
    let translation = new MessageTranslation(email);
    translation.setDisplayed("html", email.html);
    await translation.translate();
    expect(translation.current.status).toBe("error");
    expect((translation.current.error as any).originalCall).toBeUndefined();
  });

  test("DeepL: до согласия текст не отправляется", async () => {
    getTranslationEngineSetting().value = "deepl";
    let email = mail(kEnglish);
    let translation = new MessageTranslation(email);
    translation.setDisplayed("html", email.html);
    await translation.translate();
    expect(translation.current.status).toBe("consent");
    expect(appGlobal.remoteApp.translateMailTextsWithDeepL).not.toHaveBeenCalled();
    translation.reset();
    expect(getDeepLConsentSetting().value).toBe(false);
  });

  test("смена языка перевода в настройках — перевод заново", async () => {
    let email = mail(kEnglish);
    let translation = new MessageTranslation(email);
    translation.setDisplayed("html", email.html);
    await translation.translate();
    translation.showOriginal();
    getTranslationTargetSetting().value = "en";
    getTranslationTargetSetting().value = "de";
    appGlobal.remoteApp.getMailTranslationLanguages = async () => ({ from: ["en"], to: ["de", "ru"] });
    translation.showTranslation();
    await vi.waitFor(() => expect(translation.current.status).toBe("translated"));
    expect(translation.current.targetLanguage).toBe("de");
    expect(translateMailTexts).toHaveBeenLastCalledWith("en", "de", expect.any(Array), true);
  });
});

describe("предложение перевести", () => {
  test("письмо на другом языке — предложить; «не предлагать для» — нет", async () => {
    let email = mail(kEnglish);
    expect(await translationSuggestionFor(email)).toBe("en");
    neverSuggestLanguage("en");
    expect(getTranslationNeverSuggestSetting().value).toEqual(["en"]);
    expect(await translationSuggestionFor(email)).toBeNull();
  });

  test("без десктопного backend перевод не предлагается", async () => {
    appGlobal.remoteApp = {};
    expect(await translationSuggestionFor(mail(kEnglish))).toBeNull();
  });
});
