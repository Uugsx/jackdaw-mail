// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import LinkFeature from "@tiptap/extension-link";
import {
  darkBackgroundColor,
  darkBlockStyle,
  htmlWithoutDarkColorMarks,
  kDarkBackgroundAttr,
  kDarkTextColorAttr,
  markDarkColors,
  readableDarkTextColor,
  textContrastOnDark,
  type ComputedColors,
} from "../../../frontend/Mail/Composer/composeDarkColors";
import { parseCssColor } from "../../../frontend/Mail/Message/emailDarkMode";
import { composeEditorExtensions } from "../../../frontend/Shared/Editor/composeEditorExtensions";
import { buildDarkModeDecorations, darkModeColorsKey } from "../../../frontend/Shared/Editor/DarkModeColors";

/** Подпись из письма HENDERSON: тёмные цвета Outlook на светлом фоне. */
const kHendersonSignature =
  `<p style="color:#595959">С наилучшими пожеланиями,</p>` +
  `<p><b><span style="color:#1F3864">Камил Ибрагимов</span></b><span style="color:#7F7F7F"> | Тестировщик</span></p>` +
  `<p><b><span style="color:#404040">Дом Моды HENDERSON</span></b></p>` +
  `<p><span style="color:#7F7F7F">тел.: </span><a href="tel:+74957999300"><span style="color:#0563C1">+7 495 7 999 300</span></a></p>` +
  `<table><tbody><tr><td bgcolor="#FFFFFF" style="background-color:#F2F2F2">` +
  `<span style="color:windowtext">From:</span> Камил</td></tr></tbody></table>`;

/** Цвета из inline style и наследование — как getComputedStyle, но детерминированно. */
function inlineColors(root: HTMLElement): (el: Element) => ComputedColors {
  let defaultColor = "rgb(229, 231, 235)";
  return el => {
    let color = "";
    let current: Element | null = el;
    while (current && current !== root && !color) {
      color = (current as HTMLElement).style.color;
      current = current.parentElement;
    }
    let element = el as HTMLElement;
    return {
      color: color || defaultColor,
      backgroundColor: element.style.backgroundColor || element.getAttribute("bgcolor") || "rgba(0, 0, 0, 0)",
    };
  };
}

describe("composeDarkColors: преобразование цветов", () => {
  test.each([
    "#1F3864", "#002060", "#0563C1", "#595959", "#7F7F7F", "#404040", "#000000",
    "#C00000", "#00B050", "#7030A0", "#C55A11", "windowtext", "navy", "rgb(31, 56, 100)",
  ])("%s читается на тёмном фоне не хуже WCAG AA", color => {
    let adapted = readableDarkTextColor(color);
    expect(adapted).toMatch(/^#[0-9a-f]{6}$/);
    expect(textContrastOnDark(parseCssColor(adapted!)!)).toBeGreaterThanOrEqual(4.5);
  });

  test("тёмно-синее имя остаётся синим, как в Outlook", () => {
    let rgb = parseCssColor(readableDarkTextColor("#1F3864")!)!;
    expect(rgb.b).toBeGreaterThan(rgb.r);
    expect(rgb.b).toBeGreaterThan(rgb.g);
  });

  test("тёмно-красный остаётся красным", () => {
    let rgb = parseCssColor(readableDarkTextColor("#C00000")!)!;
    expect(rgb.r).toBeGreaterThan(rgb.g);
    expect(rgb.r).toBeGreaterThan(rgb.b);
  });

  test("светлый текст не меняется", () => {
    expect(readableDarkTextColor("#f0f0f0")).toBeNull();
    expect(readableDarkTextColor("rgb(229, 231, 235)")).toBeNull();
  });

  test("прозрачный текст остаётся скрытым", () => {
    expect(readableDarkTextColor("rgba(0, 0, 0, 0)")).toBeNull();
    expect(readableDarkTextColor("transparent")).toBeNull();
  });

  test("светлые фоны затемняются, прозрачные не трогаются", () => {
    expect(darkBackgroundColor("#FFFFFF")).toBe("transparent");
    expect(darkBackgroundColor("rgba(0, 0, 0, 0)")).toBeNull();
    expect(darkBackgroundColor("transparent")).toBeNull();
    let highlight = parseCssColor(darkBackgroundColor("#FFFF00")!)!;
    expect(highlight.r + highlight.g + highlight.b).toBeLessThan(255);
  });

  test("стиль блока TipTap: цвет и фон адаптируются, мусор игнорируется", () => {
    let style = darkBlockStyle("margin: 0; color: #1F3864; background-color: #FFFFFF");
    expect(style).toMatch(/^color: #[0-9a-f]{6}; background-color: transparent$/);
    expect(darkBlockStyle("background: url(x.png) no-repeat; color: inherit")).toBeNull();
    expect(darkBlockStyle(null, "#FFFFFF")).toBe("background-color: transparent");
    expect(darkBlockStyle("color: #f0f0f0")).toBeNull();
  });
});

describe("composeDarkColors: цитата в редакторе", () => {
  test("подпись HENDERSON отмечается для показа, ссылки не трогаются", () => {
    let root = document.createElement("div");
    root.innerHTML = kHendersonSignature;
    let css = markDarkColors(root, ".compose-quote-html", inlineColors(root));

    let name = Array.from(root.querySelectorAll("span")).find(el => el.textContent == "Камил Ибрагимов")!;
    let nameColor = name.getAttribute(kDarkTextColorAttr);
    expect(nameColor).toMatch(/^[0-9a-f]{6}$/);
    expect(css).toContain(`[${kDarkTextColorAttr}="${nameColor}"] { color: #${nameColor} !important; }`);
    expect(root.querySelector("p")!.hasAttribute(kDarkTextColorAttr)).toBe(true);
    expect(root.querySelector("a span")!.hasAttribute(kDarkTextColorAttr)).toBe(false);
    expect(root.querySelector("td")!.getAttribute(kDarkBackgroundAttr)).toBe("transparent");
    expect(css).toContain("background-color: transparent !important");
  });

  test("HTML для черновика и отправки совпадает с исходным", () => {
    let root = document.createElement("div");
    root.innerHTML = kHendersonSignature;
    let original = root.innerHTML;
    markDarkColors(root, ".compose-quote-html", inlineColors(root));
    expect(root.innerHTML).not.toBe(original);
    expect(htmlWithoutDarkColorMarks(root)).toBe(original);
    // Отметки остаются на экране, сериализация их не снимает с живого DOM.
    expect(root.querySelector(`[${kDarkTextColorAttr}]`)).not.toBeNull();
  });

  test("правка цитаты в тёмной теме не переносит адаптированные цвета", () => {
    let root = document.createElement("div");
    root.innerHTML = kHendersonSignature;
    markDarkColors(root, ".compose-quote-html", inlineColors(root));
    root.querySelector("p")!.append(" Спасибо!");
    let saved = htmlWithoutDarkColorMarks(root);
    expect(saved).toContain(`<p style="color:#595959">С наилучшими пожеланиями, Спасибо!</p>`);
    expect(saved).toContain(`<span style="color:#1F3864">Камил Ибрагимов</span>`);
    expect(saved).not.toContain("data-jackdaw-dark");
  });

  test("в светлой теме HTML не меняется вовсе", () => {
    let root = document.createElement("div");
    root.innerHTML = kHendersonSignature;
    expect(htmlWithoutDarkColorMarks(root)).toBe(root.innerHTML);
  });
});

describe("DarkModeColors: редактор ответа TipTap", () => {
  function createEditor(content: string) {
    return new Editor({
      extensions: [StarterKit, LinkFeature, ...composeEditorExtensions],
      content,
    });
  }

  test("документ и getHTML() сохраняют исходные цвета", () => {
    let html = `<p style="color: #595959">С уважением</p><p><span style="color: #1F3864">Никита Галкин</span></p>`;
    let editor = createEditor(html);
    let before = editor.getHTML();
    editor.view.dispatch(editor.state.tr.setMeta(darkModeColorsKey, true));
    expect(darkModeColorsKey.getState(editor.state)!.dark).toBe(true);
    expect(editor.getHTML()).toBe(before);
    expect(before).toContain("#1F3864");
    editor.destroy();
  });

  test("тёмные цвета показываются осветлёнными через декорации", () => {
    let editor = createEditor(
      `<p style="color: #595959">С уважением</p><p><span style="color: #1F3864">Никита Галкин</span></p>`);
    let decorations = buildDarkModeDecorations(editor.state.doc).find();
    let styles = decorations.map(deco => (deco as any).type.attrs.style as string);
    expect(styles.some(style => /^color: #[0-9a-f]{6}$/.test(style))).toBe(true);
    expect(styles.length).toBe(2);

    editor.view.dispatch(editor.state.tr.setMeta(darkModeColorsKey, true));
    let shown = editor.view.dom.innerHTML;
    let adapted = readableDarkTextColor("#1F3864")!;
    expect(shown).toContain(adapted);
    editor.view.dispatch(editor.state.tr.setMeta(darkModeColorsKey, false));
    expect(editor.view.dom.innerHTML).not.toContain(adapted);
    editor.destroy();
  });

  test("ссылки и подсветка не получают декораций", () => {
    let editor = createEditor(
      `<p><a href="https://smartds.ru"><span style="color: #0563C1">smartds.ru</span></a> <mark data-color="#FFFF00">важно</mark></p>`);
    expect(buildDarkModeDecorations(editor.state.doc).find()).toHaveLength(0);
    editor.destroy();
  });
});
