import type { Database } from "../../../lib/rs-sqlite/index";

/**
 * Открывает базу и выполняет её инициализацию (миграции, pragma) один раз
 * на все одновременные вызовы: пока инициализация идёт, каждый вызов получает
 * тот же Promise, а не базу до окончания миграций.
 *
 * Неудача не запоминается: соединение закрывается, чтобы не держать файл,
 * а следующий вызов открывает базу заново. Готовую базу хранит вызывающий.
 *
 * @param connect Открывает соединение с файлом базы
 * @param init Миграции и pragma на открытом соединении
 */
export function openDatabaseOnce(
  connect: () => Promise<Database>,
  init: (database: Database) => Promise<void>,
): () => Promise<Database> {
  let opening: Promise<Database> | null = null;
  async function open(): Promise<Database> {
    let database = await connect();
    try {
      await init(database);
    } catch (ex) {
      try {
        await (database as any).close(); // any, because function exists, but not in TypeScript definitions
      } catch {
        // Важнее исходная ошибка инициализации
      }
      throw ex;
    }
    return database;
  }
  return () => {
    opening ??= open().finally(() => {
      opening = null;
    });
    return opening;
  };
}
