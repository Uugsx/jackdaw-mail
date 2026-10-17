import { Directory } from "../Directory";
import { WebDAVFile } from "./WebDAVFile";
import type { WebDAVAccount } from "./WebDAVAccount";
import type { File } from "../File";
import { Lock } from "../../util/flow/Lock";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { Buffer } from "buffer";
import type { ArrayColl, Collection } from "svelte-collections";
import type { FileStat } from "webdav";
import { kNoOverwrite, runWithoutOverwrite } from "./webdavMove";

export class WebDAVDirectory extends Directory {
  declare account: WebDAVAccount;
  declare readonly files: ArrayColl<WebDAVFile>;
  declare readonly subDirs: ArrayColl<WebDAVDirectory>;
  protected readonly listLock = new Lock();

  newDirectory(name: string, dir = new WebDAVDirectory()): WebDAVDirectory {
    return super.newDirectory(name, dir) as WebDAVDirectory;
  }

  newFile(name: string, file = new WebDAVFile()): WebDAVFile {
    return super.newFile(name, file) as WebDAVFile;
  }

  get etag(): string | null {
    return this.syncState as string;
  }
  set etag(val: string | null) {
    this.syncState = val;
  }

  async listContents() {
    let lock = await this.listLock.lock();
    try {
      await this.account.login(false);
      let stats = await this.account.client.getDirectoryContents(this.path) as FileStat[];
      let curFiles = new Set<WebDAVFile>();
      let curDirs = new Set<WebDAVDirectory>();
      for (let stat of stats) {
        let path = sanitize.nonemptystring(stat.filename, null);
        if (!path) {
          continue;
        }
        if (stat.type == "directory") {
          let dirPath = path.endsWith("/") ? path : path + "/";
          let existing = this.subDirs.find(d => d.path == dirPath);
          if (existing) {
            existing.fromDAV(stat);
            curDirs.add(existing);
          } else {
            let dir = this.newDirectory("");
            dir.account = this.account;
            dir.parent = this;
            dir.fromDAV(stat);
            this.subDirs.add(dir);
            curDirs.add(dir);
          }
        } else {
          let existing = this.files.find(f => f.path == path);
          if (existing) {
            existing.fromDAV(stat);
            curFiles.add(existing);
          } else {
            let file = this.newFile("");
            file.parent = this;
            file.fromDAV(stat);
            this.files.add(file);
            curFiles.add(file);
          }
        }
      }

      let removedFiles = this.files.filterOnce(file => !curFiles.has(file));
      let removedDirs = this.subDirs.filterOnce(dir => !curDirs.has(dir));
      this.files.removeAll(removedFiles);
      this.subDirs.removeAll(removedDirs);
      for (let file of removedFiles) {
        file.clearURL();
        await file.deleteLocally();
      }
      for (let dir of removedDirs) {
        await dir.deleteLocally();
      }

      await this.saveLocally();
      for (let dir of curDirs) {
        await dir.saveLocally();
      }
      for (let file of curFiles) {
        await file.saveLocally();
      }
    } finally {
      lock.release();
    }
  }

  fromDAV(stat: FileStat) {
    let path = sanitize.nonemptystring(stat.filename);
    this.path = path.endsWith("/") ? path : path + "/";
    // Имя показываем как есть: «очистка» убирала скобки, #, № и т. п., после чего
    // сохранение переименовывало папку на сервере, а имя из одних символов ломало листинг
    this.name = sanitize.nonemptystring(stat.basename);
    this.etag = sanitize.string(stat.etag, null);
    this.lastMod = sanitize.date(stat.lastmod, new Date());
  }

  protected async moveOrCopyFilesOnServer(action: "move" | "copy", files: Collection<File>) {
    await this.account.login(false);
    let source = files.first.parent;
    try {
      for (let file of files) {
        let target = this.childPath(file.name);
        if (action == "move") {
          await runWithoutOverwrite(() => this.account.client.moveFile(file.path, target, kNoOverwrite));
          await file.deleteLocally();
        } else {
          await runWithoutOverwrite(() => this.account.client.copyFile(file.path, target, kNoOverwrite));
        }
      }
    } catch (ex) {
      // После частичного переноса сверяем обе папки, сохраняя исходную ошибку.
      await Promise.allSettled([this.listContents(), source.listContents()]);
      throw ex;
    }
    await this.listContents();
    if (source && source != this) {
      await source.listContents();
    }
  }

  async addFile(file: File) {
    await this.account.login(false);
    await file.download();
    let newFile = this.newFile(file.name);
    newFile.contents = file.contents;
    newFile.mimetype = file.mimetype;
    newFile.size = file.size;
    newFile.lastMod = file.lastMod ?? new Date();

    let bytes = Buffer.from(await file.contents.arrayBuffer()); // Buffer needed for JPC
    let headers: Record<string, string> = {};
    // Honored by ownCloud, Nextcloud, openCloud, SabreDAV. Plain WebDAV ignores it.
    headers["X-OC-MTime"] = Math.floor(newFile.lastMod.getTime() / 1000).toString();
    await this.account.client.putFileContents(newFile.path, bytes, { overwrite: false, headers });
    this.files.add(newFile);
    await newFile.stat();
    await newFile.save();
  }

  async createSubDirectory(name: string): Promise<WebDAVDirectory> {
    await this.account.login(false);
    let subDir = this.newDirectory(name);
    await this.account.client.createDirectory(subDir.path);
    await this.listContents();
    return this.subDirs.find(dir => dir.path == subDir.path) ?? subDir;
  }

  /** Переименование папки на сервере (MOVE без перезаписи). */
  async saveOnServer() {
    let parent = this.parent as WebDAVDirectory;
    if (!parent || !this.name) {
      return;
    }
    let renamedPath = parent.childPath(this.name, true);
    if (renamedPath == this.path) {
      return;
    }
    await this.account.login(false);
    await runWithoutOverwrite(() => this.account.client.moveFile(this.path, renamedPath, kNoOverwrite));
    this.path = renamedPath;
    await this.saveLocally();
    await parent.listContents();
  }

  async deleteOnServer() {
    await this.account.login(false);
    await this.account.client.deleteFile(this.path);
  }
}
