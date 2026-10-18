// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe } from "vitest";
import { InProcessSQLiteHost } from "../../util/hostedSQLite";
import { defineBatchSaveTests } from "./batchSaveScenarios";

/** Десктопный бэкенд: SQLiteHost → SQLiteServer → better-sqlite3, пакет — одна транзакция. */
describe("пакетное сохранение писем, десктопный бэкенд базы", () => {
  let dir = mkdtempSync(path.join(tmpdir(), "mail-batch-hosted-"));
  let sqlite = new InProcessSQLiteHost();
  defineBatchSaveTests({
    getSQLiteDatabase: (filename: string) => sqlite.host.openDatabase(path.join(dir, filename), {}),
    atomic: true,
    sqlite,
  });
});
