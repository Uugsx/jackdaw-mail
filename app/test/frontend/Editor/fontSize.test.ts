// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Footer } from "../../../frontend/Shared/Editor/Footer";
import {
  currentFontSize,
  fontSizeToCSS,
  parseFontSizeFromHTML,
  normalizeSignatureHTML,
  signatureEditorExtensions,
  textColorForHighlight,
  currentLineHeight,
  applyComposeDefaultBlockFormatting,
} from "../../../frontend/Shared/Editor/composeEditorExtensions";

function createEditor(content: string) {
  let element = document.createElement("div");
  document.body.appendChild(element);
  let editor = new Editor({
    element,
    extensions: [
      StarterKit.configure({ bold: false, italic: false, strike: false }),
      ...signatureEditorExtensions,
    ],
    content,
  });
  return { editor, element };
}

describe("font size parsing", () => {
  it("keeps round pt sizes like 10 and 20", () => {
    expect(parseFontSizeFromHTML("10pt")).toBe("10");
    expect(parseFontSizeFromHTML("20pt")).toBe("20");
    expect(parseFontSizeFromHTML("10")).toBe("10");
    expect(fontSizeToCSS(parseFontSizeFromHTML("10pt"))).toBe("10pt");
  });

  it("maps html font size index 2 to 10pt", () => {
    expect(parseFontSizeFromHTML("2")).toBe("10");
  });
});

describe("text highlight", () => {
  it("picks dark text on yellow fill", () => {
    expect(textColorForHighlight("#FFFF00")).toBe("#000000");
  });

  it("picks light text on dark fill", () => {
    expect(textColorForHighlight("#000080")).toBe("#FFFFFF");
  });
});

describe("signature font size", () => {
  it("registers fontSize on textStyle mark", () => {
    let { editor, element } = createEditor("<p>Hello</p>");
    expect(Object.keys(editor.schema.marks.textStyle.attrs)).toContain("fontSize");
    editor.destroy();
    element.remove();
  });

  it("applies font size 10 to selected text", () => {
    let { editor, element } = createEditor("<p>Hello world</p>");
    editor.commands.setTextSelection({ from: 1, to: 6 });
    expect(editor.commands.setFontSize("10")).toBe(true);
    expect(editor.getHTML()).toMatch(/10pt/i);
    expect(currentFontSize(editor)).toBe("10");
    editor.destroy();
    element.remove();
  });

  it("applies font size 20 through toolbar chain", () => {
    let { editor, element } = createEditor("<p>Hello world</p>");
    let saved = { from: 1, to: 6 };
    expect(editor.chain().focus().setTextSelection(saved).setFontSize("20").run()).toBe(true);
    expect(editor.getHTML()).toMatch(/20pt/i);
    editor.destroy();
    element.remove();
  });

  it("applies font size to outlook-like table signature text", () => {
    let raw = `<table><tbody><tr>
      <td style="font-size:11.0pt;font-family:Arial,sans-serif">
        <p>ООО «Смарт ДС Рус»</p>
      </td></tr></tbody></table>`;
    let normalized = normalizeSignatureHTML(raw)!;
    let { editor, element } = createEditor(normalized);
    let textPos = editor.state.doc.textContent.indexOf("ООО");
    expect(textPos).toBeGreaterThanOrEqual(0);
    let from = textPos + 1;
    let to = from + "ООО «Смарт ДС Рус»".length;
    editor.commands.setTextSelection({ from, to });
    expect(editor.commands.setFontSize("14")).toBe(true);
    expect(editor.getHTML()).toMatch(/14pt/i);
    editor.destroy();
    element.remove();
  });

  it("normalizes outlook font tags", () => {
    let normalized = normalizeSignatureHTML('<p><font size="2">Company</font></p>');
    expect(normalized).toContain("10pt");
  });

  it("preserves the font face from legacy signature tags", () => {
    let normalized = normalizeSignatureHTML('<p><font face="Arial" size="2">Company</font></p>');
    expect(normalized).toMatch(/font-family:\s*Arial/i);
    expect(normalized).toMatch(/font-size:\s*10pt/i);
  });

  it("normalizes Outlook block spacing to single lines", () => {
    let normalized = normalizeSignatureHTML(
      '<p style="margin: 0cm 0cm 8pt; line-height: 115%;">Company</p><div>Address</div>',
    )!;
    expect(normalized).toContain("margin-top: 0px");
    expect(normalized).toContain("margin-bottom: 0px");
    expect(normalized).toContain("line-height: 1.15");

    let { editor, element } = createEditor(normalized);
    let paragraphs = [...element.querySelectorAll("p")];
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0].style.marginTop).toBe("0px");
    expect(paragraphs[0].style.marginBottom).toBe("0px");
    expect(paragraphs[0].style.lineHeight).toBe("1.15");
    editor.destroy();
    element.remove();
  });

  it("uses a real single line height by default", () => {
    let normalized = normalizeSignatureHTML("<p>Company</p>")!;
    let { editor, element } = createEditor(normalized);
    expect(element.querySelector("p")?.style.lineHeight).toBe("1");
    expect(currentLineHeight(editor)).toBe("");
    expect(editor.commands.setLineHeight("1.5")).toBe(true);
    expect(currentLineHeight(editor)).toBe("1.5");
    expect(editor.getHTML()).toMatch(/line-height:\s*1\.5/);
    editor.destroy();
    element.remove();
  });

  it("applies default block formatting to each editable paragraph", () => {
    let { editor, element } = createEditor("<p>One</p><p>Two</p>");
    let bodyEnd = 1;
    editor.state.doc.forEach((node, position) => {
      bodyEnd = Math.max(bodyEnd, position + node.nodeSize - 1);
    });

    expect(applyComposeDefaultBlockFormatting(editor, 1, bodyEnd, {
      lineHeight: "1.5",
      textAlign: "center",
      paragraphSpacing: "8",
      firstLineIndent: "12",
    })).toBe(true);

    let paragraphs = [...element.querySelectorAll("p")];
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs.every(paragraph => paragraph.style.lineHeight == "1.5")).toBe(true);
    expect(paragraphs.every(paragraph => paragraph.style.textAlign == "center")).toBe(true);
    expect(paragraphs.every(paragraph => paragraph.style.marginBottom == "8pt")).toBe(true);
    expect(paragraphs.every(paragraph => paragraph.style.textIndent == "12pt")).toBe(true);

    editor.destroy();
    element.remove();
  });

  it("does not apply compose defaults to the signature footer", () => {
    let element = document.createElement("div");
    document.body.appendChild(element);
    let editor = new Editor({
      element,
      extensions: [
        StarterKit.configure({ bold: false, italic: false, strike: false }),
        Footer,
        ...signatureEditorExtensions,
      ],
      content: `<p>Reply</p><p></p><footer class="signature"><p><span style="font-family: Arial, Helvetica, sans-serif; font-size: 10pt">Signature</span></p></footer>`,
    });

    let bodyEnd = 1;
    editor.state.doc.forEach((node, position) => {
      if (node.type.name !== "footer") {
        bodyEnd = Math.max(bodyEnd, position + node.nodeSize - 1);
      }
    });
    editor.chain().focus()
      .setTextSelection({ from: 1, to: bodyEnd })
      .setFontFamily("Calibri, Arial, sans-serif")
      .setFontSize("12pt")
      .run();

    let signature = element.querySelector("footer.signature span");
    expect(signature?.getAttribute("style")).toMatch(/font-family:\s*Arial/i);
    expect(signature?.getAttribute("style")).toMatch(/font-size:\s*10pt/i);

    editor.destroy();
    element.remove();
  });
});
