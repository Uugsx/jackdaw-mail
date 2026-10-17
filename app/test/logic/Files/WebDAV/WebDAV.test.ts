/**
 * Integration test for WebDAV.
 *
 * Spins up an in-process WebDAV server (webdav-server npm) against a temp
 * directory, stubs the IPC bridge so the renderer-side WebDAVAccount talks to
 * the webdav client directly in this process, then drives the full File/
 * Directory API surface. No dev backend needed.
 *
 * Note: modules are dynamically imported inside beforeAll() because the
 * Mail/Encryption module graph has circular imports that fail when triggered
 * at top-level by an unrelated test file.
 */
import * as webdavServer from "webdav-server";
import * as webdavClient from "webdav";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";

const v2 = (webdavServer as any).v2;
const USERNAME = "testuser";
const PASSWORD = "testpass";

let server: any;
let port: number;
let storageDir: string;
let localFilesDir: string;
let account: any;            // WebDAVAccount
let ArrayColl: any;
let WebDAVDirectoryCls: any;

afterEach(() => vi.restoreAllMocks());

async function startServer(): Promise<void> {
  storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "jackdaw-webdav-test-"));
  let userManager = new v2.SimpleUserManager();
  let user = userManager.addUser(USERNAME, PASSWORD, false);
  let privilegeManager = new v2.SimplePathPrivilegeManager();
  privilegeManager.setRights(user, "/", ["all"]);

  server = new v2.WebDAVServer({
    port: 0,
    httpAuthentication: new v2.HTTPBasicAuthentication(userManager, "test"),
    privilegeManager,
  });
  await new Promise<void>(resolve => server.start((httpServer: any) => {
    port = httpServer.address().port;
    resolve();
  }));
  await new Promise<void>((resolve, reject) =>
    server.setFileSystem("/", new v2.PhysicalFileSystem(storageDir), (success: boolean) =>
      success ? resolve() : reject(new Error("setFileSystem failed"))));
}

async function stopServer(): Promise<void> {
  await new Promise<void>(resolve => server.stop(() => resolve()));
  await fs.rm(storageDir, { recursive: true, force: true });
}

/** Independent verification client — talks to the WebDAV server directly, not
 *  through our WebDAVAccount, so we can prove changes are really on the server. */
let verify: webdavClient.WebDAVClient;

beforeAll(async () => {
  let app = await import("../../../../logic/app");
  let { WebDAVAccount } = await import("../../../../logic/Files/WebDAV/WebDAVAccount");
  let { WebDAVDirectory } = await import("../../../../logic/Files/WebDAV/WebDAVDirectory");
  let { AuthMethod } = await import("../../../../logic/Abstract/Account");
  let { DummyFileStorage } = await import("../../../../logic/Files/Store/DummyFileStorage");
  ArrayColl = (await import("svelte-collections")).ArrayColl;
  WebDAVDirectoryCls = WebDAVDirectory;
  localFilesDir = await fs.mkdtemp(path.join(os.tmpdir(), "jackdaw-webdav-files-"));

  app.appGlobal.remoteApp = {
    createWebDAVClient(serverURL: string, options: any) {
      return webdavClient.createClient(serverURL, options);
    },
    async getFilesDir() {
      return localFilesDir;
    },
    async readFile(filename: string) {
      return new Uint8Array(await fs.readFile(filename));
    },
    async writeFile(filename: string, _permissions: number, contents: Uint8Array) {
      await fs.mkdir(path.dirname(filename), { recursive: true });
      await fs.writeFile(filename, contents);
    },
    async deleteFile(filename: string) {
      await fs.rm(filename, { force: true });
    },
    fs: {
      mkdir: (directory: string, options: any) => fs.mkdir(directory, options),
    },
  };
  await startServer();
  verify = webdavClient.createClient(`http://127.0.0.1:${port}/`, {
    username: USERNAME,
    password: PASSWORD,
  });
  account = new WebDAVAccount();
  account.storage = new DummyFileStorage();
  account.url = `http://127.0.0.1:${port}/`;
  account.username = USERNAME;
  account.password = PASSWORD;
  account.authMethod = AuthMethod.Password;
  await account.login(false);
});

afterAll(async () => {
  await stopServer();
  await fs.rm(localFilesDir, { recursive: true, force: true });
});

test("sync creates exactly one root directory labelled Files", async () => {
  await account.sync();
  expect(account.rootDirs.length).toBe(1);
  let root = account.rootDirs.first;
  expect(root).toBeInstanceOf(WebDAVDirectoryCls);
  expect(root.path).toBe("/");
});

test("listContents on empty root returns nothing", async () => {
  let root = account.rootDirs.first;
  await root.listContents();
  expect(root.files.length).toBe(0);
  expect(root.subDirs.length).toBe(0);
});

test("uploaded file appears on the server (via independent verify client)", async () => {
  let root = account.rootDirs.first;
  let payload = new TextEncoder().encode("Hello WebDAV world\n");
  let stub = root.newFile("hello.txt");
  stub.contents = new Blob([payload], { type: "text/plain" });
  stub.mimetype = "text/plain";
  await root.addFile(stub);

  let serverListing = await verify.getDirectoryContents("/") as webdavClient.FileStat[];
  expect(serverListing.map(s => s.basename)).toContain("hello.txt");
  let bytes = await verify.getFileContents("/hello.txt", { format: "binary" }) as ArrayBuffer;
  expect(new TextDecoder().decode(new Uint8Array(bytes))).toBe("Hello WebDAV world\n");
});

test("downloaded file bytes match what was uploaded", async () => {
  let root = account.rootDirs.first;
  await root.listContents();
  let file = root.files.find(f => f.name == "hello.txt");
  expect(file).toBeDefined();
  expect(file.size).toBe("Hello WebDAV world\n".length);

  file.contents = null;
  await file.download();
  let downloaded = new Uint8Array(await file.contents.arrayBuffer());
  expect(new TextDecoder().decode(downloaded)).toBe("Hello WebDAV world\n");
});

test("created subdirectory appears on the server", async () => {
  let root = account.rootDirs.first;
  await root.createSubDirectory("subdir");

  let serverListing = await verify.getDirectoryContents("/") as webdavClient.FileStat[];
  let subStat = serverListing.find(s => s.basename == "subdir");
  expect(subStat).toBeDefined();
  expect(subStat!.type).toBe("directory");

  await root.listContents();
  let sub = root.subDirs.find(d => d.name == "subdir");
  expect(sub).toBeDefined();
  expect(sub.path).toBe("/subdir/");
});

test("move file across directories is reflected on the server", async () => {
  let root = account.rootDirs.first;
  await root.listContents();
  let file = root.files.find(f => f.name == "hello.txt");
  expect(file).toBeDefined();
  let sub = root.subDirs.find(d => d.name == "subdir");
  expect(sub).toBeDefined();

  await sub.moveFilesHere(new ArrayColl([file]));

  let rootOnServer = await verify.getDirectoryContents("/") as webdavClient.FileStat[];
  let subOnServer = await verify.getDirectoryContents("/subdir") as webdavClient.FileStat[];
  expect(rootOnServer.map(s => s.basename)).not.toContain("hello.txt");
  expect(subOnServer.map(s => s.basename)).toContain("hello.txt");
});

test("copy file across directories is reflected on the server", async () => {
  let root = account.rootDirs.first;
  await root.listContents();
  let sub = root.subDirs.find(d => d.name == "subdir");
  await sub.listContents();
  let file = sub.files.find(f => f.name == "hello.txt");
  expect(file).toBeDefined();

  await root.copyFilesHere(new ArrayColl([file]));

  let rootOnServer = await verify.getDirectoryContents("/") as webdavClient.FileStat[];
  let subOnServer = await verify.getDirectoryContents("/subdir") as webdavClient.FileStat[];
  expect(rootOnServer.map(s => s.basename)).toContain("hello.txt");
  expect(subOnServer.map(s => s.basename)).toContain("hello.txt");
});

test("saveContents overwrites bytes on the server", async () => {
  let root = account.rootDirs.first;
  await root.listContents();
  let file = root.files.find(f => f.name == "hello.txt");
  expect(file).toBeDefined();
  await file.saveContents(new Blob([new TextEncoder().encode("Replaced contents\n")],
                                    { type: "text/plain" }));

  let bytes = await verify.getFileContents("/hello.txt", { format: "binary" }) as ArrayBuffer;
  expect(new TextDecoder().decode(new Uint8Array(bytes))).toBe("Replaced contents\n");
});

test("deleteIt removes file from the server", async () => {
  let root = account.rootDirs.first;
  await root.listContents();
  let file = root.files.find(f => f.name == "hello.txt");
  expect(file).toBeDefined();
  await file.deleteIt();

  let onServer = await verify.getDirectoryContents("/") as webdavClient.FileStat[];
  expect(onServer.map(s => s.basename)).not.toContain("hello.txt");
});

async function transferFolders(name: string) {
  const root = account.rootDirs.first;
  const source = await root.createSubDirectory(name + "-source");
  const target = await root.createSubDirectory(name + "-target");
  await verify.putFileContents(source.path + "first.txt", "first");
  await verify.putFileContents(source.path + "second.txt", "second");
  await source.listContents();
  return { source, target };
}

test("ошибка сервера не убирает переносимые файлы из исходной папки", async () => {
  const { source, target } = await transferFolders("failed-move");
  const files = [...source.files.contents];
  const failure = new Error("Сеть недоступна");
  vi.spyOn(account.client, "moveFile").mockRejectedValueOnce(failure);
  await expect(target.moveFilesHere(source.files)).rejects.toBe(failure);
  expect(source.files.contents).toEqual(files);
  expect(target.files.length).toBe(0);
  expect(await verify.exists(source.path + "first.txt")).toBe(true);
});

test("частичный перенос сохраняет неперенесённые файлы и обновляет обе папки", async () => {
  const { source, target } = await transferFolders("partial-move");
  const originalMove = account.client.moveFile.bind(account.client);
  const first = source.files.first;
  const second = source.files.contents[1];
  vi.spyOn(account.client, "moveFile")
    .mockImplementationOnce(originalMove)
    .mockRejectedValueOnce(new Error("Сеть недоступна"));
  await expect(target.moveFilesHere(source.files)).rejects.toThrow("Сеть недоступна");
  expect(source.files.contents.map(file => file.name)).toEqual([second.name]);
  expect(target.files.contents.map(file => file.name)).toEqual([first.name]);
  expect(await verify.exists(source.path + second.name)).toBe(true);
  expect(await verify.exists(target.path + first.name)).toBe(true);
});

test("неудачное удаление сохраняет файл в локальном списке", async () => {
  const { source } = await transferFolders("failed-delete");
  const file = source.files.first;
  vi.spyOn(account.client, "deleteFile").mockRejectedValueOnce(new Error("Удаление запрещено"));
  await expect(file.deleteIt()).rejects.toThrow("Удаление запрещено");
  expect(source.files.contains(file)).toBe(true);
  expect(await verify.exists(file.path)).toBe(true);
});

test("неудачная загрузка не создаёт файл в целевой папке", async () => {
  const { source, target } = await transferFolders("failed-upload");
  const file = source.files.first;
  await file.download();
  vi.spyOn(account.client, "putFileContents").mockRejectedValueOnce(new Error("Загрузка запрещена"));
  await expect(target.addFile(file)).rejects.toThrow("Загрузка запрещена");
  expect(target.files.length).toBe(0);
  expect(source.files.contains(file)).toBe(true);
});

test("пустой перенос и перенос в ту же папку не вызывают серверные операции", async () => {
  const { source, target } = await transferFolders("noop-move");
  const move = vi.spyOn(account.client, "moveFile");
  await target.moveFilesHere(new ArrayColl());
  await source.moveFilesHere(source.files);
  expect(move).not.toHaveBeenCalled();
  expect(source.files.length).toBe(2);
});

test("перенос всей коллекции не пропускает файлы при изменении исходного списка", async () => {
  const { source, target } = await transferFolders("all-move");
  await target.moveFilesHere(source.files);
  expect(source.files.length).toBe(0);
  expect(target.files.contents.map(file => file.name).sort()).toEqual(["first.txt", "second.txt"]);
});

async function useSeparateAccount(target: any) {
  const other = new account.constructor();
  other.storage = new account.storage.constructor();
  other.url = account.url;
  other.username = USERNAME;
  other.password = PASSWORD;
  other.authMethod = account.authMethod;
  await other.login(false);
  target.account = other;
  return other;
}

test("между аккаунтами сначала загружает файлы, затем удаляет оригиналы", async () => {
  const { source, target } = await transferFolders("cross-account");
  await useSeparateAccount(target);
  await target.moveFilesHere(source.files);
  expect(source.files.length).toBe(0);
  expect(target.files.length).toBe(2);
  expect(await verify.exists(source.path + "first.txt")).toBe(false);
  expect(await verify.getFileContents(target.path + "first.txt", { format: "text" })).toBe("first");
  expect(await verify.getFileContents(target.path + "second.txt", { format: "text" })).toBe("second");
});

test("ошибка загрузки между аккаунтами сохраняет оригиналы", async () => {
  const { source, target } = await transferFolders("cross-failed");
  const other = await useSeparateAccount(target);
  vi.spyOn(other.client, "putFileContents").mockRejectedValueOnce(new Error("Загрузка запрещена"));
  const deleteSource = vi.spyOn(account.client, "deleteFile");
  await expect(target.moveFilesHere(source.files)).rejects.toThrow("Загрузка запрещена");
  expect(source.files.length).toBe(2);
  expect(target.files.length).toBe(0);
  expect(deleteSource).not.toHaveBeenCalled();
});

// Регрессии QA-аудита (октябрь 2026)

test("имена со скобками и # не «очищаются» и не переименовываются на сервере при сохранении", async () => {
  const root = account.rootDirs.first;
  const dir = await root.createSubDirectory("names (2026) #1");
  await verify.putFileContents(dir.path + "Счёт (1), №2.txt", "x");
  await root.listContents();
  const listedDir = root.subDirs.find(d => d.path == dir.path);
  expect(listedDir.name).toBe("names (2026) #1");
  await listedDir.listContents();
  const file = listedDir.files.first;
  expect(file.name).toBe("Счёт (1), №2.txt");
  await file.save();
  expect(await verify.exists(dir.path + "Счёт (1), №2.txt")).toBe(true);
});

test("локальный кеш различает имена, которые совпадают после очистки", async () => {
  const { localCacheFileName } = await import("../../../../logic/Files/File");
  expect(localCacheFileName("plain.txt")).toBe("plain.txt");
  expect(localCacheFileName("a(1).txt")).not.toBe(localCacheFileName("a1.txt"));
  expect(localCacheFileName("()")).toMatch(/^[0-9a-f]{8}-file$/);
});

test("перенос не затирает одноимённый файл в целевой папке", async () => {
  const { source, target } = await transferFolders("no-overwrite");
  await verify.putFileContents(target.path + "first.txt", "keep me");
  await expect(target.moveFilesHere(new ArrayColl([source.files.first])))
    .rejects.toThrow(/already exists/);
  expect(await verify.getFileContents(target.path + "first.txt", { format: "text" })).toBe("keep me");
  expect(await verify.exists(source.path + "first.txt")).toBe(true);
});

test("переименование папки выполняется на сервере", async () => {
  const root = account.rootDirs.first;
  const dir = await root.createSubDirectory("rename-me");
  await verify.putFileContents(dir.path + "inside.txt", "inside");
  dir.name = "renamed";
  await dir.save();
  expect(await verify.exists("/rename-me/")).toBe(false);
  expect(await verify.getFileContents("/renamed/inside.txt", { format: "text" })).toBe("inside");
  expect(dir.path).toBe("/renamed/");
});

test("«Обновить» не падает на файлах, которые ещё не скачивались", async () => {
  const { source } = await transferFolders("not-downloaded");
  const file = source.files.first;
  expect(file.filepathLocal).toBeFalsy();
  await expect(file.isLocalFileChanged()).resolves.toBe(false);
});
