import { mount, unmount } from "svelte";
import ConfirmDialog from "./ConfirmDialog.svelte";

export type ConfirmChoice = "confirm" | "cancel" | "extra";

/**
 * Подтверждение в стиле приложения, независимое от жизни вызвавшего компонента:
 * панель действий сообщения исчезает при уходе указателя, а диалог должен остаться.
 * В Svelte 5 `new Component()` не работает, поэтому диалог создаётся через `mount()`.
 */
export function showConfirmDialog(options: { title: string; message?: string; confirmLabel?: string;
    cancelLabel?: string; extraLabel?: string | null; showCancel?: boolean }): Promise<ConfirmChoice> {
  return new Promise(resolve => {
    let dialog: Record<string, any>;
    let finish = (choice: ConfirmChoice) => {
      resolve(choice);
      // После закрытия: диалог возвращает фокус туда, где он был.
      queueMicrotask(() => unmount(dialog));
    };
    dialog = mount(ConfirmDialog, {
      target: document.body,
      props: {
        open: true,
        title: options.title,
        message: options.message ?? "",
        confirmLabel: options.confirmLabel ?? null,
        cancelLabel: options.cancelLabel ?? null,
        extraLabel: options.extraLabel ?? null,
        showCancel: options.showCancel ?? true,
      },
      events: {
        confirm: () => finish("confirm"),
        cancel: () => finish("cancel"),
        extra: () => finish("extra"),
      },
    });
  });
}

/** @returns true — пользователь подтвердил */
export async function askConfirm(options: { title: string; message?: string; confirmLabel?: string; cancelLabel?: string }): Promise<boolean> {
  return await showConfirmDialog(options) == "confirm";
}
