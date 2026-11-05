import { mount, unmount } from "svelte";
import FollowUpDateDialog from "../FollowUp/FollowUpDateDialog.svelte";
import { checkSendLaterTime, tomorrowMorning } from "../../../logic/Mail/SendLater/SendLater";
import { getDateTimeLocale, gt } from "../../../l10n/l10n";

/**
 * Спрашивает дату и время «Отправить позже» в модальном окне.
 * Время местное: `datetime-local` без пояса, `Date` хранит момент в UTC.
 * null — пользователь отменил выбор.
 */
export function pickSendLaterDate(initial?: Date): Promise<Date | null> {
  return new Promise(resolve => {
    let target = document.createElement("div");
    document.body.append(target);
    let instance: ReturnType<typeof mount> | null = null;
    let done = (sendAt: Date | null) => {
      if (instance) {
        void unmount(instance);
        instance = null;
      }
      target.remove();
      resolve(sendAt);
    };
    instance = mount(FollowUpDateDialog, {
      target,
      props: {
        initial: initial ?? tomorrowMorning(),
        onDone: done,
        title: gt`Send later`,
        submitLabel: gt`Schedule send`,
        validate: sendLaterTimeError,
      },
    });
  });
}

export function sendLaterTimeError(sendAt: Date): string | null {
  let problem = checkSendLaterTime(sendAt);
  return problem == "past"
    ? gt`The send time has already passed. Pick a later time.`
    : problem
      ? gt`Pick a send time within the next year.`
      : null;
}

/** «пт, 24 окт., 08:00»: день недели помогает не перепутать «понедельник» */
export function formatSendLaterTime(date: Date, now = new Date()): string {
  let sameYear = date.getFullYear() == now.getFullYear();
  return new Intl.DateTimeFormat(getDateTimeLocale(), {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
