import { getBaseDomainFromURL } from "./netUtil";
import type { URLString } from "./util";
import DOMPurify from "dompurify"; // https://github.com/cure53/DOMPurify
import { compile as makeHTMLToText } from "html-to-text";
import markdownit from "markdown-it";
import { gt } from "../../l10n/l10n";
import { kMailImageSourceAttribute } from "../Mail/mailImage";
import { normalizeMailLinkURL } from "../Mail/SignatureHTML";

let htmlToText: (html: string) => string;

export function convertHTMLToText(html: string): string {
  if (!htmlToText) {
    const options = {
      formatters: {
        removeFormatter: () => { },
      },
      selectors: [
        {
          selector: "img",
          format: "removeFormatter",
        },
        {
          selector: "style",
          format: "removeFormatter",
        },
      ],
    };
    htmlToText = makeHTMLToText(options);
  }
  let text = htmlToText(sanitizeHTML(html));
  return text;
}

let markdownitInstance;
export function convertTextToHTML(plaintext: string): string {
  if (!markdownitInstance) {
    markdownitInstance = markdownit({
      linkify: true,
      breaks: true,
    });
  }
  let html = markdownitInstance.render(plaintext);
  return sanitizeHTML(html);
}

export function fixNewlines(text: string): string {
  return text?.replace(/\r?\n/g, "\r\n");
}

export function sanitizeHTML(html: string): string {
  if (!html) {
    return "";
  }
  includeExternal = false;
  let sanitized = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["svg", "mathml"],
    WHOLE_DOCUMENT: true,
  });
  return linkifyPhoneNumbers(sanitized);
}

export function sanitizeHTMLExternal(html: string): string {
  if (!html) {
    return "";
  }
  includeExternal = true;
  let sanitized = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["svg", "mathml"],
    WHOLE_DOCUMENT: true,
  });
  includeExternal = false;
  return linkifyPhoneNumbers(sanitized);
}

const kPhoneCandidateRegex = /(?:\+?\d[\d\s().-]{5,}\d)(?:\s*(?:доб\.?|ext\.?)\s*\d+)?/giu;

/**
 * Делает номера телефонов активными и в просмотрщике, и в нативной цитате.
 * Ссылками становятся только явно похожие на телефон номера, поэтому номера
 * заказов и даты остаются обычным текстом.
 */
export function linkifyPhoneNumbers(html: string): string {
  if (!html || typeof DOMParser == "undefined") {
    return html;
  }
  kPhoneCandidateRegex.lastIndex = 0;
  if (!kPhoneCandidateRegex.test(html)) {
    return html;
  }
  kPhoneCandidateRegex.lastIndex = 0;
  let doc = new DOMParser().parseFromString(html, "text/html");
  if (!doc.body) {
    return html;
  }
  let textNodes: Text[] = [];
  let walker = doc.createTreeWalker(doc.body, typeof NodeFilter == "undefined" ? 4 : NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    let text = node as Text;
    let parent = text.parentElement;
    if (!parent || parent.closest("a,button,script,style,textarea,select,option,pre")) {
      continue;
    }
    textNodes.push(text);
  }

  for (let text of textNodes) {
    kPhoneCandidateRegex.lastIndex = 0;
    let matches = [...text.data.matchAll(kPhoneCandidateRegex)];
    if (!matches.length) {
      continue;
    }
    let fragment = doc.createDocumentFragment();
    let lastIndex = 0;
    let changed = false;
    for (let match of matches) {
      let candidate = match[0];
      if (!isPhoneCandidate(candidate)) {
        continue;
      }
      let start = match.index ?? 0;
      fragment.append(text.data.slice(lastIndex, start));
      let link = doc.createElement("a");
      link.href = phoneURL(candidate);
      link.className = "jackdaw-phone-link";
      link.setAttribute("data-jackdaw-phone", "true");
      link.append(candidate);
      fragment.append(link);
      lastIndex = start + candidate.length;
      changed = true;
    }
    if (changed) {
      fragment.append(text.data.slice(lastIndex));
      text.replaceWith(fragment);
    }
  }
  let doctype = doc.doctype ? `<!DOCTYPE ${doc.doctype.name}>` : "";
  return doctype + doc.documentElement.outerHTML;
}

function isPhoneCandidate(candidate: string): boolean {
  let mainNumber = candidate.replace(/\s*(?:доб\.?|ext\.?)\s*\d+\s*$/iu, "").trim();
  let digits = mainNumber.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) {
    return false;
  }
  if (/\b(?:\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{4}[-/.]\d{1,2}[-/.]\d{1,2})\b/.test(mainNumber) || mainNumber.includes(":")) {
    return false;
  }
  let spaces = (mainNumber.match(/\s/g) ?? []).length;
  return mainNumber.includes("+") || mainNumber.includes("(") || mainNumber.includes("-") || spaces >= 3;
}

function phoneURL(candidate: string): string {
  let extension = candidate.match(/\s*(?:доб\.?|ext\.?)\s*(\d+)\s*$/iu)?.[1];
  let mainNumber = candidate.replace(/\s*(?:доб\.?|ext\.?)\s*\d+\s*$/iu, "");
  let digits = mainNumber.replace(/\D/g, "");
  let normalized = mainNumber.trim().startsWith("+") ? `+${digits}` : digits;
  return `tel:${normalized}${extension ? `;ext=${extension}` : ""}`;
}

// <copied from="https://github.com/cure53/DOMPurify/blob/main/demos/hooks-proxy-demo.html" modified="true" license="Apache 2.0">
const proxy = 'http://localhost:5454/proxy?url=';
const cssURLRegex = /(url\("?)(?!data:)/gim;
const urlAttributes = ['action', 'background', 'href', 'poster', 'src', 'srcset'];

function urlAttribute(url: URLString, includeExternal = false) {
  if (!url) {
    return "";
  }
  if (url.startsWith("data:image/") || url.substring(0, 4).toLowerCase() == "cid:" ||
    includeExternal && /^https?:\/\//i.test(url)) {
    return url; // or `${proxy}${escape(url)}`;
  }
  return "";
}

function addStyles(output: string[], styles: CSSStyleDeclaration) {
  for (let style of [...styles].reverse()) {
    if (styles[style]) {
      if (cssURLRegex.test(styles[style])) {
        styles[style] = includeExternal
          ? styles[style].replace(cssURLRegex, `$1${proxy}`)
          : styles[style].replace(cssURLRegex, `$1about:blank`);
      }
      output.push(`${style}: ${styles[style]};`);
    }
  }
};

function addCSSRules(output: string[], cssRules: ArrayLike<any> = []) {
  for (let rule of Array.from(cssRules).reverse()) {
    switch (rule.type) {
      case CSSRule.STYLE_RULE:
        output.push(`${rule.selectorText} {`);
        if (rule.style) {
          addStyles(output, rule.style);
        }
        output.push('}\n');
        break;
      case CSSRule.MEDIA_RULE:
        output.push(`@media ${rule.media.mediaText} {`);
        addCSSRules(output, rule?.cssRules);
        output.push('}\n');
        break;
      case CSSRule.FONT_FACE_RULE:
        output.push('@font-face {');
        if (rule.style) {
          addStyles(output, rule.style);
        }
        output.push('}\n');
        break;
      case CSSRule.KEYFRAMES_RULE:
        output.push(`@keyframes ${rule.name} {`);
        for (let frame of [...rule.cssRules].reverse()) {
          if (frame.type === CSSRule.KEYFRAME_RULE && frame.keyText) {
            output.push(`${frame.keyText} {`);
            if (frame.style) {
              addStyles(output, frame.style);
            }
            output.push('}\n');
          }
        }
        output.push('}\n');
        break;
      default:
        break;
    }
  }
};

if (!DOMPurify.addHook) { // for unit tests only. TODO Load it in vitests as well
  DOMPurify.addHook = () => null;
  DOMPurify.sanitize = ((html: string) => html) as typeof DOMPurify.sanitize;
  console.log("Warning: DOMPurify not loaded. Normal in unit tests, otherwise dangerous.");
}

DOMPurify.addHook('uponSanitizeElement', (node, data) => {
  if (data.tagName === 'style') {
    const output: string[] = [];
    addCSSRules(output, (node as HTMLStyleElement)?.sheet?.cssRules);
    node.textContent = output.join("\n");
  }
});

let includeExternal = false;
DOMPurify.addHook('afterSanitizeAttributes', node => {
  for (let attribute of urlAttributes) {
    if (node.hasAttribute(attribute)) {
      if (node.tagName.toLowerCase() == "a" && attribute == "href") {
        try {
          // New window requests are caught by e2 index.ts setWindowOpenHandler()
          node.setAttribute("target", "_blank");
          node.setAttribute("source", "convert-html");
          let url = node.getAttribute(attribute);
          if (!url) {
            continue;
          }
          let normalizedURL = normalizeMailLinkURL(url);
          if (normalizedURL && normalizedURL != url) {
            node.setAttribute(attribute, normalizedURL);
            url = normalizedURL;
          }
          if (/^tel:\+?[\d().\s-]+(?:;ext=\d+)?$/i.test(url)) {
            node.setAttribute("title", url);
            continue;
          }
          let domain = getBaseDomainFromURL(url);
          node.setAttribute("title", domain + "\n\n" + url.substring(0, 120));
        } catch (ex) {
          node.setAttribute(attribute, "");
          node.setAttribute("title", gt`Broken URL`);
        }
      } else if ((node.tagName.toLocaleLowerCase() == "img" && attribute == "src") ||
          (node.tagName.toLocaleLowerCase() == "link" && node.getAttribute("rel") == "stylesheet" && attribute == "href")) {
        let orgURL = node.getAttribute(attribute);
        let isImage = node.tagName.toLocaleLowerCase() == "img" && attribute == "src";
        if (isImage && !includeExternal && /^https?:\/\//i.test(orgURL ?? "")) {
          node.setAttribute(kMailImageSourceAttribute, orgURL!);
        }
        let newURL = urlAttribute(orgURL, includeExternal);
        node.setAttribute(attribute, newURL);
      } else {
        let orgURL = node.getAttribute(attribute);
        let newURL = urlAttribute(orgURL);
        node.setAttribute(attribute, newURL);
      }
    }
  }

  if (node.hasAttribute('style')) {
    const styles = (node as HTMLElement).style;
    const output = [];
    for (let style of [...styles].reverse()) {
      if (styles[style] && cssURLRegex.test(styles[style])) {
        styles[style] = includeExternal
          ? styles[style].replace(cssURLRegex, `$1${proxy}`)
          : styles[style].replace(cssURLRegex, `$1about:blank`);
      }
      output.push(`${style}: ${styles[style]};`);
    }

    node.setAttribute('style', output.join('') || node.removeAttribute('style') || '');
  }
});
// </copied>
