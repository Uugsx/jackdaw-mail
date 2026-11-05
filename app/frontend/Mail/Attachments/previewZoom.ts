import type { PreviewKind } from "./attachmentPreview";

/** Масштаб и горячие клавиши встроенного просмотра вложений. Без DOM, чтобы проверять тестами. */

export const kMinZoom = 0.1;
export const kMaxZoom = 8;
/** Ступени кнопок +/−: как у просмотрщиков картинок, 100 % всегда среди них */
const kZoomSteps = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.25, 1.5, 2, 3, 4, 6, 8];
/** Чувствительность колеса и щипка: на столько пикселей прокрутки масштаб меняется в e раз */
const kWheelPixelsPerE = 300;
/** Погрешность сравнения масштабов: 0,333 и 0,33 — одна ступень */
const kEpsilon = 0.005;

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) {
    return 1;
  }
  return Math.min(kMaxZoom, Math.max(kMinZoom, zoom));
}

export function zoomIn(zoom: number): number {
  return kZoomSteps.find(step => step > zoom + kEpsilon) ?? kMaxZoom;
}

export function zoomOut(zoom: number): number {
  return [...kZoomSteps].reverse().find(step => step < zoom - kEpsilon) ?? kMinZoom;
}

/** Колесо с Ctrl/⌘ или щипок на тачпаде (Chromium присылает его как колесо с ctrlKey) */
export function wheelZoom(zoom: number, deltaY: number): number {
  return clampZoom(zoom * Math.exp(-deltaY / kWheelPixelsPerE));
}

/** Масштаб «Вписать»: картинка целиком в окне, мелкая не растягивается */
export function fitZoom(width: number, height: number, rotation: number, boxWidth: number, boxHeight: number): number {
  if (!(width > 0 && height > 0 && boxWidth > 0 && boxHeight > 0)) {
    return 1;
  }
  let [w, h] = isSideways(rotation) ? [height, width] : [width, height];
  return clampZoom(Math.min(1, boxWidth / w, boxHeight / h));
}

export function isSideways(rotation: number): boolean {
  return normalizeRotation(rotation) % 180 != 0;
}

export function normalizeRotation(rotation: number): number {
  return ((Math.round(rotation / 90) * 90) % 360 + 360) % 360;
}

export function zoomPercent(zoom: number): string {
  return `${Math.round(zoom * 100)} %`;
}

/** Прокрутка, при которой точка под курсором остаётся на месте после смены масштаба.
 * @param scroll текущая прокрутка по оси
 * @param point точка курсора относительно видимой области
 * @param oldOffset @param newOffset отступ картинки внутри области: мелкая стоит по центру */
export function scrollToKeepPoint(scroll: number, point: number, oldZoom: number, newZoom: number,
    oldOffset = 0, newOffset = 0): number {
  return Math.max(0, (scroll + point - oldOffset) * (newZoom / oldZoom) + newOffset - point);
}

export type PreviewAction =
  "close" | "previous" | "next" |
  "zoomIn" | "zoomOut" | "fit" | "actualSize" | "rotate" | "fullscreen" |
  "copy" | "save" | "print" | "find";

/** Какие инструменты есть у вида файла */
export function previewActions(kind: PreviewKind): Set<PreviewAction> {
  let actions = new Set<PreviewAction>(["close", "previous", "next", "save"]);
  if (kind == "image") {
    for (let action of ["zoomIn", "zoomOut", "fit", "actualSize", "rotate", "fullscreen", "copy"] as const) {
      actions.add(action);
    }
  } else if (kind == "pdf") {
    for (let action of ["print", "find", "fullscreen"] as const) {
      actions.add(action);
    }
  } else {
    for (let action of ["zoomIn", "zoomOut", "actualSize", "fullscreen"] as const) {
      actions.add(action);
    }
  }
  return actions;
}

type KeyLike = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">;

/** Действие по клавише. Одиночные клавиши не срабатывают, пока печатают в поле ввода.
 * @param inTextField фокус в поле ввода (поиск по PDF) */
export function previewShortcut(event: KeyLike, kind: PreviewKind, inTextField = false): PreviewAction | null {
  let action = shortcutAction(event, inTextField);
  if (action == "fit" && kind != "image") {
    action = "actualSize"; // у документа «0» — обычный размер, как Ctrl+0 в браузере
  }
  return action && previewActions(kind).has(action) ? action : null;
}

function shortcutAction(event: KeyLike, inTextField: boolean): PreviewAction | null {
  if (event.key == "Escape") {
    return "close";
  }
  if (event.altKey) {
    return null;
  }
  let key = event.key.length == 1 ? event.key.toLowerCase() : event.key;
  if (event.ctrlKey || event.metaKey) {
    // ⌘+/⌘−/⌘0 не берём: это масштаб всего окна в меню «Вид».
    // Русские буквы — та же клавиша в другой раскладке.
    return {
      "c": "copy", "с": "copy", "s": "save", "ы": "save", "p": "print", "з": "print", "f": "find", "а": "find",
    }[key] as PreviewAction ?? null;
  }
  if (inTextField) {
    return null;
  }
  return {
    "ArrowLeft": "previous", "ArrowRight": "next",
    "=": "zoomIn", "+": "zoomIn", "-": "zoomOut", "_": "zoomOut", "0": "fit", "1": "actualSize",
    "r": "rotate", "к": "rotate", "f": "fullscreen", "а": "fullscreen",
  }[key] as PreviewAction ?? null;
}
