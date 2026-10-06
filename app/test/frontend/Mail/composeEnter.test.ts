// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Footer } from "../../../frontend/Shared/Editor/Footer";
import { ParagraphNewLine } from "../../../frontend/Shared/Editor/ParagraphNewLine";
import { focusComposeTypingArea } from "../../../frontend/Mail/Composer/composeCursor";
import {
  composeEditorExtensions,
  currentFontFamily,
  currentFontSize,
  currentLineHeight,
  setStoredComposeTextStyle,
} from "../../../frontend/Shared/Editor/composeEditorExtensions";

function createComposeEditor(content: string) {
  let element = document.createElement("div");
  document.body.appendChild(element);
  let editor = new Editor({
    element,
    extensions: [
      StarterKit.configure({ bold: false, italic: false, strike: false }),
      Footer,
      ParagraphNewLine,
    ],
    content,
  });
  return { editor, element };
}

function createFormattedComposeEditor(content: string) {
  let element = document.createElement("div");
  document.body.appendChild(element);
  let editor = new Editor({
    element,
    extensions: [
      StarterKit.configure({ bold: false, italic: false, strike: false }),
      Footer,
      ParagraphNewLine,
      ...composeEditorExtensions,
    ],
    content,
  });
  return { editor, element };
}

function pressEnter(editor: Editor): void {
  editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key: "Enter",
    code: "Enter",
  }));
}

describe("перенос строки в композере", () => {
  it("сохраняет текст до и после Enter перед подписью", () => {
    let { editor, element } = createComposeEditor(
      '<p>До переноса</p><footer class="signature"><p>Подпись</p></footer>',
    );
    let firstParagraph = editor.state.doc.firstChild!;
    let paragraphEnd = 1 + firstParagraph.nodeSize - 2;
    editor.commands.setTextSelection(paragraphEnd);
    editor.commands.insertContent(" первая часть");
    pressEnter(editor);
    editor.commands.insertContent("вторая часть");

    let html = editor.getHTML();
    expect(html).toContain("первая часть");
    expect(html).toContain("вторая часть");
    expect(html).toContain("Подпись");

    editor.destroy();
    element.remove();
  });

  it("не теряет строки в типичном ответе с подписью и цитатой", () => {
    let { editor, element } = createComposeEditor(
      `<p></p><p></p><footer class="signature"><p>Подпись</p></footer>
        <p class="quote-header">Иван написал:</p>
        <blockquote><p>Исходное письмо</p></blockquote>`,
    );
    focusComposeTypingArea(editor);
    editor.commands.insertContent("первая строка");
    pressEnter(editor);
    editor.commands.insertContent("вторая строка");
    pressEnter(editor);
    editor.commands.insertContent("третья строка");

    let html = editor.getHTML();
    expect(html).toContain("первая строка");
    expect(html).toContain("вторая строка");
    expect(html).toContain("третья строка");
    expect(html).toContain("Подпись");

    editor.destroy();
    element.remove();
  });

  it("сохраняет форматирование абзаца и текста после Enter", () => {
    let { editor, element } = createFormattedComposeEditor(
      `<p style="line-height: 1.5"><span style="font-family: Arial, Helvetica, sans-serif; font-size: 10pt">Первая строка</span></p>
       <footer class="signature"><p>Подпись</p></footer>`,
    );
    let firstParagraph = editor.state.doc.firstChild!;
    let paragraphEnd = firstParagraph.nodeSize - 1;
    editor.commands.setTextSelection(paragraphEnd);
    pressEnter(editor);
    expect(currentFontFamily(editor)).toMatch(/Arial/i);
    expect(currentFontSize(editor)).toBe("10");
    expect(currentLineHeight(editor)).toBe("1.5");
    editor.commands.insertContent("Вторая строка");

    let paragraphs = [...editor.view.dom.children]
      .filter(child => child.nodeName == "P")
      .slice(0, 2) as HTMLParagraphElement[];
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[1].style.lineHeight).toBe("1.5");
    expect(paragraphs[1].innerHTML).toMatch(/font-family:\s*Arial/i);
    expect(paragraphs[1].innerHTML).toMatch(/font-size:\s*10pt/i);

    editor.destroy();
    element.remove();
  });

  it("сохраняет стиль пустой строки ответа при повторном Enter", () => {
    let { editor, element } = createFormattedComposeEditor(
      `<p style="line-height: 1.5"></p><footer class="signature"><p>Подпись</p></footer>`,
    );
    editor.commands.setTextSelection(1);
    editor.commands.setLineHeight("1.5");
    setStoredComposeTextStyle(editor, "Arial, Helvetica, sans-serif", "10pt");
    expect(currentFontFamily(editor)).toMatch(/Arial/i);
    expect(currentFontSize(editor)).toBe("10");
    expect(currentLineHeight(editor)).toBe("1.5");

    pressEnter(editor);
    expect(currentFontFamily(editor)).toMatch(/Arial/i);
    expect(currentFontSize(editor)).toBe("10");
    expect(currentLineHeight(editor)).toBe("1.5");
    editor.commands.insertContent("Новая строка");

    let paragraphs = [...editor.view.dom.children]
      .filter(child => child.nodeName == "P")
      .slice(0, 2) as HTMLParagraphElement[];
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[1].style.lineHeight).toBe("1.5");
    expect(paragraphs[1].innerHTML).toMatch(/font-family:\s*Arial/i);
    expect(paragraphs[1].innerHTML).toMatch(/font-size:\s*10pt/i);

    editor.destroy();
    element.remove();
  });

  it("сохраняет стиль при удалении служебного br на Enter", () => {
    let { editor, element } = createFormattedComposeEditor(
      `<p><br></p><footer class="signature"><p>Подпись</p></footer>`,
    );
    editor.commands.setTextSelection(1);
    editor.commands.setLineHeight("1.5");
    setStoredComposeTextStyle(editor, "Arial, Helvetica, sans-serif", "10pt");

    pressEnter(editor);
    expect(currentFontFamily(editor)).toMatch(/Arial/i);
    expect(currentFontSize(editor)).toBe("10");
    expect(currentLineHeight(editor)).toBe("1.5");
    editor.commands.insertContent("Строка после br");

    let paragraphs = [...editor.view.dom.children]
      .filter(child => child.nodeName == "P")
      .slice(0, 2) as HTMLParagraphElement[];
    expect(paragraphs[1].innerHTML).toMatch(/font-family:\s*Arial/i);
    expect(paragraphs[1].innerHTML).toMatch(/font-size:\s*10pt/i);
    expect(paragraphs[1].style.lineHeight).toBe("1.5");

    editor.destroy();
    element.remove();
  });
});
