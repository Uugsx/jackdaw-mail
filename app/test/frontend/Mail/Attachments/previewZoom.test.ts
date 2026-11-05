import { describe, expect, test } from "vitest";
import {
  clampZoom, fitZoom, kMaxZoom, kMinZoom, normalizeRotation, previewActions, previewShortcut,
  scrollToKeepPoint, wheelZoom, zoomIn, zoomOut, zoomPercent,
} from "../../../../frontend/Mail/Attachments/previewZoom";

function key(key: string, modifiers: Partial<Record<"ctrlKey" | "metaKey" | "altKey" | "shiftKey", boolean>> = {}) {
  return { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...modifiers };
}

describe("масштаб просмотра", () => {
  test("кнопки +/− идут по ступеням и проходят через 100 %", () => {
    expect(zoomIn(0.9)).toBe(1);
    expect(zoomOut(1.25)).toBe(1);
    expect(zoomIn(1)).toBe(1.25);
    expect(zoomOut(1)).toBe(0.9);
    // из «Вписать» (произвольный масштаб) — к ближайшей ступени
    expect(zoomIn(0.42)).toBe(0.5);
    expect(zoomOut(0.42)).toBe(0.33);
  });

  test("масштаб не выходит за пределы", () => {
    expect(zoomIn(kMaxZoom)).toBe(kMaxZoom);
    expect(zoomOut(kMinZoom)).toBe(kMinZoom);
    expect(clampZoom(100)).toBe(kMaxZoom);
    expect(clampZoom(0)).toBe(kMinZoom);
    expect(clampZoom(NaN)).toBe(1);
    expect(wheelZoom(kMaxZoom, -10_000)).toBe(kMaxZoom);
  });

  test("колесо и щипок: вверх — крупнее, вниз — мельче, плавно", () => {
    expect(wheelZoom(1, -100)).toBeGreaterThan(1);
    expect(wheelZoom(1, 100)).toBeLessThan(1);
    expect(wheelZoom(1, -3)).toBeLessThan(1.02);
    expect(wheelZoom(wheelZoom(1, -50), 50)).toBeCloseTo(1, 6);
  });

  test("«Вписать» уменьшает большую картинку и не растягивает мелкую", () => {
    expect(fitZoom(2000, 1000, 0, 1000, 800)).toBe(0.5);
    expect(fitZoom(200, 100, 0, 1000, 800)).toBe(1);
    // повёрнутая на 90° вписывается по другой стороне
    expect(fitZoom(2000, 1000, 90, 1000, 800)).toBe(0.4);
    expect(fitZoom(2000, 1000, 270, 1000, 800)).toBe(0.4);
    // картинка ещё не загрузилась
    expect(fitZoom(0, 0, 0, 1000, 800)).toBe(1);
  });

  test("поворот по кругу, процент для показа", () => {
    expect(normalizeRotation(360)).toBe(0);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(-90)).toBe(270);
    expect(zoomPercent(1)).toBe("100 %");
    expect(zoomPercent(0.333)).toBe("33 %");
  });

  test("точка под курсором остаётся на месте", () => {
    // точка 100 px в окне при прокрутке 0; после 2× — та же точка документа на 200, прокрутка 100
    expect(scrollToKeepPoint(0, 100, 1, 2)).toBe(100);
    expect(scrollToKeepPoint(100, 100, 2, 1)).toBe(0);
    expect(scrollToKeepPoint(0, 100, 1, 0.5)).toBe(0);
    // мелкая картинка стояла по центру с отступом 50: точка 150 — это 100 px картинки, после 2× — 200
    expect(scrollToKeepPoint(0, 150, 1, 2, 50, 0)).toBe(50);
  });
});

describe("горячие клавиши просмотра", () => {
  test("картинка: масштаб, поворот, листание, копирование", () => {
    expect(previewShortcut(key("+"), "image")).toBe("zoomIn");
    expect(previewShortcut(key("="), "image")).toBe("zoomIn");
    expect(previewShortcut(key("-"), "image")).toBe("zoomOut");
    expect(previewShortcut(key("0"), "image")).toBe("fit");
    expect(previewShortcut(key("1"), "image")).toBe("actualSize");
    expect(previewShortcut(key("r"), "image")).toBe("rotate");
    expect(previewShortcut(key("R", { shiftKey: true }), "image")).toBe("rotate");
    expect(previewShortcut(key("ArrowRight"), "image")).toBe("next");
    expect(previewShortcut(key("ArrowLeft"), "image")).toBe("previous");
    expect(previewShortcut(key("c", { metaKey: true }), "image")).toBe("copy");
    expect(previewShortcut(key("c", { ctrlKey: true }), "image")).toBe("copy");
    // ⌘+/⌘− остаются масштабом всего окна
    expect(previewShortcut(key("=", { ctrlKey: true }), "image")).toBe(null);
    expect(previewShortcut(key("Escape"), "image")).toBe("close");
  });

  test("русская раскладка: те же клавиши", () => {
    expect(previewShortcut(key("к"), "image")).toBe("rotate");
    expect(previewShortcut(key("с", { metaKey: true }), "image")).toBe("copy");
    expect(previewShortcut(key("ы", { metaKey: true }), "pdf")).toBe("save");
  });

  test("PDF: печать и поиск, масштаб — у самого PDF", () => {
    expect(previewShortcut(key("p", { metaKey: true }), "pdf")).toBe("print");
    expect(previewShortcut(key("f", { ctrlKey: true }), "pdf")).toBe("find");
    expect(previewShortcut(key("s", { ctrlKey: true }), "pdf")).toBe("save");
    expect(previewShortcut(key("+"), "pdf")).toBe(null);
    expect(previewShortcut(key("r"), "pdf")).toBe(null);
    expect(previewShortcut(key("c", { metaKey: true }), "pdf")).toBe(null);
  });

  test("документы: масштаб без поворота и «Вписать»", () => {
    expect(previewShortcut(key("+"), "document")).toBe("zoomIn");
    expect(previewShortcut(key("1"), "text")).toBe("actualSize");
    expect(previewShortcut(key("0"), "document")).toBe("actualSize");
    expect(previewShortcut(key("0", { metaKey: true }), "text")).toBe(null);
    expect(previewShortcut(key("r"), "document")).toBe(null);
    expect(previewShortcut(key("p", { metaKey: true }), "document")).toBe(null);
  });

  test("пока печатают в поиске, одиночные клавиши — это текст", () => {
    expect(previewShortcut(key("r"), "pdf", true)).toBe(null);
    expect(previewShortcut(key("f"), "pdf", true)).toBe(null);
    expect(previewShortcut(key("ArrowLeft"), "pdf", true)).toBe(null);
    expect(previewShortcut(key("Escape"), "pdf", true)).toBe("close");
    expect(previewShortcut(key("f", { metaKey: true }), "pdf", true)).toBe("find");
  });

  test("Alt и прочие клавиши не перехватываются", () => {
    expect(previewShortcut(key("r", { altKey: true }), "image")).toBe(null);
    expect(previewShortcut(key("x"), "image")).toBe(null);
    expect(previewShortcut(key("Tab"), "image")).toBe(null);
  });

  test("набор инструментов по виду файла", () => {
    expect(previewActions("image").has("rotate")).toBe(true);
    expect(previewActions("pdf").has("print")).toBe(true);
    expect(previewActions("pdf").has("rotate")).toBe(false);
    expect(previewActions("document").has("zoomIn")).toBe(true);
    expect(previewActions("document").has("copy")).toBe(false);
  });
});
