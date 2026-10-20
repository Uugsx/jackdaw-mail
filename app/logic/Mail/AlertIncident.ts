import type { EMail } from "./EMail";

/**
 * Группировка однотипных писем-алертов мониторинга в инциденты.
 *
 * Без ИИ и без обращений к серверу: тема нормализуется набором правил
 * (маркеры состояния, числа, ID, даты, хосты), ключ инцидента — отправитель
 * плюс нормализованная тема. Пара «сработало / восстановлено» попадает в один
 * инцидент, потому что маркеры состояния из темы убираются, а само состояние
 * запоминается отдельно.
 */

export type AlertPolarity = "firing" | "resolved";

/**
 * active — алерты идут;
 * resumed — снова пошли после затишья, «решено» или закрытия;
 * quiet — новых срабатываний не было дольше периода затишья;
 * resolved — после последнего срабатывания пришло «resolved/OK/восстановлено»;
 * closed — пользователь закрыл инцидент, новых срабатываний после этого нет.
 */
export type AlertIncidentStatus = "active" | "resumed" | "quiet" | "resolved" | "closed";

export interface AlertSubjectInfo {
  /** Тема без маркеров состояния и префиксов ответа */
  cleaned: string;
  /** Тема с заменой изменчивых частей на «…» — подпись группы */
  template: string;
  /** Ключ темы: шаблон в нижнем регистре */
  key: string;
  polarity: AlertPolarity;
}

export interface AlertIncident {
  /** Отправитель и нормализованная тема */
  key: string;
  label: string;
  senderLabel: string;
  /** Письма инцидента, новые первыми */
  messages: EMail[];
  /** Число срабатываний (письма «resolved» не считаются) */
  firingCount: number;
  resolvedCount: number;
  unreadCount: number;
  firstAt: Date | null;
  lastAt: Date | null;
  /** Время последнего письма инцидента любого типа, мс */
  lastEventAt: number;
  status: AlertIncidentStatus;
  /** Когда статус сменится сам по себе (active → quiet), мс */
  nextTransitionAt: number | null;
}

export interface AlertIncidentOptions {
  now?: number;
  /** Период затишья, после которого инцидент считается затихшим, мс */
  quietMs?: number;
  /** Время закрытия инцидента пользователем, мс */
  closedAt?: (key: string) => number | null | undefined;
  /** Дополнительные шаблоны изменчивых частей темы */
  patterns?: readonly RegExp[];
}

export const kDefaultAlertQuietMs = 60 * 60 * 1000;
/** Дальше этой длины тема для группировки не нужна, а регулярным выражениям лишняя работа */
const kMaxSubjectLength = 300;
const kKeySeparator = "\u001f";
const kVariable = "…";

/* Граница слова для кириллицы: `\b` в JS работает только с ASCII. */
const kEnd = String.raw`(?![\p{L}\p{N}_])`;

const kResolvedWords = String.raw`resolved|recovered|recovery|ok|cleared|restored|up|normal|` +
  String.raw`восстановлен[оаы]?|восстановление|устранен[оаы]?|решен[оаы]?|норма|ок|отбой`;
const kFiringWords = String.raw`firing|alerting|alert|triggered|re-triggered|retriggered|problem|` +
  String.raw`critical|crit|warning|warn|error|failure|failed|fail|down|fired|no data|` +
  String.raw`ошибка|ошибки|авария|сбой|проблема|внимание|критично|тревога`;
/* Уровни важности без состояния: убираем, чтобы смена важности не делила инцидент. */
const kSeverityWords = String.raw`p\d|sev\s*\d|severity\s*\d|disaster|high|average|medium|low|info|information|` +
  String.raw`not classified|высокая|средняя|низкая`;

/* [FIRING:3], [Triggered on {host:a}], (OK), 【Resolved】 */
const bracketMarker = (words: string) => new RegExp(
  String.raw`^[\[(【]\s*(?:${words})(?:\s*[:#]\s*\d+)?(?:\s+on\s+[^\])】]*)?\s*[\])】]\s*[:\-–—|]?\s*`, "iu");
/* Problem: …, Resolved in 5m 0s: …, Ошибка — …, Fired:Sev3 … */
const wordMarker = (words: string) => new RegExp(
  String.raw`^(?:${words})(?:\s+in\s+[^:]{1,40})?\s*[:\-–—|]\s*`, "iu");
/* PROBLEM Service Alert…, RESOLVED HighCPU — только заглавными, иначе это обычное слово темы */
const upperResolved = new RegExp(String.raw`^(?:RESOLVED|RECOVERY|RECOVERED|OK|UP)${kEnd}\s*`, "u");
const upperFiring = new RegExp(String.raw`^(?:FIRING|PROBLEM|ALERT|CRITICAL|WARNING|DOWN|ERROR)${kEnd}\s*`, "u");

const prefixRules: { pattern: RegExp; polarity: AlertPolarity | null }[] = [
  { pattern: /^(?:(?:re|fw|fwd|aw|wg|ответ|пересылка|отв|пересл)(?:\[\d+\])?\s*:\s*)+/iu, polarity: null },
  { pattern: /^\*+\s*/u, polarity: null },
  { pattern: bracketMarker(kResolvedWords), polarity: "resolved" },
  { pattern: bracketMarker(kFiringWords), polarity: "firing" },
  { pattern: bracketMarker(kSeverityWords), polarity: null },
  { pattern: wordMarker(kResolvedWords), polarity: "resolved" },
  { pattern: wordMarker(kFiringWords), polarity: "firing" },
  { pattern: new RegExp(String.raw`^(?:sev\s*\d|p\d)${kEnd}\s*[:\-–—|]?\s*`, "iu"), polarity: null },
  { pattern: upperResolved, polarity: "resolved" },
  { pattern: upperFiring, polarity: "firing" },
];

const suffixRules: { pattern: RegExp; polarity: AlertPolarity | null }[] = [
  { pattern: /\s*\*+$/u, polarity: null },
  {
    pattern: /\s+(?:is|are|was|has been|went|got)\s+(?:ok|up|resolved|recovered|restored|deactivated|cleared|back to normal|back up)[.!]*$/iu,
    polarity: "resolved",
  },
  {
    pattern: /\s+(?:is|are|was|has been|went|got)\s+(?:critical|warning|down|unknown|unreachable|activated|fired|triggered)[.!]*$/iu,
    polarity: "firing",
  },
  {
    pattern: /\s*[-–—:(]\s*(?:восстановлен[оаы]?|устранен[оаы]?|в норме|снова работает)\)?[.!]*$/iu,
    polarity: "resolved",
  },
];

/* «may» и «мая» не включаем: это частые обычные слова */
const kMonths = String.raw`jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|jun(?:e)?|jul(?:y)?|aug(?:ust)?|` +
  String.raw`sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|` +
  String.raw`январ[ья]|феврал[ья]|марта?|апрел[ья]|июн[ья]|июл[ья]|августа?|сентябр[ья]|октябр[ья]|ноябр[ья]|декабр[ья]`;

/** Изменчивые части темы, заменяемые на «…». Порядок важен: сначала длинные. */
const variablePatterns: RegExp[] = [
  /\b(?:https?|ftp):\/\/\S+/giu,
  /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/giu,
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu,
  /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{8,}\b/giu,
  /\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/gu,
  /\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}\b/giu,
  /* Хосты: имена хотя бы с двумя точками (db01.corp.local, api.prod.example.com) */
  /\b[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+){2,}\b/giu,
  new RegExp(String.raw`(?<![\p{L}])(?:${kMonths})(?![\p{L}])\.?`, "giu"),
  new RegExp(String.raw`(?<![\p{L}])(?:am|pm|utc|gmt|msk|мск)${kEnd}`, "giu"),
];

const kNoPatterns: readonly RegExp[] = Object.freeze([]);
const cache = new WeakMap<EMail, {
  subject: string;
  sender: string;
  patterns: readonly RegExp[];
  key: string;
  info: AlertSubjectInfo;
}>();

/** Тема письма-алерта без маркеров состояния, с ключом группировки. */
export function normalizeAlertSubject(subject: string | null | undefined, patterns: readonly RegExp[] = kNoPatterns): AlertSubjectInfo {
  let text = (subject ?? "")
    .slice(0, kMaxSubjectLength)
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim();
  let polarity: AlertPolarity | null = null;
  for (let changed = true, guard = 0; changed && guard < 12; guard++) {
    changed = false;
    for (let rule of prefixRules) {
      let match = rule.pattern.exec(text);
      if (match && match[0].length) {
        text = text.slice(match[0].length).trim();
        polarity ??= rule.polarity;
        changed = true;
      }
    }
  }
  for (let changed = true, guard = 0; changed && guard < 6; guard++) {
    changed = false;
    for (let rule of suffixRules) {
      let match = rule.pattern.exec(text);
      if (match && match[0].length) {
        text = text.slice(0, match.index).trim();
        polarity ??= rule.polarity;
        changed = true;
      }
    }
  }
  let cleaned = text.replace(/^[\s:\-–—|]+|[\s:\-–—|]+$/gu, "");
  let template = cleaned;
  for (let pattern of [...patterns, ...variablePatterns]) {
    pattern.lastIndex = 0;
    template = template.replace(pattern, kVariable);
  }
  template = template
    .replace(/\d+/gu, kVariable)
    // «…:…:…», «… - …», «…/…» — одна изменчивая часть
    .replace(new RegExp(String.raw`${kVariable}(?:[\s.,:/_\-+#]*${kVariable})+`, "gu"), kVariable)
    .replace(/\s+/gu, " ")
    .trim();
  return {
    cleaned,
    template,
    key: template.toLocaleLowerCase(),
    polarity: polarity ?? "firing",
  };
}

/** Сравнимый ключ отправителя: адрес, иначе имя. */
export function alertSenderKey(message: EMail): string {
  return (message.from?.emailAddress || message.from?.name || "").trim().toLowerCase();
}

function senderLabel(message: EMail): string {
  return (message.contact?.name || message.from?.name || message.from?.emailAddress || "").trim();
}

/**
 * Разбор темы с кэшем на объект письма. Тема и отправитель письма почти
 * никогда не меняются, а папка в 50 тыс. писем пересобирается при каждой
 * синхронизации, поэтому регулярные выражения выполняются один раз на письмо.
 */
export function alertInfoForMessage(
  message: EMail,
  patterns: readonly RegExp[] = kNoPatterns,
): { key: string; info: AlertSubjectInfo } {
  let subject = message.subject ?? "";
  let sender = alertSenderKey(message);
  let cached = cache.get(message);
  if (cached && cached.subject === subject && cached.sender === sender && cached.patterns === patterns) {
    return cached;
  }
  let info = normalizeAlertSubject(subject, patterns);
  let entry = { subject, sender, patterns, key: sender + kKeySeparator + info.key, info };
  cache.set(message, entry);
  return entry;
}

/** Ключ инцидента письма: отправитель и нормализованная тема. */
export function alertIncidentKey(message: EMail, patterns: readonly RegExp[] = kNoPatterns): string {
  return alertInfoForMessage(message, patterns).key;
}

function messageTime(message: EMail): number {
  let date = typeof message.listDisplayDate == "function"
    ? message.listDisplayDate()
    : message.received ?? message.sent;
  let time = date?.getTime();
  return Number.isFinite(time) ? time : 0;
}

type IncidentEvent = {
  message: EMail;
  time: number;
  info: AlertSubjectInfo;
};

/**
 * Собирает инциденты из писем папки. O(n log n) по числу писем: один проход
 * для группировки и сортировка внутри групп; без сравнения «каждого с каждым».
 * Порядок результата — по последнему событию, новые первыми.
 */
export function buildAlertIncidents(messages: readonly EMail[], options: AlertIncidentOptions = {}): AlertIncident[] {
  let now = options.now ?? Date.now();
  let quietMs = Math.max(0, options.quietMs ?? kDefaultAlertQuietMs);
  let patterns = options.patterns ?? kNoPatterns;
  let groups = new Map<string, IncidentEvent[]>();
  for (let message of messages) {
    if (!message) {
      continue;
    }
    let { key, info } = alertInfoForMessage(message, patterns);
    let event = { message, time: messageTime(message), info };
    let group = groups.get(key);
    if (group) {
      group.push(event);
    } else {
      groups.set(key, [event]);
    }
  }
  let incidents: AlertIncident[] = [];
  for (let [key, events] of groups) {
    incidents.push(buildIncident(key, events, now, quietMs, options.closedAt?.(key) ?? null));
  }
  incidents.sort((a, b) => b.lastEventAt - a.lastEventAt || compareKeys(a.key, b.key));
  return incidents;
}

function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function buildIncident(
  key: string,
  events: IncidentEvent[],
  now: number,
  quietMs: number,
  closedAt: number | null,
): AlertIncident {
  events.sort((a, b) => a.time - b.time);
  let firingCount = 0;
  let resolvedCount = 0;
  let unreadCount = 0;
  let firstFiring: number | null = null;
  let lastFiring: number | null = null;
  let lastResolved: number | null = null;
  let resumed = false;
  let latestFiringEvent: IncidentEvent | null = null;
  let sameCleaned = true;
  let firstCleaned = events[0].info.cleaned;
  for (let event of events) {
    if (!event.message.isRead) {
      unreadCount++;
    }
    if (event.info.cleaned != firstCleaned) {
      sameCleaned = false;
    }
    if (event.info.polarity == "resolved") {
      resolvedCount++;
      lastResolved = event.time;
      continue;
    }
    firingCount++;
    if (lastFiring == null) {
      firstFiring = event.time;
      // Первое срабатывание после «решено» без предыдущих срабатываний — новый инцидент
    } else {
      let afterBreak = event.time - lastFiring > quietMs ||
        (lastResolved != null && lastResolved >= lastFiring) ||
        (closedAt != null && closedAt >= lastFiring && closedAt < event.time);
      if (afterBreak) {
        resumed = true;
      }
    }
    lastFiring = event.time;
    latestFiringEvent = event;
  }
  let latest = events[events.length - 1];
  let status: AlertIncidentStatus;
  let nextTransitionAt: number | null = null;
  if (lastFiring == null || (lastResolved != null && lastResolved >= lastFiring)) {
    status = "resolved";
  } else if (closedAt != null && closedAt >= lastFiring) {
    status = "closed";
  } else if (now - lastFiring > quietMs) {
    status = "quiet";
  } else {
    status = resumed ? "resumed" : "active";
    nextTransitionAt = lastFiring + quietMs + 1;
  }
  let labelEvent = latestFiringEvent ?? latest;
  let label = sameCleaned ? labelEvent.info.cleaned : labelEvent.info.template;
  return {
    key,
    label: label || labelEvent.info.template,
    senderLabel: senderLabel(latest.message),
    messages: events.map(event => event.message).reverse(),
    firingCount,
    resolvedCount,
    unreadCount,
    firstAt: firstFiring == null ? null : new Date(firstFiring),
    lastAt: lastFiring == null ? null : new Date(lastFiring),
    lastEventAt: latest.time,
    status,
    nextTransitionAt,
  };
}

export function isAlertIncidentActive(incident: Pick<AlertIncident, "status">): boolean {
  return incident.status == "active" || incident.status == "resumed";
}

/**
 * Нужно ли уведомление ОС о новом письме инцидента: только если это первое
 * срабатывание (новый инцидент) или срабатывание после затишья, «решено»
 * или закрытия. Повторы идущего инцидента и письма «resolved» — без уведомления.
 *
 * @param previous Ранее известные письма того же инцидента (без нового)
 */
export function alertMessageOpensIncident(
  message: EMail,
  previous: { lastFiring: number | null; lastResolved: number | null },
  options: { quietMs?: number; closedAt?: number | null; patterns?: readonly RegExp[] } = {},
): boolean {
  let { info } = alertInfoForMessage(message, options.patterns ?? kNoPatterns);
  if (info.polarity == "resolved") {
    return false;
  }
  let { lastFiring, lastResolved } = previous;
  if (lastFiring == null) {
    return true;
  }
  let time = messageTime(message);
  let quietMs = Math.max(0, options.quietMs ?? kDefaultAlertQuietMs);
  let closedAt = options.closedAt ?? null;
  return time - lastFiring > quietMs ||
    (lastResolved != null && lastResolved >= lastFiring) ||
    (closedAt != null && closedAt >= lastFiring);
}

/**
 * Последние срабатывание и «решено» по каждому инциденту — для решения об
 * уведомлении. Один проход по письмам папки.
 */
export function indexAlertIncidentHistory(
  messages: Iterable<EMail>,
  exclude: ReadonlySet<EMail>,
  patterns: readonly RegExp[] = kNoPatterns,
): Map<string, { lastFiring: number | null; lastResolved: number | null }> {
  let history = new Map<string, { lastFiring: number | null; lastResolved: number | null }>();
  for (let message of messages) {
    if (!message || exclude.has(message)) {
      continue;
    }
    let { key, info } = alertInfoForMessage(message, patterns);
    let time = messageTime(message);
    let entry = history.get(key);
    if (!entry) {
      entry = { lastFiring: null, lastResolved: null };
      history.set(key, entry);
    }
    if (info.polarity == "resolved") {
      entry.lastResolved = Math.max(entry.lastResolved ?? time, time);
    } else {
      entry.lastFiring = Math.max(entry.lastFiring ?? time, time);
    }
  }
  return history;
}

export interface AlertFolderSuggestion {
  label: string;
  count: number;
  sampleSize: number;
}

/**
 * Похожа ли папка на папку алертов: много писем с одинаковой нормализованной
 * темой от одного отправителя. Смотрим не больше `sampleLimit` писем, чтобы
 * не делать тяжёлых проходов по огромным папкам.
 */
export function suggestAlertFolder(
  messages: readonly EMail[],
  { sampleLimit = 3000, minGroup = 10, minShare = 0.3, patterns = kNoPatterns }: {
    sampleLimit?: number;
    minGroup?: number;
    minShare?: number;
    patterns?: readonly RegExp[];
  } = {},
): AlertFolderSuggestion | null {
  let sample = messages.length > sampleLimit ? messages.slice(messages.length - sampleLimit) : messages;
  if (sample.length < minGroup) {
    return null;
  }
  let counts = new Map<string, { count: number; message: EMail }>();
  for (let message of sample) {
    if (!message) {
      continue;
    }
    let key = alertIncidentKey(message, patterns);
    let entry = counts.get(key);
    if (entry) {
      entry.count++;
    } else {
      counts.set(key, { count: 1, message });
    }
  }
  let repeated = 0;
  let best: { count: number; message: EMail } | null = null;
  for (let entry of counts.values()) {
    if (entry.count >= 3) {
      repeated += entry.count;
    }
    if (!best || entry.count > best.count) {
      best = entry;
    }
  }
  if (!best || best.count < minGroup || repeated / sample.length < minShare) {
    return null;
  }
  return {
    label: alertInfoForMessage(best.message, patterns).info.template,
    count: best.count,
    sampleSize: sample.length,
  };
}

/**
 * Шаблоны пользователя: по одному регулярному выражению на строку.
 * Ошибочные строки пропускаются, чтобы опечатка не ломала список писем.
 */
let compiledSource: string | null = null;
let compiledPatterns: readonly RegExp[] = kNoPatterns;

export function compileAlertPatterns(lines: readonly string[] | null | undefined): readonly RegExp[] {
  /* Тот же список — тот же массив: от него зависит кэш разбора тем. */
  let source = JSON.stringify(Array.isArray(lines) ? lines : []);
  if (source === compiledSource) {
    return compiledPatterns;
  }
  let result: RegExp[] = [];
  for (let line of lines ?? []) {
    let source = typeof line == "string" ? line.trim() : "";
    if (!source || source.length > 500) {
      continue;
    }
    try {
      result.push(new RegExp(source, "giu"));
    } catch {
      // Неверное выражение пропускаем: его видно в настройках
    }
  }
  compiledSource = source;
  compiledPatterns = result.length ? result : kNoPatterns;
  return compiledPatterns;
}

/** Проверка строки шаблона для настроек. */
export function isValidAlertPattern(source: string): boolean {
  try {
    new RegExp(source, "giu");
    return true;
  } catch {
    return false;
  }
}
