import { describe, expect, test } from "vitest";
import { detectLanguage, mainBodyText } from "../../../../logic/Mail/Translate/languageDetect";

function language(text: string): string | null {
  return detectLanguage(text)?.language ?? null;
}

describe("определение языка письма", () => {
  test("английское деловое письмо", () => {
    expect(language("Hello Alex, please find attached the shipment report for October. " +
      "Let me know if you have any questions. Kind regards, John")).toBe("en");
  });

  test("русское письмо", () => {
    expect(language("Добрый день! Прошу проверить отчёт о доставке за октябрь и сообщить, " +
      "если есть вопросы. С уважением, Иван")).toBe("ru");
  });

  test("украинский не путается с русским", () => {
    expect(language("Доброго дня! Надсилаю звіт про доставку за жовтень. Якщо є питання, " +
      "будь ласка, напишіть мені. З повагою, Олена")).toBe("uk");
  });

  test("немецкий, французский и испанский", () => {
    expect(language("Sehr geehrte Damen und Herren, die Lieferung ist für Montag geplant. " +
      "Bitte prüfen Sie die Unterlagen. Mit freundlichen Grüßen")).toBe("de");
    expect(language("Bonjour, nous vous remercions pour votre commande. La livraison est prévue " +
      "pour lundi. Cordialement, le service client")).toBe("fr");
    expect(language("Hola, gracias por su pedido. La entrega está prevista para el lunes. " +
      "Si tiene alguna pregunta, no dude en contactarnos. Saludos")).toBe("es");
  });

  test("японский, китайский и корейский — по письменности", () => {
    expect(language("お世話になっております。来週の会議の資料を添付いたしますので、ご確認ください。")).toBe("ja");
    expect(language("您好，我们已经收到您的订单，这个包裹将在下周一发货。如有问题请联系我们。")).toBe("zh-Hans");
    expect(language("您好，我們已經收到您的訂單，這個包裹將在下週一發貨。如有問題請聯繫我們。")).toBe("zh-Hant");
    expect(language("안녕하세요, 주문해 주셔서 감사합니다. 배송은 다음 주 월요일에 예정되어 있습니다.")).toBe("ko");
  });

  test("короткий текст, ссылки и числа — язык не определяется", () => {
    expect(detectLanguage("OK")).toBeNull();
    expect(detectLanguage("")).toBeNull();
    expect(detectLanguage(null)).toBeNull();
    expect(detectLanguage("https://example.com/track?id=123456789 0123 4567 8910 john@example.com")).toBeNull();
  });

  test("русское письмо с английской подписью остаётся русским", () => {
    expect(language("Коллеги, добрый день! Отправляю обновлённый график поставок на следующую неделю, " +
      "прошу подтвердить получение до пятницы. Спасибо!\n--\nBest regards, DPD Team")).toBe("ru");
  });

  test("английский ответ с русской подписью и цепочкой Outlook — английский", () => {
    // Как письмо «RE: [TEC][DPD KZ] - Relabel orders»: под ответом русская подпись,
    // реквизиты и длинная цепочка с заголовками, именами и кодами заказов
    let orders = Array.from({ length: 60 }, (_, i) => `KZ-ALA-${100200 + i} Inditex Zara Bershka Pull Stradivarius Massimo Dutti relabel pending`).join("\n");
    let text = [
      "Good afternoon.",
      "",
      "We have resolved the issue on our end.",
      "Are you still encountering the error?",
      "If so, please provide the IP addresses from which you are sending the requests, as well as the specific error you are receiving.",
      "",
      "We will forward this to our administrators for further investigation.",
      "",
      "С уважением,",
      "Левченко Никита",
      "Старший инженер по сопровождению программного обеспечения | Отдел по сопровождению стандартной и индивидуальной интеграции",
      "+7 (495) 775 42 75 доб. 1065| Nikita.levchenko@smartds.ru",
      "ООО «Смарт ДС Рус», ул. Барабанный пер., д.3, 107023 Москва, Россия | smartds.ru",
      "",
      "From: TEC Support <tec.support@inditex.com>",
      "Sent: Wednesday, October 21, 2026 12:02 PM",
      "To: integrators <integrators@smartds.ru>; Kurbatova Yuliya ALA <Yuliya.Kurbatova@dpd.kz>",
      "Cc: Lidia Cundins Balsas; Samuel Piñeiro Sande; Andres GentoBlanco; Marta Mariñas Rojo; Titov Yuriy MOW",
      "Subject: RE: [TEC][DPD KZ] - Relabel orders",
      "Buenos días, Muchas gracias. Saludos, Lidia",
      "Добрый день, коллеги! Просим проверить перемаркировку заказов, список ниже.",
      orders,
    ].join("\n");
    expect(language(text)).toBe("en");
  });

  test("основной текст — до цитаты или подписи; без них — весь текст", () => {
    expect(mainBodyText("Hello team\nPlease check\n-----Original Message-----\nFrom: x")).toBe("Hello team\nPlease check");
    expect(mainBodyText("Hi\nOn Mon, Oct 20, 2026 John wrote:\n> old")).toBe("Hi");
    expect(mainBodyText("Привет\n20.10.2026 Иван написал(а):\n> старое")).toBe("Привет");
    expect(mainBodyText("Text\nBest regards,\nJohn")).toBe("Text");
    expect(mainBodyText("Text\n--\nJohn")).toBe("Text");
    expect(mainBodyText("Just one paragraph without signature")).toBe("Just one paragraph without signature");
    // Строка «From: …» в самом начале — цитата без ответа: определяем по всему тексту
    expect(mainBodyText("From: a@b.c\nhello")).toBe("From: a@b.c\nhello");
  });

  test("уверенность от 0 до 1", () => {
    let detected = detectLanguage("This is a short note about the delivery of the parcel to the warehouse.");
    expect(detected?.language).toBe("en");
    expect(detected.confidence).toBeGreaterThan(0.5);
    expect(detected.confidence).toBeLessThanOrEqual(1);
  });
});
