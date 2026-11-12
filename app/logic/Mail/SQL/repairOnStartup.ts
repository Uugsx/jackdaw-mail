import { getDatabase } from "./SQLDatabase";
import { getDatabase as getSourceDatabase } from "./Source/SQLSourceDatabase";
import { repairForeignSources } from "./SQLIntegrity";
import { sleep } from "../../util/util";
import sql from "../../../../lib/rs-sqlite/index";

/** Пауза после запуска: сначала открываются окно и папки */
const kStartDelaySeconds = 10;
/** Пауза между пачками чтения заголовков: база не занята подолгу */
const kPauseSeconds = 0.1;
/** До какого `emailMIME.id` заголовки исходников уже проверены */
const kHeadersCheckedKey = "mail.integrity.sourceHeadersCheckedUpTo";

/**
 * Лёгкая проверка базы писем при запуске, в фоне: письма, у которых под
 * номером строки лежит исходник MIME другого письма (порча 2026-11, PR #175–#178),
 * теряют сохранённый текст, вложения и `downloadComplete` и при открытии
 * загружаются с сервера заново. Письма, которые сравнить нечем, не трогает.
 *
 * Колонка Message-ID исходников сверяется каждый запуск (доли секунды),
 * заголовки — только у исходников, сохранённых после прошлой проверки.
 * @returns число исправленных писем
 */
export async function repairMailDatabaseOnStartup(): Promise<number> {
  await sleep(kStartDelaySeconds);
  let started = Date.now();
  let mailDB = await getDatabase();
  let sourceDB = await getSourceDatabase();
  let headersAfterID = readHeadersChecked();
  let maxSourceID = (await sourceDB.get(sql`SELECT MAX(id) AS id FROM emailMIME`) as any)?.id ?? -1;
  if (headersAfterID > maxSourceID) {
    // Файл исходников создан заново: проверяем все
    headersAfterID = -1;
  }
  let found = await repairForeignSources(mailDB, sourceDB, {
    headersAfterID,
    pause: () => sleep(kPauseSeconds),
  });
  writeHeadersChecked(found.lastSourceID);
  console.info(`Проверка базы писем: исправлено писем с чужим исходником — ${found.emailIDs.length}` +
    ` (${Date.now() - started} мс)`);
  return found.emailIDs.length;
}

function readHeadersChecked(): number {
  try {
    let value = Number(localStorage.getItem(kHeadersCheckedKey));
    return Number.isInteger(value) && value > 0 ? value : -1;
  } catch (ex) {
    return -1;
  }
}

function writeHeadersChecked(id: number) {
  try {
    localStorage.setItem(kHeadersCheckedKey, String(id));
  } catch (ex) {
    // Без отметки следующий запуск проверит заголовки заново — медленнее, но верно
  }
}
