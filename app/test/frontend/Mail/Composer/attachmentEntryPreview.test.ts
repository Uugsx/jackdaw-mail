// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { mount, tick, unmount } from "svelte";
import { ArrayColl } from "svelte-collections";
import { Attachment } from "../../../../logic/Abstract/Attachment";

let AttachmentEntry: typeof import("../../../../frontend/Mail/Composer/Attachments/AttachmentEntry.svelte").default;
let mounted: Record<string, any> | null = null;

beforeAll(async () => {
  (URL as any).createObjectURL ??= () => "blob:test";
  (URL as any).revokeObjectURL ??= () => {};
  AttachmentEntry = (await import("../../../../frontend/Mail/Composer/Attachments/AttachmentEntry.svelte")).default;
}, 120_000);

afterEach(async () => {
  // Закрыть оставшиеся окна просмотра: их обработчики Esc висят на window
  while (document.querySelector(".preview-dialog")) {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await settle();
  }
  if (mounted) {
    unmount(mounted);
    mounted = null;
  }
  document.body.replaceChildren();
});

async function settle() {
  for (let i = 0; i < 8; i++) {
    await tick();
    await Promise.resolve();
  }
}

function draftWith(...files: File[]) {
  let attachments = new ArrayColl<Attachment>();
  let message: any = {};
  for (let file of files) {
    let attachment = new Attachment();
    attachment.fromFile(file);
    attachment.message = message;
    attachments.add(attachment);
  }
  message.attachments = attachments;
  return attachments;
}

function mountEntry(attachments: ArrayColl<Attachment>, index = 0) {
  mounted = mount(AttachmentEntry, { target: document.body, props: { attachment: attachments.get(index), attachments } });
  return document.querySelector<HTMLElement>(".attachment");
}

const dialogName = () => document.querySelector(".preview-dialog .filename")?.textContent;

describe("предпросмотр вложения в окне составления", () => {
  test("клик по карточке открывает просмотр локального файла, подсказка есть", async () => {
    let card = mountEntry(draftWith(new File(["x"], "pic.png", { type: "image/png" })));
    expect(card?.getAttribute("role")).toBe("button");
    expect(card?.getAttribute("tabindex")).toBe("0");
    expect(card?.getAttribute("title")).toBeTruthy();
    card!.click();
    await settle();
    expect(dialogName()).toBe("pic.png");
  });

  test("Enter и Space на карточке открывают, Esc закрывает", async () => {
    let card = mountEntry(draftWith(new File(["x"], "a.pdf", { type: "application/pdf" })));
    card!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle();
    expect(dialogName()).toBe("a.pdf");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await settle();
    expect(document.querySelector(".preview-dialog")).toBeNull();
    card!.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    await settle();
    expect(dialogName()).toBe("a.pdf");
  });

  test("корзина удаляет и не открывает просмотр", async () => {
    let attachments = draftWith(new File(["x"], "a.png", { type: "image/png" }));
    let card = mountEntry(attachments);
    card!.querySelector<HTMLElement>(".buttons button")!.click();
    await settle();
    expect(document.querySelector(".preview-dialog")).toBeNull();
    expect(attachments.length).toBe(0);
  });

  test("архив: окно с пояснением и кнопкой внешнего приложения", async () => {
    let card = mountEntry(draftWith(new File(["x"], "data.zip", { type: "application/zip" })));
    card!.click();
    await settle();
    expect(dialogName()).toBe("data.zip");
    expect(document.querySelector(".preview-dialog .message")?.textContent).toContain("This file cannot be shown here");
  });

  test("файл без доступа к содержимому: сообщение, а не ошибка", async () => {
    let attachments = draftWith(new File(["x"], "gone.pdf", { type: "application/pdf" }));
    attachments.get(0).content = null as any;
    let card = mountEntry(attachments);
    card!.click();
    await settle();
    expect(document.querySelector(".preview-dialog .message")?.textContent).toContain("Attachment file is missing");
  });

  test("несколько вложений листаются стрелками, скрытые не входят", async () => {
    let attachments = draftWith(
      new File(["x"], "a.png", { type: "image/png" }),
      new File(["x"], "b.pdf", { type: "application/pdf" }),
      new File(["x"], "c.zip", { type: "application/zip" }));
    mountEntry(attachments).click();
    await settle();
    expect(document.querySelector(".counter")?.textContent).toBe("1 / 3");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    await settle();
    expect(dialogName()).toBe("b.pdf");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    await settle();
    expect(dialogName()).toBe("c.zip");
  });

  test("большой документ не разбирается в памяти", async () => {
    let big = new File(["x"], "big.docx");
    Object.defineProperty(big, "size", { value: 30 * 1024 * 1024 });
    mountEntry(draftWith(big)).click();
    await settle();
    expect(document.querySelector(".preview-dialog .message")?.textContent).toContain("too large");
  });
});
