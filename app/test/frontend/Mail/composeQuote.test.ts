// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { applyQuoteBodyEdit, mergeComposeQuote, quoteDisplayBody, splitComposeQuote } from "../../../frontend/Mail/Composer/composeQuote";
import { applyQuoteTextInput } from "../../../frontend/Mail/Composer/quoteEditorInput";

describe("splitComposeQuote", () => {
  it("splits reply header and blockquote", () => {
    let full = `<p></p><p class="quote-header">On Mon wrote:</p><blockquote cite="mid:abc"><table><tr><td>A</td></tr></table></blockquote>`;
    let { editable, quote } = splitComposeQuote(full);
    expect(editable).toBe("<p></p>");
    expect(quote).toContain("quote-header");
    expect(quote).toContain("<table>");
  });

  it("splits forward at hr", () => {
    let full = `<p>Hi</p><hr /><p class="forward-header">From:</p><p>Body</p>`;
    let { editable, quote } = splitComposeQuote(full);
    expect(editable).toBe("<p>Hi</p>");
    expect(quote).toMatch(/^<hr/);
  });

  it("mergeComposeQuote round-trips", () => {
    let full = `<p>x</p><blockquote cite="mid:1"><p>q</p></blockquote>`;
    let split = splitComposeQuote(full);
    expect(mergeComposeQuote(split.editable, split.quote)).toBe(full);
  });
});

describe("quoteDisplayBody", () => {
  it("uses source HTML for replies", () => {
    let quote = `<p class="quote-header">On Mon wrote:</p><blockquote cite="mid:1"><p>old</p></blockquote>`;
    expect(quoteDisplayBody(quote, "<p>source</p>", true)).toBe("<p>source</p>");
  });

  it("uses blockquote inner for forwards", () => {
    let quote = `<hr /><p class="forward-header">From:</p><p>Body</p>`;
    expect(quoteDisplayBody(quote, null, false)).toBe(quote);
  });
});

describe("applyQuoteBodyEdit", () => {
  it("updates blockquote inner on reply", () => {
    let quote = `<p class="quote-header">On Mon wrote:</p><blockquote cite="mid:1"><p>old</p></blockquote>`;
    let updated = applyQuoteBodyEdit(quote, "<p>edited</p>", true);
    expect(updated).toContain("<p>edited</p>");
    expect(updated).toContain("quote-header");
    expect(updated).not.toContain("<p>old</p>");
  });
});

describe("applyQuoteTextInput", () => {
  function selectText(root: HTMLElement, selector: string, start: number, end: number): void {
    let text = root.querySelector(selector)?.firstChild;
    expect(text).toBeTruthy();
    let range = document.createRange();
    range.setStart(text!, start);
    range.setEnd(text!, end);
    let selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  function input(inputType: string, data: string | null = null): InputEvent {
    return { inputType, data, dataTransfer: null } as InputEvent;
  }

  it("inserts text inside the existing formatted element", () => {
    let root = document.createElement("div");
    root.innerHTML = '<ol style="margin-left: 20px"><li><strong>Вопрос</strong></li></ol>';
    document.body.append(root);
    selectText(root, "strong", 6, 6);

    expect(applyQuoteTextInput(root, input("insertText", " — ответ"))).toBe(true);
    expect(root.querySelector("ol")).toBeTruthy();
    expect(root.querySelector("strong")?.textContent).toBe("Вопрос — ответ");
    expect(root.querySelector("ol")?.getAttribute("style")).toBe("margin-left: 20px");
    root.remove();
  });

  it("keeps the original list when inserting a line break", () => {
    let root = document.createElement("div");
    root.innerHTML = "<ol><li>Вопрос</li></ol>";
    document.body.append(root);
    selectText(root, "li", 6, 6);

    expect(applyQuoteTextInput(root, input("insertParagraph"))).toBe(true);
    expect(root.querySelector("ol")).toBeTruthy();
    expect(root.querySelector("ul")).toBeNull();
    expect(root.querySelector("li br")).toBeTruthy();
    expect(applyQuoteTextInput(root, input("deleteContentBackward"))).toBe(true);
    expect(root.querySelector("li br")).toBeNull();
    root.remove();
  });

  it("deletes a character without replacing the surrounding markup", () => {
    let root = document.createElement("div");
    root.innerHTML = '<p><span style="font-family: Arial">Текст</span></p>';
    document.body.append(root);
    selectText(root, "span", 5, 5);

    expect(applyQuoteTextInput(root, input("deleteContentBackward"))).toBe(true);
    expect(root.querySelector("span")?.textContent).toBe("Текс");
    expect(root.querySelector("span")?.getAttribute("style")).toBe("font-family: Arial");
    root.remove();
  });
});
