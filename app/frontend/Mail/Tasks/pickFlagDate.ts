import { mount, unmount } from "svelte";
import FlagDateDialog from "./FlagDateDialog.svelte";
import { addDays, localDay, type DayString } from "../../../logic/Mail/Tasks/ExchangeTask";

/** Спрашивает свой срок флажка. null — пользователь отменил. См. pickFollowUpDate(). */
export function pickFlagDate(initial?: DayString | null): Promise<DayString | null> {
  let defaultDay = initial ?? addDays(localDay(new Date()), 1);
  return new Promise(resolve => {
    let target = document.createElement("div");
    document.body.append(target);
    let instance: ReturnType<typeof mount> | null = null;
    let done = (dueDay: DayString | null) => {
      if (instance) {
        void unmount(instance);
        instance = null;
      }
      target.remove();
      resolve(dueDay);
    };
    instance = mount(FlagDateDialog, {
      target,
      props: { initial: defaultDay, onDone: done },
    });
  });
}
