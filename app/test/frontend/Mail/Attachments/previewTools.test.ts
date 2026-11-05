// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { tick } from "svelte";
import { ArrayColl } from "svelte-collections";
import { Attachment } from "../../../../logic/Abstract/Attachment";

let previewAttachment: typeof import("../../../../frontend/Mail/Attachments/attachmentPreview").previewAttachment;
let copyImageToClipboard: typeof import("../../../../frontend/Mail/Attachments/attachmentPreview").copyImageToClipboard;

beforeAll(async () => {
  (URL as any).createObjectURL ??= () => "blob:test";
  (URL as any).revokeObjectURL ??= () => {};
  ({ previewAttachment, copyImageToClipboard } = await import("../../../../frontend/Mail/Attachments/attachmentPreview"));
}, 120_000);

afterEach(async () => {
  // Закрываем как пользователь: иначе обработчики окна от прошлого просмотра останутся
  for (let i = 0; i < 3 && document.querySelector(".preview-dialog"); i++) {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await settle();
  }
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

async function settle() {
  for (let i = 0; i < 5; i++) {
    await tick();
    await Promise.resolve();
  }
}

async function open(...specs: [string, string][]) {
  let message: any = { attachments: new ArrayColl<Attachment>() };
  for (let [filename, mimeType] of specs) {
    let attachment = new Attachment();
    attachment.fromFile(new File(["x"], filename, { type: mimeType }));
    attachment.filename = filename;
    attachment.message = message;
    message.attachments.add(attachment);
  }
  await previewAttachment(message.attachments.get(0));
  await settle();
}

function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = window) {
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
}

function wheel(target: HTMLElement, deltaY: number, modifiers: { ctrlKey?: boolean, metaKey?: boolean } = {}) {
  let event = new Event("wheel", { cancelable: true, bubbles: true });
  Object.assign(event, { deltaY, deltaMode: 0, ctrlKey: false, metaKey: false, ...modifiers });
  target.dispatchEvent(event);
  return event;
}

const $ = (selector: string) => document.querySelector(selector) as HTMLElement;
const percent = () => $(".preview-dialog .percent")?.textContent;
/** У кнопки-значка подсказка — название и клавиша */
const button = (label: string) => document.querySelector(`.preview-dialog button[aria-label^="${label}"]`) as HTMLButtonElement;

/** Картинка «загрузилась» с заданным размером */
async function loadImage(width: number, height: number) {
  let img = $(".image-frame img") as HTMLImageElement;
  Object.defineProperty(img, "naturalWidth", { value: width, configurable: true });
  Object.defineProperty(img, "naturalHeight", { value: height, configurable: true });
  img.dispatchEvent(new Event("load"));
  await settle();
  return img;
}

describe("инструменты просмотра картинки", () => {
  test("масштаб кнопками и клавишами, процент на панели", async () => {
    await open(["photo.jpg", "image/jpeg"]);
    await loadImage(200, 100);
    expect(percent()).toBe("100 %"); // мелкая картинка во «Вписать» не растягивается
    button("Zoom in").click();
    await settle();
    expect(percent()).toBe("125 %");
    press("+");
    await settle();
    expect(percent()).toBe("150 %");
    press("-");
    press("-");
    await settle();
    expect(percent()).toBe("100 %");
    press("-");
    await settle();
    expect(percent()).toBe("90 %");
    press("1");
    await settle();
    expect(percent()).toBe("100 %");
    expect(button("Actual size").classList.contains("selected")).toBe(true);
    press("0");
    await settle();
    expect(button("Fit to window").classList.contains("selected")).toBe(true);
  });

  test("Ctrl/⌘ + колесо масштабирует, простое колесо — нет", async () => {
    await open(["photo.png", "image/png"]);
    await loadImage(200, 100);
    let area = $(".image-area");
    expect(wheel(area, -100, { ctrlKey: true }).defaultPrevented).toBe(true);
    await settle();
    expect(parseInt(percent())).toBeGreaterThan(100);
    let before = percent();
    expect(wheel(area, -100).defaultPrevented).toBe(false);
    await settle();
    expect(percent()).toBe(before);
    wheel(area, 300, { metaKey: true });
    await settle();
    expect(parseInt(percent())).toBeLessThan(parseInt(before));
  });

  test("поворот на 90° меняет размеры рамки", async () => {
    await open(["photo.png", "image/png"]);
    let img = await loadImage(200, 100);
    press("1");
    await settle();
    let frame = $(".image-frame");
    expect([frame.style.width, frame.style.height]).toEqual(["200px", "100px"]);
    button("Rotate").click();
    await settle();
    expect(img.style.transform).toContain("rotate(90deg)");
    expect([frame.style.width, frame.style.height]).toEqual(["100px", "200px"]);
    press("r");
    press("r");
    press("r");
    await settle();
    expect(img.style.transform).toContain("rotate(0deg)");
  });

  test("двойной клик: «Вписать» ↔ «100 %»", async () => {
    await open(["photo.png", "image/png"]);
    await loadImage(200, 100);
    let area = $(".image-area");
    expect(button("Fit to window").classList.contains("selected")).toBe(true);
    area.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await settle();
    expect(button("Fit to window").classList.contains("selected")).toBe(false);
    expect(percent()).toBe("100 %");
    area.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await settle();
    expect(button("Fit to window").classList.contains("selected")).toBe(true);
  });

  test("при листании масштаб и поворот сбрасываются", async () => {
    await open(["a.png", "image/png"], ["b.png", "image/png"]);
    await loadImage(200, 100);
    press("+");
    press("r");
    await settle();
    press("ArrowRight");
    await settle();
    expect($(".preview-dialog .filename").textContent).toBe("b.png");
    expect(button("Fit to window").classList.contains("selected")).toBe(true);
    expect(($(".image-frame img") as HTMLImageElement).style.transform).toContain("rotate(0deg)");
  });

  test("подсказки кнопок называют клавиши", async () => {
    await open(["a.png", "image/png"], ["b.png", "image/png"]);
    expect(button("Rotate").title).toBe("Rotate\n\nShortcut: R");
    expect(button("Zoom in").title).toContain("Shortcut: +, ");
    expect(button("Close").title).toContain("Shortcut: Esc");
    expect(button("Next image").title).toContain("Shortcut: →");
    expect(button("Full screen").title).toContain("Shortcut: F");
    expect(button("Fit to window").title).toContain("0 or double-click");
  });

  test("копирование картинки в буфер обмена — по ⌘C, если не выделен текст", async () => {
    let write = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, platform: "MacIntel", clipboard: { write } });
    vi.stubGlobal("ClipboardItem", class { constructor(public items: Record<string, Blob>) {} });
    await open(["photo.png", "image/png"]);
    let event = new Event("copy", { cancelable: true }) as ClipboardEvent;
    document.dispatchEvent(event);
    await settle();
    expect(event.defaultPrevented).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
    let [[items]] = write.mock.calls as any;
    expect(Object.keys(items[0].items)).toEqual(["image/png"]);
    expect(button("Copied")).not.toBeNull();
  });

  test("PNG копируется как есть", async () => {
    let write = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { write } });
    vi.stubGlobal("ClipboardItem", class { constructor(public items: Record<string, Blob>) {} });
    let png = new Blob(["png"], { type: "image/png" });
    await copyImageToClipboard(png);
    expect((write.mock.calls[0] as any)[0][0].items["image/png"]).toBe(png);
  });
});

describe("инструменты просмотра PDF и документов", () => {
  test("PDF: поиск и печать, без масштаба картинки; Esc сначала очищает поиск", async () => {
    await open(["report.pdf", "application/pdf"]);
    let view = $(".preview-dialog webview") as any;
    expect(view).not.toBeNull();
    expect(view.hasAttribute("plugins")).toBe(true);
    expect(button("Print")).not.toBeNull();
    expect(button("Zoom in")).toBeNull();
    expect(button("Rotate")).toBeNull();

    view.findInPage = vi.fn(() => 1);
    view.stopFindInPage = vi.fn();
    view.print = vi.fn(async () => {});
    press("f", { metaKey: true });
    await settle();
    let input = $(".find-input") as HTMLInputElement;
    expect(document.activeElement).toBe(input);

    input.value = "zebra";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    expect(view.findInPage).toHaveBeenLastCalledWith("zebra", {});
    let found = new Event("found-in-page") as any;
    found.result = { matches: 3, activeMatchOrdinal: 1, finalUpdate: true };
    view.dispatchEvent(found);
    await settle();
    expect($(".find-result").textContent.trim()).toBe("1 of 3");

    press("Enter", {}, input);
    expect(view.findInPage).toHaveBeenLastCalledWith("zebra", { forward: true, findNext: true });
    press("Enter", { shiftKey: true }, input);
    expect(view.findInPage).toHaveBeenLastCalledWith("zebra", { forward: false, findNext: true });
    // буквы в поле поиска — это текст, а не «повернуть» или «полный экран»
    press("f", {}, input);
    await settle();
    expect(document.fullscreenElement).toBeFalsy();

    press("p", { ctrlKey: true });
    await settle();
    expect(view.print).toHaveBeenCalledTimes(1);

    press("Escape", {}, input);
    await settle();
    expect(input.value).toBe("");
    expect(view.stopFindInPage).toHaveBeenCalledWith("clearSelection");
    expect($(".preview-dialog")).not.toBeNull();
    press("Escape", {}, input);
    await settle();
    expect($(".preview-dialog")).toBeNull();
  });

  test("документ: масштаб применяется к самому документу", async () => {
    await open(["notes.txt", "text/plain"]);
    await settle();
    let frame = () => $(".preview-dialog iframe");
    expect(frame()).not.toBeNull();
    expect(button("Fit to window")).toBeNull();
    press("+");
    await settle();
    expect(percent()).toBe("125 %");
    expect(frame().getAttribute("srcdoc")).toContain("html { zoom: 1.25; }");
    press("0");
    await settle();
    expect(percent()).toBe("100 %");
    expect(frame().getAttribute("srcdoc")).not.toContain("zoom");
  });
});
