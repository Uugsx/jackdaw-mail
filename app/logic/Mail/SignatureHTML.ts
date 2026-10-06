const PT_PER_PX = 72 / 96;

const HTML_FONT_SIZE_TO_PT: Record<string, string> = {
  "1": "8",
  "2": "10",
  "3": "12",
  "4": "14",
  "5": "18",
  "6": "24",
  "7": "36",
};

const COMPOSE_FONT_SIZES = [
  "5", "5.5", "6.5", "7.5", "8", "9", "10", "10.5", "11", "12",
  "14", "16", "18", "20", "22", "24", "26", "28", "36", "48", "72",
];

const INLINE_TEXT_STYLE_PROPERTIES = [
  "font-family",
  "font-size",
  "color",
  "background-color",
  "font-weight",
  "font-style",
  "text-decoration",
] as const;

type InlineTextStyleProperty = typeof INLINE_TEXT_STYLE_PROPERTIES[number];

/** Добавляет ожидаемый протокол, если пользователь указал домен без протокола. */
export function normalizeMailLinkURL(value: string | null | undefined): string {
  let trimmed = value?.trim() ?? "";
  if (!trimmed || /^(?:https?|mailto|tel):/i.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith("//")) {
    return `https:${trimmed}`;
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(trimmed) || /^[#/?]/.test(trimmed)) {
    return trimmed;
  }
  try {
    let candidate = new URL(`https://${trimmed}`);
    if (candidate.hostname.includes(".")) {
      return candidate.href;
    }
  } catch {
    return trimmed;
  }
  return trimmed;
}

function trimFontSizeNumber(value: string): string {
  let n = parseFloat(value);
  if (Number.isNaN(n)) {
    return value;
  }
  let rounded = Math.round(n * 100) / 100;
  if (Number.isInteger(rounded)) {
    return String(rounded);
  }
  return String(rounded).replace(/0+$/, "").replace(/\.$/, "");
}

function isHtmlFontSizeIndex(value: string): boolean {
  if (!/^[\d]+$/.test(value)) {
    return false;
  }
  let n = parseInt(value, 10);
  return n >= 1 && n <= 7;
}

function htmlFontSizeIndexToPt(index: string): string {
  return HTML_FONT_SIZE_TO_PT[index] ?? "";
}

/** Parse CSS font-size to Outlook-style pt number (unitless string for UI/storage). */
export function parseFontSizeFromHTML(size: string): string {
  if (!size) {
    return "";
  }
  size = size.replace(/[\'"]+/g, "").trim();
  let ptMatch = size.match(/^([\d.]+)\s*pt$/i);
  if (ptMatch) {
    return trimFontSizeNumber(ptMatch[1]);
  }
  let pxMatch = size.match(/^([\d.]+)\s*px$/i);
  if (pxMatch) {
    return trimFontSizeNumber(String(parseFloat(pxMatch[1]) * PT_PER_PX));
  }
  if (/^[\d.]+$/.test(size)) {
    if (isHtmlFontSizeIndex(size)) {
      return htmlFontSizeIndexToPt(size);
    }
    let n = parseFloat(size);
    // Legacy mistaken px numbers from an older build (e.g. 13.33 → 10pt)
    if (n >= 12 && n !== Math.round(n)) {
      let asPt = n * PT_PER_PX;
      for (let candidate of COMPOSE_FONT_SIZES) {
        if (Math.abs(parseFloat(candidate) - asPt) < 0.06) {
          return candidate;
        }
      }
    }
    return trimFontSizeNumber(size);
  }
  return size.replace(/px$/i, "").replace(/pt$/i, "");
}

/** Read font size from a DOM node (inline style or legacy `<font size>`). */
export function parseFontSizeFromHTMLElement(element: HTMLElement): string {
  if (element.tagName === "FONT") {
    let legacy = element.getAttribute("size");
    if (legacy && HTML_FONT_SIZE_TO_PT[legacy]) {
      return HTML_FONT_SIZE_TO_PT[legacy];
    }
  }
  let fromStyle = element.style.fontSize ?? "";
  if (!fromStyle && element.tagName !== "FONT") {
    return "";
  }
  return parseFontSizeFromHTML(fromStyle);
}

function readInlineTextStyles(element: HTMLElement): Partial<Record<InlineTextStyleProperty, string>> {
  let styles: Partial<Record<InlineTextStyleProperty, string>> = {};
  for (let property of INLINE_TEXT_STYLE_PROPERTIES) {
    let value = element.style.getPropertyValue(property).trim();
    if (value) {
      styles[property] = value;
    }
  }
  return styles;
}

function applyInlineTextStylesToTextNodes(
  block: HTMLElement,
  doc: Document,
  styles: Partial<Record<InlineTextStyleProperty, string>>,
) {
  if (!Object.keys(styles).length) {
    return;
  }
  let walker = doc.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let textNodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    let text = node as Text;
    if (!text.data.trim()) {
      continue;
    }
    textNodes.push(text);
  }
  for (let text of textNodes) {
    let parent = text.parentElement;
    if (!parent) {
      continue;
    }
    if (parent.tagName === "SPAN" && parent.childNodes.length === 1) {
      for (let [property, value] of Object.entries(styles)) {
        if (!parent.style.getPropertyValue(property).trim()) {
          parent.style.setProperty(property, value);
        }
      }
      continue;
    }
    let span = doc.createElement("span");
    for (let [property, value] of Object.entries(styles)) {
      span.style.setProperty(property, value);
    }
    parent.insertBefore(span, text);
    span.appendChild(text);
  }
}

function moveInlineStylesFromLink(anchor: HTMLAnchorElement, doc: Document) {
  let styles = readInlineTextStyles(anchor);
  if (!Object.keys(styles).length) {
    return;
  }
  let span = doc.createElement("span");
  for (let [property, value] of Object.entries(styles)) {
    span.style.setProperty(property, value);
  }
  while (anchor.firstChild) {
    span.appendChild(anchor.firstChild);
  }
  anchor.appendChild(span);
  for (let property of INLINE_TEXT_STYLE_PROPERTIES) {
    anchor.style.removeProperty(property);
  }
  if (!anchor.getAttribute("style")) {
    anchor.removeAttribute("style");
  }
}

function normalizeLineHeightValue(value: string): string {
  if (!value) {
    return "";
  }
  value = value.trim().replace(",", ".");
  if (value === "normal" || value === "1" || value === "1.0") {
    return "";
  }
  if (value.endsWith("%")) {
    let percent = parseFloat(value);
    if (!Number.isNaN(percent)) {
      return String(percent / 100);
    }
  }
  return value;
}

/** Normalize Outlook/Word signature HTML before TipTap parses it. */
export function normalizeSignatureHTML(html: string | null | undefined): string | null {
  if (!html?.trim()) {
    return html ?? null;
  }
  if (typeof document === "undefined") {
    return html;
  }
  let doc = new DOMParser().parseFromString(`<body><div id="sig-root">${html}</div></body>`, "text/html");
  let root = doc.getElementById("sig-root");
  if (!root) {
    return html;
  }
  for (let font of root.querySelectorAll<HTMLElement>("font[size], font[face], font[color]")) {
    let span = doc.createElement("span");
    let styles = readInlineTextStyles(font);
    let pt = HTML_FONT_SIZE_TO_PT[font.getAttribute("size") ?? ""];
    if (pt) {
      styles["font-size"] = `${pt}pt`;
    }
    let face = font.getAttribute("face")?.trim();
    if (face) {
      styles["font-family"] = face;
    }
    let color = font.getAttribute("color")?.trim();
    if (color) {
      styles.color = color;
    }
    for (let [property, value] of Object.entries(styles)) {
      span.style.setProperty(property, value);
    }
    while (font.firstChild) {
      span.appendChild(font.firstChild);
    }
    font.replaceWith(span);
  }
  for (let anchor of root.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    let href = anchor.getAttribute("href");
    let normalizedURL = normalizeMailLinkURL(href);
    if (normalizedURL && normalizedURL != href) {
      anchor.setAttribute("href", normalizedURL);
    }
    moveInlineStylesFromLink(anchor, doc);
  }
  let styleBlocks = [...root.querySelectorAll<HTMLElement>(
    "p, div, li, h1, h2, h3, h4, h5, h6, blockquote, table, thead, tbody, tfoot, tr, td, th, footer",
  )].reverse();
  for (let blockEl of styleBlocks) {
    let blockStyles = readInlineTextStyles(blockEl);
    if (blockStyles["font-size"]) {
      let pt = parseFontSizeFromHTML(blockStyles["font-size"]);
      if (pt) {
        blockStyles["font-size"] = `${pt}pt`;
      }
    }
    if (Object.keys(blockStyles).length) {
      applyInlineTextStylesToTextNodes(blockEl, doc, blockStyles);
      for (let property of INLINE_TEXT_STYLE_PROPERTIES) {
        blockEl.style.removeProperty(property);
      }
    }
    if (/^(P|DIV|LI|H[1-6]|BLOCKQUOTE|TD|TH)$/.test(blockEl.tagName)) {
      blockEl.style.marginTop = "0";
      blockEl.style.marginBottom = "0";
      blockEl.style.lineHeight = normalizeLineHeightValue(blockEl.style.lineHeight) || "1";
    }
  }
  return root.innerHTML;
}
