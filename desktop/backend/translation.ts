/**
 * Перевод писем.
 *
 * По умолчанию — на этом компьютере: движок Bergamot (Mozilla, тот же, что
 * в Firefox Translations) в WebAssembly, в отдельном потоке. Текст письма
 * никуда не уходит; из сети один раз скачиваются только языковые модели
 * (20–45 МБ на пару языков) с серверов Mozilla, с проверкой SHA-256.
 *
 * По выбору пользователя — DeepL с его ключом API. Тогда текст уходит в DeepL;
 * интерфейс предупреждает об этом до первой отправки.
 */
import { app, net, session, type Session } from "electron";
import { Worker } from "node:worker_threads";
import crypto from "node:crypto";
import fsPromises from "node:fs/promises";
import path from "node:path";
import {
  desktopTranslationEnvironment,
  listTranslationLanguages,
  planTranslationModels,
  translationModelsSize,
  type TranslationModelFiles,
  type TranslationModelRecord,
} from "./translationModels";

const kRemoteSettingsURL = "https://firefox.settings.services.mozilla.com/v1/";
const kModelsCollectionPath = "buckets/main/collections/translations-models/records";
const kDefaultAttachmentsURL = "https://firefox-settings-attachments.cdn.mozilla.net/";
/** Список моделей меняется редко; при ошибке сети используем сохранённый */
const kRecordsMaxAgeMs = 7 * 24 * 60 * 60 * 1000;
/** Модели занимают память (по 40–200 МБ); без перевода поток выгружается */
const kWorkerIdleMs = 10 * 60 * 1000;
const kMaxLoadedModels = 2;
const kMaxTextsPerCall = 500;
const kMaxCharsPerCall = 200_000;
/** Загрузка модели без единого байта дольше этого — обрыв, а не медленная сеть */
const kDownloadStallMs = 60 * 1000;

export type MailTranslationPhase = "idle" | "download" | "load" | "translate";

export interface MailTranslationProgress {
  phase: MailTranslationPhase;
  loadedBytes: number;
  totalBytes: number;
}

export interface MailTranslationModelInfo {
  supported: boolean;
  downloaded: boolean;
  downloadBytes: number;
}

let progress: MailTranslationProgress = { phase: "idle", loadedBytes: 0, totalBytes: 0 };

export function getMailTranslationProgress(): MailTranslationProgress {
  return { ...progress };
}

function translationDir(): string {
  return path.join(app.getPath("userData"), "translation");
}

function modelsDir(): string {
  return path.join(translationDir(), "models");
}

function translationError(message: string, code: string, extra: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(message), { code }, extra);
}

function assertLanguageCode(language: string): void {
  if (typeof language != "string" || !/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(language)) {
    throw translationError("Invalid language code", "TranslationBadLanguage");
  }
}

function assertTexts(texts: string[]): void {
  if (!Array.isArray(texts) || texts.length > kMaxTextsPerCall ||
      texts.some(text => typeof text != "string")) {
    throw translationError("Invalid texts", "TranslationBadInput");
  }
  let chars = texts.reduce((sum, text) => sum + text.length, 0);
  if (chars > kMaxCharsPerCall) {
    throw translationError("Too much text in one call", "TranslationBadInput");
  }
}

// ---------------------------------------------------------------------------
// Список моделей

let modelsSession: Session | null = null;

/**
 * Отдельная сессия без кук и кеша, с честным User-Agent: CDN Mozilla отвечает
 * 406 на User-Agent браузера Chrome, который Electron шлёт по умолчанию.
 * Прокси — системный, как у остального приложения.
 */
function modelsFetch(url: string, init?: RequestInit): Promise<Response> {
  if (!modelsSession) {
    modelsSession = session.fromPartition("jackdaw-translation-models", { cache: false });
    modelsSession.setUserAgent(`JackdawMail/${app.getVersion()}`);
  }
  return modelsSession.fetch(url, init);
}

let recordsPromise: Promise<TranslationModelRecord[]> | null = null;
let attachmentsBaseURL = kDefaultAttachmentsURL;

interface CachedRecords {
  fetchedAt: number;
  attachmentsBaseURL: string;
  records: TranslationModelRecord[];
}

async function readCachedRecords(): Promise<CachedRecords | null> {
  try {
    let json = JSON.parse(await fsPromises.readFile(path.join(translationDir(), "models.json"), "utf-8"));
    return Array.isArray(json?.records) ? json : null;
  } catch {
    return null;
  }
}

async function fetchJSON(url: string): Promise<any> {
  let response = await modelsFetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw translationError(`HTTP ${response.status}`, "TranslationModelsUnavailable", { status: response.status });
  }
  return await response.json();
}

async function downloadRecords(): Promise<CachedRecords> {
  let base = kDefaultAttachmentsURL;
  try {
    let root = await fetchJSON(kRemoteSettingsURL);
    let advertised = root?.capabilities?.attachments?.base_url;
    if (typeof advertised == "string" && advertised.startsWith("https://")) {
      base = advertised.endsWith("/") ? advertised : advertised + "/";
    }
  } catch {
    // Без адреса вложений берём известный адрес CDN
  }
  let json = await fetchJSON(kRemoteSettingsURL + kModelsCollectionPath);
  let records = Array.isArray(json?.data) ? json.data as TranslationModelRecord[] : [];
  if (!records.length) {
    throw translationError("Empty model list", "TranslationModelsUnavailable");
  }
  let cached = { fetchedAt: Date.now(), attachmentsBaseURL: base, records };
  await fsPromises.mkdir(translationDir(), { recursive: true });
  await fsPromises.writeFile(path.join(translationDir(), "models.json"), JSON.stringify(cached));
  return cached;
}

async function loadRecords(): Promise<TranslationModelRecord[]> {
  let cached = await readCachedRecords();
  if (cached && Date.now() - cached.fetchedAt < kRecordsMaxAgeMs) {
    attachmentsBaseURL = cached.attachmentsBaseURL || kDefaultAttachmentsURL;
    return cached.records;
  }
  try {
    let fresh = await downloadRecords();
    attachmentsBaseURL = fresh.attachmentsBaseURL;
    return fresh.records;
  } catch (ex) {
    if (cached) {
      attachmentsBaseURL = cached.attachmentsBaseURL || kDefaultAttachmentsURL;
      return cached.records;
    }
    throw ex;
  }
}

function getRecords(): Promise<TranslationModelRecord[]> {
  recordsPromise ??= loadRecords().catch(ex => {
    recordsPromise = null;
    throw ex;
  });
  return recordsPromise;
}

const env = desktopTranslationEnvironment(process.platform);

export async function getMailTranslationLanguages(): Promise<{ from: string[]; to: string[] }> {
  return listTranslationLanguages(await getRecords(), env);
}

async function planModels(from: string, to: string): Promise<TranslationModelFiles[]> {
  assertLanguageCode(from);
  assertLanguageCode(to);
  let plan = planTranslationModels(await getRecords(), from, to, env);
  if (!plan) {
    throw translationError(`No model for ${from} → ${to}`, "TranslationUnsupportedLanguage", { from, to });
  }
  return plan;
}

// ---------------------------------------------------------------------------
// Файлы моделей

function modelFilePath(files: TranslationModelFiles, record: TranslationModelRecord): string {
  // Имя только из проверенных частей: ни один путь из списка Mozilla не попадает в ФС
  let hash = String(record.attachment.hash).replace(/[^0-9a-f]/gi, "").slice(0, 64);
  return path.join(modelsDir(), `${files.from}-${files.to}`, `${hash}.bin`);
}

function recordsOf(files: TranslationModelFiles): TranslationModelRecord[] {
  return [files.model, files.lex, ...files.vocabs];
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fsPromises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function isDownloaded(models: TranslationModelFiles[]): Promise<boolean> {
  for (let files of models) {
    for (let record of recordsOf(files)) {
      if (!await fileExists(modelFilePath(files, record))) {
        return false;
      }
    }
  }
  return true;
}

export async function getMailTranslationModelInfo(from: string, to: string): Promise<MailTranslationModelInfo> {
  let models: TranslationModelFiles[];
  try {
    models = await planModels(from, to);
  } catch (ex) {
    if ((ex as any)?.code == "TranslationUnsupportedLanguage") {
      return { supported: false, downloaded: false, downloadBytes: 0 };
    }
    throw ex;
  }
  let downloaded = await isDownloaded(models);
  return { supported: true, downloaded, downloadBytes: downloaded ? 0 : translationModelsSize(models) };
}

async function downloadRecordFile(record: TranslationModelRecord, target: string): Promise<void> {
  let location = String(record.attachment.location ?? "");
  if (!location || location.includes("..") || /^[a-z]+:/i.test(location)) {
    throw translationError("Bad model location", "TranslationModelsUnavailable");
  }
  let abort = new AbortController();
  let stallTimer: ReturnType<typeof setTimeout> | null = null;
  let watchStall = () => {
    if (stallTimer) {
      clearTimeout(stallTimer);
    }
    stallTimer = setTimeout(() => abort.abort(), kDownloadStallMs);
  };
  let hash = crypto.createHash("sha256");
  let parts: Uint8Array[] = [];
  try {
    watchStall();
    let response = await modelsFetch(attachmentsBaseURL + location, { signal: abort.signal });
    if (!response.ok || !response.body) {
      throw translationError(`HTTP ${response.status}`, "TranslationDownloadFailed", { status: response.status });
    }
    let reader = response.body.getReader();
    for (;;) {
      watchStall();
      let { done, value } = await reader.read();
      if (done || !value) {
        break;
      }
      hash.update(value);
      parts.push(value);
      progress.loadedBytes += value.byteLength;
    }
  } catch (ex) {
    if (abort.signal.aborted) {
      throw translationError("Model download stalled", "TranslationDownloadFailed");
    }
    throw ex;
  } finally {
    if (stallTimer) {
      clearTimeout(stallTimer);
    }
  }
  if (hash.digest("hex") != String(record.attachment.hash).toLowerCase()) {
    throw translationError("Model checksum mismatch", "TranslationDownloadFailed");
  }
  await fsPromises.mkdir(path.dirname(target), { recursive: true });
  let temp = `${target}.${process.pid}.part`;
  await fsPromises.writeFile(temp, Buffer.concat(parts));
  await fsPromises.rename(temp, target);
}

let downloadPromise: Promise<void> | null = null;

async function ensureDownloaded(models: TranslationModelFiles[]): Promise<void> {
  // Одна загрузка за раз: повторное нажатие «Перевести» ждёт ту же загрузку
  while (downloadPromise) {
    await downloadPromise.catch(() => {});
  }
  if (await isDownloaded(models)) {
    return;
  }
  downloadPromise = (async () => {
    progress = { phase: "download", loadedBytes: 0, totalBytes: translationModelsSize(models) };
    for (let files of models) {
      for (let record of recordsOf(files)) {
        let target = modelFilePath(files, record);
        if (await fileExists(target)) {
          progress.loadedBytes += record.attachment.size ?? 0;
          continue;
        }
        await downloadRecordFile(record, target);
      }
    }
  })();
  try {
    await downloadPromise;
  } finally {
    downloadPromise = null;
  }
}

/** Сколько места занимают скачанные модели */
export async function getMailTranslationModelsSize(): Promise<number> {
  let total = 0;
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fsPromises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (let entry of entries) {
      let full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        total += (await fsPromises.stat(full)).size;
      }
    }
  }
  await walk(modelsDir());
  return total;
}

export async function deleteMailTranslationModels(): Promise<void> {
  await queue;
  stopWorker();
  await fsPromises.rm(modelsDir(), { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Поток с движком Bergamot

/** Каталог движка из пакета @browsermt/bergamot-translator.
 * В собранном приложении он распакован из app.asar (asarUnpack). */
function bergamotDir(): string {
  let dir = path.join(app.getAppPath(), "node_modules", "@browsermt", "bergamot-translator", "worker");
  return dir.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
}

/** Загрузчик для worker_threads: даёт скрипту движка то окружение Web Worker,
 * которого он ждёт, и читает файлы только из каталога движка. */
const kWorkerBootstrap = `
const { parentPort, workerData } = require("node:worker_threads");
const fs = require("node:fs");
const path = require("node:path");
const dir = workerData.dir;
const inDir = name => {
  let full = path.resolve(dir, String(name));
  if (path.relative(dir, full).startsWith("..")) {
    throw new Error("Engine file outside of engine directory");
  }
  return full;
};
global.self = {
  addEventListener(name, callback) {
    parentPort.on(name, data => callback({ data }));
  },
  postMessage(message) {
    parentPort.postMessage(message);
  },
  importScripts(...scripts) {
    for (let script of scripts) {
      eval.call(global, fs.readFileSync(inDir(script), "utf-8"));
    }
  },
  async fetch(url) {
    let file = url instanceof URL ? url.pathname : new URL(String(url)).pathname;
    return new Response(fs.readFileSync(inDir(path.basename(decodeURIComponent(file)))), {
      headers: { "Content-Type": "application/wasm" },
    });
  },
  location: new URL("file:///bergamot/translator-worker.js"),
};
eval.call(global, fs.readFileSync(inDir("translator-worker.js"), "utf-8"));
`;

interface PendingCall {
  resolve: (value: any) => void;
  reject: (ex: Error) => void;
}

let worker: Worker | null = null;
let workerReady: Promise<void> | null = null;
let callID = 0;
let pendingCalls = new Map<number, PendingCall>();
/** Загруженные в поток модели: ключ пары → версия, по порядку использования */
let loadedModels = new Map<string, string>();
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function stopWorker(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  let stopped = worker;
  worker = null;
  workerReady = null;
  loadedModels.clear();
  for (let call of pendingCalls.values()) {
    call.reject(translationError("Translation engine stopped", "TranslationEngineFailed"));
  }
  pendingCalls.clear();
  void stopped?.terminate();
}

function callWorker(name: string, ...args: unknown[]): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!worker) {
      reject(translationError("Translation engine is not running", "TranslationEngineFailed"));
      return;
    }
    let id = ++callID;
    pendingCalls.set(id, { resolve, reject });
    worker.postMessage({ id, name, args });
  });
}

function startWorker(): Promise<void> {
  if (workerReady) {
    return workerReady;
  }
  worker = new Worker(kWorkerBootstrap, { eval: true, workerData: { dir: bergamotDir() } });
  worker.on("message", ({ id, result, error }) => {
    let call = pendingCalls.get(id);
    if (!call) {
      return;
    }
    pendingCalls.delete(id);
    if (error) {
      call.reject(translationError(error.message ?? "Translation failed", "TranslationEngineFailed"));
    } else {
      call.resolve(result);
    }
  });
  worker.on("error", ex => {
    console.error("Translation engine failed", ex);
    stopWorker();
  });
  worker.on("exit", () => {
    if (worker) {
      stopWorker();
    }
  });
  workerReady = callWorker("initialize", { cacheSize: 0 }).catch(ex => {
    stopWorker();
    throw ex;
  });
  return workerReady;
}

function scheduleIdleStop(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
  }
  idleTimer = setTimeout(stopWorker, kWorkerIdleMs);
  idleTimer.unref?.();
}

async function readBuffer(filePath: string): Promise<ArrayBuffer> {
  let data = await fsPromises.readFile(filePath);
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

async function ensureLoaded(models: TranslationModelFiles[]): Promise<void> {
  await startWorker();
  for (let files of models) {
    let key = `${files.from}-${files.to}`;
    if (loadedModels.get(key) == files.version) {
      // Свежий по использованию — в конец очереди
      loadedModels.delete(key);
      loadedModels.set(key, files.version);
      continue;
    }
    let pair = { from: files.from, to: files.to };
    if (loadedModels.has(key)) {
      await callWorker("freeTranslationModel", pair);
      loadedModels.delete(key);
    }
    let needed = new Set(models.map(m => `${m.from}-${m.to}`));
    for (let oldKey of [...loadedModels.keys()]) {
      if (loadedModels.size < kMaxLoadedModels) {
        break;
      }
      if (!needed.has(oldKey)) {
        let [from, to] = oldKey.split("-");
        await callWorker("freeTranslationModel", { from, to });
        loadedModels.delete(oldKey);
      }
    }
    progress = { phase: "load", loadedBytes: 0, totalBytes: 0 };
    await callWorker("loadTranslationModel", pair, {
      model: await readBuffer(modelFilePath(files, files.model)),
      shortlist: await readBuffer(modelFilePath(files, files.lex)),
      vocabs: await Promise.all(files.vocabs.map(vocab => readBuffer(modelFilePath(files, vocab)))),
    });
    loadedModels.set(key, files.version);
  }
}

/** Вызовы движка по очереди: поток всё равно переводит по одному запросу */
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  let result = queue.then(job, job);
  queue = result.catch(() => {});
  return result;
}

/**
 * Переводит тексты на этом компьютере.
 * @param html тексты — фрагменты HTML; движок сохраняет теги на своих местах
 */
export async function translateMailTexts(from: string, to: string, texts: string[], html: boolean): Promise<string[]> {
  assertTexts(texts);
  if (!texts.length) {
    return [];
  }
  let models = await planModels(from, to);
  await ensureDownloaded(models);
  return await enqueue(async () => {
    try {
      await ensureLoaded(models);
      progress = { phase: "translate", loadedBytes: 0, totalBytes: 0 };
      let result = await callWorker("translate", {
        models: models.map(files => ({ from: files.from, to: files.to })),
        texts: texts.map(text => ({ text, html: !!html, qualityScores: false })),
      });
      return (result as { target: { text: string } }[]).map(item => String(item?.target?.text ?? ""));
    } finally {
      progress = { phase: "idle", loadedBytes: 0, totalBytes: 0 };
      scheduleIdleStop();
    }
  });
}

// ---------------------------------------------------------------------------
// DeepL — только по выбору пользователя, с его ключом

/** Коды DeepL: у целевого языка для английского и португальского нужен вариант */
function deeplLanguage(language: string, target: boolean): string {
  let code = language.toLowerCase();
  if (code.startsWith("zh")) {
    return target ? (code == "zh-hant" ? "ZH-HANT" : "ZH-HANS") : "ZH";
  }
  let base = code.split("-")[0];
  if (target && base == "en") {
    return code == "en-gb" ? "EN-GB" : "EN-US";
  }
  if (target && base == "pt") {
    return code == "pt-pt" ? "PT-PT" : "PT-BR";
  }
  return (base == "no" || base == "nn" ? "nb" : base).toUpperCase();
}

/**
 * @param apiKey ключ пользователя; не логируется и не возвращается
 * @param from null — DeepL определит язык сам
 */
export async function translateMailTextsWithDeepL(
  apiKey: string,
  from: string | null,
  to: string,
  texts: string[],
  html: boolean,
): Promise<{ texts: string[]; detectedLanguage: string | null }> {
  assertTexts(texts);
  assertLanguageCode(to);
  if (from) {
    assertLanguageCode(from);
  }
  if (typeof apiKey != "string" || !apiKey.trim()) {
    throw translationError("No DeepL API key", "TranslationNoKey");
  }
  if (!texts.length) {
    return { texts: [], detectedLanguage: null };
  }
  let key = apiKey.trim();
  let host = key.endsWith(":fx") ? "https://api-free.deepl.com" : "https://api.deepl.com";
  let body: Record<string, unknown> = {
    text: texts,
    target_lang: deeplLanguage(to, true),
    preserve_formatting: true,
  };
  if (from) {
    body.source_lang = deeplLanguage(from, false);
  }
  if (html) {
    body.tag_handling = "html";
  }
  let response = await net.fetch(`${host}/v2/translate`, {
    method: "POST",
    headers: {
      "Authorization": `DeepL-Auth-Key ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    let code = response.status == 403 || response.status == 401 ? "TranslationKeyRejected" :
      response.status == 456 ? "TranslationQuotaExceeded" :
      response.status == 429 ? "TranslationRateLimited" :
      "TranslationServiceFailed";
    throw translationError(`DeepL HTTP ${response.status}`, code, { status: response.status });
  }
  let json = await response.json();
  let translations = Array.isArray(json?.translations) ? json.translations : [];
  if (translations.length != texts.length) {
    throw translationError("DeepL returned a different number of texts", "TranslationServiceFailed");
  }
  let detected = typeof translations[0]?.detected_source_language == "string"
    ? translations[0].detected_source_language.toLowerCase()
    : null;
  return {
    texts: translations.map(item => String(item?.text ?? "")),
    detectedLanguage: detected,
  };
}
