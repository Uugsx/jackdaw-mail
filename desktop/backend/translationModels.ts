/**
 * Выбор языковых моделей Firefox Translations для перевода писем на устройстве.
 *
 * Список моделей публикует Mozilla в Remote Settings (коллекция
 * `translations-models`). В нём лежат все версии всех пар языков, в том числе
 * альфа-версии для Nightly и отдельные сборки для Android. Здесь только
 * чистая логика выбора, без сети и файлов, чтобы её можно было проверить тестами.
 */

export type TranslationModelFileType = "model" | "lex" | "vocab" | "srcvocab" | "trgvocab";

export interface TranslationModelRecord {
  name: string;
  fromLang: string;
  toLang: string;
  version: string;
  fileType: TranslationModelFileType | string;
  filter_expression?: string;
  attachment: {
    hash: string;
    size: number;
    location: string;
  };
}

export interface TranslationModelFiles {
  from: string;
  to: string;
  version: string;
  model: TranslationModelRecord;
  lex: TranslationModelRecord;
  /** Один общий словарь или два: исходного и целевого языка */
  vocabs: TranslationModelRecord[];
}

export interface TranslationModelEnvironment {
  /** Как в Firefox: `Darwin`, `WINNT`, `Linux` */
  os: string;
  channel: string;
}

/** Язык-посредник: пары без прямой модели переводятся через английский */
export const kPivotLanguage = "en";

export function desktopTranslationEnvironment(platform: string): TranslationModelEnvironment {
  let os = platform == "darwin" ? "Darwin" : platform == "win32" ? "WINNT" : "Linux";
  return { os, channel: "release" };
}

/**
 * Проверяет `filter_expression` записи для нашей среды.
 * Поддерживаются только сравнения `env.appinfo.OS` и `env.channel` со строкой
 * через `==`/`!=`, объединённые `||` и `&&` (других в коллекции нет).
 * Незнакомое выражение — запись не для нас.
 */
export function matchesTranslationFilter(expression: string | undefined | null, env: TranslationModelEnvironment): boolean {
  let source = (expression ?? "").trim();
  if (!source) {
    return true;
  }
  return source.split("||").some(alternative =>
    alternative.split("&&").every(condition => matchesCondition(condition.trim(), env)));
}

function matchesCondition(condition: string, env: TranslationModelEnvironment): boolean {
  let match = /^env\.(appinfo\.OS|channel)\s*(==|!=)\s*'([^']*)'$/.exec(condition);
  if (!match) {
    throw new Error("Unknown filter");
  }
  let [, field, operator, expected] = match;
  let actual = field == "channel" ? env.channel : env.os;
  return operator == "==" ? actual == expected : actual != expected;
}

function safeMatchesFilter(expression: string | undefined | null, env: TranslationModelEnvironment): boolean {
  try {
    return matchesTranslationFilter(expression, env);
  } catch {
    return false;
  }
}

/** Только выпущенные версии: `2.1`, но не `2.1a1` */
function parseStableVersion(version: string): number[] | null {
  if (!/^\d+(\.\d+)*$/.test(version ?? "")) {
    return null;
  }
  return version.split(".").map(Number);
}

function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    let diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff) {
      return diff;
    }
  }
  return 0;
}

/**
 * Самая новая выпущенная полная модель для пары `from` → `to`.
 * @returns null, если прямой модели нет
 */
export function pickTranslationModelFiles(
  records: TranslationModelRecord[],
  from: string,
  to: string,
  env: TranslationModelEnvironment,
): TranslationModelFiles | null {
  let byVersion = new Map<string, TranslationModelRecord[]>();
  for (let record of records) {
    if (record?.fromLang != from || record.toLang != to || !record.attachment?.location) {
      continue;
    }
    if (!parseStableVersion(record.version) || !safeMatchesFilter(record.filter_expression, env)) {
      continue;
    }
    let list = byVersion.get(record.version) ?? [];
    list.push(record);
    byVersion.set(record.version, list);
  }
  let versions = [...byVersion.keys()]
    .sort((a, b) => compareVersions(parseStableVersion(b) ?? [], parseStableVersion(a) ?? []));
  for (let version of versions) {
    let files = completeModelFiles(byVersion.get(version) ?? [], from, to, version);
    if (files) {
      return files;
    }
  }
  return null;
}

function completeModelFiles(
  list: TranslationModelRecord[],
  from: string,
  to: string,
  version: string,
): TranslationModelFiles | null {
  let ofType = (type: string) => list.find(record => record.fileType == type);
  let model = ofType("model");
  let lex = ofType("lex");
  let vocab = ofType("vocab");
  let srcVocab = ofType("srcvocab");
  let trgVocab = ofType("trgvocab");
  let vocabs = vocab ? [vocab] : srcVocab && trgVocab ? [srcVocab, trgVocab] : null;
  if (!model || !lex || !vocabs) {
    return null;
  }
  return { from, to, version, model, lex, vocabs };
}

/**
 * Цепочка моделей для перевода: прямая пара или через английский.
 * @returns null, если перевести нельзя
 */
export function planTranslationModels(
  records: TranslationModelRecord[],
  from: string,
  to: string,
  env: TranslationModelEnvironment,
): TranslationModelFiles[] | null {
  if (!from || !to || from == to) {
    return null;
  }
  let direct = pickTranslationModelFiles(records, from, to, env);
  if (direct) {
    return [direct];
  }
  if (from == kPivotLanguage || to == kPivotLanguage) {
    return null;
  }
  let toPivot = pickTranslationModelFiles(records, from, kPivotLanguage, env);
  let fromPivot = pickTranslationModelFiles(records, kPivotLanguage, to, env);
  return toPivot && fromPivot ? [toPivot, fromPivot] : null;
}

/** Языки, с которых и на которые можно перевести (с учётом перевода через английский) */
export function listTranslationLanguages(
  records: TranslationModelRecord[],
  env: TranslationModelEnvironment,
): { from: string[]; to: string[] } {
  let languages = new Set<string>();
  for (let record of records) {
    if (record?.fromLang) {
      languages.add(record.fromLang);
    }
    if (record?.toLang) {
      languages.add(record.toLang);
    }
  }
  let toPivot = new Set<string>();
  let fromPivot = new Set<string>();
  for (let language of languages) {
    if (language == kPivotLanguage) {
      continue;
    }
    if (pickTranslationModelFiles(records, language, kPivotLanguage, env)) {
      toPivot.add(language);
    }
    if (pickTranslationModelFiles(records, kPivotLanguage, language, env)) {
      fromPivot.add(language);
    }
  }
  let from = [...toPivot];
  let to = [...fromPivot];
  if (fromPivot.size) {
    from.push(kPivotLanguage);
  }
  if (toPivot.size) {
    to.push(kPivotLanguage);
  }
  return { from: from.sort(), to: to.sort() };
}

/** Сколько байт нужно скачать для этих моделей */
export function translationModelsSize(models: TranslationModelFiles[]): number {
  let total = 0;
  for (let files of models) {
    for (let record of [files.model, files.lex, ...files.vocabs]) {
      total += record.attachment.size ?? 0;
    }
  }
  return total;
}
