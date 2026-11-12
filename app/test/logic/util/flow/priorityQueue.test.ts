import { Semaphore } from '../../../../logic/util/flow/Semaphore';
import { Throttle } from '../../../../logic/util/flow/Throttle';
import { sleep } from '../../../../logic/util/util';
import { expect, test } from 'vitest';

/* Текст открытого письма Exchange грузился минутами: запрос стоял в общей
 * очереди за сотнями запросов синхронизации (2026-11-10). */

test("Приоритетная задача семафора обгоняет очередь, но не другие приоритетные", async () => {
  let sema = new Semaphore(1);
  let order: string[] = [];
  async function task(name: string, priority = false) {
    let lock = await sema.lock(priority);
    try {
      order.push(name);
      await sleep(0.01);
    } finally {
      lock.release();
    }
  }
  let all = [task("running")];
  for (let i = 1; i <= 5; i++) {
    all.push(task("sync" + i));
  }
  all.push(task("open1", true));
  all.push(task("open2", true));
  await Promise.all(all);
  expect(order).toEqual(["running", "open1", "open2", "sync1", "sync2", "sync3", "sync4", "sync5"]);
  expect(sema.countRunning).toBe(0);
  expect(sema.countWaiting).toBe(0);
});

test("Приоритетный запрос не ждёт очередь Throttle, но выжидает паузу сервера", async () => {
  let throttle = new Throttle(2, 1);
  // Очередь синхронизации заняла слоты на несколько секунд вперёд
  for (let i = 0; i < 6; i++) {
    void throttle.throttle();
  }
  let started = Date.now();
  await throttle.throttle(true);
  expect(Date.now() - started).toBeLessThan(100);

  // Сервер попросил подождать — приоритетный запрос тоже ждёт
  throttle.waitForSecond(0.3);
  started = Date.now();
  await throttle.throttle(true);
  expect(Date.now() - started).toBeGreaterThanOrEqual(250);
});
