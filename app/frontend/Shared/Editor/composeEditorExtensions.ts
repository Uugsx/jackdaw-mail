import { Extension } from "@tiptap/core";
import Underline from "@tiptap/extension-underline";
import { Color } from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import { getStyleProperty } from "@tiptap/core";
import TextAlign from "@tiptap/extension-text-align";
import FontFamily from "@tiptap/extension-font-family";
import { TextStyle } from "@tiptap/extension-text-style";
import { Table, TableRow, TableCell, TableHeader } from "@tiptap/extension-table";
import { gt } from "../../../l10n/l10n";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    fontSize: {
      setFontSize: (fontSize: string) => ReturnType;
      unsetFontSize: () => ReturnType;
    };
    lineHeight: {
      setLineHeight: (lineHeight: string) => ReturnType;
      unsetLineHeight: () => ReturnType;
    };
  }
}

const PT_PER_PX = 72 / 96;

/** Legacy HTML `<font size="1..7">` → pt (Outlook / Word). */
const HTML_FONT_SIZE_TO_PT: Record<string, string> = {
  "1": "8",
  "2": "10",
  "3": "12",
  "4": "14",
  "5": "18",
  "6": "24",
  "7": "36",
};

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

/** True when a unitless integer is an HTML `<font size>` index (1–7), not pt. */
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
  size = size.replace(/['"]+/g, "").trim();
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
      for (let candidate of composeFontSizes) {
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

function applyFontSizeToTextNodes(block: HTMLElement, doc: Document, cssPt: string) {
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
    if (parent.tagName === "SPAN" && parent.childNodes.length === 1 && parent.style.fontSize) {
      parent.style.fontSize = cssPt;
      continue;
    }
    let span = doc.createElement("span");
    span.style.fontSize = cssPt;
    parent.insertBefore(span, text);
    span.appendChild(text);
  }
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
  for (let font of root.querySelectorAll("font[size], font[face]")) {
    let span = doc.createElement("span");
    let pt = HTML_FONT_SIZE_TO_PT[font.getAttribute("size") ?? ""];
    if (pt) {
      span.style.fontSize = `${pt}pt`;
    }
    let face = font.getAttribute("face")?.trim();
    if (face) {
      span.style.fontFamily = face;
    }
    while (font.firstChild) {
      span.appendChild(font.firstChild);
    }
    font.replaceWith(span);
  }
  for (let block of root.querySelectorAll("p, div, li, h1, h2, h3, h4, h5, h6, blockquote, td, th")) {
    let blockEl = block as HTMLElement;
    let blockSize = blockEl.style.fontSize?.trim();
    if (blockSize) {
      let pt = parseFontSizeFromHTML(blockSize);
      if (pt) {
        applyFontSizeToTextNodes(blockEl, doc, `${pt}pt`);
      }
      blockEl.style.removeProperty("font-size");
    }
    blockEl.style.marginTop = "0";
    blockEl.style.marginBottom = "0";
    blockEl.style.lineHeight = normalizeLineHeightValue(blockEl.style.lineHeight) || "1";
  }
  return root.innerHTML;
}

/** CSS font-size for HTML output — Outlook uses pt. */
export function fontSizeToCSS(stored: string): string {
  if (!stored) {
    return "";
  }
  if (/px|pt|em|rem|%$/i.test(stored)) {
    return stored;
  }
  return `${stored}pt`;
}

/** @deprecated alias — returns pt number for UI, like Outlook */
export function normalizeFontSizeValue(size: string): string {
  return parseFontSizeFromHTML(size);
}

function renderFontSizeStyle(attributes: { fontSize?: string | null }) {
  if (!attributes.fontSize) {
    return {};
  }
  return {
    style: `font-size: ${fontSizeToCSS(parseFontSizeFromHTML(String(attributes.fontSize)))}`,
  };
}

function fontSizeMarkValue(fontSize: string): string {
  let stored = parseFontSizeFromHTML(fontSizeToCSS(fontSize));
  return stored ? fontSizeToCSS(stored) : "";
}

function mergeTextStyleAttrs(
  existing: Record<string, unknown> | null | undefined,
  patch: Record<string, unknown | null>,
): Record<string, unknown> | null {
  let attrs: Record<string, unknown> = { ...(existing ?? {}) };
  for (let [key, value] of Object.entries(patch)) {
    if (value == null || value === "") {
      delete attrs[key];
    } else {
      attrs[key] = value;
    }
  }
  return Object.keys(attrs).length ? attrs : null;
}

function selectionTextRange(state: import("@tiptap/pm/state").EditorState): { from: number; to: number } {
  let { from, to, empty } = state.selection;
  if (!empty) {
    return { from, to };
  }
  let $from = state.selection.$from;
  let depth = $from.depth;
  while (depth > 0 && !$from.node(depth).isTextblock) {
    depth--;
  }
  return { from: $from.start(depth), to: $from.end(depth) };
}

function applyTextStylePatchToRange(
  state: import("@tiptap/pm/state").EditorState,
  tr: import("@tiptap/pm/state").Transaction,
  from: number,
  to: number,
  patch: Record<string, unknown | null>,
) {
  let markType = state.schema.marks.textStyle;
  if (!markType || from >= to) {
    return;
  }
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) {
      return;
    }
    let markFrom = Math.max(from, pos);
    let markTo = Math.min(to, pos + node.nodeSize);
    if (markFrom >= markTo) {
      return;
    }
    let existing = markType.isInSet(node.marks);
    let attrs = mergeTextStyleAttrs(existing?.attrs, patch);
    if (attrs) {
      tr.addMark(markFrom, markTo, markType.create(attrs));
    } else {
      tr.removeMark(markFrom, markTo, markType);
    }
  });
}

/** Apply font size to every text node in the selection (works inside Outlook tables). */
function fontSizeCommands() {
  return {
    setFontSize: (fontSize: string) => ({ state, dispatch }) => {
      let cssValue = fontSizeMarkValue(fontSize);
      if (!cssValue) {
        return false;
      }
      let { from, to } = selectionTextRange(state);
      let tr = state.tr;
      if (from === to) {
        let markType = state.schema.marks.textStyle;
        if (!markType) {
          return false;
        }
        let stored = markType.isInSet(state.storedMarks ?? state.selection.$from.marks());
        let attrs = mergeTextStyleAttrs(stored?.attrs, { fontSize: cssValue });
        if (attrs) {
          tr.addStoredMark(markType.create(attrs));
        }
        dispatch?.(tr);
        return true;
      }
      applyTextStylePatchToRange(state, tr, from, to, { fontSize: cssValue });
      dispatch?.(tr);
      return true;
    },
    unsetFontSize: () => ({ state, dispatch }) => {
      let { from, to } = selectionTextRange(state);
      let tr = state.tr;
      if (from === to) {
        let markType = state.schema.marks.textStyle;
        if (!markType) {
          return false;
        }
        let stored = markType.isInSet(state.storedMarks ?? state.selection.$from.marks());
        let attrs = mergeTextStyleAttrs(stored?.attrs, { fontSize: null });
        if (attrs) {
          tr.addStoredMark(markType.create(attrs));
        } else {
          tr.removeStoredMark(markType);
        }
        dispatch?.(tr);
        return true;
      }
      applyTextStylePatchToRange(state, tr, from, to, { fontSize: null });
      dispatch?.(tr);
      return true;
    },
  };
}

/** Font size on inline textStyle marks only (Outlook-style pt in HTML output). */
const FontSizeExtension = Extension.create({
  name: "fontSize",
  addOptions() {
    return {
      types: ["textStyle"],
    };
  },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: element => {
              let parsed = parseFontSizeFromHTMLElement(element);
              return parsed ? fontSizeToCSS(parsed) : null;
            },
            renderHTML: attributes => renderFontSizeStyle(attributes),
          },
        },
      },
    ];
  },
  addCommands() {
    return fontSizeCommands();
  },
});

const lineHeightTypes = ["paragraph", "heading", "tableCell", "tableHeader", "blockquote"];

const LineHeight = Extension.create({
  name: "lineHeight",
  addOptions() {
    return {
      types: lineHeightTypes,
    };
  },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: element => {
              let value = element.style.lineHeight?.replace(/['"]+/g, "") ?? "";
              if (!value) {
                return null;
              }
              return normalizeLineHeightValue(value) || "1";
            },
            renderHTML: attributes => {
              if (!attributes.lineHeight) {
                return {};
              }
              return {
                style: `line-height: ${attributes.lineHeight}`,
              };
            },
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setLineHeight: (lineHeight: string) => ({ chain, editor }) => {
        let value = normalizeLineHeightValue(lineHeight);
        for (let type of lineHeightTypes) {
          if (editor.isActive(type)) {
            if (value) {
              return chain().focus().updateAttributes(type, { lineHeight: value }).run();
            }
            return chain().focus().resetAttributes(type, "lineHeight").run();
          }
        }
        if (value) {
          return chain().focus().updateAttributes("paragraph", { lineHeight: value }).run();
        }
        return chain().focus().resetAttributes("paragraph", "lineHeight").run();
      },
      unsetLineHeight: () => ({ chain, editor }) => {
        for (let type of lineHeightTypes) {
          if (editor.isActive(type)) {
            return chain().focus().resetAttributes(type, "lineHeight").run();
          }
        }
        return chain().focus().resetAttributes("paragraph", "lineHeight").run();
      },
    };
  },
});

function parseHexColor(hex: string): { r: number; g: number; b: number } | null {
  let match = hex.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!match) {
    return null;
  }
  let value = parseInt(match[1], 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

/** Pick readable text on Outlook-style highlight fills. */
export function textColorForHighlight(background: string): string {
  let rgb = parseHexColor(background);
  if (!rgb) {
    return "#000000";
  }
  let luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  return luminance > 0.55 ? "#000000" : "#FFFFFF";
}

/** Background fill only — no underline artifacts, readable foreground. */
const ComposeHighlight = Highlight.extend({
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (element) =>
          element.getAttribute("data-color") ||
          getStyleProperty(element, "background-color") ||
          element.style.backgroundColor,
        renderHTML: (attributes) => {
          if (!attributes.color) {
            return {};
          }
          let fg = textColorForHighlight(attributes.color);
          return {
            "data-color": attributes.color,
            style: `background-color: ${attributes.color}; color: ${fg}`,
          };
        },
      },
    };
  },
});

/** Keep legacy Outlook/Word table attributes when quoting HTML into the composer. */
function preserveHtmlAttribute(name: string) {
  return {
    default: null as string | null,
    parseHTML: (element: HTMLElement) => element.getAttribute(name),
    renderHTML: (attributes: Record<string, unknown>) => {
      let value = attributes[name];
      return typeof value == "string" && value ? { [name]: value } : {};
    },
  };
}

function removeCssProperty(style: string | null, property: string): string | null {
  if (!style) {
    return style;
  }
  if (typeof document !== "undefined") {
    let element = document.createElement("div");
    element.setAttribute("style", style);
    element.style.removeProperty(property);
    return element.getAttribute("style") || null;
  }
  let filtered = style.split(";").filter(declaration =>
    declaration.split(":", 1)[0].trim().toLowerCase() != property).join(";").trim();
  return filtered || null;
}

function preserveBlockStyle() {
  return {
    default: null as string | null,
    parseHTML: (element: HTMLElement) => removeCssProperty(element.getAttribute("style"), "line-height"),
    renderHTML: (attributes: Record<string, unknown>) => {
      let value = typeof attributes.style == "string" ? attributes.style : null;
      let withoutLineHeight = removeCssProperty(value, "line-height");
      return withoutLineHeight ? { style: withoutLineHeight } : {};
    },
  };
}

const composeTableAttributes = {
  style: preserveHtmlAttribute("style"),
  width: preserveHtmlAttribute("width"),
  border: preserveHtmlAttribute("border"),
  cellpadding: preserveHtmlAttribute("cellpadding"),
  cellspacing: preserveHtmlAttribute("cellspacing"),
  role: preserveHtmlAttribute("role"),
};

const composeTableCellAttributes = {
  style: preserveHtmlAttribute("style"),
  width: preserveHtmlAttribute("width"),
  height: preserveHtmlAttribute("height"),
  bgcolor: preserveHtmlAttribute("bgcolor"),
  valign: preserveHtmlAttribute("valign"),
  align: preserveHtmlAttribute("align"),
};

const ComposeTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...composeTableAttributes,
    };
  },
});

const ComposeTableRow = TableRow.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      style: preserveHtmlAttribute("style"),
      valign: preserveHtmlAttribute("valign"),
      align: preserveHtmlAttribute("align"),
    };
  },
});

const ComposeTableCell = TableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...composeTableCellAttributes,
    };
  },
});

const ComposeTableHeader = TableHeader.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...composeTableCellAttributes,
    };
  },
});

const composeTableExtensions = [
  ComposeTable.configure({
    resizable: false,
    HTMLAttributes: {
      style: "border-collapse: collapse;",
    },
  }),
  ComposeTableRow,
  ComposeTableHeader,
  ComposeTableCell,
];

const composeBlockStyle = Extension.create({
  name: "composeBlockStyle",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading", "blockquote", "codeBlock"],
        attributes: {
          style: preserveBlockStyle(),
        },
      },
    ];
  },
});

export type ComposeTextAlignment = "left" | "center" | "right" | "justify";

export interface ComposeDefaultBlockFormatting {
  lineHeight: string;
  textAlign: ComposeTextAlignment;
  paragraphSpacing: string;
  firstLineIndent: string;
}

/** Apply default paragraph formatting without touching quoted or signature blocks. */
export function applyComposeDefaultBlockFormatting(
  editor: import("@tiptap/core").Editor,
  from: number,
  to: number,
  formatting: ComposeDefaultBlockFormatting,
): boolean {
  let tr = editor.state.tr;
  editor.state.doc.nodesBetween(from, to, (node, position) => {
    if (node.type.name === "footer") {
      return false;
    }
    if (!node.isTextblock || !["paragraph", "heading"].includes(node.type.name)) {
      return true;
    }

    let attrs = { ...node.attrs };
    let changed = false;
    let nextLineHeight = formatting.lineHeight || null;
    let nextTextAlign = formatting.textAlign == "left" ? null : formatting.textAlign;
    if (attrs.lineHeight != nextLineHeight) {
      attrs.lineHeight = nextLineHeight;
      changed = true;
    }
    if (attrs.textAlign != nextTextAlign) {
      attrs.textAlign = nextTextAlign;
      changed = true;
    }

    let style = typeof(attrs.style) == "string" ? attrs.style : "";
    style = updateStyleProperty(style, "margin-bottom", formatting.paragraphSpacing && formatting.paragraphSpacing != "0"
      ? `${formatting.paragraphSpacing}pt`
      : null);
    style = updateStyleProperty(style, "text-indent", formatting.firstLineIndent && formatting.firstLineIndent != "0"
      ? `${formatting.firstLineIndent}pt`
      : null);
    let nextStyle = style || null;
    if (attrs.style != nextStyle) {
      attrs.style = nextStyle;
      changed = true;
    }

    if (changed) {
      tr.setNodeMarkup(position, node.type, attrs, node.marks);
    }
    return true;
  });
  if (!tr.docChanged) {
    return false;
  }
  editor.view.dispatch(tr);
  return true;
}

function updateStyleProperty(style: string, property: string, value: string | null): string {
  if (typeof document == "undefined") {
    return style;
  }
  let element = document.createElement("span");
  if (style) {
    element.setAttribute("style", style);
  }
  if (value) {
    element.style.setProperty(property, value);
  } else {
    element.style.removeProperty(property);
  }
  return element.getAttribute("style") || "";
}

/** Rich-text extensions for the mail compose editor (Outlook-style). */
export const composeEditorExtensions = [
  TextStyle,
  FontFamily.configure({
    types: ["textStyle"],
  }),
  FontSizeExtension,
  LineHeight,
  composeBlockStyle,
  Color.configure({
    types: ["textStyle"],
  }),
  ComposeHighlight.configure({
    multicolor: true,
  }),
  Underline,
  TextAlign.configure({
    types: ["heading", "paragraph"],
    alignments: ["left", "center", "right", "justify"],
  }),
  ...composeTableExtensions,
];

/** Signature editor in settings — inline font size and block line spacing. */
export const signatureEditorExtensions = [
  TextStyle,
  FontFamily.configure({
    types: ["textStyle"],
  }),
  FontSizeExtension,
  LineHeight,
  composeBlockStyle,
  Color.configure({
    types: ["textStyle"],
  }),
  ComposeHighlight.configure({
    multicolor: true,
  }),
  Underline,
  TextAlign.configure({
    types: ["heading", "paragraph"],
    alignments: ["left", "center", "right", "justify"],
  }),
  ...composeTableExtensions,
];

/** Outlook-style defaults for new compose messages. */
export const composeDefaultFontFamily = "Aptos, Calibri, Arial, sans-serif";
export const composeDefaultFontSize = "11";
export const composeDefaultTextColor = "";
export const composeDefaultLineHeight = "";
export const composeDefaultTextAlign: ComposeTextAlignment = "left";
export const composeDefaultParagraphSpacing = "0";
export const composeDefaultFirstLineIndent = "0";

export const composeFontFamilies = [
  { label: () => gt`System`, value: "" },
  { label: () => "Aptos", value: composeDefaultFontFamily },
  { label: () => "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: () => "Calibri", value: "Calibri, Arial, sans-serif" },
  { label: () => "Georgia", value: "Georgia, serif" },
  { label: () => "Times New Roman", value: "\"Times New Roman\", Times, serif" },
  { label: () => "Courier New", value: "\"Courier New\", Courier, monospace" },
];

export const composeFontSizes = [
  "5", "5.5", "6.5", "7.5", "8", "9", "10", "10.5", "11", "12",
  "14", "16", "18", "20", "22", "24", "26", "28", "36", "48", "72",
];

/** Outlook line spacing multipliers; empty value = single (default). */
export const composeLineHeights = [
  { value: "", label: "1" },
  { value: "1.15", label: "1,15" },
  { value: "1.5", label: "1,5" },
  { value: "2", label: "2" },
  { value: "2.5", label: "2,5" },
  { value: "3", label: "3" },
];

export const composeTextAlignments: ComposeTextAlignment[] = ["left", "center", "right", "justify"];
export const composeParagraphSpacingValues = ["0", "4", "8", "12", "16"];
export const composeFirstLineIndentValues = ["0", "12", "24", "36"];

export function normalizeComposeTextColor(value: unknown): string {
  return typeof(value) == "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : "";
}

/** Display font size like Outlook (7.5 → 7,5 in ru locales). */
export function formatFontSizeLabel(size: string): string {
  return size.replace(".", ",");
}

export function normalizeLineHeightValue(value: string): string {
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

export function formatLineHeightLabel(value: string): string {
  if (!value) {
    return "1";
  }
  return value.replace(".", ",");
}

export const composeTextColors = [
  "#000000", "#C00000", "#FF0000", "#FFC000", "#FFFF00",
  "#92D050", "#00B050", "#00B0F0", "#0070C0", "#002060",
  "#7030A0", "#FFFFFF", "#808080", "#C0C0C0", "#EEEAE3",
];

export const composeDefaultHighlightColor = "#FFFF00";

/** Outlook text highlight palette (5×3). */
export const composeHighlightColors = [
  "#FFFF00", "#00FF00", "#00FFFF", "#FF00FF", "#0000FF",
  "#FF0000", "#000080", "#008080", "#008000", "#800080",
  "#800000", "#808000", "#808080", "#C0C0C0", "#000000",
];

export const composeHighlightColorsHighContrast = [
  "#FF0000", "#000080", "#008080", "#008000", "#800080",
  "#800000", "#808000", "#808080", "#000000",
];

export function currentTextStyle(editor: import("@tiptap/core").Editor) {
  return editor.getAttributes("textStyle") ?? {};
}

export function currentFontFamily(editor: import("@tiptap/core").Editor): string {
  return currentTextStyle(editor).fontFamily ?? "";
}

export function currentFontSize(editor: import("@tiptap/core").Editor): string {
  return parseFontSizeFromHTML(currentTextStyle(editor).fontSize ?? "");
}

export function currentLineHeight(editor: import("@tiptap/core").Editor): string {
  for (let type of lineHeightTypes) {
    if (editor.isActive(type)) {
      return normalizeLineHeightValue(editor.getAttributes(type).lineHeight ?? "");
    }
  }
  return normalizeLineHeightValue(editor.getAttributes("paragraph").lineHeight ?? "");
}

export function currentTextColor(editor: import("@tiptap/core").Editor): string {
  return currentTextStyle(editor).color ?? "#0B0F14";
}

export function currentHighlightColor(editor: import("@tiptap/core").Editor): string {
  return editor.getAttributes("highlight").color ?? composeDefaultHighlightColor;
}

export function highlightPreviewColor(editor: import("@tiptap/core").Editor): string {
  if (editor.isActive("highlight")) {
    return editor.getAttributes("highlight").color ?? composeDefaultHighlightColor;
  }
  return composeDefaultHighlightColor;
}
