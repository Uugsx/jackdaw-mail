import { appGlobal } from "../../app";
import { UserError } from "../../util/util";
import { gt } from "../../../l10n/l10n";

/**
 * Движки перевода писем.
 *
 * `local` — на этом компьютере (Bergamot в процессе Electron), текст писем
 * никуда не отправляется. `deepl` — облачный DeepL с ключом пользователя.
 */
export type TranslationEngineID = "local" | "deepl";

export interface TranslationLanguages {
  from: string[];
  to: string[];
}

export interface TranslationModelStatus {
  phase: "idle" | "download" | "load" | "translate";
  loadedBytes: number;
  totalBytes: number;
}

/** Языки, которые принимает DeepL API (исходные; целевые — те же) */
export const kDeepLLanguages = [
  "ar", "bg", "cs", "da", "de", "el", "en", "es", "et", "fi", "fr", "he", "hu", "id", "it",
  "ja", "ko", "lt", "lv", "nb", "nl", "pl", "pt", "ro", "ru", "sk", "sl", "sv", "th", "tr",
  "uk", "vi", "zh-Hans", "zh-Hant",
];

/**
 * Код языка, как его понимают движки: базовый ISO 639-1, китайский —
 * с письменностью (`zh-Hans`/`zh-Hant`), норвежский — букмол.
 */
export function normalizeTranslationLanguage(code: string | null | undefined): string {
  let value = String(code ?? "").trim().replace(/_/g, "-");
  if (!value) {
    return "";
  }
  let [base, ...rest] = value.split("-");
  base = base.toLowerCase();
  if (base == "zh") {
    let region = rest.join("-").toLowerCase();
    return /^(hant|tw|hk|mo)/.test(region) || region.includes("hant") ? "zh-Hant" : "zh-Hans";
  }
  if (base == "no" || base == "nn") {
    return "nb";
  }
  if (base == "iw") {
    return "he";
  }
  return base;
}

/** Один ли это язык с точки зрения перевода (`en-US` и `en-GB` — да) */
export function sameTranslationLanguage(a: string | null | undefined, b: string | null | undefined): boolean {
  let left = normalizeTranslationLanguage(a);
  return !!left && left == normalizeTranslationLanguage(b);
}

/** Падеж названия языка во фразе: «с английского», «на английском» */
export type LanguageNameCase = "nominative" | "genitive" | "prepositional";

/**
 * Название языка на языке интерфейса: «английский», «English».
 * Intl даёт только именительный падеж; для русского интерфейса склоняем
 * сами: названия языков — прилагательные («английский») и «иврит».
 */
export function translationLanguageName(code: string, uiLocale: string, grammaticalCase: LanguageNameCase = "nominative"): string {
  let name: string;
  try {
    name = new Intl.DisplayNames([uiLocale], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
  if (grammaticalCase != "nominative" && normalizeTranslationLanguage(uiLocale) == "ru") {
    return russianLanguageNameCase(name, grammaticalCase);
  }
  return name;
}

function russianLanguageNameCase(name: string, grammaticalCase: "genitive" | "prepositional"): string {
  let genitive = grammaticalCase == "genitive";
  let adjective = /^([а-яё]+)(ий|ый|ой)(?=$|[\s,(])/i;
  if (adjective.test(name)) {
    return name.replace(adjective, (_match, stem: string) => stem + (genitive ? "ого" : "ом"));
  }
  if (/^иврит(?=$|[\s,(])/i.test(name)) {
    return name.replace(/^иврит/i, genitive ? "иврита" : "иврите");
  }
  // Хинди, урду, эсперанто и т. п. не склоняются
  return name;
}

/** С заглавной буквы — для списков: «Английский» */
export function capitalizeLanguageName(name: string, uiLocale: string): string {
  return name ? name.charAt(0).toLocaleUpperCase(uiLocale) + name.slice(1) : name;
}

function remoteApp(): any {
  return appGlobal?.remoteApp;
}

/** Есть ли перевод на устройстве: только в десктопном приложении */
export function isLocalTranslationAvailable(): boolean {
  return typeof remoteApp()?.translateMailTexts == "function";
}

export function isDeepLTranslationAvailable(): boolean {
  return typeof remoteApp()?.translateMailTextsWithDeepL == "function";
}

export function isTranslationEngineAvailable(engine: TranslationEngineID): boolean {
  return engine == "deepl" ? isDeepLTranslationAvailable() : isLocalTranslationAvailable();
}

/** Отправляет ли движок текст писем за пределы компьютера */
export function engineSendsTextOutside(engine: TranslationEngineID): boolean {
  return engine == "deepl";
}

/**
 * Ошибка из backend приходит со всем вызовом (`originalCall`), то есть с
 * текстом письма и ключом. В логи и на экран идёт только понятный текст.
 */
export function cleanTranslationError(ex: any): Error {
  if (ex?.name == "AbortError" || ex?.name == "Cancelled") {
    return ex;
  }
  let code = typeof ex?.code == "string" ? ex.code : "";
  let message = friendlyMessageForCode(code);
  if (message) {
    return Object.assign(new UserError(message), { code });
  }
  let clean = new Error(typeof ex?.message == "string" ? ex.message : String(ex ?? ""));
  if (code) {
    Object.assign(clean, { code });
  }
  if (typeof ex?.status == "number") {
    Object.assign(clean, { status: ex.status });
  }
  return clean;
}

function friendlyMessageForCode(code: string): string | null {
  switch (code) {
  case "TranslationUnsupportedLanguage":
    return gt`There is no translation model for these languages yet.`;
  case "TranslationModelsUnavailable":
  case "TranslationDownloadFailed":
    return gt`Could not download the language model. Check the internet connection and try again.`;
  case "TranslationEngineFailed":
    return gt`The translation engine stopped unexpectedly. Try again.`;
  case "TranslationNoKey":
    return gt`Enter your DeepL API key in Settings → Mail → Read.`;
  case "TranslationKeyRejected":
    return gt`DeepL did not accept the API key. Check it in Settings → Mail → Read.`;
  case "TranslationQuotaExceeded":
    return gt`The DeepL translation quota for this key is used up.`;
  case "TranslationRateLimited":
    return gt`DeepL is busy. Wait a moment and try again.`;
  default:
    return null;
  }
}

/** Языки движка; для DeepL — постоянный список */
export async function getTranslationLanguages(engine: TranslationEngineID): Promise<TranslationLanguages> {
  if (engine == "deepl") {
    return { from: kDeepLLanguages, to: kDeepLLanguages };
  }
  try {
    return await remoteApp().getMailTranslationLanguages();
  } catch (ex) {
    throw cleanTranslationError(ex);
  }
}

export async function getLocalModelInfo(from: string, to: string): Promise<{ supported: boolean; downloaded: boolean; downloadBytes: number }> {
  try {
    return await remoteApp().getMailTranslationModelInfo(from, to);
  } catch (ex) {
    throw cleanTranslationError(ex);
  }
}

export async function getLocalModelStatus(): Promise<TranslationModelStatus> {
  return await remoteApp().getMailTranslationProgress();
}

export async function getLocalModelsSize(): Promise<number> {
  return await remoteApp().getMailTranslationModelsSize();
}

export async function deleteLocalModels(): Promise<void> {
  try {
    await remoteApp().deleteMailTranslationModels();
  } catch (ex) {
    throw cleanTranslationError(ex);
  }
}

export async function translateTextsLocally(from: string, to: string, texts: string[], isHTML: boolean): Promise<string[]> {
  try {
    return await remoteApp().translateMailTexts(from, to, texts, isHTML);
  } catch (ex) {
    throw cleanTranslationError(ex);
  }
}

/** @param apiKey расшифрованный ключ; хранится только зашифрованным */
export async function translateTextsWithDeepL(
  apiKey: string,
  from: string | null,
  to: string,
  texts: string[],
  isHTML: boolean,
): Promise<{ texts: string[]; detectedLanguage: string | null }> {
  try {
    return await remoteApp().translateMailTextsWithDeepL(apiKey, from, to, texts, isHTML);
  } catch (ex) {
    throw cleanTranslationError(ex);
  }
}
