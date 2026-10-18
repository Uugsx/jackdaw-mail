import { expect, test } from "vitest";
import en from "../../l10n/locales/en/messages.json";
import { fullyTranslatedLocales } from "../../l10n/list";
import { loadLanguageMessages, languageMessages } from "../../l10n/messagesLoader";

/** Плейсхолдеры `{0}` и `{num}` должны совпадать с исходной строкой,
 * иначе подстановка значений молча ломается. Текст внутри вариантов plural
 * (`one {day}`) и `#` не сравниваются: в переводе бывает больше форм. */
function placeholders(message: string): string[] {
  let found = message.match(/\{(?:\d+|num)(?=[},])/g) ?? [];
  return [...new Set(found)].sort();
}

for (let locale of fullyTranslatedLocales) {
  test(`каталог ${locale} содержит перевод каждой строки исходного каталога`, async () => {
    await loadLanguageMessages(locale);
    let messages = languageMessages[locale];
    let untranslated = Object.entries(en)
      .filter(([id]) => !messages[id])
      .map(([id, message]) => `${id}: ${message}`);

    expect(untranslated).toEqual([]);
  });

  test(`переводы ${locale} сохраняют плейсхолдеры исходных строк`, async () => {
    await loadLanguageMessages(locale);
    let messages = languageMessages[locale];
    let mismatched = Object.entries(en)
      .filter(([id]) => messages[id])
      .filter(([id, message]) =>
        placeholders(message).join() != placeholders(messages[id]).join())
      .map(([id, message]) => `${id}: ${message} => ${messages[id]}`);

    expect(mismatched).toEqual([]);
  });
}
