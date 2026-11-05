import { utilityProcess } from "electron";
import type { SQLiteChannelFactory } from "./SQLiteHost";
import type { SQLiteRequest } from "./protocol";

/** Запускает процесс базы (`worker.ts`) как Electron utilityProcess. */
export function createUtilityProcessChannel(workerPath: string): SQLiteChannelFactory {
  return handlers => {
    let child = utilityProcess.fork(workerPath, [], {
      serviceName: "Jackdaw Mail Database",
    });
    // До события spawn у процесса ещё нет канала: копим запросы
    let queue: SQLiteRequest[] | null = [];
    let terminated = false;
    child.once("spawn", () => {
      let queued = queue ?? [];
      queue = null;
      for (let request of queued) {
        child.postMessage(request);
      }
    });
    child.on("message", handlers.onResponse);
    child.once("exit", code => {
      if (!terminated) {
        handlers.onExit(`SQLite process exited with code ${code}`);
      }
    });
    return {
      send(request) {
        if (queue) {
          queue.push(request);
        } else {
          child.postMessage(request);
        }
      },
      terminate() {
        terminated = true;
        child.kill();
      },
      get pid() {
        return child.pid;
      },
    };
  };
}
