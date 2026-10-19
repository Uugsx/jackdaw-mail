/**
 * Тёмная тема в редакторе письма, как в Outlook: тёмные цвета текста осветляются
 * с сохранением оттенка, светлые фоны затемняются, ссылки остаются голубыми.
 *
 * Меняется только отображение. HTML письма не трогаем: адаптированный цвет
 * хранится в служебных data-атрибутах, а применяется отдельной таблицей стилей.
 * Перед сохранением черновика и отправкой атрибуты снимаются.
 */
import { readable } from "svelte/store";
import { adaptBackgroundColor, adaptTextColor, parseCssColor } from "../Message/emailDarkMode";

type RGB = { r: number; g: number; b: number };

export const kDarkTextColorAttr = "data-jackdaw-dark-fg";
export const kDarkBackgroundAttr = "data-jackdaw-dark-bg";
/** Цвет ссылок в тёмной теме — тот же, что в просмотре письма (content-body-dark.css). */
export const kDarkLinkColor = "#6cb4ff";
/** Самый светлый из тёмных фонов редактора (#141A22, #151718, #1B1D1E) с запасом. */
const kDarkReferenceBackground: RGB = { r: 0x1e, g: 0x21, b: 0x26 };
/** WCAG AA для обычного текста. */
const kMinTextContrast = 4.5;
const kLightenStep = 0.05;
const kTransparentMarker = "transparent";
const kMarkSelector = `[${kDarkTextColorAttr}],[${kDarkBackgroundAttr}]`;
const kSkipTags = new Set(["STYLE", "SCRIPT", "IMG", "BR", "HR", "svg"]);

/** Тёмная ли сейчас схема приложения (её задаёт nativeTheme по настройке темы). */
export const darkColorScheme = readable(false, set => {
  if (typeof window == "undefined" || !window.matchMedia) {
    return;
  }
  let query = window.matchMedia("(prefers-color-scheme: dark)");
  set(query.matches);
  let onChange = (event: MediaQueryListEvent) => set(event.matches);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
});

/**
 * Читаемый на тёмном фоне цвет текста или null, если исходный уже читается.
 * Оттенок сохраняется (тёмно-синий → голубой), контраст не ниже WCAG AA.
 */
export function readableDarkTextColor(color: string): string | null {
  // Скрытый прозрачный текст (прехедеры рассылок) не проявляем.
  if (isTransparentColor(color)) {
    return null;
  }
  let original = parseCssColor(color);
  if (!original) {
    return null;
  }
  let adapted = adaptTextColor(color);
  let rgb = adapted ? parseCssColor(adapted) : original;
  if (!rgb) {
    return null;
  }
  let readable = ensureDarkContrast(rgb);
  if (!adapted && sameColor(readable, original)) {
    return null;
  }
  return rgbToHex(readable);
}

/** Фон для тёмной темы: светлые нейтральные — прозрачные, цветные — затемнённые. */
export function darkBackgroundColor(color: string): string | null {
  if (isTransparentColor(color)) {
    return null;
  }
  return adaptBackgroundColor(color);
}

export function textContrastOnDark(rgb: RGB): number {
  return contrastRatio(rgb, kDarkReferenceBackground);
}

export type ComputedColors = { color: string; backgroundColor: string };

function readComputedColors(el: Element): ComputedColors {
  let style = getComputedStyle(el);
  return { color: style.color, backgroundColor: style.backgroundColor };
}

/** Снимает служебные отметки тёмной темы. */
export function clearDarkColorMarks(root: ParentNode): void {
  for (let el of root.querySelectorAll(kMarkSelector)) {
    el.removeAttribute(kDarkTextColorAttr);
    el.removeAttribute(kDarkBackgroundAttr);
  }
}

/** HTML без отметок тёмной темы — именно он попадает в черновик и отправку. */
export function htmlWithoutDarkColorMarks(root: HTMLElement): string {
  if (!root.querySelector(kMarkSelector)) {
    return root.innerHTML;
  }
  let clone = root.cloneNode(true) as HTMLElement;
  clearDarkColorMarks(clone);
  return clone.innerHTML;
}

/**
 * Отмечает элементы, чей цвет не читается на тёмном фоне, и возвращает CSS,
 * который показывает их адаптированными. Перед вызовом прежний CSS отметок
 * должен быть отключён, иначе будут прочитаны уже адаптированные цвета.
 */
export function markDarkColors(
  root: HTMLElement,
  scopeSelector: string,
  readColors: (el: Element) => ComputedColors = readComputedColors,
): string {
  clearDarkColorMarks(root);
  let elements = Array.from(root.querySelectorAll("*"))
    .filter(el => !kSkipTags.has(el.tagName));
  // Сначала читаем все стили, потом пишем атрибуты: иначе каждый
  // setAttribute заставлял бы браузер пересчитывать стили заново.
  let colors = elements.map(el => readColors(el));
  let textColors = new Set<string>();
  let backgrounds = new Set<string>();
  elements.forEach((el, i) => {
    // Ссылки и их содержимое красит общее правило, как в просмотре письма.
    if (!el.closest("a")) {
      let text = readableDarkTextColor(colors[i].color);
      if (text) {
        let value = text.slice(1);
        el.setAttribute(kDarkTextColorAttr, value);
        textColors.add(value);
      }
    }
    let background = darkBackgroundColor(colors[i].backgroundColor);
    if (background) {
      let value = background == kTransparentMarker ? kTransparentMarker : background.slice(1);
      el.setAttribute(kDarkBackgroundAttr, value);
      backgrounds.add(value);
    }
  });
  let rules: string[] = [];
  for (let value of textColors) {
    rules.push(`${scopeSelector} [${kDarkTextColorAttr}="${value}"] { color: #${value} !important; }`);
  }
  for (let value of backgrounds) {
    let css = value == kTransparentMarker ? kTransparentMarker : `#${value}`;
    rules.push(`${scopeSelector} [${kDarkBackgroundAttr}="${value}"] { background-color: ${css} !important; }`);
  }
  return rules.join("\n");
}

/** Значение CSS-свойства из inline style (последнее объявление выигрывает). */
export function inlineStyleValue(style: string | null | undefined, property: string): string | null {
  if (!style) {
    return null;
  }
  let result: string | null = null;
  for (let declaration of style.split(";")) {
    let colon = declaration.indexOf(":");
    if (colon < 0) {
      continue;
    }
    if (declaration.slice(0, colon).trim().toLowerCase() == property) {
      result = declaration.slice(colon + 1).replace(/!important\s*$/i, "").trim();
    }
  }
  return result;
}

/**
 * Inline style для показа блока (абзац, ячейка) в тёмной теме или null.
 * Используется декорациями TipTap, которые не меняют документ.
 */
export function darkBlockStyle(style: string | null | undefined, bgcolor?: string | null): string | null {
  let parts: string[] = [];
  let color = colorValue(inlineStyleValue(style, "color"));
  let text = color ? readableDarkTextColor(color) : null;
  if (text) {
    parts.push(`color: ${text}`);
  }
  let background = colorValue(inlineStyleValue(style, "background-color")) ??
    colorValue(inlineStyleValue(style, "background")) ??
    colorValue(bgcolor);
  let adapted = background ? darkBackgroundColor(background) : null;
  if (adapted) {
    parts.push(`background-color: ${adapted}`);
  }
  return parts.length ? parts.join("; ") : null;
}

/** Только явный цвет: parseCssColor для прочих значений вернул бы унаследованный цвет. */
function colorValue(value: string | null | undefined): string | null {
  let trimmed = value?.trim();
  if (!trimmed || /^(inherit|initial|unset|revert|currentcolor|transparent|none)$/i.test(trimmed)) {
    return null;
  }
  return /^(#[0-9a-f]{3,8}|(rgba?|hsla?)\([^()]*\)|[a-z]+)$/i.test(trimmed) ? trimmed : null;
}

function isTransparentColor(value: string): boolean {
  let trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed == "transparent") {
    return true;
  }
  let alpha = trimmed.match(/^rgba\([^)]*[,/]\s*([\d.]+%?)\s*\)$/);
  if (!alpha) {
    return false;
  }
  let raw = alpha[1];
  let numeric = raw.endsWith("%") ? Number(raw.slice(0, -1)) / 100 : Number(raw);
  return numeric == 0;
}

/** Осветляет цвет к белому, пока контраст с тёмным фоном не станет WCAG AA. */
function ensureDarkContrast(rgb: RGB): RGB {
  let result = rgb;
  for (let mix = kLightenStep; textContrastOnDark(result) < kMinTextContrast && mix <= 1; mix += kLightenStep) {
    result = {
      r: Math.round(rgb.r + (255 - rgb.r) * mix),
      g: Math.round(rgb.g + (255 - rgb.g) * mix),
      b: Math.round(rgb.b + (255 - rgb.b) * mix),
    };
  }
  return result;
}

function relativeLuminance({ r, g, b }: RGB): number {
  let channel = (value: number) => {
    let c = value / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a: RGB, b: RGB): number {
  let la = relativeLuminance(a);
  let lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function sameColor(a: RGB, b: RGB): boolean {
  return a.r == b.r && a.g == b.g && a.b == b.b;
}

function rgbToHex({ r, g, b }: RGB): string {
  return `#${[r, g, b].map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("")}`;
}
