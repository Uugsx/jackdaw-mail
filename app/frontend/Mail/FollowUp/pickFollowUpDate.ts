import { mount, unmount } from "svelte";
import FollowUpDateDialog from "./FollowUpDateDialog.svelte";

/**
 * Спрашивает дату и время напоминания в модальном окне.
 * Окно живёт отдельно от меню, из которого его открыли: меню закрывается
 * сразу после выбора пункта. null — пользователь отменил выбор.
 */
export function pickFollowUpDate(initial?: Date): Promise<Date | null> {
  let defaultDueAt = initial ?? new Date(Date.now() + 24 * 60 * 60 * 1000);
  return new Promise(resolve => {
    let target = document.createElement("div");
    document.body.append(target);
    let instance: ReturnType<typeof mount> | null = null;
    let done = (dueAt: Date | null) => {
      if (instance) {
        void unmount(instance);
        instance = null;
      }
      target.remove();
      resolve(dueAt);
    };
    instance = mount(FollowUpDateDialog, {
      target,
      props: { initial: defaultDueAt, onDone: done },
    });
  });
}
