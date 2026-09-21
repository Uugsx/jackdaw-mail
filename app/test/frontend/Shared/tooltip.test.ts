// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { installTooltips } from "../../../frontend/Shared/tooltip";

let uninstallTooltips: () => void;

beforeEach(() => {
  vi.useFakeTimers();
  document.body.replaceChildren();
  uninstallTooltips = installTooltips(document);
});

afterEach(() => {
  uninstallTooltips?.();
  document.body.replaceChildren();
  vi.useRealTimers();
});

function hover(element: HTMLElement): void {
  element.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
}

describe("renderer tooltips", () => {
  test("shows a stable body-level tooltip for a native title", () => {
    const button = document.createElement("button");
    button.title = "Настройки";
    button.textContent = "⚙";
    document.body.append(button);

    hover(button);
    vi.advanceTimersByTime(420);

    const tooltip = document.querySelector<HTMLElement>("#jackdaw-tooltip");
    expect(tooltip?.textContent).toBe("Настройки");
    expect(tooltip?.dataset.visible).toBe("true");
    expect(button.hasAttribute("title")).toBe(false);
    expect(button.getAttribute("aria-describedby")).toBe("jackdaw-tooltip");
  });

  test("does not show a tooltip when it repeats the visible button label", () => {
    const button = document.createElement("button");
    button.title = "Удалить";
    button.textContent = "Удалить";
    document.body.append(button);

    hover(button);
    vi.advanceTimersByTime(420);

    const tooltip = document.querySelector<HTMLElement>("#jackdaw-tooltip");
    expect(tooltip?.dataset.visible).toBe("false");
    expect(tooltip?.hidden).toBe(true);
    expect(button.hasAttribute("title")).toBe(false);

    button.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, relatedTarget: document.body }));
    vi.advanceTimersByTime(140);

    expect(button.getAttribute("title")).toBe("Удалить");
  });

  test("shows an explicit tooltip when the button label is visually hidden", () => {
    const button = document.createElement("button");
    button.title = "Почта";
    button.setAttribute("aria-label", "Почта");
    button.setAttribute("data-tooltip", "Почта");
    const hiddenLabel = document.createElement("span");
    hiddenLabel.textContent = "Почта";
    button.append(hiddenLabel);
    document.body.append(button);

    hover(button);
    vi.advanceTimersByTime(420);

    const tooltip = document.querySelector<HTMLElement>("#jackdaw-tooltip");
    expect(tooltip?.textContent).toBe("Почта");
    expect(tooltip?.dataset.visible).toBe("true");
  });

  test("does not restart while the pointer moves inside the same button", () => {
    const button = document.createElement("button");
    button.setAttribute("aria-label", "Обновить");
    const icon = document.createElement("span");
    button.append(icon);
    document.body.append(button);

    hover(button);
    icon.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    vi.advanceTimersByTime(419);
    expect(document.querySelector<HTMLElement>("#jackdaw-tooltip")?.dataset.visible).toBe("false");

    vi.advanceTimersByTime(1);
    expect(document.querySelector<HTMLElement>("#jackdaw-tooltip")?.dataset.visible).toBe("true");
  });

  test("finds the button when the pointer is over an aria-hidden icon", () => {
    const button = document.createElement("button");
    button.title = "Ответить";
    const icon = document.createElement("span");
    icon.setAttribute("aria-hidden", "true");
    button.append(icon);
    document.body.append(button);

    hover(icon);
    vi.advanceTimersByTime(420);

    expect(document.querySelector<HTMLElement>("#jackdaw-tooltip")?.textContent).toBe("Ответить");
    expect(document.querySelector<HTMLElement>("#jackdaw-tooltip")?.dataset.visible).toBe("true");
  });

  test("restores the previous title when moving to another button", () => {
    const first = document.createElement("button");
    first.title = "Первый";
    const second = document.createElement("button");
    second.title = "Второй";
    document.body.append(first, second);

    hover(first);
    vi.advanceTimersByTime(420);
    second.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, relatedTarget: first }));
    vi.advanceTimersByTime(420);

    expect(first.getAttribute("title")).toBe("Первый");
    expect(second.hasAttribute("title")).toBe(false);
    expect(document.querySelector<HTMLElement>("#jackdaw-tooltip")?.textContent).toBe("Второй");
  });

  test("ignores titles on non-interactive mail content", () => {
    const sender = document.createElement("span");
    sender.title = "Galkin Nikita SDS\nnikita.galkin@smartds.ru";
    sender.textContent = "Galkin Nikita SDS";
    document.body.append(sender);

    hover(sender);
    vi.advanceTimersByTime(420);

    expect(document.querySelector<HTMLElement>("#jackdaw-tooltip")?.dataset.visible).toBe("false");
    expect(sender.getAttribute("title")).toBe("Galkin Nikita SDS\nnikita.galkin@smartds.ru");
  });

  test("restores the native title after leaving and hides the tooltip", () => {
    const button = document.createElement("button");
    button.title = "Закрыть";
    document.body.append(button);

    hover(button);
    vi.advanceTimersByTime(420);
    button.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, relatedTarget: document.body }));
    vi.advanceTimersByTime(140);

    expect(button.getAttribute("title")).toBe("Закрыть");
    expect(button.hasAttribute("aria-describedby")).toBe(false);
    expect(document.querySelector<HTMLElement>("#jackdaw-tooltip")?.hidden).toBe(true);
  });
});
