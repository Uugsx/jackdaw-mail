/**
 * Замена выделенного в письме текста переводом прямо на месте.
 * Функция самодостаточна: в Electron `<webview>` она передаётся строкой (`toString`)
 * и выполняется внутри страницы письма; в iframe вызывается с его `window`.
 */
export function installSelectionTools(win: any): void {
  if (win.__jackdawSel) {
    return;
  }
  let doc = win.document;
  let pending: { node: Text, start: number, end: number }[] = [];

  function currentRange(): Range | null {
    let sel = win.getSelection();
    if (sel && sel.rangeCount && !sel.isCollapsed) {
      return sel.getRangeAt(0);
    }
    return win.__jackdawRange || null;
  }

  /** Куски текста в выделении (по текстовым узлам, чтобы сохранить ссылки и оформление) */
  function collect(): string[] {
    pending = [];
    let range = currentRange();
    if (!range) {
      return [];
    }
    let root = range.commonAncestorContainer;
    let nodes: Text[] = [];
    if (root.nodeType == 3) {
      nodes.push(root as Text);
    } else {
      let walker = doc.createTreeWalker(root, 4);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (range.intersectsNode(node)) {
          nodes.push(node as Text);
        }
      }
    }
    let texts: string[] = [];
    for (let node of nodes) {
      let parent = node.parentElement;
      if (parent && parent.closest("style, script")) {
        continue;
      }
      let start = node == range.startContainer ? range.startOffset : 0;
      let end = node == range.endContainer ? range.endOffset : node.data.length;
      let text = node.data.slice(start, end);
      if (!/\p{L}/u.test(text)) {
        continue;
      }
      pending.push({ node, start, end });
      texts.push(text.trim());
    }
    return texts;
  }

  function ensureStyle() {
    if (doc.getElementById("jackdaw-translated-style")) {
      return;
    }
    let style = doc.createElement("style");
    style.id = "jackdaw-translated-style";
    style.textContent = ".jackdaw-translated{background:rgba(255,196,0,.22);border-radius:2px}";
    (doc.head || doc.documentElement).appendChild(style);
  }

  /** Подставить переводы вместо собранных кусков; оригинал остаётся во всплывающей подсказке */
  function apply(translations: string[]): number {
    ensureStyle();
    let replaced = 0;
    for (let i = pending.length - 1; i >= 0; i--) {
      let { node, start, end } = pending[i];
      let translated = translations[i];
      if (!translated || !node.parentNode || end > node.data.length) {
        continue;
      }
      let original = node.data.slice(start, end);
      let lead = (/^\s*/.exec(original) || [""])[0];
      let trail = (/\s*$/.exec(original) || [""])[0];
      if (end < node.data.length) {
        node.splitText(end);
      }
      let target = start > 0 ? node.splitText(start) : node;
      let span = doc.createElement("span");
      span.className = "jackdaw-translated";
      span.title = original.trim();
      span.textContent = lead + translated + trail;
      target.replaceWith(span);
      replaced++;
    }
    pending = [];
    win.__jackdawRange = null;
    let sel = win.getSelection();
    if (sel) {
      sel.removeAllRanges();
    }
    return replaced;
  }

  win.__jackdawSel = { collect, apply };
}
