// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe } from "vitest";
import { InProcessSQLiteDatabase } from "../../util/inProcessSQLite";
import { defineBatchSaveTests } from "./batchSaveScenarios";

/** Бэкенд без batch() (мобильный, тесты): runBatch() выполняет шаги по очереди. */
describe("пакетное сохранение писем, бэкенд без batch()", () => {
  let dir = mkdtempSync(path.join(tmpdir(), "mail-batch-fallback-"));
  defineBatchSaveTests({
    getSQLiteDatabase: (filename: string) => new InProcessSQLiteDatabase(path.join(dir, filename)),
    atomic: false,
  });
});
