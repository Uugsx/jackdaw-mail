import {
  checkTemplateName, inlineImageDataURLs, isTemplateEmpty, kMaxTemplateNameLength, newTemplateAttachments,
  subjectAfterTemplate, templateBodyFromEditor, templateNameFromSubject,
} from "../../../../logic/Mail/Templates/MailTemplate";
import type { ComposeWindowAttachment } from "../../../../logic/Mail/Composer/ComposeWindowProtocol";
import { describe, expect, test } from "vitest";

function attachment(filename: string, size: number): ComposeWindowAttachment {
  return {
    filename, filepathLocal: null, mimeType: "text/plain", size,
    disposition: "attachment", related: false, contentID: null, contentBase64: "",
  };
}

describe("название", () => {
  test("из темы: пробелы схлопнуты, длина ограничена", () => {
    expect(templateNameFromSubject("  Счёт \n на оплату ")).toBe("Счёт на оплату");
    expect(templateNameFromSubject(null)).toBe("");
    expect(templateNameFromSubject("я".repeat(200))).toHaveLength(kMaxTemplateNameLength);
  });

  test("пустое, длинное и повтор без учёта регистра", () => {
    let existing = [{ id: 1, name: "Счёт" }, { id: 2, name: "Акт" }];
    expect(checkTemplateName("  ", existing)).toBe("empty");
    expect(checkTemplateName("я".repeat(kMaxTemplateNameLength + 1), existing)).toBe("too-long");
    expect(checkTemplateName(" СЧЁТ ", existing)).toBe("duplicate");
    expect(checkTemplateName("Счёт", existing, 1)).toBeNull();
    expect(checkTemplateName("Договор", existing)).toBeNull();
  });
});

describe("тело", () => {
  test("подпись и пустые абзацы в конце убираются", () => {
    let html = `<p>Добрый день!</p><p></p><footer class="signature"><p>Иван</p></footer><p><br></p>`;
    expect(templateBodyFromEditor(html)).toBe("<p>Добрый день!</p>");
    expect(templateBodyFromEditor(null)).toBe("");
  });

  test("пустой шаблон", () => {
    expect(isTemplateEmpty({ subject: " ", html: "<p>&nbsp;</p>", attachments: [] })).toBe(true);
    expect(isTemplateEmpty({ subject: "", html: `<p><img src="data:image/png;base64,AA"></p>`, attachments: [] })).toBe(false);
    expect(isTemplateEmpty({ subject: "", html: "", attachments: [attachment("a.txt", 1)] })).toBe(false);
    expect(isTemplateEmpty({ subject: "Тема", html: "", attachments: [] })).toBe(false);
  });

  test("встроенные картинки без повторов", () => {
    let png = "data:image/png;base64,AAAA";
    let html = `<p><img src="${png}" alt="a"><img alt='b' src='${png}'><img src="https://example.com/x.png"></p>`;
    expect(inlineImageDataURLs(html)).toEqual([png]);
  });
});

describe("вставка", () => {
  test("тема шаблона только в пустую тему", () => {
    expect(subjectAfterTemplate("", "Счёт")).toBe("Счёт");
    expect(subjectAfterTemplate("   ", "Счёт")).toBe("Счёт");
    expect(subjectAfterTemplate(null, "Счёт")).toBe("Счёт");
    expect(subjectAfterTemplate("Re: вопрос", "Счёт")).toBe("Re: вопрос");
  });

  test("повторная вставка не дублирует вложения", () => {
    let template = [attachment("a.txt", 1), attachment("b.txt", 2)];
    expect(newTemplateAttachments(template, [{ filename: "a.txt", size: 1 }])).toEqual([template[1]]);
    expect(newTemplateAttachments(template, [{ filename: "a.txt", size: 5 }])).toEqual(template);
    expect(newTemplateAttachments(template, [])).toEqual(template);
  });
});
