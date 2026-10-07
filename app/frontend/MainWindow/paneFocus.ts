import { get, writable } from "svelte/store";
import { hideTooltips } from "../Shared/tooltip";

/** Какая часть главного окна последней получила клик мыши. */
export type PaneFocus = "mail" | "widgets";

export const paneFocus = writable<PaneFocus>("mail");

let mailWebViewPointerButtonDown = false;
let mailWebViewPointerReleasePosition: { clientX: number; clientY: number } | null = null;
let mailWebViewPointerReleasePending = false;

export function focusMailPane() {
  paneFocus.set("mail");
}

export function focusWidgetPane() {
  paneFocus.set("widgets");
}

/**
 * WebView не передаёт pointer-события гостевого документа в оболочку
 * Electron, поэтому фокус почтовой панели обновляется через input-event.
 */
export function updatePaneFocusFromWebViewInput(event: {
  type?: string;
  clickCount?: number;
}): void {
  if (event.type == "mouseDown" && event.clickCount == 1) {
    focusMailPane();
  }
}

/**
 * Пока указатель находится в почтовом WebView, соседние панели не должны
 * реагировать на stale :hover и показывать ложную подсветку.
 */
export function setMailWebViewPointerActive(active: boolean): void {
  if (!active) {
    mailWebViewPointerButtonDown = false;
    mailWebViewPointerReleasePosition = null;
    mailWebViewPointerReleasePending = false;
  }
  if (typeof document == "undefined") {
    return;
  }
  if (active && !document.body?.classList.contains("mail-webview-pointer-active")) {
    hideTooltips();
    let activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement &&
        !activeElement.closest(".message-display .body")) {
      // Выделение текста в native WebView не должно оставлять фокус на
      // случайной кнопке оболочки: иначе она выглядит выбранной рядом с
      // выделенным письмом, хотя пользователь её не нажимал.
      activeElement.blur();
    }
  }
  document.body?.classList.toggle("mail-webview-pointer-active", active);
}

/** Фиксирует нажатую кнопку до mouseup, даже если указатель покинул WebView. */
export function setMailWebViewPointerButtonDown(active: boolean): void {
  mailWebViewPointerButtonDown = active;
  if (active) {
    mailWebViewPointerReleasePosition = null;
    mailWebViewPointerReleasePending = false;
  }
}

export function isMailWebViewPointerButtonDown(): boolean {
  return mailWebViewPointerButtonDown;
}

/**
 * Запоминает отпускание мыши, чтобы не вернуть stale-hover на первом
 * mousemove. Нативный input-event WebView не содержит координат окна, поэтому
 * координаты здесь опциональны и используются только для точной проверки.
 */
export function markMailWebViewPointerReleased(clientX?: number, clientY?: number): void {
  mailWebViewPointerButtonDown = false;
  mailWebViewPointerReleasePosition = typeof clientX == "number" && typeof clientY == "number" &&
    Number.isFinite(clientX) && Number.isFinite(clientY)
    ? { clientX, clientY }
    : null;
  mailWebViewPointerReleasePending = true;
}

export function getMailWebViewPointerReleasePosition(): { clientX: number; clientY: number } | null {
  return mailWebViewPointerReleasePosition;
}

export function clearMailWebViewPointerReleasePosition(): void {
  mailWebViewPointerReleasePosition = null;
  mailWebViewPointerReleasePending = false;
}

/**
 * Поглощает click, который Chromium может сгенерировать на оболочке после
 * выделения текста, завершившегося уже за пределами нативного WebView.
 */
export function consumeMailWebViewPointerReleaseClick(): boolean {
  if (!mailWebViewPointerReleasePending) {
    return false;
  }
  clearMailWebViewPointerReleasePosition();
  return true;
}

/** Возвращает true один раз для input-event без координат окна. */
export function consumeMailWebViewPointerReleasePending(): boolean {
  if (!mailWebViewPointerReleasePending || mailWebViewPointerReleasePosition) {
    return false;
  }
  mailWebViewPointerReleasePending = false;
  return true;
}

export function isMailPaneFocused(): boolean {
  return get(paneFocus) == "mail";
}

export function isWidgetPaneFocused(): boolean {
  return get(paneFocus) == "widgets";
}

export function updatePaneFocusFromPointer(event: PointerEvent | MouseEvent) {
  if (!(event.target instanceof Element)) {
    return;
  }
  if (event.target.closest(".widget-sidebar")) {
    focusWidgetPane();
  } else if (event.target.closest(".content-shell")) {
    focusMailPane();
  }
}
