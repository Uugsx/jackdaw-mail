/** Outlook-style dark mode: lighten unreadable colors but keep hue (blue/orange/etc.). */

type RGB = { r: number; g: number; b: number };
type HSL = { h: number; s: number; l: number };

const kTextLuminanceKeep = 0.58;
const kBackgroundLuminanceClear = 0.34;
const kNeutralBackgroundSaturationMax = 0.12;
const kDarkBackgroundLightnessMax = 0.2;

export function adaptEmailHtmlForDarkMode(html: string): string {
  if (!html || typeof DOMParser == "undefined") {
    return html;
  }
  let doc = new DOMParser().parseFromString(html, "text/html");
  for (let style of doc.querySelectorAll("style")) {
    adaptStyleElement(style);
  }
  adaptElementColors(doc.body);
  for (let el of doc.body.querySelectorAll("*")) {
    adaptElementColors(el as HTMLElement);
  }
  return doc.documentElement.outerHTML;
}

function adaptStyleElement(style: HTMLStyleElement): void {
  let css = style.textContent;
  if (!css) {
    return;
  }
  let adapted = adaptCssText(css);
  if (adapted != css) {
    style.textContent = adapted;
  }
}

function adaptElementColors(el: HTMLElement): void {
  if (el.hasAttribute("data-ogsc")) {
    let adapted = adaptTextColor(el.getAttribute("data-ogsc")!);
    if (adapted) {
      mergeInlineColor(el, adapted);
    }
  }
  if (el.hasAttribute("data-ogsb")) {
    let adapted = adaptBackgroundColor(el.getAttribute("data-ogsb")!);
    if (adapted == "transparent") {
      mergeInlineBackground(el, "transparent");
    } else if (adapted) {
      mergeInlineBackground(el, adapted);
    }
  }
  if (el.hasAttribute("color")) {
    let adapted = adaptTextColor(el.getAttribute("color")!);
    if (adapted) {
      el.setAttribute("color", adapted);
    }
  }
  if (el.hasAttribute("bgcolor")) {
    let adapted = adaptBackgroundColor(el.getAttribute("bgcolor")!);
    if (adapted == "transparent") {
      el.removeAttribute("bgcolor");
    } else if (adapted) {
      el.setAttribute("bgcolor", adapted);
    }
  }
  let style = el.getAttribute("style");
  if (style) {
    let adaptedStyle = adaptInlineStyle(style);
    if (adaptedStyle != style) {
      el.setAttribute("style", adaptedStyle);
    }
  }
}

export function adaptInlineStyle(style: string): string {
  return adaptCssText(style);
}

export function adaptCssText(css: string): string {
  return css.replace(
    /\b(color|-webkit-text-fill-color|background-color|background)\s*:\s*([^;}{]+)/gi,
    (match, prop, value) => adaptCssColorDeclaration(prop, value.trim()) ?? match,
  );
}

function adaptCssColorDeclaration(prop: string, trimmed: string): string | null {
  let value = stripColorModifiers(trimmed);
  if (/^(inherit|currentcolor|transparent|none|window|canvas)$/i.test(value)) {
    return null;
  }
  if (/^color$/i.test(prop) && /^windowtext$/i.test(value)) {
    return "color: #e5e7eb";
  }
  if (/^background$/i.test(prop) && !/^#[0-9a-f]{3,8}$/i.test(value) &&
      !/^rgb/i.test(value) && !/^[a-z]+$/i.test(value)) {
    return null;
  }
  if (/^background-color$|^background$/i.test(prop)) {
    let adapted = adaptBackgroundColor(value);
    if (adapted == "transparent") {
      return `${prop}: transparent`;
    }
    if (adapted) {
      return `${prop}: ${adapted}`;
    }
    return null;
  }
  let adapted = adaptTextColor(value);
  return adapted ? `${prop}: ${adapted}` : null;
}

function stripColorModifiers(value: string): string {
  return value.trim().replace(/\s*!important\s*$/i, "").trim();
}

function mergeInlineColor(el: HTMLElement, color: string): void {
  let style = el.getAttribute("style") ?? "";
  if (/\bcolor\s*:/i.test(style)) {
    style = style.replace(/\bcolor\s*:\s*[^;]+;?/gi, `color: ${color};`);
  } else {
    style = `color: ${color};${style}`;
  }
  el.setAttribute("style", style);
}

function mergeInlineBackground(el: HTMLElement, background: string): void {
  let style = el.getAttribute("style") ?? "";
  if (/\bbackground-color\s*:/i.test(style)) {
    style = style.replace(/\bbackground-color\s*:\s*[^;]+;?/gi, `background-color: ${background};`);
  } else {
    style = `background-color: ${background};${style}`;
  }
  el.setAttribute("style", style);
}

export function adaptTextColor(input: string): string | null {
  let trimmed = stripColorModifiers(input);
  if (/^windowtext$/i.test(trimmed)) {
    return "#e5e7eb";
  }
  let rgb = parseCssColor(trimmed);
  if (!rgb) {
    return null;
  }
  let lum = relativeLuminance(rgb);
  if (lum >= kTextLuminanceKeep) {
    return null;
  }

  let hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
  if (hsl.s < 0.12) {
    return "#e5e7eb";
  }

  hsl.s = Math.min(0.92, Math.max(hsl.s, 0.42));
  if (hsl.h >= 190 && hsl.h <= 265) {
    hsl.l = Math.max(hsl.l, 0.74);
    hsl.s = Math.max(hsl.s, 0.55);
    return hslToHex(hsl);
  }
  if (hsl.h >= 18 && hsl.h <= 48) {
    hsl.l = Math.max(hsl.l, 0.68);
    hsl.s = Math.max(hsl.s, 0.72);
    return hslToHex(hsl);
  }
  if (hsl.h >= 330 || hsl.h <= 12) {
    hsl.l = Math.max(hsl.l, 0.70);
    return hslToHex(hsl);
  }
  if (hsl.h >= 95 && hsl.h <= 145) {
    hsl.l = Math.max(hsl.l, 0.72);
    return hslToHex(hsl);
  }

  hsl.l = Math.max(hsl.l, 0.73);
  return hslToHex(hsl);
}

export function adaptBackgroundColor(input: string): string | null {
  let rgb = parseCssColor(input);
  if (!rgb) {
    return null;
  }
  if (relativeLuminance(rgb) >= kBackgroundLuminanceClear) {
    let hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
    // Убираем светлые нейтральные фоны страницы, но сохраняем смысловую
    // подсветку письма: Outlook отображает её более тёмным оттенком в dark mode.
    if (hsl.s < kNeutralBackgroundSaturationMax) {
      return "transparent";
    }
    hsl.l = Math.min(hsl.l, kDarkBackgroundLightnessMax);
    return hslToHex(hsl);
  }
  return null;
}

export function parseCssColor(input: string): RGB | null {
  let trimmed = stripColorModifiers(input).replace(/^['"]|['"]$/g, "");
  if (!trimmed) {
    return null;
  }
  let hex = trimmed.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    return parseHexColor(hex[1]);
  }
  let rgbMatch = trimmed.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (rgbMatch) {
    return {
      r: clamp255(Number(rgbMatch[1])),
      g: clamp255(Number(rgbMatch[2])),
      b: clamp255(Number(rgbMatch[3])),
    };
  }
  let rgbPctMatch = trimmed.match(/^rgba?\(\s*([\d.]+)%[,\s]+([\d.]+)%[,\s]+([\d.]+)%/i);
  if (rgbPctMatch) {
    return {
      r: clamp255(Number(rgbPctMatch[1]) * 2.55),
      g: clamp255(Number(rgbPctMatch[2]) * 2.55),
      b: clamp255(Number(rgbPctMatch[3]) * 2.55),
    };
  }
  if (typeof document != "undefined") {
    let probe = document.createElement("span");
    probe.style.color = trimmed;
    document.documentElement.append(probe);
    let parsed = parseRgbString(getComputedStyle(probe).color);
    probe.remove();
    if (parsed) {
      return parsed;
    }
  }
  return parseNamedColor(trimmed);
}

function parseHexColor(hex: string): RGB | null {
  if (hex.length == 3) {
    return {
      r: parseInt(hex[0] + hex[0], 16),
      g: parseInt(hex[1] + hex[1], 16),
      b: parseInt(hex[2] + hex[2], 16),
    };
  }
  if (hex.length == 6) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  }
  return null;
}

function parseRgbString(value: string): RGB | null {
  let match = value.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (!match) {
    return null;
  }
  return {
    r: clamp255(Number(match[1])),
    g: clamp255(Number(match[2])),
    b: clamp255(Number(match[3])),
  };
}

function parseNamedColor(name: string): RGB | null {
  let map: Record<string, RGB> = {
    black: { r: 0, g: 0, b: 0 },
    navy: { r: 0, g: 0, b: 128 },
    blue: { r: 0, g: 0, b: 255 },
    darkblue: { r: 0, g: 0, b: 139 },
    darkslategray: { r: 47, g: 79, b: 79 },
    darkslategrey: { r: 47, g: 79, b: 79 },
    dimgray: { r: 105, g: 105, b: 105 },
    dimgrey: { r: 105, g: 105, b: 105 },
    gray: { r: 128, g: 128, b: 128 },
    grey: { r: 128, g: 128, b: 128 },
    darkgray: { r: 169, g: 169, b: 169 },
    darkgrey: { r: 169, g: 169, b: 169 },
    red: { r: 255, g: 0, b: 0 },
    maroon: { r: 128, g: 0, b: 0 },
    orange: { r: 255, g: 165, b: 0 },
    white: { r: 255, g: 255, b: 255 },
    windowtext: { r: 0, g: 0, b: 0 },
  };
  return map[name.toLowerCase()] ?? null;
}

function relativeLuminance({ r, g, b }: RGB): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function rgbToHsl(r: number, g: number, b: number): HSL {
  r /= 255;
  g /= 255;
  b /= 255;
  let max = Math.max(r, g, b);
  let min = Math.min(r, g, b);
  let l = (max + min) / 2;
  if (max == min) {
    return { h: 0, s: 0, l };
  }
  let d = max - min;
  let s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  switch (max) {
    case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
    case g: h = ((b - r) / d + 2) / 6; break;
    default: h = ((r - g) / d + 4) / 6; break;
  }
  return { h: h * 360, s, l };
}

function hslToHex({ h, s, l }: HSL): string {
  let c = (1 - Math.abs(2 * l - 1)) * s;
  let x = c * (1 - Math.abs((h / 60) % 2 - 1));
  let m = l - c / 2;
  let rp = 0;
  let gp = 0;
  let bp = 0;
  if (h < 60) { rp = c; gp = x; }
  else if (h < 120) { rp = x; gp = c; }
  else if (h < 180) { gp = c; bp = x; }
  else if (h < 240) { gp = x; bp = c; }
  else if (h < 300) { rp = x; bp = c; }
  else { rp = c; bp = x; }
  return rgbToHex({
    r: Math.round((rp + m) * 255),
    g: Math.round((gp + m) * 255),
    b: Math.round((bp + m) * 255),
  });
}

function rgbToHex({ r, g, b }: RGB): string {
  return `#${[r, g, b].map(v => clamp255(v).toString(16).padStart(2, "0")).join("")}`;
}

function clamp255(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}
