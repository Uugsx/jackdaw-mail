import { sleep } from "../util";

/**
 * Limits the number of tasks per second.
 */
export class Throttle {
  protected nextTime: number[];
  protected perSecond = 1; // in seconds
  /** До какого момента сервер просил подождать (`waitForSecond()`) */
  protected backoffUntil = 0;

  /**
   * @param maxTasks max count of tasks per interval
   * @param perSecond interval, in seconds
   */
  constructor(maxTasks: number, perSecond: number) {
    this.perSecond = perSecond;
    this.nextTime = new Array(maxTasks).fill(0);
  }

  /**
   * @param priority Не вставать в очередь обычных задач, только выждать паузу,
   *   которую попросил сервер: для одного запроса, который ждёт пользователь.
   */
  async throttle(priority = false): Promise<void> {
    let now = Date.now();
    if (priority) {
      if (this.backoffUntil > now) {
        await sleep((this.backoffUntil - now) / 1000);
      }
      return;
    }
    this.nextTime.push(now + this.perSecond * 1000);
    let waitFor = (this.nextTime.shift() ?? 0) - now;
    if (waitFor > 0) {
      console.log(`Throttling for ${waitFor}ms because there were ${this.nextTime.length} connections in the last ${this.perSecond} second`);
      await sleep(waitFor / 1000);
    }
  }

  /** Delays the next task until `seconds` from now. */
  waitForSecond(seconds: number) {
    this.nextTime[0] = Math.max(this.nextTime[0] ?? 0, Date.now() + seconds * 1000);
    this.backoffUntil = Math.max(this.backoffUntil, Date.now() + seconds * 1000);
  }

  get maxTasks(): number {
    return this.nextTime.length;
  }
  set maxTasks(max: number) {
    let oldMax = this.nextTime.length;
    if (max == oldMax) {
      return;
    }
    this.nextTime.length = max;
    if (oldMax < max) {
      this.nextTime.fill(0, oldMax);
    }
  }
}
