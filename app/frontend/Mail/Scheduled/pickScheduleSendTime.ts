import { mount, unmount } from "svelte";
import ScheduleSendDialog from "./ScheduleSendDialog.svelte";
import type { ScheduledSendMode } from "../../../logic/Mail/Scheduled/ScheduledSendData";

/**
 * Спрашивает время «Отправить позже» в модальном окне.
 * @param mode где будет ждать письмо: от этого зависит подсказка в окне
 * @returns null — пользователь передумал
 */
export function pickScheduleSendTime(mode: ScheduledSendMode, initial?: Date): Promise<Date | null> {
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
    instance = mount(ScheduleSendDialog, {
      target,
      props: { mode, initial: initial ?? null, onDone: done },
    });
  });
}

/** Варианты быстрого выбора, как в Outlook: завтра утром и днём, утро понедельника */
export function scheduleSendPresets(now = new Date()): { key: "tomorrowMorning" | "tomorrowAfternoon" | "mondayMorning", at: Date }[] {
  let tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  let monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + ((8 - now.getDay()) % 7 || 7));
  let at = (day: Date, hours: number) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours, 0);
  let presets = [
    { key: "tomorrowMorning" as const, at: at(tomorrow, 8) },
    { key: "tomorrowAfternoon" as const, at: at(tomorrow, 13) },
    { key: "mondayMorning" as const, at: at(monday, 8) },
  ];
  // В воскресенье «понедельник утром» совпадает с «завтра утром»
  return presets.filter((preset, index) =>
    presets.findIndex(other => other.at.getTime() == preset.at.getTime()) == index);
}
