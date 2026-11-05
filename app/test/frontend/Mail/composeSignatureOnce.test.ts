// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// app первым: иначе циклический импорт моделей ломает загрузку ComposeActions
import "../../../logic/app";
import { splitComposeQuote } from "../../../frontend/Mail/Composer/composeQuote";
import { ComposeActions } from "../../../logic/Mail/ComposeActions";
import { EMail } from "../../../logic/Mail/EMail";
import { Folder } from "../../../logic/Mail/Folder";
import { MailAccount } from "../../../logic/Mail/MailAccount";

// Подпись как у владельца (OWA): блок с именем, разделитель <hr>, логотип и адрес
const signatureWithRule = `<p>С уважением<br><strong>Никита Галкин</strong></p>`
  + `<p>+7 (495) 775 42 75 доб. 1107</p><hr><img src="data:image/png;base64,AA==" width="180" height="44">`
  + `<p>ООО «Смарт ДС Рус»</p>`;
const otherSignature = `<p>Другая подпись</p>`;

function compose(): ComposeActions {
  return new ComposeActions(new EMail(new Folder(new MailAccount())));
}

function count(html: string, text: string): number {
  return html.split(text).length - 1;
}

describe("подпись вставляется ровно один раз", () => {
  beforeEach(() => {
    let store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("<hr> внутри подписи не считается началом цитаты", () => {
    let body = compose().applySignatureHTML("", signatureWithRule);
    let { editable, quote } = splitComposeQuote(body);
    expect(quote).toBe("");
    expect(editable).toContain("ООО «Смарт ДС Рус»");
  });

  it("новое письмо: повторная вставка не удваивает подпись", () => {
    let actions = compose();
    let body = actions.applySignatureHTML("", signatureWithRule);
    body = actions.applySignatureHTML(body, signatureWithRule);
    body = actions.applySignatureHTML(body, signatureWithRule);
    expect(count(body, "Никита Галкин")).toBe(1);
    expect(count(body, "ООО «Смарт ДС Рус»")).toBe(1);
    expect(count(body, "<footer")).toBe(1);
  });

  it("ответ: подпись одна, цитата на месте", () => {
    let actions = compose();
    let reply = `<p></p><p></p><blockquote cite="mid:1"><p>Исходное</p><hr><p>старое</p></blockquote>`;
    let body = actions.applySignatureHTML(reply, signatureWithRule);
    body = actions.applySignatureHTML(body, signatureWithRule);
    expect(count(body, "Никита Галкин")).toBe(1);
    expect(count(body, "ООО «Смарт ДС Рус»")).toBe(1);
    expect(count(body, "Исходное")).toBe(1);
    expect(body.indexOf("</footer>")).toBeLessThan(body.indexOf("<blockquote"));
  });

  it("пересылка: подпись одна и стоит над пересылаемым письмом", () => {
    let actions = compose();
    let forward = `<p></p><hr><p class="forward-header">From: a@b.test</p><p>Текст пересылки</p>`;
    let body = actions.applySignatureHTML(forward, signatureWithRule);
    body = actions.applySignatureHTML(body, signatureWithRule);
    expect(count(body, "Никита Галкин")).toBe(1);
    expect(count(body, "ООО «Смарт ДС Рус»")).toBe(1);
    expect(body.indexOf("</footer>")).toBeLessThan(body.indexOf("forward-header"));
    let { quote } = splitComposeQuote(body);
    expect(quote).toMatch(/^<hr>\s*<p class="forward-header"/);
  });

  it("смена отправителя заменяет подпись целиком", () => {
    let actions = compose();
    let body = actions.applySignatureHTML("<p>Текст</p>", signatureWithRule);
    body = actions.applySignatureHTML(body, otherSignature);
    expect(body).not.toContain("Никита Галкин");
    expect(body).not.toContain("ООО «Смарт ДС Рус»");
    expect(count(body, "Другая подпись")).toBe(1);
    expect(body).toContain("<p>Текст</p>");
    body = actions.applySignatureHTML(body, signatureWithRule);
    expect(body).not.toContain("Другая подпись");
    expect(count(body, "ООО «Смарт ДС Рус»")).toBe(1);
  });

  it("<hr> вне подписи по-прежнему отделяет цитату другого клиента", () => {
    let { editable, quote } = splitComposeQuote(`<p>Привет</p><hr><p>From: x</p>`);
    expect(editable).toBe("<p>Привет</p>");
    expect(quote).toBe(`<hr><p>From: x</p>`);
  });
});
