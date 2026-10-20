import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sql from "../../../lib/rs-sqlite";
import { kBusyTimeoutMs } from "../../../desktop/backend/sqlite/SQLiteServer";
import { InProcessSQLiteHost } from "../logic/util/hostedSQLite";

let tempDir: string;
let sqlite: InProcessSQLiteHost;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "sqlite-busy-test-"));
  sqlite = new InProcessSQLiteHost();
});

afterEach(async () => {
  await sqlite.host.shutdown();
  rmSync(tempDir, { recursive: true, force: true });
});

function open(filename = "test.db", options: any = {}) {
  return sqlite.host.openDatabase(path.join(tempDir, filename), options);
}

test("busy_timeout файловой базы не меньше 15 с: сразу после открытия и после migrate()", async () => {
  expect(kBusyTimeoutMs).toBeGreaterThanOrEqual(15_000);
  let db = await open();
  expect(await db.pragma("busy_timeout", { simple: true })).toBe(kBusyTimeoutMs);
  // migrate() библиотеки ставит busy_timeout = 5000
  await db.migrate(sql`CREATE TABLE item (id INTEGER PRIMARY KEY)`);
  expect(await db.pragma("busy_timeout", { simple: true })).toBe(kBusyTimeoutMs);
});

test("busy_timeout переустанавливается после перезапуска процесса базы", async () => {
  let db = await open();
  await db.migrate(sql`CREATE TABLE item (id INTEGER PRIMARY KEY)`);
  sqlite.crash();
  expect(await db.pragma("busy_timeout", { simple: true })).toBe(kBusyTimeoutMs);
  expect(sqlite.starts).toBe(2);
});

test("явный busy_timeout вызывающего сохраняется после migrate() и перезапуска процесса", async () => {
  let db = await open();
  await db.pragma("busy_timeout = 20000");
  await db.migrate(sql`CREATE TABLE item (id INTEGER PRIMARY KEY)`);
  expect(await db.pragma("busy_timeout", { simple: true })).toBe(20000);
  sqlite.crash();
  expect(await db.pragma("busy_timeout", { simple: true })).toBe(20000);
});

test("явный timeout в параметрах открытия важнее (импорт чужих баз)", async () => {
  let db = await open("other.db", { timeout: 200 });
  expect(await db.pragma("busy_timeout", { simple: true })).toBe(200);
});

test("journal_mode = WAL для базы уже в WAL не ждёт чужую блокировку, а переход в DELETE отказывает сразу", async () => {
  let first = await open();
  await first.migrate(sql`CREATE TABLE item (id INTEGER PRIMARY KEY)`);
  let second = await open();
  await second.migrate(sql`CREATE TABLE item (id INTEGER PRIMARY KEY)`);
  // Второе соединение держит читающую транзакцию, как другое окно или прошлая версия
  await second.execute(sql`BEGIN`);
  await second.all(sql`SELECT * FROM item`);

  let started = Date.now();
  expect(await first.pragma("journal_mode = WAL", { simple: true })).toBe("wal");
  // Этот переход и ронял запуск: account.db каждый раз возвращалась в DELETE
  await expect(first.pragma("journal_mode = DELETE")).rejects.toMatchObject({ code: "SQLITE_BUSY" });
  expect(Date.now() - started).toBeLessThan(5_000);

  await second.execute(sql`COMMIT`);
});
