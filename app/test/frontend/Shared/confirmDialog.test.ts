// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { mount, tick, unmount } from "svelte";

let ConfirmDialog: any;
let gt: any;
let setUILocale: any;
let mounted: ReturnType<typeof mount>[] = [];

afterEach(() => {
  for (let instance of mounted) {
    unmount(instance);
  }
  mounted = [];
  document.body.replaceChildren();
});

beforeAll(async () => {
  ConfirmDialog = (await import("../../../frontend/Shared/ConfirmDialog.svelte")).default;
  ({ gt, setUILocale } = await import("../../../l10n/l10n"));
  // Переводы грузятся по требованию: русский нужен до синхронного setUILocale("ru").
  await (await import("../../../l10n/messagesLoader")).loadLanguageMessages("ru");
});

describe("confirm dialog", () => {
  test("uses Russian translations for folder actions", () => {
    gt`OK`;
    setUILocale("ru");

    expect(gt`Delete folder “${"Черновики"}” and all messages in it? This cannot be undone.`)
      .toBe("Удалить папку «Черновики» и все сообщения в ней? Это действие нельзя отменить.");
    expect(gt`Move all messages in “${"Входящие"}” to Trash?`)
      .toBe("Переместить все сообщения из «Входящие» в корзину?");
    expect(gt`Permanently delete all messages in “${"Корзина"}”? This cannot be undone.`)
      .toBe("Окончательно удалить все сообщения из «Корзина»? Это действие нельзя отменить.");
  });

  test("shows translated actions and restores focus after cancel", async () => {
    let target = document.createElement("div");
    let trigger = document.createElement("button");
    target.append(trigger);
    document.body.append(target);
    trigger.focus();

    mounted.push(mount(ConfirmDialog, {
      target,
      props: {
        open: true,
        title: "Удаление",
        message: "Удалить все сообщения?",
        confirmLabel: "Удалить",
        cancelLabel: "Отмена",
      },
    }));
    await tick();
    await tick();

    let dialog = document.body.querySelector('[role="alertdialog"]') as HTMLElement;
    let buttons = Array.from(dialog.querySelectorAll("button"));
    expect(dialog.textContent).toContain("Удалить все сообщения?");
    expect(buttons.map((button) => button.textContent?.trim())).toEqual(["Отмена", "Удалить"]);
    expect(document.activeElement).toBe(buttons[1]);

    (buttons[0] as HTMLButtonElement).click();
    await tick();
    expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  test("closes on Escape and keeps Tab focus inside", async () => {
    let target = document.createElement("div");
    document.body.append(target);
    mounted.push(mount(ConfirmDialog, {
      target,
      props: {
        open: true,
        title: "Удаление",
        message: "Удалить все сообщения?",
        confirmLabel: "Удалить",
        cancelLabel: "Отмена",
      },
    }));
    await tick();

    let dialog = document.body.querySelector('[role="alertdialog"]') as HTMLElement;
    let buttons = Array.from(dialog.querySelectorAll("button")) as HTMLButtonElement[];
    buttons[1].focus();
    dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(buttons[0]);
    dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await tick();
    expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
  });
});
