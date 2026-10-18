import en from './locales/en/messages.json';
import { sourceLocale } from './list';

type Messages = Record<string, string>;

/* Каждый язык — отдельный чанк: раньше все ~45 переводов (≈2.7 МБ) лежали
 * в основном бандле и разбирались при каждом запуске. */
const loaders = import.meta.glob<Messages>('./locales/*/messages.json', { import: 'default' });

/** Уже загруженные переводы. Исходный язык нужен всегда как запасной, поэтому он в основном чанке. */
export const languageMessages: Record<string, Messages> = { [sourceLocale]: en };

function loaderPath(lang: string): string {
  return `./locales/${lang}/messages.json`;
}

/** Есть ли в сборке перевод на этот язык (загружен он или нет) */
export function hasLanguageMessages(lang: string): boolean {
  return !!languageMessages[lang] || !!loaders[loaderPath(lang)];
}

/** Загружает перевод, если он есть в сборке и ещё не загружен */
export async function loadLanguageMessages(lang: string): Promise<void> {
  if (languageMessages[lang]) {
    return;
  }
  let load = loaders[loaderPath(lang)];
  if (!load) {
    return;
  }
  languageMessages[lang] = await load();
}
