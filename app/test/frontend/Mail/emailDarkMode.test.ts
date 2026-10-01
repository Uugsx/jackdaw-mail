// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";
import {
  adaptEmailHtmlForDarkMode,
  adaptInlineStyle,
  adaptTextColor,
  parseCssColor,
} from "../../../frontend/Mail/Message/emailDarkMode";

describe("emailDarkMode", () => {
  test("navy становится светло-синим, не белым", () => {
    let adapted = adaptTextColor("#000080");
    expect(adapted).not.toBe("#e5e7eb");
    let rgb = parseCssColor(adapted!);
    expect(rgb!.b).toBeGreaterThan(rgb!.r);
  });

  test("оранжевый остаётся оранжевым, но светлее", () => {
    let adapted = adaptTextColor("#cc6600");
    expect(adapted).toMatch(/^#/);
    let rgb = parseCssColor(adapted!);
    expect(rgb!.r).toBeGreaterThan(rgb!.b);
  });

  test("светлый текст не меняется", () => {
    expect(adaptTextColor("#f0f0f0")).toBeNull();
  });

  test("белый фон в inline style убирается", () => {
    expect(adaptInlineStyle("background-color: #ffffff; color: navy"))
      .toContain("background-color: transparent");
  });

  test("насыщенная подсветка Outlook сохраняется в тёмной теме", () => {
    let html = `<html><body><span style="background-color: #00ff00">Выделенный текст</span></body></html>`;
    let out = adaptEmailHtmlForDarkMode(html);
    expect(out).toContain("background-color: #006600");
    expect(out).not.toContain("background-color: transparent");
  });

  test("html с font color адаптирует оттенки", () => {
    let html = `<html><body><font color="#000080">Data</font><font color="#cc6600">Error</font></body></html>`;
    let out = adaptEmailHtmlForDarkMode(html);
    expect(out).not.toContain('color="#000080"');
    expect(out).not.toContain('color="#cc6600"');
    expect(out).toMatch(/color="#[0-9a-f]{6}"/i);
  });

  test("style-блоки адаптируют navy и orange", () => {
    let html = `<html><head><style>.data { color: #000080; } .err { color: #cc6600; }</style></head><body><p class="data">Data</p></body></html>`;
    let out = adaptEmailHtmlForDarkMode(html);
    expect(out).not.toContain("#000080");
    expect(out).not.toContain("#cc6600");
  });

  test("чёрный и тёмно-серый текст становятся читаемыми", () => {
    expect(adaptTextColor("#000000")).toBe("#e5e7eb");
    expect(adaptTextColor("#7f7f7f")).toBe("#e5e7eb");
    expect(adaptTextColor("black")).toBe("#e5e7eb");
    expect(adaptTextColor("windowtext")).toBe("#e5e7eb");
  });

  test("inline style с !important адаптируется", () => {
    expect(adaptInlineStyle("color: #000000 !important;"))
      .toContain("color: #e5e7eb");
  });

  test("outlook data-ogsc/data-ogsb адаптируются", () => {
    let html = `<html><body><span data-ogsc="#000000" data-ogsb="#ffffff">Text</span></body></html>`;
    let out = adaptEmailHtmlForDarkMode(html);
    expect(out).toContain("color: #e5e7eb");
    expect(out).toContain("background-color: transparent");
  });

  test("типичное word/html письмо: тёмный текст и mailto", () => {
    let html = `<html><body>
      <p style="color:#212121">Коллеги, добрый день!</p>
      <p><span style="color:#0563C1">elki23@yandex.ru</span><span style="color:#212121">, сможете связаться</span></p>
      <p style="color:#7F7F7F">АО «ДПД РУС»</p>
    </body></html>`;
    let out = adaptEmailHtmlForDarkMode(html);
    expect(out).not.toContain("#212121");
    expect(out).not.toContain("#7F7F7F");
    expect(out).not.toContain("#0563C1");
  });
});
