import { get, writable } from "svelte/store";
import { hideTooltips } from "../Shared/tooltip";

/** Какая часть главного окна последней получила клик мыши. */
export type PaneFocus = "mail" | "widgets";

export const paneFocus = writable<PaneFocus>("mail");

let mailWebViewPointerButtonDown = false;
let mailWebViewPointerMovedWhileDown = false;
let mailWebViewPointerReleasePosition: { clientX: number; clientY: number } | null = null;
let mailWebViewPointerReleasePending = false;
let mailWebViewPointerReleaseMoveConsumed = false;
let mailWebViewPointerSelectionGuard = false;

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
    mailWebViewPointerMovedWhileDown = false;
    mailWebViewPointerReleasePosition = null;
    mailWebViewPointerReleasePending = false;
    mailWebViewPointerReleaseMoveConsumed = false;
    mailWebViewPointerSelectionGuard = false;
  }
  if (typeof document == "undefined") {
    return;
  }
  let body = document.body;
  if (!body) {
    return;
  }
  let wasActive = body.classList.contains("mail-webview-pointer-active");
  if (wasActive == active) {
    return;
  }
  if (active) {
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
  body.classList.toggle("mail-webview-pointer-active", active);
}

/** Снимает только визуальную защиту, сохраняя pending-click после drag-select. */
export function clearMailWebViewPointerActiveVisual(): void {
  if (typeof document == "undefined") {
    return;
  }
  document.body?.classList.remove("mail-webview-pointer-active");
}

/** Фиксирует нажатую кнопку до mouseup, даже если указатель покинул WebView. */
export function setMailWebViewPointerButtonDown(active: boolean): void {
  mailWebViewPointerButtonDown = active;
  if (active) {
    mailWebViewPointerMovedWhileDown = false;
    mailWebViewPointerReleasePosition = null;
    mailWebViewPointerReleasePending = false;
    mailWebViewPointerReleaseMoveConsumed = false;
    mailWebViewPointerSelectionGuard = false;
  }
}

export function isMailWebViewPointerButtonDown(): boolean {
  return mailWebViewPointerButtonDown;
}

/** Фиксирует движение мыши во время drag-select текста в WebView. */
export function markMailWebViewPointerMoved(): void {
  if (mailWebViewPointerButtonDown) {
    mailWebViewPointerMovedWhileDown = true;
  }
}

/**
 * Запоминает отпускание мыши, чтобы не вернуть stale-hover на первом
 * mousemove. Нативный input-event WebView не содержит координат окна, поэтому
 * координаты здесь опциональны и используются только для точной проверки.
 */
export function markMailWebViewPointerReleased(clientX?: number, clientY?: number): void {
  let selectionGuard = mailWebViewPointerSelectionGuard || mailWebViewPointerMovedWhileDown;
  mailWebViewPointerButtonDown = false;
  mailWebViewPointerMovedWhileDown = false;
  mailWebViewPointerReleasePosition = typeof clientX == "number" && typeof clientY == "number" &&
    Number.isFinite(clientX) && Number.isFinite(clientY)
    ? { clientX, clientY }
    : null;
  mailWebViewPointerReleasePending = true;
  mailWebViewPointerReleaseMoveConsumed = false;
  mailWebViewPointerSelectionGuard = selectionGuard;
}

export function getMailWebViewPointerReleasePosition(): { clientX: number; clientY: number } | null {
  return mailWebViewPointerReleasePosition;
}

export function clearMailWebViewPointerReleasePosition(): void {
  mailWebViewPointerReleasePosition = null;
  mailWebViewPointerReleasePending = false;
  mailWebViewPointerReleaseMoveConsumed = false;
  mailWebViewPointerSelectionGuard = false;
}

/** Убирает координаты отпускания после ухода указателя, сохраняя защиту selection. */
export function markMailWebViewPointerMovedAfterRelease(): boolean {
  if (!mailWebViewPointerReleasePending || !mailWebViewPointerReleasePosition ||
      mailWebViewPointerReleaseMoveConsumed) {
    return false;
  }
  mailWebViewPointerReleasePosition = null;
  mailWebViewPointerReleaseMoveConsumed = true;
  return true;
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
  if (!mailWebViewPointerReleasePending || mailWebViewPointerReleasePosition ||
      mailWebViewPointerReleaseMoveConsumed) {
    return false;
  }
  // Первый внешний mousemove нужен только для перехода из native WebView в
  // оболочку. Защиту от запоздалого click сохраняем до нового pointerdown.
  mailWebViewPointerReleaseMoveConsumed = true;
  return true;
}

export function isMailWebViewPointerSelectionGuardActive(): boolean {
  return mailWebViewPointerSelectionGuard;
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
