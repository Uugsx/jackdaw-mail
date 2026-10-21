import type { EMail } from "../../../logic/Mail/EMail";
import { writable, type Readable } from "svelte/store";
import { getLocalStorage } from "../../Util/LocalStorage";
import { getUILocale } from "../../../l10n/l10n";
import { detectLanguage, type DetectedLanguage } from "../../../logic/Mail/Translate/languageDetect";
import { translateHTML, translatePlainText, type TranslateBatch } from "../../../logic/Mail/Translate/translateHTML";
import {
  engineSendsTextOutside,
  getLocalModelStatus,
  getTranslationLanguages,
  isTranslationEngineAvailable,
  normalizeTranslationLanguage,
  sameTranslationLanguage,
  translateTextsLocally,
  translateTextsWithDeepL,
  type TranslationEngineID,
  type TranslationLanguages,
  type TranslationModelStatus,
} from "../../../logic/Mail/Translate/translationEngine";
import { passwordDecrypt } from "../../../logic/Auth/passwordEncrypt";
import { UserError } from "../../../logic/util/util";
import { gt } from "../../../l10n/l10n";
import { stripMailChatQuote } from "./mailChatBody";

// ---------------------------------------------------------------------------
// Настройки

/** Язык перевода; пусто — язык интерфейса */
export function getTranslationTargetSetting() {
  return getLocalStorage<string>("mail.translate.target", "");
}
export function getTranslationEngineSetting() {
  return getLocalStorage<TranslationEngineID>("mail.translate.engine", "local");
}
/** Предлагать перевод писем на другом языке */
export function getTranslationSuggestSetting() {
  return getLocalStorage<boolean>("mail.translate.suggest", true);
}
/** Языки, для которых перевод не предлагать */
export function getTranslationNeverSuggestSetting() {
  return getLocalStorage<string[]>("mail.translate.neverSuggest", []);
}
/** Ключ DeepL API, зашифрованный как пароли аккаунтов */
export function getDeepLKeySetting() {
  return getLocalStorage<string>("mail.translate.deepl.key", "");
}
/** Пользователь знает, что текст писем уходит в DeepL */
export function getDeepLConsentSetting() {
  return getLocalStorage<boolean>("mail.translate.deepl.consent", false);
}

/** @param target значение настройки; по умолчанию — текущее */
export function translationTargetLanguage(target = getTranslationTargetSetting().value): string {
  return normalizeTranslationLanguage(target || getUILocale());
}

export function currentTranslationEngine(engine: string = getTranslationEngineSetting().value): TranslationEngineID {
  return engine == "deepl" ? "deepl" : "local";
}

/** @param engine значение настройки; по умолчанию — текущее */
export function isMailTranslationAvailable(engine: string = getTranslationEngineSetting().value): boolean {
  return isTranslationEngineAvailable(currentTranslationEngine(engine));
}

export function neverSuggestLanguage(language: string): void {
  let setting = getTranslationNeverSuggestSetting();
  let code = normalizeTranslationLanguage(language);
  let list = Array.isArray(setting.value) ? setting.value : [];
  if (code && !list.includes(code)) {
    setting.value = [...list, code];
  }
}

// ---------------------------------------------------------------------------
// Языки движка: запрашиваются один раз

let languagesCache = new Map<TranslationEngineID, Promise<TranslationLanguages>>();

export function translationLanguages(engine = currentTranslationEngine()): Promise<TranslationLanguages> {
  let cached = languagesCache.get(engine);
  if (!cached) {
    cached = getTranslationLanguages(engine).catch(ex => {
      languagesCache.delete(engine);
      throw ex;
    });
    languagesCache.set(engine, cached);
  }
  return cached;
}

export async function canTranslatePair(from: string, to: string, engine = currentTranslationEngine()): Promise<boolean> {
  let { from: sources, to: targets } = await translationLanguages(engine);
  let source = normalizeTranslationLanguage(from);
  let target = normalizeTranslationLanguage(to);
  return source != target && sources.includes(source) && targets.includes(target);
}

// ---------------------------------------------------------------------------
// Определение языка письма

/** Текст письма без цитаты прошлых писем: по нему и определяется язык */
export function languageSampleFromHTML(html: string | null | undefined): string {
  if (!html || typeof DOMParser == "undefined") {
    return "";
  }
  let doc = new DOMParser().parseFromString(stripMailChatQuote(html), "text/html");
  for (let el of doc.querySelectorAll("style, script, code, pre")) {
    el.remove();
  }
  return doc.body?.textContent ?? "";
}

export function detectMessageLanguage(message: EMail): DetectedLanguage | null {
  let html = message?.html;
  let detected = detectLanguage(languageSampleFromHTML(html));
  if (!detected && message?.text) {
    detected = detectLanguage(message.text);
  }
  return detected;
}

// ---------------------------------------------------------------------------
// Перевод одного письма

export type MessageTranslationStatus =
  /** Перевода нет */
  | "idle"
  /** Ждём согласия отправить текст во внешний сервис */
  | "consent"
  /** Язык письма не определён: нужно выбрать */
  | "choose-language"
  | "translating"
  | "translated"
  /** Письмо уже на нужном языке */
  | "same-language"
  | "error";

export type TranslationKind = "html" | "text";

export interface MessageTranslationState {
  status: MessageTranslationStatus;
  showOriginal: boolean;
  /** Язык оригинала: определённый или выбранный */
  sourceLanguage: string | null;
  targetLanguage: string;
  engine: TranslationEngineID;
  done: number;
  total: number;
  /** Загрузка языковой модели, если она идёт */
  model: TranslationModelStatus | null;
  error: Error | null;
  /** Номер изменения результатов: тело письма перечитывает перевод */
  revision: number;
}

const kModelStatusPollMs = 400;

export class MessageTranslation implements Readable<MessageTranslationState> {
  private state: MessageTranslationState;
  private store;
  private results = new Map<string, string>();
  private abort: AbortController | null = null;
  private requestedKind: TranslationKind = "html";
  private requestedSource = "";
  private chosenLanguage: string | null = null;

  constructor(private message: EMail) {
    this.state = {
      status: "idle",
      showOriginal: false,
      sourceLanguage: null,
      targetLanguage: translationTargetLanguage(),
      engine: currentTranslationEngine(),
      done: 0,
      total: 0,
      model: null,
      error: null,
      revision: 0,
    };
    this.store = writable(this.state);
  }

  subscribe(run: (value: MessageTranslationState) => void, invalidate?: () => void) {
    return this.store.subscribe(run, invalidate);
  }

  get current(): MessageTranslationState {
    return this.state;
  }

  private update(changes: Partial<MessageTranslationState>): void {
    this.state = { ...this.state, ...changes };
    this.store.set(this.state);
  }

  private resultKey(kind: TranslationKind, source: string, from: string, to: string, engine: string): string {
    return `${engine}\n${from}\n${to}\n${kind}\n${source}`;
  }

  /** Перевод для того, что сейчас показывает тело письма; null — показывать оригинал */
  resultFor(kind: TranslationKind, source: string): string | null {
    if (this.state.showOriginal || this.state.status != "translated" || !this.state.sourceLanguage) {
      return null;
    }
    return this.results.get(this.resultKey(kind, source, this.state.sourceLanguage,
      this.state.targetLanguage, this.state.engine)) ?? null;
  }

  /**
   * Тело письма сообщает, что именно показывает: HTML (с внешними картинками
   * или без) или обычный текст. Если перевод включён, а для этого вида его ещё
   * нет — переводим.
   */
  setDisplayed(kind: TranslationKind, source: string): void {
    this.requestedKind = kind;
    this.requestedSource = source ?? "";
    if (this.state.status == "translated" && !this.state.showOriginal &&
        this.resultFor(kind, this.requestedSource) == null) {
      void this.translate();
    }
  }

  /** Перевести на язык из настроек. `from` — язык, выбранный вручную. */
  async translate(from: string | null = null): Promise<void> {
    if (from) {
      this.chosenLanguage = normalizeTranslationLanguage(from);
    }
    let engine = currentTranslationEngine();
    let target = translationTargetLanguage();
    this.update({ engine, targetLanguage: target, showOriginal: false, error: null });
    if (!isTranslationEngineAvailable(engine)) {
      this.fail(new UserError(gt`Translation is available only in the desktop app.`));
      return;
    }
    if (engineSendsTextOutside(engine) && !getDeepLConsentSetting().value) {
      this.update({ status: "consent" });
      return;
    }
    let source = this.chosenLanguage ?? normalizeTranslationLanguage(detectMessageLanguage(this.message)?.language);
    if (!source && engine == "local") {
      this.update({ status: "choose-language", sourceLanguage: null });
      return;
    }
    if (source && sameTranslationLanguage(source, target)) {
      this.update({ status: "same-language", sourceLanguage: source });
      return;
    }
    let kind = this.requestedKind;
    let original = kind == "text" ? this.message.text ?? "" : this.requestedSource || this.message.html;
    let key = this.resultKey(kind, original, source ?? "", target, engine);
    if (this.results.has(key)) {
      this.update({ status: "translated", sourceLanguage: source });
      return;
    }

    this.abort?.abort();
    let abort = new AbortController();
    this.abort = abort;
    this.update({ status: "translating", sourceLanguage: source, done: 0, total: 0, model: null });
    let stopPolling = engine == "local" ? this.pollModelStatus(abort) : () => {};
    try {
      let detectedByService: string | null = null;
      let batch: TranslateBatch = engine == "deepl"
        ? async (texts, isHTML) => {
          let result = await translateTextsWithDeepL(await this.deeplKey(), source, target, texts, isHTML);
          detectedByService ??= result.detectedLanguage;
          return result.texts;
        }
        : (texts, isHTML) => translateTextsLocally(source, target, texts, isHTML);
      let options = {
        signal: abort.signal,
        onProgress: (done: number, total: number) => {
          if (this.abort == abort) {
            this.update({ done, total });
          }
        },
      };
      let translated = kind == "text"
        ? await translatePlainText(original, batch, options)
        : await translateHTML(original, batch, options);
      if (this.abort != abort) {
        return;
      }
      let finalSource = source ?? normalizeTranslationLanguage(detectedByService);
      if (finalSource && sameTranslationLanguage(finalSource, target)) {
        this.update({ status: "same-language", sourceLanguage: finalSource });
        return;
      }
      this.results.set(this.resultKey(kind, original, finalSource ?? "", target, engine), translated);
      this.update({
        status: "translated",
        sourceLanguage: finalSource,
        model: null,
        revision: this.state.revision + 1,
      });
    } catch (ex) {
      if (this.abort == abort && !abort.signal.aborted) {
        this.fail(ex);
      }
    } finally {
      stopPolling();
      if (this.abort == abort) {
        this.abort = null;
      }
    }
  }

  showError(ex: unknown): void {
    this.abort?.abort();
    this.abort = null;
    this.fail(ex);
  }

  private fail(ex: unknown): void {
    this.update({
      status: "error",
      error: ex instanceof Error ? ex : new Error(String(ex)),
      model: null,
    });
  }

  private async deeplKey(): Promise<string> {
    let key = await passwordDecrypt(getDeepLKeySetting().value || null);
    if (!key) {
      throw new UserError(gt`Enter your DeepL API key in Settings → Mail → Read.`);
    }
    return key;
  }

  /** Пока идёт перевод, показываем загрузку языковой модели (первый раз) */
  private pollModelStatus(abort: AbortController): () => void {
    let timer = setInterval(async () => {
      try {
        let status = await getLocalModelStatus();
        if (this.abort == abort && this.state.status == "translating") {
          this.update({ model: status?.phase == "download" ? status : null });
        }
      } catch {
        // Состояние загрузки — только подсказка
      }
    }, kModelStatusPollMs);
    return () => clearInterval(timer);
  }

  /** Пользователь согласился отправить текст в DeepL */
  async acceptConsent(): Promise<void> {
    getDeepLConsentSetting().value = true;
    await this.translate();
  }

  cancel(): void {
    this.abort?.abort();
    this.abort = null;
    this.update({ status: "idle", model: null, done: 0, total: 0 });
  }

  showOriginal(): void {
    this.update({ showOriginal: true, revision: this.state.revision + 1 });
  }

  showTranslation(): void {
    // Язык перевода или движок сменили в настройках — переводим заново
    if (this.state.targetLanguage != translationTargetLanguage() || this.state.engine != currentTranslationEngine()) {
      void this.translate();
      return;
    }
    this.update({ showOriginal: false, revision: this.state.revision + 1 });
    if (this.resultFor(this.requestedKind, this.requestedKind == "text"
      ? this.message.text ?? ""
      : this.requestedSource || this.message.html) == null) {
      void this.translate();
    }
  }

  /** Кнопка «Перевести» на панели письма: перевести или переключить перевод и оригинал */
  toggle(): void {
    if (this.state.status != "translated") {
      void this.translate();
    } else if (this.state.showOriginal) {
      this.showTranslation();
    } else {
      this.showOriginal();
    }
  }

  /** Закрыть полоску «Письмо уже на нужном языке», «Выберите язык» и т. п. */
  reset(): void {
    this.abort?.abort();
    this.abort = null;
    this.update({ status: "idle", showOriginal: false, error: null, model: null });
  }
}

let translations = new WeakMap<EMail, MessageTranslation>();

export function getMessageTranslation(message: EMail): MessageTranslation {
  let translation = translations.get(message);
  if (!translation) {
    translation = new MessageTranslation(message);
    translations.set(message, translation);
  }
  return translation;
}

/** Закрытые предложения перевести (на время работы приложения) */
let dismissedSuggestions = new WeakSet<EMail>();

export function dismissTranslationSuggestion(message: EMail): void {
  dismissedSuggestions.add(message);
}

export function isTranslationSuggestionDismissed(message: EMail): boolean {
  return dismissedSuggestions.has(message);
}

/**
 * Язык, на котором стоит предложить перевод, или null.
 * Предложение — только если язык надёжно определён и его можно перевести.
 */
export async function translationSuggestionFor(message: EMail): Promise<string | null> {
  if (!getTranslationSuggestSetting().value || !isMailTranslationAvailable() ||
      isTranslationSuggestionDismissed(message)) {
    return null;
  }
  let detected = detectMessageLanguage(message);
  if (!detected) {
    return null;
  }
  let source = normalizeTranslationLanguage(detected.language);
  let target = translationTargetLanguage();
  let never = getTranslationNeverSuggestSetting().value;
  if (sameTranslationLanguage(source, target) || (Array.isArray(never) && never.includes(source))) {
    return null;
  }
  try {
    return await canTranslatePair(source, target) ? source : null;
  } catch {
    // Список языков недоступен (нет сети и кеша): не навязываемся
    return null;
  }
}
