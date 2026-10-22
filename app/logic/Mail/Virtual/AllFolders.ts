import { Folder, SpecialFolder } from "../Folder";
import type { MailAccount } from "../MailAccount";
import type { AllAccounts } from "./AllAccounts";
import type { EMail } from "../EMail";
import { UserError, assert } from "../../util/util";
import { mergeColls, mergeColl, Collection, ArrayColl, CollectionObserver } from "svelte-collections";
import { gt } from "../../../l10n/l10n";

export class AllFolders extends Folder {
  declare account: AllAccounts;
  /** `this` folder shows the sum of all messages in these `folders` */
  _folders: Collection<Folder>;
  private folderCountUnsubs: (() => void)[] = [];
  private readonly foldersListObserver = new (class extends CollectionObserver<Folder> {
    constructor(private owner: AllFolders) { super(); }
    added() { this.owner.reattachFolderCountObservers(); }
    removed() { this.owner.reattachFolderCountObservers(); }
  })(this);

  constructor(account: AllAccounts) {
    super(account as any as MailAccount);
  }

  get folders(): Collection<Folder> {
    return this._folders;
  }
  set folders(val: Collection<Folder>) {
    if (this._folders) {
      this._folders.unregisterObserver(this.foldersListObserver);
    }
    this._folders = val;
    this._folders.registerObserver(this.foldersListObserver);
    (this as any).messages = mergeColls(this.folders.map(folder => folder.messages));
    this.messages.subscribe(() => {
      this.countTotal = this.messages.length;
    });
    this.reattachFolderCountObservers();
  }

  /** Sum unread/new badges from the underlying real folders. */
  protected reattachFolderCountObservers(): void {
    for (let unsub of this.folderCountUnsubs) {
      unsub();
    }
    this.folderCountUnsubs = [];
    if (!this._folders) {
      return;
    }
    let unread = 0;
    let newArrived = 0;
    for (let folder of this._folders.contents) {
      unread += folder.countUnread;
      newArrived += folder.countNewArrived;
      this.folderCountUnsubs.push(folder.subscribe((_folder, prop) => {
        if (prop === "countUnread" || prop === "countNewArrived") {
          this.resyncAggregatedCounts();
        }
      }));
    }
    this.countUnread = unread;
    this.countNewArrived = newArrived;
  }

  protected resyncAggregatedCounts(): void {
    if (!this._folders) {
      return;
    }
    let unread = 0;
    let newArrived = 0;
    for (let folder of this._folders.contents) {
      unread += folder.countUnread;
      newArrived += folder.countNewArrived;
    }
    this.countUnread = unread;
    this.countNewArrived = newArrived;
  }

  followSpecialFolder(specialFolder: SpecialFolder) {
    this.specialFolder = specialFolder;
    this.folders = this.account.allRootFolders.filterObservable(folder =>
      folder.specialFolder == specialFolder);
  }

  async listMessages(): Promise<Collection<EMail>> {
    let results = await Promise.all(this._folders.contents.map(folder =>
      folder.listMessages()));
    // return new ArrayColl(results.map(arrayColl => arrayColl.contents).flat());
    return mergeColl(...results);
  }

  async getNewMessages(): Promise<Collection<EMail>> {
    let results = await Promise.all(this._folders.contents.map(folder =>
      folder.getNewMessages()));
    return mergeColl(...results);
  }

  async downloadMessages(emails: Collection<EMail>): Promise<Collection<EMail>> {
    let results = await Promise.all(this._folders.contents.map(folder =>
      folder.downloadMessages(emails.filterOnce(email => email.folder == folder))));
    return mergeColl(...results);
  }

  async downloadAllMessages(): Promise<Collection<EMail>> {
    let results = await Promise.all(this._folders.contents.map(folder =>
      folder.downloadAllMessages()));
    return mergeColl(...results);
  }

  /** Действие над каждой реальной папкой. Ошибка одной не отменяет остальные,
   * а первая ошибка показывается пользователю. */
  protected async forEachFolder(action: (folder: Folder) => Promise<void>): Promise<void> {
    let results = await Promise.allSettled(this._folders.contents.map(action));
    let failed = results.find((result): result is PromiseRejectedResult => result.status == "rejected");
    if (failed) {
      throw failed.reason;
    }
  }

  /* Базовая реализация меняла только локальные флаги: сервер и другие клиенты
   * видели письма непрочитанными, а бейдж возвращался при следующем обновлении. */
  async markAllRead(): Promise<void> {
    await this.forEachFolder(folder => folder.markAllRead());
  }

  async markAllUnread(): Promise<void> {
    await this.forEachFolder(folder => folder.markAllUnread());
  }

  /** «Очистить» в общей корзине или спаме очищает их в каждом аккаунте */
  async clearFolder(): Promise<void> {
    await this.forEachFolder(folder => folder.clearFolder());
  }

  disableRename(): string | false {
    return gt`You cannot change an All accounts special folder.`;
  }

  disableDelete(): string | false {
    return gt`You cannot change an All accounts special folder.`;
  }

  async moveMessagesHere(messages: Collection<EMail>) {
    throw new UserError(gt`Select an account first, to move emails into a specific folder`);
  }

  async copyMessagesHere(messages: Collection<EMail>) {
    throw new UserError(gt`Select an account first, to copy emails into a specific folder`);
  }

  async moveFolderHere(folder: Folder) {
    throw new UserError(gt`Select an account first, to move a folder`);
  }

  async createSubFolder(name: string): Promise<Folder> {
    throw new UserError(gt`Select a folder in a specific account first, to create a subfolder`);
  }

  disableChangeSpecial(): string | false {
    return gt`You cannot change an All accounts special folder.`;
  }

  newEMail(): EMail {
    let account = this.account.accounts.first;
    if (!account) {
      throw new UserError(gt`Setup and select email account first`);
    }
    let folder = account.getSpecialFolder(SpecialFolder.Sent);
    assert(folder, gt`No folder found in account ${account.name}`);
    return folder.newEMail();
  }
}
