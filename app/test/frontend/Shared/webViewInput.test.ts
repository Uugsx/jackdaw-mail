// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import {
  focusMailPane,
  focusWidgetPane,
  getMailWebViewPointerReleasePosition,
  isMailPaneFocused,
  isMailWebViewPointerButtonDown,
  isMailWebViewPointerSelectionGuardActive,
  markMailWebViewPointerMoved,
  markMailWebViewPointerMovedAfterRelease,
  markMailWebViewPointerReleased,
  paneFocus,
  clearMailWebViewPointerReleasePosition,
  clearMailWebViewPointerActiveVisual,
  consumeMailWebViewPointerReleaseClick,
  consumeMailWebViewPointerReleasePending,
  setMailWebViewPointerButtonDown,
  setMailWebViewPointerActive,
  updatePaneFocusFromWebViewInput,
} from "../../../frontend/MainWindow/paneFocus";

afterEach(() => {
  setMailWebViewPointerButtonDown(false);
  focusMailPane();
  setMailWebViewPointerActive(false);
});

describe("фокус почтовой панели из input-event WebView", () => {
  it("переключает фокус на одиночном нажатии в письме", () => {
    focusWidgetPane();

    updatePaneFocusFromWebViewInput({ type: "mouseDown", clickCount: 1 });

    expect(isMailPaneFocused()).toBe(true);
    expect(get(paneFocus)).toBe("mail");
  });

  it("не меняет фокус для двойного клика и клавиатурного события", () => {
    focusWidgetPane();

    updatePaneFocusFromWebViewInput({ type: "mouseDown", clickCount: 2 });
    expect(get(paneFocus)).toBe("widgets");

    updatePaneFocusFromWebViewInput({ type: "rawKeyDown" });
    expect(get(paneFocus)).toBe("widgets");
  });

  it("блокирует hover-панели на время удержания левой кнопки", () => {
    setMailWebViewPointerButtonDown(true);
    expect(isMailWebViewPointerButtonDown()).toBe(true);

    setMailWebViewPointerActive(true);
    expect(document.body.classList.contains("mail-webview-pointer-active")).toBe(true);

    setMailWebViewPointerButtonDown(false);
    expect(isMailWebViewPointerButtonDown()).toBe(false);

    setMailWebViewPointerActive(false);
    expect(document.body.classList.contains("mail-webview-pointer-active")).toBe(false);
  });

  it("снимает фокус со случайной кнопки оболочки при начале выделения", () => {
    let button = document.createElement("button");
    document.body.append(button);
    button.focus();
    expect(document.activeElement).toBe(button);

    setMailWebViewPointerActive(true);

    expect(document.activeElement).not.toBe(button);
  });

  it("сохраняет защиту от ложного hover и click после drag-select", () => {
    setMailWebViewPointerButtonDown(true);
    markMailWebViewPointerMoved();
    markMailWebViewPointerReleased();

    expect(isMailWebViewPointerSelectionGuardActive()).toBe(true);
    expect(consumeMailWebViewPointerReleasePending()).toBe(true);
    expect(isMailWebViewPointerSelectionGuardActive()).toBe(true);
    expect(consumeMailWebViewPointerReleaseClick()).toBe(true);
    expect(isMailWebViewPointerSelectionGuardActive()).toBe(false);
  });

  it("не теряет защиту после ухода указателя с координатным mouseup", () => {
    setMailWebViewPointerButtonDown(true);
    markMailWebViewPointerMoved();
    markMailWebViewPointerReleased(120, 240);

    expect(markMailWebViewPointerMovedAfterRelease()).toBe(true);
    expect(consumeMailWebViewPointerReleaseClick()).toBe(true);
  });

  it("сохраняет точку отпускания до следующего движения или нового нажатия", () => {
    markMailWebViewPointerReleased(120, 240);
    expect(isMailWebViewPointerButtonDown()).toBe(false);
    expect(getMailWebViewPointerReleasePosition()).toEqual({ clientX: 120, clientY: 240 });

    setMailWebViewPointerButtonDown(true);
    expect(getMailWebViewPointerReleasePosition()).toBeNull();

    markMailWebViewPointerReleased(Number.NaN, Number.NaN);
    expect(getMailWebViewPointerReleasePosition()).toBeNull();
    clearMailWebViewPointerReleasePosition();
  });

  it("защищает первый внешний mousemove после native отпускания без координат окна", () => {
    markMailWebViewPointerReleased();

    expect(consumeMailWebViewPointerReleasePending()).toBe(true);
    expect(consumeMailWebViewPointerReleasePending()).toBe(false);

    setMailWebViewPointerButtonDown(true);
    expect(consumeMailWebViewPointerReleasePending()).toBe(false);
  });

  it("поглощает внешний click после отпускания выделения", () => {
    markMailWebViewPointerReleased(300, 400);

    expect(consumeMailWebViewPointerReleaseClick()).toBe(true);
    expect(getMailWebViewPointerReleasePosition()).toBeNull();
    expect(consumeMailWebViewPointerReleaseClick()).toBe(false);
  });

  it("снимает визуальную защиту после ухода указателя и сохраняет pending-click", () => {
    setMailWebViewPointerButtonDown(true);
    markMailWebViewPointerMoved();
    markMailWebViewPointerReleased();
    setMailWebViewPointerActive(true);

    clearMailWebViewPointerActiveVisual();

    expect(document.body.classList.contains("mail-webview-pointer-active")).toBe(false);
    expect(consumeMailWebViewPointerReleaseClick()).toBe(true);
  });

  it("не меняет DOM повторными вызовами активации", () => {
    let toggle = vi.spyOn(document.body.classList, "toggle");

    setMailWebViewPointerActive(true);
    setMailWebViewPointerActive(true);

    expect(toggle).toHaveBeenCalledTimes(1);
    toggle.mockRestore();
  });
});
