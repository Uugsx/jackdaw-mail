import { SQLiteHost, type SQLiteChannelHandlers } from "../../../../desktop/backend/sqlite/SQLiteHost";
import { SQLiteServer } from "../../../../desktop/backend/sqlite/SQLiteServer";
import { openSQLiteEngine } from "../../../../desktop/backend/sqlite/openEngine";
import type { SQLiteRequest } from "../../../../desktop/backend/sqlite/protocol";

/**
 * Десктопный бэкенд базы для тестов: тот же SQLiteHost и SQLiteServer
 * с better-sqlite3, но сервер работает в этом же процессе вместо utilityProcess.
 * Сообщения проходят через structuredClone, как через канал Electron
 * (Buffer при этом становится Uint8Array).
 */
export class InProcessSQLiteHost {
  readonly host: SQLiteHost;
  /** Все запросы к процессу базы по порядку — для проверки числа кругов IPC */
  readonly requests: SQLiteRequest[] = [];
  /** Сколько раз запускался «процесс» базы */
  starts = 0;
  protected current: { server: SQLiteServer, handlers: SQLiteChannelHandlers, dead: boolean } | null = null;

  constructor() {
    this.host = new SQLiteHost(handlers => {
      let state = { server: new SQLiteServer(openSQLiteEngine), handlers, dead: false };
      this.current = state;
      this.starts++;
      return {
        send: request => {
          let cloned = structuredClone(request);
          this.requests.push(cloned);
          setImmediate(async () => {
            if (state.dead) {
              return;
            }
            let response = await state.server.handle(cloned);
            if (!state.dead) {
              state.handlers.onResponse(structuredClone(response));
            }
          });
        },
        terminate: () => {
          state.dead = true;
          state.server.closeAll();
        },
      };
    });
  }

  /** Имитирует падение процесса базы */
  crash(): void {
    let state = this.current;
    if (!state || state.dead) {
      return;
    }
    state.dead = true;
    state.server.closeAll();
    state.handlers.onExit("SQLite process exited with code 9");
  }

  /** Запросы к базе с начала теста, кроме служебных */
  countRequests(since: number, ops?: string[]): number {
    return this.requests.slice(since).filter(request => !ops || ops.includes(request.op)).length;
  }
}
