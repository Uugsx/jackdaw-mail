/** Native text editing helpers for the quoted message editor. */

function containsNode(root: HTMLElement, node: Node | null): boolean {
  return !!node && (node === root || root.contains(node));
}

function getQuoteSelection(root: HTMLElement): Range | null {
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

function setQuoteSelection(range: Range): void {
  let selection = document.getSelection();
  if (!selection) {
    return;
  }
  selection.removeAllRanges();
  selection.addRange(range);
}

function insertTextFragment(text: string): DocumentFragment {
  let fragment = document.createDocumentFragment();
  let parts = text.split(/\r\n|\r|\n/);
  parts.forEach((part, index) => {
    if (index) {
      fragment.append(document.createElement("br"));
    }
    if (part) {
      fragment.append(document.createTextNode(part));
    }
  });
  return fragment;
}

function replaceSelection(range: Range, content: Node): void {
  let lastInsertedNode = content.nodeType == Node.DOCUMENT_FRAGMENT_NODE
    ? content.lastChild
    : content;
  range.deleteContents();
  range.insertNode(content);

  if (!lastInsertedNode) {
    range.collapse(true);
    setQuoteSelection(range);
    return;
  }

  let nextRange = document.createRange();
  nextRange.setStartAfter(lastInsertedNode);
  nextRange.collapse(true);
  setQuoteSelection(nextRange);
}

function deepestNode(node: Node, backwards: boolean): Node {
  let current = node;
  while (current.lastChild || current.firstChild) {
    current = backwards ? current.lastChild! : current.firstChild!;
  }
  return current;
}

function previousNode(root: HTMLElement, node: Node): Node | null {
  let current: Node | null = node;
  while (current && current !== root) {
    if (current.previousSibling) {
      return deepestNode(current.previousSibling, true);
    }
    current = current.parentNode;
  }
  return null;
}

function nextNode(root: HTMLElement, node: Node): Node | null {
  let current: Node | null = node;
  while (current && current !== root) {
    if (current.nextSibling) {
      return deepestNode(current.nextSibling, false);
    }
    current = current.parentNode;
  }
  return null;
}

function rangeForAdjacentNode(node: Node | null, backwards: boolean): Range | null {
  if (!node) {
    return null;
  }
  let result = document.createRange();
  if (node.nodeType == Node.TEXT_NODE) {
    let text = node as Text;
    if (!text.data.length) {
      return null;
    }
    let offset = backwards ? text.data.length : 0;
    result.setStart(text, offset - (backwards ? 1 : 0));
    result.setEnd(text, offset + (backwards ? 0 : 1));
    return result;
  }
  result.selectNode(node);
  return result;
}

function adjacentCharacterRange(root: HTMLElement, range: Range, backwards: boolean): Range | null {
  if (!range.collapsed || range.startContainer.nodeType != Node.TEXT_NODE) {
    if (!range.collapsed) {
      return null;
    }
    let container = range.startContainer;
    if (container.nodeType != Node.ELEMENT_NODE) {
      return null;
    }
    let element = container as Element;
    let adjacent = backwards
      ? element.childNodes[range.startOffset - 1]
      : element.childNodes[range.startOffset];
    return rangeForAdjacentNode(adjacent ? deepestNode(adjacent, backwards) : null, backwards);
  }

  let text = range.startContainer as Text;
  let offset = range.startOffset;
  if (backwards) {
    if (offset > 0) {
      let result = document.createRange();
      result.setStart(text, offset - 1);
      result.setEnd(text, offset);
      return result;
    }
  } else if (offset < text.data.length) {
    let result = document.createRange();
    result.setStart(text, offset);
    result.setEnd(text, offset + 1);
    return result;
  }

  return rangeForAdjacentNode(
    backwards ? previousNode(root, text) : nextNode(root, text),
    backwards,
  );
}

function deleteSelection(root: HTMLElement, range: Range, backwards: boolean): boolean {
  let target = range.collapsed ? adjacentCharacterRange(root, range, backwards) : range;
  if (!target) {
    return false;
  }
  target.deleteContents();
  target.collapse(true);
  setQuoteSelection(target);
  return true;
}

/**
 * Handle ordinary text editing without handing the quote's DOM tree back to
 * the browser's list/paragraph normalizer. This keeps the sender's original
 * elements, attributes and inline styles intact while still allowing inline
 * replies.
 */
export function applyQuoteTextInput(root: HTMLElement, event: InputEvent): boolean {
  let range = getQuoteSelection(root);
  if (!range) {
    return false;
  }

  switch (event.inputType) {
    case "insertText":
    case "insertReplacementText":
    case "insertFromYank": {
      let text = event.data ?? event.dataTransfer?.getData("text/plain") ?? "";
      if (!text) {
        return false;
      }
      replaceSelection(range, insertTextFragment(text));
      return true;
    }
    case "insertFromPaste": {
      let text = event.data ?? event.dataTransfer?.getData("text/plain") ?? "";
      if (!text) {
        return false;
      }
      replaceSelection(range, insertTextFragment(text));
      return true;
    }
    case "insertParagraph":
    case "insertLineBreak":
      replaceSelection(range, document.createElement("br"));
      return true;
    case "deleteContentBackward":
      return deleteSelection(root, range, true);
    case "deleteContentForward":
      return deleteSelection(root, range, false);
    case "deleteByCut":
    case "deleteContent":
      if (range.collapsed) {
        return false;
      }
      range.deleteContents();
      range.collapse(true);
      setQuoteSelection(range);
      return true;
    default:
      return false;
  }
}
