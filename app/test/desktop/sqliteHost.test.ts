import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sql from "../../../lib/rs-sqlite";
import { batchRef, runBatch } from "../../../lib/rs-sqlite/batch";
import { InProcessSQLiteHost } from "../logic/util/hostedSQLite";

let tempDir: string;
let sqlite: InProcessSQLiteHost;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "sqlite-host-test-"));
  sqlite = new InProcessSQLiteHost();
});

afterEach(async () => {
  await sqlite.host.shutdown();
  rmSync(tempDir, { recursive: true, force: true });
});

function open(filename = "test.db") {
  return sqlite.host.openDatabase(path.join(tempDir, filename), {});
}

test("миграции: SQL и функции, user_version, повторный запуск пропускает выполненные", async () => {
  let db = await open();
  let functionRuns = 0;
  let migrations = [
    sql`CREATE TABLE item (id INTEGER PRIMARY KEY, name TEXT)`,
    async (database: any) => {
      functionRuns++;
      await database.run(sql`INSERT INTO item (name) VALUES (${"from migration"})`);
    },
  ];
  await db.migrate(...migrations);
  expect(await db.pragma("user_version", { simple: true })).toBe(2);
  expect(await db.pragma("journal_mode", { simple: true })).toBe("wal");
  expect(await db.pragma("foreign_keys", { simple: true })).toBe(1);

  await db.migrate(...migrations, sql`ALTER TABLE item ADD COLUMN extra TEXT`);
  expect(functionRuns).toBe(1);
  expect(await db.pragma("user_version", { simple: true })).toBe(3);
  let rows = await db.all(sql`SELECT name, extra FROM item`);
  expect(rows).toEqual([{ name: "from migration", extra: null }]);
});

test("миграции: ошибка откатывает только неудачную миграцию", async () => {
  let db = await open();
  await expect(db.migrate(
    sql`CREATE TABLE ok (id INTEGER PRIMARY KEY)`,
    async (database: any) => {
      await database.run(sql`INSERT INTO ok (id) VALUES (1)`);
      throw new Error("migration failed");
    },
  )).rejects.toThrow("migration failed");
  expect(await db.pragma("user_version", { simple: true })).toBe(1);
  expect(await db.all(sql`SELECT id FROM ok`)).toEqual([]);
});

test("run/get/all/execute работают как у better-sqlite3, порядок вызовов сохраняется", async () => {
  let db = await open();
  expect(await db.execute(sql`CREATE TABLE item (id INTEGER PRIMARY KEY, value INTEGER)`)).toBe(db);
  // Без await между вызовами: процесс базы обязан выполнить их по порядку
  let inserts = [];
  for (let value = 0; value < 50; value++) {
    inserts.push(db.run(sql`INSERT INTO item (value) VALUES (${value})`));
  }
  let rows = db.all(sql`SELECT value FROM item ORDER BY id`);
  let results = await Promise.all(inserts);
  expect(results[0]).toEqual({ changes: 1, lastInsertRowid: 1 });
  expect(results[49].lastInsertRowid).toBe(50);
  expect((await rows).map((row: any) => row.value)).toEqual([...Array(50).keys()]);
  expect(await db.get(sql`SELECT COUNT(*) AS n FROM item`)).toEqual({ n: 50 });
  expect(await db.get(sql`SELECT value FROM item WHERE id = ${-1}`)).toBeUndefined();
});

test("batch: ссылки на результаты шагов, RETURNING и один запрос к процессу базы", async () => {
  let db = await open();
  await db.execute(sql`
    CREATE TABLE parent (id INTEGER PRIMARY KEY, name TEXT UNIQUE);
    CREATE TABLE child (parentID INTEGER NOT NULL REFERENCES parent (id), value TEXT);
  `);
  await db.pragma("foreign_keys = true");
  let before = sqlite.requests.length;
  let results = await db.batch([
    { query: sql`INSERT INTO parent (name) VALUES (${"a"})` },
    { query: sql`INSERT INTO child (parentID, value) VALUES (${batchRef(0)}, ${"x"})` },
    { mode: "get", query: sql`
      INSERT INTO parent (name) VALUES (${"a"})
      ON CONFLICT (name) DO UPDATE SET name = excluded.name
      RETURNING id` },
    { query: sql`INSERT INTO child (parentID, value) VALUES (${batchRef(2, "id")}, ${"y"})` },
    { mode: "all", query: sql`SELECT parentID, value FROM child ORDER BY value` },
  ]);
  expect(sqlite.countRequests(before)).toBe(1);
  expect(results[0]).toEqual({ changes: 1, lastInsertRowid: 1 });
  expect(results[2]).toEqual({ id: 1 });
  expect(results[4]).toEqual([{ parentID: 1, value: "x" }, { parentID: 1, value: "y" }]);
});

test("batch: ошибка любого шага откатывает весь пакет", async () => {
  let db = await open();
  await db.execute(sql`CREATE TABLE item (id INTEGER PRIMARY KEY, name TEXT NOT NULL)`);
  await expect(db.batch([
    { query: sql`INSERT INTO item (name) VALUES (${"first"})` },
    { query: sql`INSERT INTO item (name) VALUES (${null})` },
  ])).rejects.toMatchObject({ code: "SQLITE_CONSTRAINT_NOTNULL" });
  expect(await db.all(sql`SELECT * FROM item`)).toEqual([]);

  await expect(db.batch([
    { query: sql`INSERT INTO item (name) VALUES (${"first"})` },
    { query: sql`INSERT INTO item (name) VALUES (${batchRef(5)})` },
  ])).rejects.toThrow("not available");
  expect(await db.all(sql`SELECT * FROM item`)).toEqual([]);
});

test("batch внутри открытой транзакции миграции использует SAVEPOINT", async () => {
  let db = await open();
  await db.migrate(
    sql`CREATE TABLE item (id INTEGER PRIMARY KEY, name TEXT)`,
    async (database: any) => {
      await runBatch(database, [
        { query: sql`INSERT INTO item (name) VALUES (${"a"})` },
        { query: sql`INSERT INTO item (name) VALUES (${"b"})` },
      ]);
    },
  );
  expect(await db.get(sql`SELECT COUNT(*) AS n FROM item`)).toEqual({ n: 2 });
});

test("код ошибки SQLite доходит до вызывающего", async () => {
  let db = await open();
  await db.execute(sql`CREATE TABLE item (name TEXT UNIQUE)`);
  await db.run(sql`INSERT INTO item (name) VALUES (${"a"})`);
  await expect(db.run(sql`INSERT INTO item (name) VALUES (${"a"})`))
    .rejects.toMatchObject({ code: "SQLITE_CONSTRAINT_UNIQUE", name: "SqliteError" });
});

test("BLOB: Buffer туда и обратно остаётся Buffer", async () => {
  let db = await open();
  await db.execute(sql`CREATE TABLE file (data BLOB)`);
  await db.run(sql`INSERT INTO file (data) VALUES (${Buffer.from([1, 2, 3])})`);
  let row = await db.get(sql`SELECT data FROM file`) as any;
  expect(Buffer.isBuffer(row.data)).toBe(true);
  expect([...row.data]).toEqual([1, 2, 3]);
});

test("база из буфера открывается в памяти", async () => {
  let file = await open("source.db");
  await file.execute(sql`CREATE TABLE item (name TEXT)`);
  await file.run(sql`INSERT INTO item (name) VALUES (${"copied"})`);
  await file.close();
  let { readFileSync } = await import("node:fs");
  let buffer = new Uint8Array(readFileSync(path.join(tempDir, "source.db")));
  let memory = await sqlite.host.openDatabase(null, { readonly: true }, buffer);
  expect(await memory.all(sql`SELECT name FROM item`)).toEqual([{ name: "copied" }]);
});

test("после падения процесса база переоткрывается, pragma соединения восстанавливаются", async () => {
  let db = await open();
  await db.migrate(sql`
    CREATE TABLE parent (id INTEGER PRIMARY KEY);
    CREATE TABLE child (parentID INTEGER NOT NULL REFERENCES parent (id) ON DELETE CASCADE);
  `);
  await db.pragma("foreign_keys = true");
  await db.run(sql`INSERT INTO parent (id) VALUES (1)`);

  let pending = db.get(sql`SELECT COUNT(*) AS n FROM parent`);
  sqlite.crash();
  await expect(pending).rejects.toThrow("exited");

  expect(await db.get(sql`SELECT COUNT(*) AS n FROM parent`)).toEqual({ n: 1 });
  expect(sqlite.starts).toBe(2);
  expect(await db.pragma("foreign_keys", { simple: true })).toBe(1);
  await expect(db.run(sql`INSERT INTO child (parentID) VALUES (42)`))
    .rejects.toMatchObject({ code: "SQLITE_CONSTRAINT_FOREIGNKEY" });
});

test("база в памяти после падения процесса сообщает о потере, а не возвращает пустые данные", async () => {
  let file = await open("source.db");
  await file.execute(sql`CREATE TABLE item (name TEXT)`);
  await file.close();
  let { readFileSync } = await import("node:fs");
  let memory = await sqlite.host.openDatabase(null, {}, new Uint8Array(readFileSync(path.join(tempDir, "source.db"))));
  sqlite.crash();
  await expect(memory.all(sql`SELECT name FROM item`)).rejects.toThrow("In-memory SQLite database was lost");
});

test("после shutdown() следующий запрос запускает новый процесс", async () => {
  let db = await open();
  await db.execute(sql`CREATE TABLE item (name TEXT)`);
  await sqlite.host.shutdown();
  let reopened = await open();
  expect(await reopened.all(sql`SELECT name FROM item`)).toEqual([]);
  expect(sqlite.starts).toBe(2);
});

test("закрытая база отклоняет запросы", async () => {
  let db = await open();
  await db.close();
  await expect(db.all(sql`SELECT 1`)).rejects.toThrow("closed");
});

test("частые падения процесса не перезапускают его бесконечно", async () => {
  let db = await open();
  let failures = 0;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      await db.get(sql`SELECT 1 AS one`);
    } catch {
      failures++;
    }
    sqlite.crash();
  }
  await expect(db.get(sql`SELECT 1 AS one`)).rejects.toThrow("keeps crashing");
  expect(sqlite.starts).toBeLessThanOrEqual(6);
  expect(failures).toBeGreaterThan(0);
});
