import { mount, unmount } from "svelte";
import FollowUpDateDialog from "../FollowUp/FollowUpDateDialog.svelte";
import { snoozePresetTime } from "../../../logic/Mail/Snooze/Snooze";
import { gt } from "../../../l10n/l10n";

/** Спрашивает, до какого времени отложить письмо. null — пользователь отменил. См. pickFollowUpDate(). */
export function pickSnoozeDate(initial?: Date): Promise<Date | null> {
  let defaultTime = initial ?? snoozePresetTime("tomorrow");
  return new Promise(resolve => {
    let target = document.createElement("div");
    document.body.append(target);
    let instance: ReturnType<typeof mount> | null = null;
    let done = (until: Date | null) => {
      if (instance) {
        void unmount(instance);
        instance = null;
      }
      target.remove();
      resolve(until);
    };
    instance = mount(FollowUpDateDialog, {
      target,
      props: {
        initial: defaultTime,
        onDone: done,
        title: gt`Snooze until`,
        submitLabel: gt`Snooze`,
        validate: (until: Date) => until.getTime() > Date.now() ? null : gt`Please pick a time in the future`,
      },
    });
  });
}
