import {
  normalizeLineHeightValue,
  parseFontSizeFromHTML,
  parseFontSizeFromHTMLElement,
} from "../../Shared/Editor/composeEditorExtensions";

/** Команды, которые можно применить к нативному contenteditable цитаты. */
export type QuoteEditorCommand =
  | "bold"
  | "italic"
  | "underline"
  | "strikeThrough"
  | "foreColor"
  | "hiliteColor"
  | "backColor"
  | "fontName"
  | "fontSize"
  | "lineHeight"
  | "insertUnorderedList"
  | "insertOrderedList"
  | "formatBlock"
  | "justifyLeft"
  | "justifyCenter"
  | "justifyRight"
  | "justifyFull"
  | "indent"
  | "outdent"
  | "removeFormat"
  | "undo"
  | "redo"
  | "cut"
  | "copy"
  | "paste"
  | "insertText"
  | "insertHTML"
  | "createLink"
  | "unlink";

export type QuoteEditorHandle = {
  captureSelection: () => Range | null;
  applyCommand: (command: QuoteEditorCommand, value?: string | null, range?: Range | null) => boolean;
  getCurrentStyle?: (range?: Range | null) => QuoteEditorStyle | null;
};

export type QuoteTextAlign = "left" | "center" | "right" | "justify";

/** Фактическое оформление текста под нативным caret/выделением цитаты. */
export type QuoteEditorStyle = {
  fontFamily: string;
  fontSize: string;
  lineHeight: string;
  color: string;
  highlight: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  bulletList: boolean;
  orderedList: boolean;
  blockquote: boolean;
  textAlign: QuoteTextAlign;
  link: string;
};

function containsNode(root: HTMLElement, node: Node | null): boolean {
  return !!node && (node === root || root.contains(node));
}

/** Capture the current native selection only when it belongs to this quote. */
export function captureQuoteSelection(root: HTMLElement): Range | null {
  let selection = document.getSelection();
  if (!selection?.rangeCount) {
    return null;
  }
  let range = selection.getRangeAt(0);
  if (!containsNode(root, range.startContainer) || !containsNode(root, range.endContainer)) {
    return null;
  }
  return range.cloneRange();
}

function ancestorsUntilRoot(element: HTMLElement, root: HTMLElement): HTMLElement[] {
  let result: HTMLElement[] = [];
  let current: HTMLElement | null = element;
  while (current) {
    result.push(current);
    if (current === root) {
      break;
    }
    current = current.parentElement;
  }
  return result;
}

function elementAtRangeStart(root: HTMLElement, range: Range): HTMLElement {
  let container = range.startContainer;
  if (container.nodeType === Node.TEXT_NODE) {
    return (container.parentElement as HTMLElement | null) ?? root;
  }
  if (container instanceof HTMLElement) {
    let child = container.childNodes[range.startOffset]
      ?? container.childNodes[Math.max(0, range.startOffset - 1)];
    if (child instanceof HTMLElement) {
      return child;
    }
    if (child?.parentElement instanceof HTMLElement) {
      return child.parentElement;
    }
    return container;
  }
  return container.parentElement instanceof HTMLElement ? container.parentElement : root;
}

function nearestBlock(element: HTMLElement, root: HTMLElement): HTMLElement {
  let blocks = ancestorsUntilRoot(element, root);
  return blocks.find(candidate =>
    /^(P|DIV|LI|H[1-6]|BLOCKQUOTE|TD|TH|PRE)$/.test(candidate.tagName),
  ) ?? root;
}

function firstExplicitFontFamily(ancestors: HTMLElement[]): string {
  for (let element of ancestors) {
    let family = element.style.fontFamily.trim();
    if (family) {
      return family;
    }
    let legacyFamily = element.tagName === "FONT" ? element.getAttribute("face")?.trim() : "";
    if (legacyFamily) {
      return legacyFamily;
    }
  }
  return "";
}

function firstExplicitFontSize(ancestors: HTMLElement[]): string {
  for (let element of ancestors) {
    let size = parseFontSizeFromHTMLElement(element);
    if (/^\d+(?:\.\d+)?$/.test(size)) {
      return size;
    }
  }
  return "";
}

function firstExplicitColor(ancestors: HTMLElement[]): string {
  for (let element of ancestors) {
    let color = element.style.color.trim();
    if (color) {
      return color;
    }
    let legacyColor = element.tagName === "FONT" ? element.getAttribute("color")?.trim() : "";
    if (legacyColor) {
      return legacyColor;
    }
  }
  return "";
}

function firstExplicitBackground(ancestors: HTMLElement[]): string {
  for (let element of ancestors) {
    let background = element.style.backgroundColor.trim();
    if (background) {
      return background;
    }
    let legacyBackground = element.getAttribute("bgcolor")?.trim() ?? "";
    if (legacyBackground) {
      return legacyBackground;
    }
  }
  return "";
}

function colorToHex(value: string): string {
  let normalized = value.trim();
  if (!normalized || normalized.toLowerCase() === "transparent") {
    return "";
  }
  let hex = normalized.match(/^#([\da-f]{3,8})$/i);
  if (hex) {
    let digits = hex[1];
    if (digits.length === 4 && digits[3] === "0") {
      return "";
    }
    if (digits.length === 8 && digits.slice(6) === "00") {
      return "";
    }
    if (digits.length === 3 || digits.length === 4) {
      digits = digits.slice(0, 3).split("").map(digit => digit + digit).join("");
    } else {
      digits = digits.slice(0, 6);
    }
    return `#${digits.toUpperCase()}`;
  }
  let rgb = normalized.match(/^rgba?\((.*)\)$/i);
  if (!rgb) {
    return normalized;
  }
  let [channelText, alphaText] = rgb[1].split("/").map(part => part.trim());
  let channels = channelText.split(/[\s,]+/).filter(Boolean);
  if (channels.length < 3) {
    return normalized;
  }
  if (!alphaText && channels.length > 3) {
    alphaText = channels[3];
    channels = channels.slice(0, 3);
  }
  let alpha = alphaText ? parseFloat(alphaText.replace("%", "")) / (alphaText.includes("%") ? 100 : 1) : 1;
  if (!Number.isFinite(alpha) || alpha <= 0) {
    return "";
  }
  let values = channels.slice(0, 3).map(channel => {
    let parsed = parseFloat(channel);
    if (channel.includes("%")) {
      parsed = parsed * 2.55;
    }
    return Math.max(0, Math.min(255, Math.round(parsed)));
  });
  return `#${values.map(channel => channel.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

function computedStyleFor(element: HTMLElement): CSSStyleDeclaration | null {
  let view = element.ownerDocument.defaultView;
  return view?.getComputedStyle(element) ?? null;
}

function isTransparent(value: string): boolean {
  return !colorToHex(value);
}

function readDecoration(element: HTMLElement, root: HTMLElement, property: "underline" | "strike"): boolean {
  let ancestors = ancestorsUntilRoot(element, root);
  for (let candidate of ancestors) {
    if (property === "underline" && ["U", "INS"].includes(candidate.tagName)) {
      return true;
    }
    if (property === "strike" && ["S", "STRIKE", "DEL"].includes(candidate.tagName)) {
      return true;
    }
    let computed = computedStyleFor(candidate);
    let decoration = `${computed?.textDecorationLine ?? ""} ${computed?.textDecoration ?? ""}`.toLowerCase();
    if (decoration.includes(property === "underline" ? "underline" : "line-through")) {
      return true;
    }
  }
  return false;
}

function compactNumber(value: number): string {
  let rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(/0+$/, "").replace(/\.$/, "");
}

function readLineHeight(block: HTMLElement, computed: CSSStyleDeclaration | null, fontSizePx: number): string {
  let explicit = block.style.lineHeight.trim();
  let value = explicit || computed?.lineHeight?.trim() || "";
  if (!value || value === "normal") {
    return "";
  }
  if (/^[-+]?\d*\.?\d+px$/i.test(value)) {
    let pixels = parseFloat(value);
    return Number.isFinite(pixels) && fontSizePx > 0 ? compactNumber(pixels / fontSizePx) : "";
  }
  let normalized = normalizeLineHeightValue(value);
  if (/^[-+]?\d*\.?\d+$/.test(normalized)) {
    return normalized;
  }
  let pixels = parseFloat(value);
  return Number.isFinite(pixels) && fontSizePx > 0 ? compactNumber(pixels / fontSizePx) : "";
}

function readTextAlign(block: HTMLElement, computed: CSSStyleDeclaration | null): QuoteTextAlign {
  let value = (block.style.textAlign || block.getAttribute("align") || computed?.textAlign || "left").toLowerCase();
  if (value === "center" || value === "right" || value === "justify") {
    return value;
  }
  return "left";
}

function hasAncestor(element: HTMLElement, root: HTMLElement, selector: string): boolean {
  return ancestorsUntilRoot(element, root).some(candidate => candidate.matches(selector));
}

/**
 * Читает стиль именно под caret/началом выделения цитаты.
 * В отличие от queryCommandState учитывает стили, пришедшие из Outlook/Word HTML.
 */
export function readQuoteEditorStyle(root: HTMLElement, range?: Range | null): QuoteEditorStyle | null {
  let selectionRange = range?.cloneRange() ?? captureQuoteSelection(root);
  if (!selectionRange
    || !containsNode(root, selectionRange.startContainer)
    || !containsNode(root, selectionRange.endContainer)) {
    return null;
  }
  let element = elementAtRangeStart(root, selectionRange);
  let ancestors = ancestorsUntilRoot(element, root);
  let computed = computedStyleFor(element);
  let block = nearestBlock(element, root);
  let blockComputed = computedStyleFor(block);
  let fontSizeExplicit = firstExplicitFontSize(ancestors);
  let fontSize = fontSizeExplicit || parseFontSizeFromHTML(computed?.fontSize ?? "");
  let fontSizePx = parseFloat(computed?.fontSize ?? "");
  let fontFamily = firstExplicitFontFamily(ancestors) || computed?.fontFamily?.trim() || "";
  let color = colorToHex(computed?.color ?? "") || colorToHex(firstExplicitColor(ancestors));
  let background = colorToHex(firstExplicitBackground(ancestors));
  if (!background && computed?.backgroundColor && !isTransparent(computed.backgroundColor)) {
    background = colorToHex(computed.backgroundColor);
  }
  let fontWeight = computed?.fontWeight ?? "";
  let fontStyle = computed?.fontStyle ?? "";
  let hasBoldTag = ancestors.some(candidate => ["B", "STRONG"].includes(candidate.tagName));
  let hasItalicTag = ancestors.some(candidate => ["I", "EM", "CITE"].includes(candidate.tagName));
  let link = ancestors.find(candidate => candidate.tagName === "A")?.getAttribute("href") ?? "";

  return {
    fontFamily,
    fontSize,
    lineHeight: readLineHeight(block, blockComputed, fontSizePx),
    color,
    highlight: background,
    bold: hasBoldTag || fontWeight === "bold" || Number.parseInt(fontWeight, 10) >= 600,
    italic: hasItalicTag || /^(italic|oblique)\b/.test(fontStyle),
    underline: readDecoration(element, root, "underline"),
    strike: readDecoration(element, root, "strike"),
    bulletList: hasAncestor(element, root, "ul"),
    orderedList: hasAncestor(element, root, "ol"),
    blockquote: hasAncestor(element, root, "blockquote"),
    textAlign: readTextAlign(block, blockComputed),
    link,
  };
}

function restoreQuoteSelection(root: HTMLElement, range: Range): boolean {
  if (!containsNode(root, range.startContainer) || !containsNode(root, range.endContainer)) {
    return false;
  }
  root.focus({ preventScroll: true });
  let selection = document.getSelection();
  if (!selection) {
    return false;
  }
  selection.removeAllRanges();
  selection.addRange(range.cloneRange());
  return true;
}

function quoteBlocksForRange(root: HTMLElement, range: Range): HTMLElement[] {
  let blocks = Array.from(root.querySelectorAll<HTMLElement>(
    "p, div, li, h1, h2, h3, h4, h5, h6, blockquote, td, th",
  )).filter(block => {
    try {
      return range.intersectsNode(block);
    } catch {
      return false;
    }
  });
  if (blocks.length) {
    return blocks;
  }
  let element: HTMLElement | null = range.startContainer instanceof HTMLElement
    ? range.startContainer
    : range.startContainer.parentElement;
  while (element && element !== root) {
    if (/^(P|DIV|LI|H[1-6]|BLOCKQUOTE|TD|TH)$/.test(element.tagName)) {
      return [element];
    }
    element = element.parentElement;
  }
  return [];
}

function applyQuoteLineHeight(root: HTMLElement, range: Range, value?: string | null): boolean {
  let blocks = quoteBlocksForRange(root, range);
  if (!blocks.length) {
    return false;
  }
  for (let block of blocks) {
    if (value) {
      block.style.lineHeight = value;
    } else {
      block.style.removeProperty("line-height");
    }
  }
  root.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

/** Apply a browser editing command without transferring focus to the reply editor. */
export function applyQuoteCommand(
  root: HTMLElement,
  command: QuoteEditorCommand,
  value?: string | null,
  range?: Range | null,
): boolean {
  let selectionRange = range?.cloneRange() ?? captureQuoteSelection(root);
  if (!selectionRange || !restoreQuoteSelection(root, selectionRange)) {
    return false;
  }
  if (command === "lineHeight") {
    return applyQuoteLineHeight(root, selectionRange, value);
  }
  if (typeof document.execCommand !== "function") {
    return false;
  }

  let changed = false;
  try {
    changed = document.execCommand(command, false, value ?? null);
  } catch {
    changed = false;
  }
  if (!changed && command === "hiliteColor") {
    try {
      changed = document.execCommand("backColor", false, value ?? null);
    } catch {
      changed = false;
    }
  }
  if (changed) {
    // Chromium normally emits this event itself. Dispatching it as well covers
    // commands that change the DOM without emitting input in an Electron build.
    root.dispatchEvent(new Event("input", { bubbles: true }));
  }
  return changed;
}
