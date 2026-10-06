// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { getComposeLinkURL } from "../../../frontend/Mail/Composer/composeLink";

describe("ссылки в отдельном окне композера", () => {
  it("находит ссылку по вложенному элементу и добавляет https к домену", () => {
    let root = document.createElement("div");
    root.innerHTML = `<a href="smartds.ru"><span>SmartDS</span></a>`;
    let text = root.querySelector("span");

    expect(getComposeLinkURL(text)).toBe("https://smartds.ru/");
  });

  it("разрешает mailto и tel, но не перехватывает небезопасные протоколы", () => {
    let root = document.createElement("div");
    root.innerHTML = `
      <a id="mail" href="mailto:test@example.com">Почта</a>
      <a id="phone" href="tel:+74957754275">Телефон</a>
      <a id="script" href="javascript:alert(1)">Скрипт</a>
      <a id="relative" href="/relative">Относительная</a>
    `;

    expect(getComposeLinkURL(root.querySelector("#mail"))).toBe("mailto:test@example.com");
    expect(getComposeLinkURL(root.querySelector("#phone"))).toBe("tel:+74957754275");
    expect(getComposeLinkURL(root.querySelector("#script"))).toBeNull();
    expect(getComposeLinkURL(root.querySelector("#relative"))).toBeNull();
  });
});
