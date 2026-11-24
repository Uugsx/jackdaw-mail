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

import { looksLikeCodeOrNoise } from "../../../../frontend/Mail/Message/messageTranslation";

describe("looksLikeCodeOrNoise", () => {
  test("разметка, JSON и разделители не переводятся", () => {
    expect(looksLikeCodeOrNoise("&lt;infoParam&gt;")).toBe(true);
    expect(looksLikeCodeOrNoise('"name": "value"')).toBe(true);
    expect(looksLikeCodeOrNoise("........ ........")).toBe(true);
    expect(looksLikeCodeOrNoise("Open the portal, please")).toBe(false);
    expect(looksLikeCodeOrNoise("Ок")).toBe(false);
  });
});

import { isMessageHeaderLine } from "../../../../frontend/Mail/Message/messageTranslation";

describe("шапки и подписи", () => {
  test("строки-заголовки пересланного письма", () => {
    expect(isMessageHeaderLine("From: Burcu UCUZAL <burcu@flo.com.tr>")).toBe(true);
    expect(isMessageHeaderLine("Отправлено: Вторник, 24 Ноября 2026 16:52")).toBe(true);
    expect(isMessageHeaderLine("To: integrators &lt;integrators@smartds.ru&gt;")).toBe(true);
    expect(isMessageHeaderLine("To be or not to be: that is the question")).toBe(false);
  });
  test("подпись после «С уважением» пропускается до следующей шапки", () => {
    let skip = segmentSkipper("online", null, "en");
    expect(skip(ru)).toBe(false);
    expect(skip("С уважением,")).toBe(true);
    expect(skip("Старший инженер по сопровождению программного обеспечения")).toBe(true);
    expect(skip("From: A <a@b.c>")).toBe(true);
    expect(skip(ru)).toBe(false);
  });
});
