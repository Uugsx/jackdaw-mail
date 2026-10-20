import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sql from "../../../../../lib/rs-sqlite";
import { InProcessSQLiteHost } from "../../util/hostedSQLite";
import { openDatabaseOnce } from "../../../../logic/util/openDatabaseOnce";

const backend = vi.hoisted(() => ({
  getSQLiteDatabase: null as unknown as (filename: string) => Promise<any>,
}));

vi.mock("../../../../logic/util/backend-wrapper", () => ({
  getSQLiteDatabase: vi.fn((filename: string) => backend.getSQLiteDatabase(filename)),
}));
vi.mock("../../../../logic/Mail/SQL/Account/SQLAccountsMigrate", () => ({
  migrateToAccountsDB: vi.fn(async () => {}),
}));

let tempDir = mkdtempSync(path.join(tmpdir(), "get-database-init-"));
let sqlite = new InProcessSQLiteHost();

afterAll(async () => {
  await sqlite.host.shutdown();
  rmSync(tempDir, { recursive: true, force: true });
});

function busyError(): Error {
  return Object.assign(new Error("database is locked"), { name: "SqliteError", code: "SQLITE_BUSY" });
}

describe("openDatabaseOnce", () => {
  test("параллельные вызовы ждут одну инициализацию и получают одну базу", async () => {
    let database = { close: vi.fn() } as any;
    let connect = vi.fn(async () => database);
    let initFinished = false;
    let init = vi.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      initFinished = true;
    });
    let open = openDatabaseOnce(connect, init);
    let results = await Promise.all([
      open().then(db => (expect(initFinished).toBe(true), db)),
      open(),
      open(),
    ]);
    expect(results).toEqual([database, database, database]);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenCalledTimes(1);
  });

  test("ошибка инициализации не кэшируется: соединение закрыто, следующий вызов открывает заново", async () => {
    let first = { close: vi.fn(async () => {}) } as any;
    let second = { close: vi.fn(async () => {}) } as any;
    let connect = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    let init = vi.fn()
      .mockRejectedValueOnce(busyError())
      .mockResolvedValueOnce(undefined);
    let open = openDatabaseOnce(connect, init);
    await expect(open()).rejects.toMatchObject({ code: "SQLITE_BUSY" });
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(await open()).toBe(second);
    expect(second.close).not.toHaveBeenCalled();
    expect(connect).toHaveBeenCalledTimes(2);
  });

  test("ошибка закрытия не заменяет исходную ошибку инициализации", async () => {
    let database = { close: vi.fn(async () => { throw new Error("close failed"); }) } as any;
    let open = openDatabaseOnce(async () => database, async () => { throw busyError(); });
    await expect(open()).rejects.toMatchObject({ code: "SQLITE_BUSY" });
  });
});

describe("getDatabase() локальных баз", () => {
  beforeEach(() => {
    vi.resetModules();
    backend.getSQLiteDatabase = filename => sqlite.host.openDatabase(path.join(tempDir, filename), {});
  });

  test("mail.db: параллельные вызовы получают одну инициализацию с выполненными миграциями", async () => {
    let opened = 0;
    backend.getSQLiteDatabase = filename => {
      opened++;
      return sqlite.host.openDatabase(path.join(tempDir, filename), {});
    };
    let { getDatabase, mailDatabaseMigrations } = await import("../../../../logic/Mail/SQL/SQLDatabase");
    let databases = await Promise.all([getDatabase(), getDatabase(), getDatabase()]);
    expect(opened).toBe(1);
    expect(new Set(databases).size).toBe(1);
    expect(await databases[0].pragma("user_version", { simple: true })).toBe(mailDatabaseMigrations.length);
  });

  test("calendar.db: SQLITE_BUSY при инициализации не кэшируется, повтор открывает базу заново", async () => {
    let attempts = 0;
    backend.getSQLiteDatabase = async filename => {
      attempts++;
      let database = await sqlite.host.openDatabase(path.join(tempDir, filename), {});
      if (attempts == 1) {
        (database as any).migrate = async () => {
          throw busyError();
        };
      }
      return database;
    };
    let { getDatabase } = await import("../../../../logic/Calendar/SQL/SQLDatabase");
    await expect(getDatabase()).rejects.toMatchObject({ code: "SQLITE_BUSY" });
    let database = await getDatabase();
    expect(attempts).toBe(2);
    expect(await database.all(sql`SELECT id FROM calendar`)).toEqual([]);
  });

  test("account.db открывается, хотя файл держит другое соединение (без перехода WAL → DELETE)", async () => {
    let other = await sqlite.host.openDatabase(path.join(tempDir, "account.db"), {});
    await other.migrate();
    await other.execute(sql`BEGIN`);
    await other.pragma("user_version");
    await other.all(sql`SELECT name FROM sqlite_schema`);
    try {
      let { getDatabase } = await import("../../../../logic/Mail/SQL/Account/SQLDatabase");
      let database = await getDatabase();
      expect(await database.pragma("journal_mode", { simple: true })).toBe("wal");
      expect(await database.all(sql`SELECT idStr FROM account`)).toEqual([]);
    } finally {
      await other.execute(sql`COMMIT`);
    }
  });
});
