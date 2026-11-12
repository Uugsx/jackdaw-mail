import { mount, unmount } from "svelte";
import FollowUpDateDialog from "../FollowUp/FollowUpDateDialog.svelte";
import { replyReminderTime } from "../../../logic/Mail/ReplyReminder/ReplyReminder";
import { gt } from "../../../l10n/l10n";

/** Спрашивает, на какое время напомнить ответить. null — пользователь отменил. См. pickFollowUpDate(). */
export function pickReplyReminderDate(initial?: Date): Promise<Date | null> {
  let defaultTime = initial ?? replyReminderTime("tomorrow");
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
        title: gt`Remind me at`,
        submitLabel: gt`Remind me`,
        validate: (until: Date) => until.getTime() > Date.now() ? null : gt`Please pick a time in the future`,
      },
    });
  });
}
