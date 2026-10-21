/**
 * Перевод HTML письма с сохранением разметки.
 *
 * HTML письма недоверенный и уже санитизирован (`EMail.html`). Здесь он
 * разбирается в неактивном документе DOMParser (скрипты не выполняются,
 * картинки не грузятся), и меняется только текст:
 *
 * - Текст делится на части по блокам: абзац, ячейка, пункт списка. Внутри
 *   части остаются строчные теги (`<b>`, `<a>`, `<img>`, `<br>`), чтобы
 *   движок переводил предложение целиком и ставил теги на свои места.
 * - В движок уходят только голые теги с номером (`<a data-jt="3">`), без
 *   атрибутов: ни адреса ссылок, ни стили не покидают письмо и не могут
 *   быть изменены переводом.
 * - Перевод собирается из клонов исходных элементов по номеру; от ответа
 *   движка берётся только текст (textContent). Если движок потерял или
 *   добавил тег, часть переводится заново по отдельным текстовым узлам —
 *   разметка остаётся как в оригинале.
 */

/** Переводит пачку текстов. `isHTML` — тексты содержат строчные теги. */
export type TranslateBatch = (texts: string[], isHTML: boolean) => Promise<string[]>;

export interface TranslationSegment {
  /** Что отправить движку */
  source: string;
  isHTML: boolean;
  /** Вставляет перевод в документ. false — разметка в переводе не сходится */
  apply(translated: string): boolean;
  /** Части, которыми переводить, если apply() вернул false */
  fallback(): TranslationSegment[];
}

export interface TranslateHTMLOptions {
  /** Сколько символов отправлять движку за раз */
  maxChunkChars?: number;
  maxChunkItems?: number;
  /** Длиннее — абзац делится по `<br>` */
  maxSegmentChars?: number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

export const kDefaultMaxChunkChars = 4000;
export const kDefaultMaxChunkItems = 40;
export const kDefaultMaxSegmentChars = 1500;
const kMarkerAttribute = "data-jt";

const kBlockTags = new Set([
  "address", "article", "aside", "blockquote", "body", "caption", "center", "dd", "details",
  "dialog", "dir", "div", "dl", "dt", "fieldset", "figcaption", "figure", "footer", "form",
  "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr", "html", "legend", "li",
  "main", "menu", "nav", "ol", "p", "pre", "section", "summary", "table", "tbody", "td",
  "tfoot", "th", "thead", "tr", "ul",
]);
const kBlockSelector = [...kBlockTags].join(",");
/** Не текст письма: пропускаются целиком */
const kBarrierTags = new Set([
  "script", "style", "noscript", "template", "title", "head", "textarea", "select", "option",
  "svg", "math", "iframe", "object",
]);
/** Код и т. п.: остаётся в предложении, но не переводится */
const kProtectedTags = new Set(["code", "kbd", "samp", "var"]);

const kLetter = /\p{L}/u;

function tagOf(node: Node): string {
  return (node as Element).localName?.toLowerCase() ?? "";
}

function isElement(node: Node): node is Element {
  return node.nodeType == 1;
}

function isText(node: Node): node is Text {
  return node.nodeType == 3;
}

function isNoTranslate(el: Element): boolean {
  return el.getAttribute("translate") == "no" || el.classList?.contains("notranslate");
}

function isProtected(el: Element): boolean {
  return kProtectedTags.has(tagOf(el)) || isNoTranslate(el);
}

function isBarrier(el: Element): boolean {
  return kBarrierTags.has(tagOf(el));
}

function isInline(el: Element): boolean {
  if (kBlockTags.has(tagOf(el)) || isBarrier(el)) {
    return false;
  }
  return !el.querySelector(kBlockSelector);
}

function hasLetters(text: string): boolean {
  return kLetter.test(text);
}

/** Текст, который переводится: без кода и `translate="no"` */
function translatableText(nodes: Node[]): string {
  let text = "";
  let visit = (node: Node) => {
    if (isText(node)) {
      text += node.data;
    } else if (isElement(node) && !isProtected(node) && !isBarrier(node)) {
      node.childNodes.forEach(visit);
    }
  };
  nodes.forEach(visit);
  return text;
}

function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function splitWhitespace(text: string): { lead: string; core: string; trail: string } {
  let match = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
  return { lead: match[1], core: match[2], trail: match[3] };
}

/** Знаки цитаты `>` в начале строки обычного текста не переводятся */
function splitQuotePrefix(line: string): { prefix: string; core: string; trail: string } {
  let [, prefix, rest] = /^(\s*(?:>\s*)*)([\s\S]*)$/.exec(line);
  let { core, trail } = splitWhitespace(rest);
  return { prefix, core, trail };
}

/** Один текстовый узел. Пробелы по краям остаются как были. */
class TextNodeSegment implements TranslationSegment {
  readonly isHTML = false;
  readonly source: string;
  private lead: string;
  private trail: string;

  constructor(private node: Text) {
    let { lead, core, trail } = splitWhitespace(node.data);
    this.source = core;
    this.lead = lead;
    this.trail = trail;
  }

  apply(translated: string): boolean {
    this.node.data = this.lead + translated + this.trail;
    return true;
  }

  fallback(): TranslationSegment[] {
    return [];
  }
}

/** Строка внутри `<pre>`: переносы строк — часть оформления */
class PreLineSegment implements TranslationSegment {
  readonly isHTML = false;
  readonly source: string;
  private lead: string;
  private trail: string;

  constructor(private node: Text, private lines: string[], private index: number) {
    let { prefix, core, trail } = splitQuotePrefix(lines[index]);
    this.source = core;
    this.lead = prefix;
    this.trail = trail;
  }

  apply(translated: string): boolean {
    this.lines[this.index] = this.lead + translated.replace(/\s*\n\s*/g, " ") + this.trail;
    this.node.data = this.lines.join("\n");
    return true;
  }

  fallback(): TranslationSegment[] {
    return [];
  }
}

function textNodeSegments(nodes: Node[]): TranslationSegment[] {
  let segments: TranslationSegment[] = [];
  let visit = (node: Node) => {
    if (isText(node)) {
      if (hasLetters(node.data)) {
        segments.push(new TextNodeSegment(node));
      }
    } else if (isElement(node) && !isProtected(node) && !isBarrier(node)) {
      node.childNodes.forEach(visit);
    }
  };
  nodes.forEach(visit);
  return segments;
}

/** Подряд идущие строчные узлы одного блока: переводятся вместе, с тегами */
class InlineRunSegment implements TranslationSegment {
  readonly isHTML = true;
  readonly source: string;
  /** Номер в `data-jt` → исходный элемент */
  private originals = new Map<string, Element>();

  constructor(private nodes: Node[]) {
    let counter = 0;
    let serialize = (node: Node): string => {
      if (isText(node)) {
        return escapeText(node.data);
      }
      if (!isElement(node)) {
        return ""; // комментарии движку не нужны
      }
      let id = String(++counter);
      this.originals.set(id, node);
      let tag = tagOf(node);
      let open = `<${tag} ${kMarkerAttribute}="${id}">`;
      if (!node.firstChild && isVoidElement(node)) {
        return open;
      }
      let inner = "";
      node.childNodes.forEach(child => inner += serialize(child));
      return `${open}${inner}</${tag}>`;
    };
    this.source = nodes.map(serialize).join("");
  }

  apply(translated: string): boolean {
    let first = this.nodes[0];
    let parent = first?.parentNode;
    let doc = first?.ownerDocument;
    if (!parent || !doc || typeof DOMParser == "undefined") {
      return false;
    }
    let parsed = new DOMParser().parseFromString(`<!DOCTYPE html><body>${translated}`, "text/html");
    let used = new Set<string>();
    // Элементы внутри кода берутся вместе с ним и отдельно стоять не могут
    let originals = [...this.originals.values()];
    let insideProtected = new Set(originals.filter(el =>
      originals.some(other => other !== el && isProtected(other) && other.contains(el))));
    let rebuild = (source: Node, target: Node): boolean => {
      for (let child of Array.from(source.childNodes)) {
        if (isText(child)) {
          target.appendChild(doc.createTextNode(child.data));
          continue;
        }
        if (!isElement(child)) {
          continue;
        }
        let id = child.getAttribute(kMarkerAttribute) ?? "";
        let original = this.originals.get(id);
        if (!original || used.has(id) || tagOf(original) != tagOf(child) ||
            insideProtected.has(original)) {
          return false;
        }
        used.add(id);
        if (isProtected(original)) {
          // Код — как в оригинале, вместе со всем, что внутри
          target.appendChild(original.cloneNode(true));
          for (let [innerID, inner] of this.originals) {
            if (original.contains(inner)) {
              used.add(innerID);
            }
          }
          continue;
        }
        let clone = original.cloneNode(false) as Element;
        if (!rebuild(child, clone)) {
          return false;
        }
        target.appendChild(clone);
      }
      return true;
    };
    let fragment = doc.createDocumentFragment();
    if (!rebuild(parsed.body, fragment) || used.size != this.originals.size) {
      return false;
    }
    parent.insertBefore(fragment, first);
    for (let node of this.nodes) {
      node.parentNode?.removeChild(node);
    }
    return true;
  }

  fallback(): TranslationSegment[] {
    return textNodeSegments(this.nodes);
  }
}

const kVoidTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link",
  "meta", "source", "track", "wbr"]);

function isVoidElement(el: Element): boolean {
  return kVoidTags.has(tagOf(el));
}

function splitRunAtBreaks(run: Node[]): Node[][] {
  let parts: Node[][] = [[]];
  for (let node of run) {
    if (isElement(node) && tagOf(node) == "br") {
      parts.push([]);
    } else {
      parts.at(-1).push(node);
    }
  }
  return parts;
}

function preSegments(pre: Element, segments: TranslationSegment[]): void {
  let visit = (node: Node) => {
    if (isText(node)) {
      let lines = node.data.split("\n");
      lines.forEach((line, index) => {
        if (hasLetters(line)) {
          segments.push(new PreLineSegment(node, lines, index));
        }
      });
    } else if (isElement(node) && !isProtected(node) && !isBarrier(node)) {
      node.childNodes.forEach(visit);
    }
  };
  pre.childNodes.forEach(visit);
}

/** Разбивает содержимое элемента на части для перевода, по порядку в документе */
export function extractSegments(
  root: Element,
  maxSegmentChars = kDefaultMaxSegmentChars,
): TranslationSegment[] {
  let segments: TranslationSegment[] = [];
  let flush = (run: Node[]) => {
    if (!run.length || !hasLetters(translatableText(run))) {
      return;
    }
    let parts = translatableText(run).length > maxSegmentChars ? splitRunAtBreaks(run) : [run];
    for (let part of parts) {
      if (part.length && hasLetters(translatableText(part))) {
        segments.push(new InlineRunSegment(part));
      }
    }
  };
  let walk = (el: Element) => {
    if (isBarrier(el) || isProtected(el)) {
      return;
    }
    if (tagOf(el) == "pre") {
      preSegments(el, segments);
      return;
    }
    let run: Node[] = [];
    for (let child of Array.from(el.childNodes)) {
      if (isText(child) || (!isElement(child) && run.length)) {
        run.push(child);
      } else if (isElement(child) && isInline(child)) {
        run.push(child);
      } else if (isElement(child)) {
        flush(run);
        run = [];
        walk(child);
      }
    }
    flush(run);
  };
  walk(root);
  return segments;
}

/** Группирует части в запросы к движку; в одном запросе — части одного вида */
export function chunkSegments(
  segments: TranslationSegment[],
  maxChars = kDefaultMaxChunkChars,
  maxItems = kDefaultMaxChunkItems,
): TranslationSegment[][] {
  let chunks: TranslationSegment[][] = [];
  let current: TranslationSegment[] = [];
  let chars = 0;
  for (let segment of segments) {
    let tooBig = current.length && (chars + segment.source.length > maxChars ||
      current.length >= maxItems || current[0].isHTML != segment.isHTML);
    if (tooBig) {
      chunks.push(current);
      current = [];
      chars = 0;
    }
    current.push(segment);
    chars += segment.source.length;
  }
  if (current.length) {
    chunks.push(current);
  }
  return chunks;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException("Aborted", "AbortError");
  }
}

/** Переводит части по запросам; части с несошедшейся разметкой — повторно по текстовым узлам */
export async function translateSegments(
  segments: TranslationSegment[],
  translate: TranslateBatch,
  options: TranslateHTMLOptions = {},
): Promise<void> {
  let maxChars = options.maxChunkChars ?? kDefaultMaxChunkChars;
  let maxItems = options.maxChunkItems ?? kDefaultMaxChunkItems;
  let total = segments.length;
  let done = 0;
  let pending = segments;
  options.onProgress?.(done, total);
  while (pending.length) {
    let retry: TranslationSegment[] = [];
    for (let chunk of chunkSegments(pending, maxChars, maxItems)) {
      throwIfAborted(options.signal);
      let translated = await translate(chunk.map(segment => segment.source), chunk[0].isHTML);
      throwIfAborted(options.signal);
      if (!Array.isArray(translated) || translated.length != chunk.length) {
        throw new Error("The translation service returned a different number of texts");
      }
      chunk.forEach((segment, i) => {
        if (!segment.apply(String(translated[i] ?? ""))) {
          let fallback = segment.fallback();
          retry.push(...fallback);
          total += fallback.length;
        }
      });
      done += chunk.length;
      options.onProgress?.(done, total);
    }
    pending = retry;
  }
}

/**
 * @param html санитизированный HTML письма
 * @returns HTML с переводом, той же разметкой и теми же атрибутами
 */
export async function translateHTML(
  html: string,
  translate: TranslateBatch,
  options: TranslateHTMLOptions = {},
): Promise<string> {
  if (!html) {
    return html;
  }
  let doc = new DOMParser().parseFromString(html, "text/html");
  let segments = extractSegments(doc.body, options.maxSegmentChars ?? kDefaultMaxSegmentChars);
  if (!segments.length) {
    return html;
  }
  await translateSegments(segments, translate, options);
  return doc.documentElement.outerHTML;
}

/** Строки обычного текста; знаки цитаты `>` в начале строки не переводятся */
export async function translatePlainText(
  text: string,
  translate: TranslateBatch,
  options: TranslateHTMLOptions = {},
): Promise<string> {
  if (!text) {
    return text;
  }
  let lines = text.split(/\r?\n/);
  let segments: TranslationSegment[] = [];
  lines.forEach((line, index) => {
    let { prefix, core, trail } = splitQuotePrefix(line);
    if (!hasLetters(core)) {
      return;
    }
    segments.push({
      source: core,
      isHTML: false,
      apply(translated: string) {
        lines[index] = prefix + translated.replace(/\s*\n\s*/g, " ") + trail;
        return true;
      },
      fallback: () => [],
    });
  });
  await translateSegments(segments, translate, options);
  return lines.join("\n");
}
