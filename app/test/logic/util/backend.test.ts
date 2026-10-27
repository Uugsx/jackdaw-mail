import JPCWebSocket from '../../../../lib/jpc-ws/protocol';
import { appGlobal } from '../../../logic/app';
import { production } from '../../../logic/build';
import { InProcessSQLiteHost } from './hostedSQLite';
import { mkdtempSync, rmSync } from 'node:fs';
import fsPromises from 'node:fs/promises';
import os, { tmpdir } from 'node:os';
import path from 'node:path';
import Zip from 'adm-zip';

let gJPC: JPCWebSocket | null = null;
let gLocal: { sqlite: InProcessSQLiteHost, dir: string } | null = null;

/**
 * Start dev backend: `JPC_SECRET=password-with-32-chars yarn dev`
 * Run tests: `JPC_SECRET=password-with-32-chars yarn test`
 * The env var only works in dev builds.
 * The passcode can only be alpha-num-dash chars.
 *
 * Без JPC_SECRET тесты работают с бэкендом базы в этом же процессе.
 */
function getTestJPCSecret(): string | null {
  const env = process.env.JPC_SECRET;
  if (!env) {
    return null;
  }
  if (env.length < 32) {
    throw new Error(
      "JPC_SECRET env var is shorter than 32 chars.\n" +
      "Set JPC_SECRET=password-with-32-chars for both the running backend\n" +
      "(`JPC_SECRET=... yarn dev`) and the test process (`JPC_SECRET=... yarn test`)."
    );
  }
  return env;
}

export async function connectToBackend() {
  let secret = getTestJPCSecret();
  if (!secret) {
    connectToLocalBackend();
    return;
  }
  let jpc = gJPC = new JPCWebSocket(null);
  await jpc.connect(secret, "localhost", production ? 5455 : 5453);
  appGlobal.remoteApp = await jpc.getRemoteStartObject();
}

/** Та же логика путей, что у `getSQLiteDatabase()` в desktop/backend/backend.ts,
 * но база и папки — во временном каталоге теста. */
function connectToLocalBackend() {
  if (gLocal) {
    return;
  }
  let local = gLocal = {
    sqlite: new InProcessSQLiteHost(),
    dir: mkdtempSync(path.join(tmpdir(), "jackdaw-test-backend-")),
  };
  appGlobal.remoteApp = {
    getConfigDir: async () => local.dir,
    getFilesDir: async () => local.dir,
    getSQLiteDatabase: async (filename: string | null, options?: any, buffer?: Uint8Array) => {
      if (buffer) {
        return await local.sqlite.host.openDatabase(null, options, buffer);
      }
      if (filename && !path.isAbsolute(filename)) {
        filename = path.join(local.dir, filename);
      }
      return await local.sqlite.host.openDatabase(filename, options);
    },
    newAdmZIP,
    fs: fsPromises,
    platform: () => os.platform(),
    directory: (type: string) => localDirectory(type),
    path: {
      dirname: path.dirname,
      join: path.join,
    },
  };
}

/** Как `newAdmZIP()` в desktop/backend/backend.ts: создаёт ZIP, если его ещё нет */
function newAdmZIP(filepath: string) {
  try {
    return new Zip(filepath);
  } catch (ex) {
    if (ex.message?.includes("Invalid filename") || ex.stack?.includes("Object.INVALID_FILENAME")) {
      new Zip().writeZip(filepath);
      return new Zip(filepath);
    }
    throw ex;
  }
}

/** Пути Electron `app.getPath()`, которые нужны тестам */
export function localDirectory(type: string): string {
  if (type == "home") {
    return os.homedir();
  }
  if (type == "appData") {
    return process.env.APPDATA ?? path.join(os.homedir(),
      os.platform() == "darwin" ? "Library/Application Support" : ".config");
  }
  throw new Error(`Test backend: directory ${type} is not supported`);
}

export async function stopBackend() {
  if (gJPC) {
    await gJPC.close();
    gJPC = null;
  }
  if (gLocal) {
    await gLocal.sqlite.host.shutdown();
    rmSync(gLocal.dir, { recursive: true, force: true });
    gLocal = null;
  }
}
