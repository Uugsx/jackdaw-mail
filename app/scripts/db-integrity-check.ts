/*
 * Проверка целостности КОПИИ локальной базы писем Jackdaw Mail.
 *
 *   npx tsx scripts/db-integrity-check.ts --snapshot <папка>
 *     снимает копию mail.db и backup/mail-backup.db из профиля приложения
 *     (оригинал открывается только на чтение) и проверяет копию;
 *   npx tsx scripts/db-integrity-check.ts <папка-с-копией>
 *     проверяет уже снятую копию: <папка>/mail.db и <папка>/backup/mail-backup.db.
 *
 * Флаги: --no-headers — не читать заголовки исходников (быстрее, без проверки
 * Message-ID в самом MIME); --json — отчёт в JSON; --profile <папка> — профиль
 * приложения, если не стандартный.
 *
 * Код выхода 1 — найдены нарушения, которые портят письма. Висячие исходники
 * (orphanSource) безвредны, пока номера писем не переиспользуются.
 * Подробнее: docs/systems/mail-db-integrity.md
 */
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { Database, Query } from "../../lib/rs-sqlite/index";
import { checkMailIntegrity, harmfulIssueCount, kIntegrityInvariants, type IntegrityInvariant } from "../logic/Mail/SQL/SQLIntegrity";

const kDefaultProfile = path.join(homedir(), "Library", "Application Support", "Jackdaw");

/** Только чтение: `run()` и `execute()` запрещены */
class ReadOnlyDatabase {
  db: DatabaseSync;
  constructor(file: string) {
    this.db = new DatabaseSync(file, { readOnly: true });
  }
  protected source(query: Query): string {
    return query.sourceParts.join("?");
  }
  protected parameters(query: Query): any[] {
    return query.parameters.map(p => p === undefined ? null : p);
  }
  get(query: Query): any {
    return this.db.prepare(this.source(query)).get(...this.parameters(query));
  }
  all(query: Query): any[] {
    return this.db.prepare(this.source(query)).all(...this.parameters(query));
  }
  run(): never {
    throw new Error("Копия открыта только на чтение");
  }
  execute(): never {
    throw new Error("Копия открыта только на чтение");
  }
  close() {
    this.db.close();
  }
}

function argValue(args: string[], name: string): string | null {
  let i = args.indexOf(name);
  return i >= 0 ? args[i + 1] ?? null : null;
}

function isInside(file: string, dir: string): boolean {
  let real = (p: string) => existsSync(p) ? realpathSync(p) : path.resolve(p);
  let relative = path.relative(real(dir), real(file));
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

/** Копия через `VACUUM INTO`: согласованный снимок, оригинал только читается */
function snapshot(profile: string, target: string) {
  mkdirSync(path.join(target, "backup"), { recursive: true });
  for (let file of ["mail.db", path.join("backup", "mail-backup.db")]) {
    let from = path.join(profile, file);
    let to = path.join(target, file);
    if (existsSync(to)) {
      throw new Error(`${to} уже есть — укажите пустую папку`);
    }
    console.error(`Копирую ${from} → ${to}…`);
    let original = new DatabaseSync(from, { readOnly: true });
    try {
      original.prepare("VACUUM INTO ?").run(to);
    } finally {
      original.close();
    }
  }
}

async function main() {
  let args = process.argv.slice(2);
  let profile = argValue(args, "--profile") ?? kDefaultProfile;
  let snapshotDir = argValue(args, "--snapshot");
  let dir = snapshotDir ?? args.find(arg => !arg.startsWith("--") && arg != argValue(args, "--profile"));
  if (!dir) {
    console.error("Использование: npx tsx scripts/db-integrity-check.ts [--snapshot] <папка-копии> [--no-headers] [--json]");
    process.exit(2);
  }
  if (isInside(dir, profile)) {
    console.error(`Отказ: ${dir} — это профиль приложения. Проверяется только копия базы.`);
    process.exit(2);
  }
  if (snapshotDir) {
    snapshot(profile, snapshotDir);
  }

  let mailFile = path.join(dir, "mail.db");
  let sourceFile = path.join(dir, "backup", "mail-backup.db");
  let mailDB = new ReadOnlyDatabase(mailFile);
  let sourceDB = existsSync(sourceFile) ? new ReadOnlyDatabase(sourceFile) : null;
  let started = Date.now();
  let lastProgress = 0;
  let report = await checkMailIntegrity(mailDB as any as Database, sourceDB as any as Database | null, {
    headersAfterID: args.includes("--no-headers") ? null : -1,
    onProgress: done => {
      if (Date.now() - lastProgress > 2000) {
        lastProgress = Date.now();
        console.error(`  заголовки исходников: ${done}`);
      }
    },
  });
  mailDB.close();
  sourceDB?.close();

  let harmful = harmfulIssueCount(report);
  if (args.includes("--json")) {
    console.log(JSON.stringify({ ...report, harmful }, null, 2));
  } else {
    console.log(`Писем: ${report.emails}, исходников MIME: ${report.sources}${sourceDB ? "" : " (mail-backup.db не найдена)"}`);
    for (let invariant of Object.keys(kIntegrityInvariants) as IntegrityInvariant[]) {
      let count = report.counts[invariant];
      console.log(`${count ? "✗" : "✓"} ${kIntegrityInvariants[invariant]} (${invariant}): ${count}`);
      for (let example of report.examples[invariant]) {
        console.log(`    ${JSON.stringify(example)}`);
      }
    }
    console.log(harmful
      ? `Нарушений, портящих письма: ${harmful}`
      : "Нарушений, портящих письма, нет");
    console.log(`Время проверки: ${((Date.now() - started) / 1000).toFixed(1)} с`);
  }
  process.exit(harmful ? 1 : 0);
}

main().catch(ex => {
  console.error(ex);
  process.exit(2);
});
