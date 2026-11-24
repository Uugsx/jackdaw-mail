import { describe, expect, test } from "vitest";
import { segmentSkipper } from "../../../../frontend/Mail/Message/messageTranslation";

const ru = "Добрый день! Прошу проверить отправку заказа, потому что курьер не приехал в назначенное время.";
const en = "Hello team, please check the shipment of the order because the courier did not arrive on time today.";
const tr = "Merhaba, siparişin gönderimini kontrol eder misiniz, çünkü kurye belirtilen zamanda gelmedi.";

describe("segmentSkipper", () => {
  test("часть на языке перевода не переводится никогда", () => {
    for (let engine of ["local", "deepl", "online"] as const) {
      expect(segmentSkipper(engine, "tr", "ru")(ru)).toBe(true);
    }
  });
  test("local: посторонний язык пропускается, язык источника переводится", () => {
    let skip = segmentSkipper("local", "tr", "ru");
    expect(skip(en)).toBe(true);
    expect(skip(tr)).toBe(false);
  });
  test("online/deepl: чужой язык отдаётся сервису", () => {
    expect(segmentSkipper("online", null, "ru")(en)).toBe(false);
  });
  test("короткий текст не определяется — переводится", () => {
    expect(segmentSkipper("local", "tr", "ru")("Ok")).toBe(false);
  });
});
