import { kSnoozeCheckMS, wakeDueSnoozes } from "../../../logic/Mail/Snooze/Snooze";
import { appGlobal } from "../../../logic/app";
import { backgroundError } from "../../Util/error";

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

/** Раз в минуту возвращает во «Входящие» письма, срок которых прошёл */
export function startSnoozeWatcher(): void {
  if (timer) {
    return;
  }
  let check = async () => {
    if (running) {
      return;
    }
    running = true;
    try {
      await wakeDueSnoozes(appGlobal.emailAccounts);
    } catch (ex) {
      backgroundError(ex);
    } finally {
      running = false;
    }
  };
  timer = setInterval(() => void check(), kSnoozeCheckMS);
  void check();
}
