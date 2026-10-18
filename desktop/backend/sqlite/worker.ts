/**
 * Точка входа Electron utilityProcess: здесь живут все соединения SQLite.
 * Медленный запрос блокирует только этот процесс, а не главный процесс
 * с сетью OWA, JPC, меню и окнами.
 */
import { SQLiteServer } from "./SQLiteServer";
import { openSQLiteEngine } from "./openEngine";
import { serializeError, type SQLiteRequest, type SQLiteResponse } from "./protocol";

const parentPort = process.parentPort;

const server = new SQLiteServer(openSQLiteEngine);

function reply(response: SQLiteResponse): void {
  try {
    parentPort.postMessage(response);
  } catch (ex) {
    // Результат не сериализуется: без ответа вызов в главном процессе висел бы вечно
    parentPort.postMessage({ requestID: response.requestID, error: serializeError(ex) });
  }
}

parentPort.on("message", (event: { data: SQLiteRequest }) => {
  void server.handle(event.data).then(reply);
});

// Корректно закрываем базы (контрольная точка WAL), когда главный процесс
// завершает нас штатно.
process.on("exit", () => server.closeAll());
