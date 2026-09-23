import { EMail, computeEMailContact } from "./EMail";
import { kDummyPerson } from "../Abstract/PersonUID";
import type { MailAccount } from "./MailAccount";
import { DeleteStrategy } from "./MailAccount";
import type { TreeItem } from "../../frontend/Shared/FastTree";
import { EMailCollection } from "./Store/EMailCollection";
import { Observable, notifyChangedProperty } from "../util/Observable";
import { ArrayColl, Collection } from 'svelte-collections';
import { Lock } from "../util/flow/Lock";
import { assert, AbstractFunction } from "../util/util";
import { gt } from "../../l10n/l10n";

export type MailTransferProgressCallback = (completed: number) => void;

export type FolderClearProgress = {
  phase: "preparing" | "deleting";
  completed: number;
  total: number;
};

function compareFolderOrder(a: Folder, b: Folder): number {
  if (a.orderPos < b.orderPos) {
    return -1;
  }
  if (a.orderPos > b.orderPos) {
    return 1;
  }
  return 0;
}

export class Folder extends Observable implements TreeItem<Folder> {
  /** IMAP: folder path */
  id: string;
  dbID: number | string;
  @notifyChangedProperty
  name: string;
  @notifyChangedProperty
  parent: Folder | null;
  account: MailAccount;
  @notifyChangedProperty
  specialFolder: SpecialFolder = SpecialFolder.Normal;
  /** Stable user-defined order among ordinary sibling folders. */
  @notifyChangedProperty
  sortOrder: number | null = null;
  /** Whether subfolders are shown in the folder tree UI */
  @notifyChangedProperty
  expanded = false;
  readonly messages = new EMailCollection<EMail>(this);
  readonly subFolders = new ArrayColl<Folder>();
  @notifyChangedProperty
  countTotal = 0;
  @notifyChangedProperty
  countUnread = 0;
  /** Arrived since the user last looked at this folder. Shown as the "N new"
   * badge, so it has to be cleared by `markViewed()` when the folder opens. */
  @notifyChangedProperty
  countNewArrived = 0;
  /** Transient progress while a folder is being cleared. */
  @notifyChangedProperty
  clearProgress: FolderClearProgress | null = null;
  /**
   * IMAP: modseq from CONDSTORE, as string
   * EWS: Sync state, as string
   */
  syncState: number | string | null = null;
  /** Every message in this folder has `hasAttachmentsFlag` from Exchange FindItem. */
  attachmentFlagsSynced = false;
  /** The server reported changed counts, so this folder needs a re-scan.
   * Only protocols without a reliable delta sync (OWA) set this. */
  dirty = false;
  readonly deletions = new Set<number | string>();
  readonly storageLock = new Lock();
  protected readonly readFolderLock = new Lock();
  protected readonly listMessagesLock = new Lock();

  constructor(account: MailAccount) {
    super();
    this.account = account;
  }

  get fullPath(): string {
    let path = this.name;
    let cur = this.parent;
    while (cur) {
      path = cur.name + "/" + path;
      cur = cur.parent;
    }
    return path;
  }

  get orderPos(): string {
    let specialOrder = specialFolderOrder.indexOf(this.specialFolder);
    if (specialOrder < 0) {
      specialOrder = specialFolderOrder.length;
    }
    if (this.specialFolder != SpecialFolder.Normal) {
      return `0:${String(specialOrder).padStart(2, "0")}`;
    }
    let name = this.name ?? "";
    let customOrder = Number.isFinite(this.sortOrder)
      ? `0:${String(this.sortOrder).padStart(10, "0")}`
      : `1:${name.toLocaleLowerCase()}`;
    return `1:${customOrder}:${name.toLocaleLowerCase()}`;
  }

  get storage() {
    return this.account.storage;
  }

  protected haveReadFolder = false;

  /** Recompute list correspondent when headers are loaded (e.g. shared mailbox outgoing). */
  refreshMessageContacts() {
    for (let message of this.messages) {
      let contact = computeEMailContact(message);
      if (contact?.emailAddress && contact.emailAddress != kDummyPerson.emailAddress) {
        message.contact = contact;
      }
    }
  }

  protected async readFolder() {
    if (this.haveReadFolder) {
      return;
    }
    let lock = await this.readFolderLock.lock();
    try {
      if (this.haveReadFolder) {
        return;
      }
      if (!this.dbID) {
        await this.save();
      }
      let log = "Reading msgs from DB, for folder " + this.account.name + " " + this.name;
      console.time(log + " first 200");
      await this.storage.readAllMessagesMainProperties(this, 200);
      console.timeEnd(log + " first 200");
      console.time(log);
      await this.storage.readAllMessagesMainProperties(this, null, 200);
      console.timeEnd(log);
      this.refreshMessageContacts();
      this.haveReadFolder = true;
    } finally {
      lock.release();
    }
  }

  /** Gets the metadata of the emails in this folder.
   * May be slow, depending on the protocol.
   * @returns the new messages (not yet downloaded). */
  async listMessages(): Promise<Collection<EMail>> {
    throw new AbstractFunction();
  }

  /** Downloads the entire MIME of *all* emails in this folder.
   * Tries to download the small emails first, then the large emails.
   * Assumes that you did `listMessages()` first.
   * @returns the actually downloaded emails. */
  async downloadAllMessages(): Promise<Collection<EMail>> {
    let missing = this.messages.filter(msg => !msg.downloadComplete) as any as Collection<EMail>;
    const kMaxSize = 50000;
    let missingLarge = missing.filter(msg => msg.size && msg.size > kMaxSize);
    let missingSmall = missing.subtract(missingLarge);
    // First the small messages, then the large ones
    let downloadedSmall = await this.downloadMessages(missingSmall);
    let downloadedLarge = await this.downloadMessages(missingLarge);
    return downloadedSmall.concat(downloadedLarge);
  }

  /** Downloads the entire MIME of the given emails.
   * @returns the actually downloaded emails. */
  async downloadMessages(emails: Collection<EMail>): Promise<Collection<EMail>> {
    throw new AbstractFunction();
  }

  /** Lists only the new messages, and downloads them.
   *
   * Should be implemented as fast as possible (a few seconds),
   * so that the action can be repeated routinely every few minutes.
   * @param recentOnly
   *   Only look at the newest messages, skipping a full folder reconcile.
   *   Protocols without a delta sync use this for their frequent poll.
   * @returns the new messages */
  async getNewMessages(recentOnly = false): Promise<Collection<EMail>> {
    throw new AbstractFunction();
  }

  /** Fast refresh from UI (Get mail, F5). Background sync uses the same path. */
  async fetchNewMailQuick(): Promise<Collection<EMail>> {
    return this.getNewMessages(true);
  }

  async moveMessageHere(message: EMail) {
    await this.moveMessagesHere(new ArrayColl([message]));
  }

  async copyMessageHere(message: EMail) {
    await this.copyMessagesHere(new ArrayColl([message]));
  }

  /**
   * To move messages from one folder to another, call this function
   * on the target folder. The `messages` are in the source folder.
   *
   * All messages must be from the same source folder.
   *
   * Attention:
   * Always pass in a copy of the array, not the live `selectedMessages` array from the UI.
   * If the user deletes or moves messages, they will be removed from the UI
   * instantly, which changes the current selection, so the wrong emails get deleted.
   * (Alternatively, all implementations here would need to make a copy of the array at start.)
   */
  async moveMessagesHere(messages: Collection<EMail>, onProgress?: MailTransferProgressCallback) {
    await this.moveOrCopyMessagesHere("move", messages, undefined, onProgress);
  }

  async moveMessagesToArchiveMailbox(_messages: Collection<EMail>): Promise<void> {
    throw new AbstractFunction();
  }

  /**
   * To copy messages from one folder to another, call this function
   * on the target folder. The `messages` are in the source folder.
   *
   * All messages must be from the same source folder.
   */
  async copyMessagesHere(messages: Collection<EMail>, onProgress?: MailTransferProgressCallback) {
    await this.moveOrCopyMessagesHere("copy", messages, undefined, onProgress);
  }

  /**
   * Helper function for `copyMessagesHere()` and `moveMessagesHere()`.
   * Calls `moveOrCopyMessagesOnServer()` as needed.
   *
   * @param sameServer
   *   true = source and target folder are on the same server, and we can move the email directly on the server and locally
   *   false = we need to upload the full email to the target and hard delete it on the source
   *   default: true, if target and source folder are the same account, otherwise false
   *   You may want to override that to true for delegate accounts or dependent accounts.
   */
  protected async moveOrCopyMessagesHere(
    action: "move" | "copy",
    messages: Collection<EMail>,
    sameServer?: boolean,
    onProgress?: MailTransferProgressCallback,
  ) {
    let sourceFolder = messages.first.folder;
    sameServer ??= this.account == sourceFolder.account;
    assert(sourceFolder, "Need source folder");
    assert(messages.contents.every(msg => msg.folder === sourceFolder), "All messages must be from the same folder");

    if (action == "move") {
      for (let msg of messages) {
        if (msg.pID) {
          sourceFolder.deletions.add(msg.pID);
        }
      }
    }
    let removedLocally = false;
    let bumpedTargetCount = false;
    let movedUnreadCount = messages.contents.filter(message => !message.isRead).length;
    let movedNewArrivedCount = messages.contents.filter(message => message.isNewArrived).length;
    let bumpedSourceCount = false;
    let bumpedTargetUnread = false;
    try {
      if (action == "move") {
        sourceFolder.messages.removeAll(messages);
        removedLocally = true;
      }
      if (!sameServer) {
        let completed = 0;
        for (let message of messages) {
          await message.loadMIME();
          await this.addMessage(message);
          if (action == "move") {
            await message.deleteMessage();
          }
          onProgress?.(++completed);
        }
        return;
      }

      if (action == "move") {
        sourceFolder.countTotal = Math.max(0, sourceFolder.countTotal - messages.length);
        sourceFolder.countUnread = Math.max(0, sourceFolder.countUnread - movedUnreadCount);
        sourceFolder.countNewArrived = Math.max(0, sourceFolder.countNewArrived - movedNewArrivedCount);
        bumpedSourceCount = true;
      }

      this.countTotal += messages.length;
      bumpedTargetCount = true;
      this.countUnread += movedUnreadCount;
      bumpedTargetUnread = true;

      await this.moveOrCopyMessagesOnServer(action, messages);

      if (action == "move") {
        for (let sourceMsg of messages) {
          await sourceMsg.deleteMessageLocally();
        }
        removedLocally = false; // already purged from DB; do not restore
      }
      onProgress?.(messages.length);
    } catch (ex) {
      if (bumpedTargetCount) {
        this.countTotal -= messages.length;
      }
      if (bumpedTargetUnread) {
        this.countUnread = Math.max(0, this.countUnread - movedUnreadCount);
      }
      if (bumpedSourceCount) {
        sourceFolder.countTotal += messages.length;
        sourceFolder.countUnread += movedUnreadCount;
        sourceFolder.countNewArrived += movedNewArrivedCount;
      }
      if (removedLocally) {
        // Server move failed — put messages back in the source list.
        for (let msg of messages) {
          if (!sourceFolder.messages.contains(msg)) {
            sourceFolder.messages.add(msg);
          }
        }
      }
      throw ex;
    } finally {
      if (action == "move") {
        for (let msg of messages) {
          if (msg.pID) {
            sourceFolder.deletions.delete(msg.pID);
          }
        }
      }
    }
  }

  protected async moveOrCopyMessagesOnServer(action: "move" | "copy", messages: Collection<EMail>) {
    throw new AbstractFunction();
  }

  /**
   * Uploads a message to this folder on the server.
   *
   * MIME:
   * - If this is an existing message, e.g. from another
   *   server or from an .eml file, make sure that
   *   `.mime` is populated with the RFC5322 message.
   * - If this is a new message that you just created,
   *   then this function will create the MIME from the properties.
   */
  async addMessage(message: EMail) {
    throw new AbstractFunction();
  }

  async moveFolderHere(folder: Folder) {
    assert(folder.account == this.account, gt`Cannot move folders between accounts yet. You can create a new folder and move the messages`);
    assert(folder != folder.account.findSpecialFolder(SpecialFolder.Inbox), "Cannot move the inbox");
    assert(folder.specialFolder == SpecialFolder.Normal, "Should not move special folders");
    assert(folder != this, "Cannot move a folder into itself. Neither physics nor logic allow that. We would run into a circle and run and run and run...");
    assert(!this.subFolders.contains(folder), "This folder is already a subfolder of the target folder");
    let disableSubfolders = this.disableSubfolders();
    assert(!disableSubfolders, disableSubfolders || "This folder cannot have subfolders");
    assert(!folder.getInclusiveDescendants().contains(this), "Cannot move a folder into one of its subfolders");
    if (folder.parent) {
      folder.parent.subFolders.remove(folder);
    } else {
      folder.account.rootFolders.remove(folder);
    }
    folder.parent = this;
    this.subFolders.add(folder);
  }

  /** Whether this ordinary folder can be moved one position among its siblings. */
  canMoveSibling(direction: "up" | "down"): boolean {
    if (this.specialFolder != SpecialFolder.Normal || !this.id || this.account.protocol == "all") {
      return false;
    }
    let siblings = this.normalSiblingFolders();
    let index = siblings.indexOf(this);
    let nextIndex = index + (direction == "up" ? -1 : 1);
    return index >= 0 && nextIndex >= 0 && nextIndex < siblings.length;
  }

  /** Move this folder one position up or down and persist the order. */
  async moveSibling(direction: "up" | "down"): Promise<boolean> {
    let siblings = this.normalSiblingFolders();
    let index = siblings.indexOf(this);
    let nextIndex = index + (direction == "up" ? -1 : 1);
    let target = siblings[nextIndex];
    if (index < 0 || !target) {
      return false;
    }
    return this.moveRelativeTo(target, direction == "down");
  }

  /** Move this folder before or after another ordinary sibling folder. */
  async moveRelativeTo(target: Folder, after: boolean): Promise<boolean> {
    assert(target.account == this.account, gt`Cannot move folders between accounts yet. You can create a new folder and move the messages`);
    assert(this.specialFolder == SpecialFolder.Normal, "Should not move special folders");
    assert(target.specialFolder == SpecialFolder.Normal, "Should not move a folder next to a special folder");
    assert(this != target, "Cannot move a folder next to itself");
    assert(!!this.id, "Cannot move a folder before it has been synchronized");

    let siblings = this.parent ? this.parent.subFolders : this.account.rootFolders;
    let targetSiblings = target.parent ? target.parent.subFolders : target.account.rootFolders;
    assert(siblings == targetSiblings, gt`Folders must have the same parent to change their order`);

    let current = siblings.contents;
    let normalSiblings = current
      .filter(folder => folder.specialFolder == SpecialFolder.Normal)
      .sort(compareFolderOrder);
    let sourceIndex = normalSiblings.indexOf(this);
    let targetIndex = normalSiblings.indexOf(target);
    assert(sourceIndex >= 0 && targetIndex >= 0, "Folder is not present in its parent folder");
    normalSiblings.splice(sourceIndex, 1);
    targetIndex = normalSiblings.indexOf(target);
    normalSiblings.splice(targetIndex + (after ? 1 : 0), 0, this);

    let previousOrder = new Map(normalSiblings.map(folder => [folder, folder.sortOrder]));
    normalSiblings.forEach((folder, index) => folder.sortOrder = index);
    try {
      await Promise.all(normalSiblings.filter(folder => !!folder.id).map(folder => folder.save()));
    } catch (ex) {
      for (let [folder, sortOrder] of previousOrder) {
        folder.sortOrder = sortOrder;
      }
      throw ex;
    }

    let specialSiblings = current.filter(folder => folder.specialFolder != SpecialFolder.Normal);
    siblings.clear();
    siblings.addAll([...specialSiblings, ...normalSiblings]);
    return true;
  }

  private normalSiblingFolders(): Folder[] {
    let siblings = this.parent ? this.parent.subFolders : this.account.rootFolders;
    return siblings.contents
      .filter(folder => folder.specialFolder == SpecialFolder.Normal)
      .sort(compareFolderOrder);
  }

  initializeSortOrder(): void {
    let siblings = this.parent ? this.parent.subFolders : this.account.rootFolders;
    let existingOrders = siblings.contents
      .filter(folder => folder !== this && folder.specialFolder == SpecialFolder.Normal)
      .map(folder => folder.sortOrder)
      .filter((sortOrder): sortOrder is number => Number.isFinite(sortOrder));
    if (existingOrders.length) {
      this.sortOrder = Math.max(...existingOrders) + 1;
    }
  }

  /** @see MailAccount.createToplevelFolder() */
  async createSubFolder(name: string): Promise<Folder> {
    let disableSubfolders = this.disableSubfolders();
    assert(!disableSubfolders, disableSubfolders || "This folder cannot have subfolders");
    let folder = this.account.newFolder();
    folder.name = name;
    folder.parent = this;
    this.subFolders.add(folder);
    folder.initializeSortOrder();
    return folder;
  }

  async rename(newName: string): Promise<void> {
    let disabled = this.disableRename();
    assert(!disabled, disabled || "Cannot rename");
    this.name = newName;
  }

  async save(): Promise<void> {
    await this.storage.saveFolder(this);
  }

  /** Warning: Also deletes all messages in the folder, also on the server */
  async deleteIt(): Promise<void> {
    let disableDelete = this.disableDelete();
    assert(!disableDelete, disableDelete || "Cannot delete");
    await this.deleteItLocally();
    await this.deleteItOnServer();
  }

  /** Warning: Also deletes all messages in the folder, also on the server */
  async deleteItLocally(): Promise<void> {
    if (this.parent) {
      this.parent.subFolders.remove(this);
    } else {
      this.account.rootFolders.remove(this);
    }
    if (this.dbID) {
      await this.storage.deleteFolder(this);
    }
  }

  protected async deleteItOnServer() {
  }

  async markAllRead(): Promise<void> {
    this.countUnread = 0;
    this.countNewArrived = 0;
    for (let message of this.messages) {
      if (!message.isRead) {
        message.isRead = true;
        // Without this the flags are back to unread after a restart, until the
        // server sync happens to catch up.
        await message.saveWritablePropsLocally().catch(() => null);
      }
    }
  }

  async markAllUnread(): Promise<void> {
    for (let message of this.messages) {
      if (message.isRead) {
        message.isRead = false;
        await message.saveWritablePropsLocally().catch(() => null);
      }
    }
    this.countUnread = this.messages.contents.filter(msg => !msg.isRead).length;
  }

  /** Move every message to Trash, or permanently delete in Trash/Spam. */
  async clearFolder(): Promise<void> {
    if (this.specialFolder == SpecialFolder.Trash || this.specialFolder == SpecialFolder.Spam) {
      await this.deleteAllMessages();
      return;
    }
    if (this.messages.isEmpty && this.countTotal > 0) {
      await this.listMessages();
    }
    if (this.messages.isEmpty && this.countTotal === 0) {
      return;
    }
    let trash = this.account.findSpecialFolder(SpecialFolder.Trash);
    assert(trash, gt`Trash folder is not set. Please go to folder properties and set Use As: Trash.`);
    let messages = new ArrayColl([...this.messages.contents]);
    await trash.moveMessagesHere(messages);
  }

  async deleteAllMessages(): Promise<void> {
    if (this.messages.isEmpty && this.countTotal > 0) {
      await this.listMessages();
    }
    let messages = [...this.messages.contents];
    let results = await Promise.allSettled(messages.map(message =>
      message.deleteMessage(DeleteStrategy.DeleteImmediately)));
    let failed = results.find((result): result is PromiseRejectedResult => result.status == "rejected");
    if (failed) {
      throw failed.reason;
    }
  }

  /** The user opened this folder, so its contents are no longer "new". */
  markViewed(): void {
    if (this.countNewArrived) {
      this.countNewArrived = 0;
    }
  }

  /**
   * Triggers a full resync of the folder.
   * Works only for protocols that have a sync key (e.g. EWS).
   * For some protocols (e.g. JMAP), might trigger a full resync of
   * *every* folder (in the account), on their respective next sync.
   */
  async fullResync(): Promise<void> {
    this.syncState = null;
    await this.listMessages();
  }

  get children(): Collection<Folder> {
    return this.subFolders as any as Collection<Folder>;
  }

  /**
   * Return this folder and all of its descendants.
   */
  getInclusiveDescendants(): ArrayColl<Folder> {
    let descendants = new ArrayColl<Folder>();
    function iterateFolders(folder: Folder) {
      descendants.add(folder);
      for (let child of folder.subFolders) {
        iterateFolders(child);
      }
    }
    iterateFolders(this);
    return descendants;
  }

  /** @return false, if delete is possible. If not, a string with the reason why it's not possible. */
  disableDelete(): string | false {
    if (this.specialFolder != SpecialFolder.Normal) {
      return gt`You cannot delete this folder, because it has a special use. See Use As.`;
    }
    return false;
  }

  /** @return false, if renaming is possible. If not, a string with the reason why it's not possible. */
  disableRename(): string | false {
    if (this.specialFolder == SpecialFolder.Inbox || this.name.toUpperCase() == "INBOX") {
      return gt`You cannot rename the inbox.`;
    }
    return false;
  }

  /** @return false, if creating subfolders is possible. If not, a string with the reason why it's not possible. */
  disableSubfolders(): string | false {
    return false;
  }

  /** @return false, if changing the special folder is possible. If not, a string with the reason why it's not possible. */
  disableChangeSpecial(): string | false {
    if (this.specialFolder == SpecialFolder.Inbox || this.name.toUpperCase() == "INBOX") {
      return gt`You cannot change the Inbox folder.`;
    }
    return false;
  }

  fromExtraJSON(json: any) {
    let sortOrder = json?.sortOrder;
    this.sortOrder = typeof sortOrder == "number" && Number.isFinite(sortOrder)
      ? sortOrder
      : null;
  }
  toExtraJSON(): any {
    return this.sortOrder != null && Number.isFinite(this.sortOrder)
      ? { sortOrder: this.sortOrder }
      : {};
  }

  newEMail(): EMail {
    return new EMail(this);
  }
}

export enum SpecialFolder {
  Normal = "normal",
  Inbox = "inbox",
  Sent = "sent",
  Drafts = "drafts",
  Trash = "trash",
  Spam = "spam",
  Archive = "archive",
  Outbox = "outbox",
  All = "all",
  Search = "search",
}

export const specialFolderOrder = [
  SpecialFolder.Inbox,
  SpecialFolder.Sent,
  SpecialFolder.Drafts,
  SpecialFolder.Trash,
  SpecialFolder.Spam,
  SpecialFolder.Archive,
  SpecialFolder.Outbox,
  SpecialFolder.All,
  SpecialFolder.Search,
  SpecialFolder.Normal,
];

export const specialFolderNames: Record<string, string> = {};
specialFolderNames[SpecialFolder.Inbox] = gt`Inbox`;
specialFolderNames[SpecialFolder.Sent] = gt`Sent`;
specialFolderNames[SpecialFolder.Drafts] = gt`Drafts`;
specialFolderNames[SpecialFolder.Trash] = gt`Trash`;
specialFolderNames[SpecialFolder.Spam] = gt`Spam`;
specialFolderNames[SpecialFolder.Archive] = gt`Archive`;
specialFolderNames[SpecialFolder.Outbox] = gt`Outbox`;
specialFolderNames[SpecialFolder.Search] = gt`Saved Search`;
specialFolderNames[SpecialFolder.Normal] = gt`Normal folder`;
specialFolderNames[SpecialFolder.All] = gt`All messages`;

export enum MailShareCombinedPermissions {
  Read = "read",
  /** Can read messages, and change the flags and tags,
   * but not add and delete emails */
  FlagChange = "flags-change",
  /** Full access, read, add and delete emails, and flag changes */
  Modify = "modify",
  Custom = "custom",
}
export enum MailShareIndividualPermissions {
  Read = "read",
  /** Can change the flags and tags */
  FlagChange = "flags-change",
  Delete = "delete",
  Create = "create",
  DeleteFolder = "delete-folder",
  CreateSubfolders = "create-subfolders",
}
export const mailShareCombinedPermissionsLabels: Record<string, string> = {
  [MailShareCombinedPermissions.Read]: gt`Read`,
  [MailShareCombinedPermissions.FlagChange]: gt`Tag, star, mark as read`,
  [MailShareCombinedPermissions.Modify]: gt`Delete, move and add mails`,
  [MailShareCombinedPermissions.Custom]: gt`Custom`,
};
export const mailShareIndividualPermissionsLabels: Record<string, string> = {
  [MailShareIndividualPermissions.Read]: gt`Read mail`,
  [MailShareIndividualPermissions.FlagChange]: gt`Change mail flags`,
  [MailShareIndividualPermissions.Delete]: gt`Delete mails`,
  [MailShareIndividualPermissions.Create]: gt`Add new mails`,
  [MailShareIndividualPermissions.DeleteFolder]: gt`Delete this folder`,
  [MailShareIndividualPermissions.CreateSubfolders]: gt`Add new folders`,
};
