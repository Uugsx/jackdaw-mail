import { describe, expect, test } from "vitest";
import {
  desktopTranslationEnvironment,
  listTranslationLanguages,
  matchesTranslationFilter,
  planTranslationModels,
  translationModelsSize,
  type TranslationModelRecord,
} from "../../../desktop/backend/translationModels";

const kAndroid = "env.appinfo.OS == 'Android' ";
const kNightly = "env.channel == 'default' || env.channel == 'nightly'";
const kDesktop = "env.appinfo.OS != 'Android' || env.channel != 'release'";

function files(from: string, to: string, version: string, filter = "", size = 10, vocab: string[] = ["vocab"]): TranslationModelRecord[] {
  return ["model", "lex", ...vocab].map(fileType => ({
    name: `${fileType}.${from}${to}`,
    fromLang: from,
    toLang: to,
    version,
    fileType,
    filter_expression: filter,
    attachment: { hash: `${from}${to}${version}${fileType}`, size, location: `main/${from}${to}-${version}-${fileType}.bin` },
  }));
}

const env = desktopTranslationEnvironment("darwin");

describe("выбор языковых моделей Firefox Translations", () => {
  test("фильтры Remote Settings для десктопа", () => {
    expect(matchesTranslationFilter("", env)).toBe(true);
    expect(matchesTranslationFilter(kAndroid, env)).toBe(false);
    expect(matchesTranslationFilter(kNightly, env)).toBe(false);
    expect(matchesTranslationFilter(kDesktop, env)).toBe(true);
    expect(matchesTranslationFilter(kDesktop, { os: "Android", channel: "release" })).toBe(false);
    expect(() => matchesTranslationFilter("env.locale == 'ru'", env)).toThrow();
  });

  test("берётся новейшая выпущенная версия для десктопа, без альф и Android", () => {
    let records = [
      ...files("en", "ru", "1.0", ""),
      ...files("en", "ru", "2.0", kDesktop),
      ...files("en", "ru", "2.1", kAndroid),
      ...files("en", "ru", "2.1a1", kNightly),
      ...files("en", "ru", "3.0a1", ""),
    ];
    let plan = planTranslationModels(records, "en", "ru", env);
    expect(plan.map(model => model.version)).toEqual(["2.0"]);
  });

  test("неполная версия пропускается", () => {
    let records = [
      ...files("en", "fr", "1.0"),
      ...files("en", "fr", "2.0").filter(record => record.fileType != "lex"),
    ];
    expect(planTranslationModels(records, "en", "fr", env)[0].version).toBe("1.0");
  });

  test("раздельные словари исходного и целевого языка", () => {
    let records = files("ja", "en", "1.0", "", 10, ["srcvocab", "trgvocab"]);
    let [model] = planTranslationModels(records, "ja", "en", env);
    expect(model.vocabs.map(vocab => vocab.fileType)).toEqual(["srcvocab", "trgvocab"]);
  });

  test("пара без прямой модели — через английский", () => {
    let records = [...files("de", "en", "1.0"), ...files("en", "ru", "1.0")];
    let plan = planTranslationModels(records, "de", "ru", env);
    expect(plan.map(model => `${model.from}-${model.to}`)).toEqual(["de-en", "en-ru"]);
    expect(translationModelsSize(plan)).toBe(60);
  });

  test("нет модели — null", () => {
    let records = files("de", "en", "1.0");
    expect(planTranslationModels(records, "de", "ru", env)).toBeNull();
    expect(planTranslationModels(records, "en", "en", env)).toBeNull();
  });

  test("список языков учитывает перевод через английский", () => {
    let records = [...files("de", "en", "1.0"), ...files("en", "ru", "1.0"), ...files("fr", "en", "1.0", kAndroid)];
    expect(listTranslationLanguages(records, env)).toEqual({ from: ["de", "en"], to: ["en", "ru"] });
  });
});
