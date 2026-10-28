import { describe, expect, it } from "vitest";
import { classifyPastedFiles, filesFromClipboard } from "../../../frontend/Shared/Editor/clipboardFiles";

function file(name: string, type: string, size = 10) {
  return new File([new Uint8Array(size)], name, { type });
}

describe("вставка файлов из буфера", () => {
  it("PDF из Finder вместе с иконкой: вложение, иконка не вставляется", () => {
    let pasted = classifyPastedFiles([file("resume.pdf", "application/pdf", 500), file("image.png", "image/png", 99)]);
    expect(pasted.attach.map(f => f.name)).toEqual(["resume.pdf"]);
    expect(pasted.inline).toEqual([]);
  });

  it("несколько файлов прикрепляются все, повторы отбрасываются", () => {
    let pasted = classifyPastedFiles([
      file("a.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
      file("b.zip", "application/zip"),
      file("a.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    ]);
    expect(pasted.attach.map(f => f.name)).toEqual(["a.docx", "b.zip"]);
  });

  it("файл без типа тоже вложение", () => {
    expect(classifyPastedFiles([file("data.bin", "")]).attach).toHaveLength(1);
  });

  it("картинка, скопированная как файл (с именем), прикрепляется", () => {
    let pasted = classifyPastedFiles([file("photo.jpg", "image/jpeg"), file("image.png", "image/png")]);
    expect(pasted.attach.map(f => f.name)).toEqual(["photo.jpg"]);
    expect(pasted.inline).toEqual([]);
  });

  it("снимок экрана (image.png без файла) вставляется в текст", () => {
    let pasted = classifyPastedFiles([file("image.png", "image/png")]);
    expect(pasted.attach).toEqual([]);
    expect(pasted.inline.map(f => f.name)).toEqual(["image.png"]);
  });

  it("пустой буфер", () => {
    expect(classifyPastedFiles([])).toEqual({ attach: [], inline: [] });
  });

  it("читает файлы из items, а если их нет — из files", () => {
    let pdf = file("x.pdf", "application/pdf");
    let viaItems = { items: [{ kind: "file", getAsFile: () => pdf }, { kind: "string", getAsFile: () => null }], files: [] };
    expect(filesFromClipboard(viaItems as any)).toEqual([pdf]);
    let viaFiles = { items: [], files: [pdf] };
    expect(filesFromClipboard(viaFiles as any)).toEqual([pdf]);
    expect(filesFromClipboard(null)).toEqual([]);
  });
});
