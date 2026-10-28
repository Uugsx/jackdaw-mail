// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { tick } from "svelte";
import { ArrayColl } from "svelte-collections";
import { Attachment, ContentDisposition } from "../../../../logic/Abstract/Attachment";

let previewKind: typeof import("../../../../frontend/Mail/Attachments/attachmentPreview").previewKind;
let imageGallery: typeof import("../../../../frontend/Mail/Attachments/attachmentPreview").imageGallery;
let previewAttachment: typeof import("../../../../frontend/Mail/Attachments/attachmentPreview").previewAttachment;
let mailImageAttachment: typeof import("../../../../frontend/Mail/Message/openMailImage").mailImageAttachment;

beforeAll(async () => {
  (URL as any).createObjectURL ??= () => "blob:test";
  (URL as any).revokeObjectURL ??= () => {};
  ({ previewKind, imageGallery, previewAttachment } = await import("../../../../frontend/Mail/Attachments/attachmentPreview"));
  ({ mailImageAttachment } = await import("../../../../frontend/Mail/Message/openMailImage"));
}, 120_000);

afterEach(() => {
  document.body.replaceChildren();
});

function makeAttachment(filename: string, mimeType: string, message?: any, disposition = ContentDisposition.attachment): Attachment {
  let attachment = new Attachment();
  attachment.fromFile(new File(["x"], filename, { type: mimeType }));
  attachment.filename = filename;
  attachment.disposition = disposition;
  attachment.message = message;
  return attachment;
}

function messageWith(...specs: [string, string, ContentDisposition?][]) {
  let message: any = { attachments: new ArrayColl<Attachment>() };
  for (let [filename, mimeType, disposition] of specs) {
    message.attachments.add(makeAttachment(filename, mimeType, message, disposition));
  }
  return message;
}

async function settle() {
  for (let i = 0; i < 5; i++) {
    await tick();
    await Promise.resolve();
  }
}

describe("встроенный просмотр вложений", () => {
  test("картинка без расширения узнаётся по типу, SVG и HTML — нет", () => {
    expect(previewKind("gif-abc.gif", "image/gif")).toBe("image");
    expect(previewKind("paste", "image/png")).toBe("image");
    expect(previewKind("logo.svg", "image/svg+xml")).toBe(null);
    expect(previewKind("page.html", "text/html")).toBe(null);
  });

  test("листаются только видимые картинки того же сообщения", () => {
    let message = messageWith(
      ["a.png", "image/png"],
      ["report.pdf", "application/pdf"],
      ["b.gif", "image/gif"],
      ["sig.png", "image/png", ContentDisposition.inline],
    );
    let [a, pdf, b] = message.attachments.contents;
    expect(imageGallery(a).map(x => x.filename)).toEqual(["a.png", "b.gif"]);
    expect(imageGallery(pdf)).toEqual([pdf]);
    expect(imageGallery(b).map(x => x.filename)).toEqual(["a.png", "b.gif"]);
  });

  test("стрелки листают картинки по кругу, Esc закрывает только просмотр", async () => {
    let message = messageWith(["a.png", "image/png"], ["b.gif", "image/gif"], ["c.jpg", "image/jpeg"]);
    let outerEscape = vi.fn();
    window.addEventListener("keydown", outerEscape);
    try {
      await previewAttachment(message.attachments.get(0));
      await settle();
      let filename = () => document.querySelector(".preview-dialog .filename")?.textContent;
      expect(filename()).toBe("a.png");
      expect(document.querySelector(".counter")?.textContent).toBe("1 / 3");

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
      await settle();
      expect(filename()).toBe("b.gif");
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
      await settle();
      expect(filename()).toBe("c.jpg");
      expect(document.querySelector(".counter")?.textContent).toBe("3 / 3");

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      await settle();
      expect(document.querySelector(".preview-dialog")).toBeNull();
      expect(outerEscape).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", outerEscape);
    }
  });

  test("одно вложение открывается без кнопок листания", async () => {
    let message = messageWith(["report.pdf", "application/pdf"]);
    await previewAttachment(message.attachments.get(0));
    await settle();
    expect(document.querySelector(".preview-dialog")).not.toBeNull();
    expect(document.querySelector(".counter")).toBeNull();
  });

  test("картинка из текста письма: проверенный тип и безопасное имя", async () => {
    let png = new Blob(["png"], { type: "image/png; charset=binary" });
    let attachment = await mailImageAttachment(png, "https://example.com/pics/photo.exe");
    expect(attachment.mimeType).toBe("image/png");
    expect(attachment.filename).toBe("photo.png");
    expect(previewKind(attachment.filename, attachment.mimeType)).toBe("image");
    expect((await attachment.load()).content).toBe(attachment.content);
  });
});
