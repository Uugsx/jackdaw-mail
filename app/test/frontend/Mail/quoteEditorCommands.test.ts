// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyQuoteCommand,
  captureQuoteSelection,
  readQuoteEditorStyle,
} from "../../../frontend/Mail/Composer/quoteEditorCommands";

const originalExecCommand = document.execCommand;

afterEach(() => {
  document.body.replaceChildren();
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    writable: true,
    value: originalExecCommand,
  });
});

function selectText(root: HTMLElement, start: number, end: number): Range {
  let text = root.querySelector("p")?.firstChild;
  expect(text).toBeTruthy();
  let range = document.createRange();
  range.setStart(text!, start);
  range.setEnd(text!, end);
  let selection = document.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return range;
}

describe("native quote editor commands", () => {
  it("читает фактическое оформление под caret из Outlook-подобного HTML", () => {
    let root = document.createElement("div");
    root.className = "compose-quote-html";
    root.innerHTML = `<p style="line-height: 1.5; text-align: center">
      <span style="font-family: Arial; font-size: 14pt; color: #C00000; background-color: #FFFF00">
        <strong><em><u><a href="https://example.com">Текст клиента</a></u></em></strong>
      </span>
    </p>`;
    document.body.append(root);
    let range = document.createRange();
    let text = root.querySelector("a")?.firstChild;
    expect(text).toBeTruthy();
    range.setStart(text!, 2);
    range.collapse(true);

    let style = readQuoteEditorStyle(root, range);

    expect(style).toMatchObject({
      fontFamily: "Arial",
      fontSize: "14",
      lineHeight: "1.5",
      color: "#C00000",
      highlight: "#FFFF00",
      bold: true,
      italic: true,
      underline: true,
      blockquote: false,
      textAlign: "center",
      link: "https://example.com",
    });
    expect(style?.strike).toBe(false);
  });

  it("restores a quote selection before applying highlight", () => {
    let root = document.createElement("div");
    root.tabIndex = 0;
    root.className = "compose-quote-html";
    root.innerHTML = "<p>Текст клиента</p>";
    document.body.append(root);
    let range = selectText(root, 0, 5);
    let outside = document.createElement("div");
    outside.textContent = "Ответ";
    document.body.append(outside);
    let outsideRange = document.createRange();
    outsideRange.selectNodeContents(outside);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(outsideRange);

    let execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      writable: true,
      value: execCommand,
    });
    let inputEvents = 0;
    root.addEventListener("input", () => inputEvents++);

    expect(applyQuoteCommand(root, "hiliteColor", "#FFFF00", range)).toBe(true);
    expect(execCommand).toHaveBeenCalledWith("hiliteColor", false, "#FFFF00");
    expect(document.getSelection()?.anchorNode && root.contains(document.getSelection()!.anchorNode)).toBe(true);
    expect(inputEvents).toBe(1);
  });

  it("applies line height to every quoted paragraph in the selection", () => {
    let root = document.createElement("div");
    root.innerHTML = "<p>Один</p><p>Два</p>";
    document.body.append(root);
    let text = root.querySelectorAll("p");
    let range = document.createRange();
    range.setStart(text[0].firstChild!, 0);
    range.setEnd(text[1].firstChild!, 3);

    expect(applyQuoteCommand(root, "lineHeight", "1.5", range)).toBe(true);
    expect(text[0].getAttribute("style")).toContain("line-height: 1.5");
    expect(text[1].getAttribute("style")).toContain("line-height: 1.5");
  });

  it("does not apply a quote command to a selection outside the quote", () => {
    let root = document.createElement("div");
    root.innerHTML = "<p>Цитата</p>";
    let outside = document.createElement("div");
    outside.textContent = "Ответ";
    document.body.append(root, outside);
    let outsideRange = document.createRange();
    outsideRange.selectNodeContents(outside);

    let execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      writable: true,
      value: execCommand,
    });

    expect(applyQuoteCommand(root, "bold", undefined, outsideRange)).toBe(false);
    expect(execCommand).not.toHaveBeenCalled();
  });
});
