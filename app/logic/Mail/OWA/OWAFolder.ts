import { ExchangeFolder } from "../EWS/ExchangeFolder";
import { MessageFlagsPidTag } from "../EWS/ExchangeEMail";
import { SpecialFolder, type MailTransferProgressCallback } from "../Folder";
import { computeEMailContact, type EMail } from "../EMail";
import { getSharedPersons, ExchangePermission } from "../EWS/ExchangePermission";
import { OWAEMail, owaCategoriesConfirmedAbsent, owaCategoriesPresent } from "./OWAEMail";
import { OWAAccount, kMaxFetchCount } from "./OWAAccount";
import { OWAError, isUnsupportedOptionError } from "./OWAError";
import { OWACreateItemRequest } from "./Request/OWACreateItemRequest";
import { OWADeleteItemRequest } from "./Request/OWADeleteItemRequest";
import { OWAUpdateItemRequest } from "./Request/OWAUpdateItemRequest";
import {
  owaCreateNewSubFolderRequest, owaDeleteFolderRequest,
  owaDownloadMsgsRequest, owaFindMsgsInFolderRequest, owaFindMsgsByQueryRequest,
  owaSyncFolderItemsRequest,
  owaFolderCountsRequest, owaFolderMarkAllMsgsReadRequest,
  owaGetNewMsgHeadersRequest, owaGetMessageActionFlagsRequest, owaMoveEntireFolderRequest,
  owaMoveOrCopyMsgsIntoFolderRequest, owaArchiveMessagesRequest, owaRenameFolderRequest,
  owaSetFolderPermissionsRequest, owaGetPermissionsRequest
} from "./Request/OWAFolderRequests";
import type { EMailCollection } from "../Store/EMailCollection";
import type { PersonUID } from "../../Abstract/PersonUID";
import { CreateMIME } from "../SMTP/CreateMIME";
import { assert, base64ToUint8Array, blobToBase64, ensureArray, sleep } from "../../util/util";
import { Lock } from "../../util/flow/Lock";
import { RunOnce } from "../../util/flow/RunOnce";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { ArrayColl, Collection } from "svelte-collections";
import { gt } from "../../../l10n/l10n";

/** Upper bound on `SyncFolderItems` pages in one `updateChangedMessages()`.
 * At `kMaxFetchCount` items per page this covers a very large backlog; what is
 * left over is picked up by the next sync. */
const kMaxSyncPages = 200;

/** How long a moved or deleted ItemId stays suppressed, to outlast Exchange's
 * eventually consistent FindItem. Matches the `preserveMovedUntil` window. */
const kDeletionGracePeriodMs = 180_000;
/** Exchange принимает несколько ItemIds в одном запросе DeleteItem. */
const kDeleteItemBatchSize = 50;
/** Не допускать всплеска запросов флагов, покрывая при этом видимый кеш. */
const kActionFlagsBackfillLimit = 200;
/** Общие ящики: только видимая страница, после основной синхронизации. */
const kActionFlagsBackfillLimitShared = 40;
/** Пауза перед необязательным backfill, чтобы не блокировать FindItem/GetItem. */
const kActionFlagsBackfillDelayMs = 2_500;
const kActionFlagsBackfillDelaySharedMs = 4_000;
/** Повтор backfill, пока у свежих писем нет подтверждённых категорий. */
const kCategoryBackfillRetryMs = 3_000;
const kCategoryBackfillRetrySharedMs = 5_000;
/** Сколько верхних писем проверять при открытии папки из кеша. */
const kRecentCategoryRefreshCount = 50;
/** Повторить поиск заголовка, если счётчик уже обновился, а синхронизация ещё отставала. */
const kServerCountSyncRetryDelaysSeconds = [0.5, 1, 2, 3];
/** GetItem-обновление видимой страницы, пока папка открыта (Outlook rules/push). */
const kVisibleMetadataRefreshMs = 12_000;
const kVisibleMetadataRefreshSharedMs = 8_000;
/** Не считать «без категорий» окончательным для свежих писем (Exchange rules). */
const kRecentCategoryGraceMs = 15 * 60_000;

export class OWAFolder extends ExchangeFolder {
  declare account: OWAAccount;
  declare readonly messages: EMailCollection<OWAEMail>;
  /** dbID/itemID → keep through FindItem replaceAll until this time (ms). */
  protected preserveMovedUntil = new Map<string, number>();
  declare readonly subFolders: ArrayColl<OWAFolder>;
  declare readonly deletions: Set<string>;
  // A decrease means that a recent-page poll cannot detect which local item moved or was deleted.
  protected countTotalDecreased = false;
  /** After SyncFolderItems proves unsupported on this server, stay on FindItem. */
  protected syncFolderItemsUnsupported = false;
  /** Header/unread fetches must not wait on a full-folder FindItem reconcile. */
  protected quickFetchLock = new Lock();
  /** Coalesce the primary and shared-mailbox pollers into one recent sync. */
  protected recentSyncRunOnce = new RunOnce<ArrayColl<OWAEMail>>();
  /** Объединять синхронизации заголовков по счётчику без потери последнего значения. */
  protected serverCountSyncRunOnce = new RunOnce<ArrayColl<OWAEMail>>();
  /** Не запускать несколько одинаковых повторов, пока Exchange догоняет счётчик. */
  protected serverCountSyncRetryRunOnce = new RunOnce<void>();
  /** Не выпускать промежуточное изменение счётчика при параллельных sync-вызовах. */
  protected serverCountSyncObserverMuteDepth = 0;
  protected serverCountSyncPreviousMute = false;
  /** Не показывать исходную загрузку папки как новое письмо. */
  protected hasCompletedInitialSync = false;
  /** Пометить письма следующей синхронизации как пришедшие по push-событию. */
  protected notifyNextSyncMessagesAsNew = false;
  /** Запрос списка намеренно не содержит нестабильные дополнительные свойства. */
  protected actionFlagsCheckedIDs = new Set<string>();
  protected actionFlagsBackfillTimer: ReturnType<typeof setTimeout> | null = null;
  protected actionFlagsBackfillRunning = false;
  /** Не допускать параллельных GetItem для видимой папки. */
  protected visibleMetadataRefreshPromise: Promise<void> | null = null;

  newEMail(): OWAEMail {
    return new OWAEMail(this);
  }

  applyServerCounts(countTotal: number, countUnread: number): void {
    // Sticky: only a completed reconcile clears it. Clearing here would drop a
    // pending RowDeleted reconcile as soon as the next badge refresh arrives.
    if (countTotal < this.countTotal) {
      this.countTotalDecreased = true;
    }
    if (countUnread > this.countUnread) {
      this.countNewArrived += countUnread - this.countUnread;
    } else if (countUnread < this.countUnread) {
      this.countNewArrived = Math.max(0, this.countNewArrived - (this.countUnread - countUnread));
    }
    if (this.countTotal != countTotal || this.countUnread != countUnread) {
      this.dirty = true;
    }
    this.countTotal = countTotal;
    this.countUnread = countUnread;
  }

  fromJSON(json: any, archiveMailbox = false) {
    // Fall back rather than throw: `sanitize.integer()` and
    // `sanitize.nonemptylabel()` throw when the field is absent, and this runs
    // inside the hierarchy listing, where one odd folder would otherwise leave
    // the user with no folders at all.
    let countTotal = sanitize.integer(json.TotalCount, this.countTotal);
    let countUnread = sanitize.integer(json.UnreadCount, this.countUnread);
    this.applyServerCounts(countTotal, countUnread);
    this.isArchiveMailbox = archiveMailbox;
    this.isArchiveMailboxRoot = false;
    this.specialFolder = SpecialFolder.Normal;
    this.id = sanitize.nonemptystring(json.FolderId?.Id ?? json.FolderId?.id ?? json.FolderId, "");
    this.name = sanitize.nonemptylabel(json.DisplayName, this.name ?? this.id);
    let distinguishedFolderID = typeof json.DistinguishedFolderId == "string"
      ? json.DistinguishedFolderId
      : json.DistinguishedFolderId?.Id;
    switch (distinguishedFolderID?.toLowerCase()) { // allowed to be null
    case "inbox":
      this.specialFolder = SpecialFolder.Inbox;
      break;
    case "drafts":
      this.specialFolder = SpecialFolder.Drafts;
      break;
    case "sentitems":
      this.specialFolder = SpecialFolder.Sent;
      break;
    case "junkemail":
      this.specialFolder = SpecialFolder.Spam;
      break;
    case "deleteditems":
      this.specialFolder = SpecialFolder.Trash;
      break;
    case "archive":
    case "archivemsgfolderroot":
    case "archiveinbox":
      if (!archiveMailbox) {
        this.specialFolder = SpecialFolder.Archive;
      }
      break;
    //case "outbox":
    }
  }

  /** Pull TotalCount/UnreadCount from Exchange and reconcile local state. */
  async refreshCountsFromServer(): Promise<void> {
    let result = await this.account.callOWA(owaFolderCountsRequest(this.id));
    let folder = result?.Folders?.[0];
    if (!folder) {
      return;
    }
    let countTotal = sanitize.integer(folder.TotalCount);
    let countUnread = sanitize.integer(folder.UnreadCount);
    let previousUnread = this.countUnread;
    let previousTotal = this.countTotal;
    this.applyServerCounts(countTotal, countUnread);
    await this.readFolder();
    if (countUnread != previousUnread || countTotal != previousTotal || this.dirty || this.needsRecentRefresh()) {
      await this.getNewMessages(true);
    }
  }

  /** Whether local message state is behind the server folder counters. */
  isBehindServer(): boolean {
    return this.needsRecentRefresh();
  }

  /** Server reports more unread messages than we have locally. */
  unreadBehindServer(): boolean {
    let localUnread = 0;
    for (let message of this.messages) {
      if (!message.isRead) {
        localUnread++;
      }
    }
    return this.countUnread > localUnread;
  }

  async withQuickFetchLock<T>(fn: () => Promise<T>): Promise<T> {
    let lock = await this.quickFetchLock.lock();
    try {
      return await fn();
    } finally {
      lock.release();
    }
  }

  markNextSyncMessagesAsNew(): void {
    this.notifyNextSyncMessagesAsNew = true;
  }

  protected newMessagesAreArrivals(): boolean {
    return this.notifyNextSyncMessagesAsNew || this.hasCompletedInitialSync || this.messages.hasItems;
  }

  protected completeInitialSync(): void {
    this.hasCompletedInitialSync = true;
    this.notifyNextSyncMessagesAsNew = false;
  }

  /**
   * One AQS FindItem for unread mail — reliable on Exchange 2019 when Hierarchy
   * moved the badge but Row/NewMail did not arrive yet. Does not wait on full
   * folder scans that can take minutes on large Inboxes.
   */
  async fetchUnreadArrivals(maxResults = 30): Promise<ArrayColl<OWAEMail>> {
    if (!this.id) {
      return new ArrayColl();
    }
    await this.readFolder();
    return this.withQuickFetchLock(async () => {
      let items: any[] = [];
      let queryFailed = false;
      try {
        let result = await this.account.callOWA(
          owaFindMsgsByQueryRequest(this.id, "isread:no", maxResults));
        items = result?.RootFolder?.Items ?? [];
      } catch (ex) {
        console.warn("OWA unread query failed; falling back to recent FindItem", this.name, ex);
        queryFailed = true;
      }
      let newMessageIDs: string[] = [];
      for (let message of items) {
        let id = sanitize.nonemptystring(message?.ItemId?.Id ?? message?.ItemId, "");
        if (!id || this.deletions.has(id)) {
          continue;
        }
        let email = this.getEmailByItemID(id);
        if (email) {
          if (email.setFlags(message, "list")) {
            await this.persistEmailFlags(email);
          }
        } else {
          newMessageIDs.push(id);
        }
      }
      let newMsgs = await this.getNewMessageHeaders(newMessageIDs);
      if (newMsgs.hasItems) {
        for (let msg of newMsgs) {
          msg.isNewArrived = this.newMessagesAreArrivals();
        }
        this.addMessagesIfAbsent(newMsgs);
        this.dirty = false;
        this.notifyObservers();
      }
      // Some shared/on-premise OWA servers return an empty AQS result while
      // the folder badge already reports unread mail. A background poll must
      // use the same regular FindItem fallback as folder opening; otherwise
      // the message appears only after restarting the application.
      if (queryFailed || this.isBehindServer()) {
        let recent = await this.listMessages(true, true);
        if (!recent.hasItems && this.isBehindServer()) {
          recent = await this.listMessages(false, true);
        }
        newMsgs.addAll(recent);
      }
      void this.downloadMessages(newMsgs).catch(this.account.errorCallback);
      this.completeInitialSync();
      return newMsgs;
    });
  }

  /** Fast path after a Hierarchy badge bump or while the open folder is visible. */
  async syncRecentArrivals(): Promise<ArrayColl<OWAEMail>> {
    return this.recentSyncRunOnce.runOnce(async () => {
      await this.readFolder();
      this.dedupeMessagesByItemID();
      let completed = false;
      try {
        let messages: ArrayColl<OWAEMail>;
        if (this.unreadBehindServer()) {
          messages = await this.fetchUnreadArrivals(Math.min(50, Math.max(10, this.countUnread)));
        } else {
          messages = await this.getNewMessages(true) as ArrayColl<OWAEMail>;
        }
        completed = true;
        return messages;
      } finally {
        if (completed) {
          this.completeInitialSync();
          this.backfillMessageActionFlags();
        }
      }
    });
  }

  /** Применяет счётчик и возвращается после первой загрузки соответствующих заголовков. */
  async syncRecentArrivalsWithServerCounts(
    countTotal: number,
    countUnread: number,
  ): Promise<ArrayColl<OWAEMail>> {
    if (this.serverCountSyncObserverMuteDepth++ == 0) {
      this.serverCountSyncPreviousMute = this._muteObservers;
    }
    this._muteObservers = true;
    try {
      this.applyServerCounts(countTotal, countUnread);
      this.dirty = true;
      return await this.serverCountSyncRunOnce.runOnce(async () => {
        let messages = await this.syncRecentArrivals();
        void this.serverCountSyncRetryRunOnce.runOnce(
          () => this.retryRecentArrivalsUntilCaughtUp(),
        ).catch(ex => this.account.errorCallback(ex));
        return messages;
      });
    } finally {
      if (--this.serverCountSyncObserverMuteDepth == 0) {
        this._muteObservers = this.serverCountSyncPreviousMute;
      }
    }
  }

  /** Повторяет быструю синхронизацию после первой отложенной выдачи заголовка. */
  protected async retryRecentArrivalsUntilCaughtUp(): Promise<void> {
    for (let delaySeconds of kServerCountSyncRetryDelaysSeconds) {
      if (!this.isBehindServer()) {
        return;
      }
      await sleep(delaySeconds);
      await this.syncRecentArrivals();
    }
  }

  async moveMessagesToArchiveMailbox(messages: Collection<EMail>): Promise<void> {
    assert(this.account.archiveMailboxRoot, "Archive mailbox is not available");
    assert(!this.isArchiveMailbox, "Message is already in the archive mailbox");
    let sourceMessages = messages.contents as OWAEMail[];
    assert(sourceMessages.length > 0, "Need messages");
    assert(sourceMessages.every(message => message.folder === this), "All messages must be from the same folder");
    assert(sourceMessages.every(message => message.itemID), "Message has no server ID");

    let itemIDs = sourceMessages.map(message => message.itemID as string);
    for (let itemID of itemIDs) {
      this.deletions.add(itemID);
    }
    let serverMoved = false;
    try {
      let result = await this.account.callOWA(owaArchiveMessagesRequest(this.id, sourceMessages));
      let responseItems = result?.ResponseMessages?.Items
        ?? (result?.ResponseClass || result?.ResponseCode ? [result] : []);
      for (let responseItem of ensureArray(responseItems)) {
        if (responseItem.ResponseClass == "Error") {
          throw new OWAError({ json: responseItem });
        }
      }
      serverMoved = true;
      await this.removeMessagesAfterServerMove(messages);
    } finally {
      for (let itemID of itemIDs) {
        if (serverMoved) {
          this.releaseDeletionAfterGracePeriod(itemID);
        } else {
          this.deletions.delete(itemID);
        }
      }
    }
  }

  async fetchNewMailQuick(): Promise<Collection<OWAEMail>> {
    return this.syncRecentArrivals();
  }

  /** Очищает обычную папку одним MoveItem, а не отдельным запросом на письмо. */
  override async clearFolder(): Promise<void> {
    if (this.specialFolder == SpecialFolder.Trash || this.specialFolder == SpecialFolder.Spam) {
      await this.deleteAllMessages();
      return;
    }
    this.clearProgress = {
      phase: "preparing",
      completed: 0,
      total: Math.max(this.countTotal, this.messages.length),
    };
    let messages: OWAEMail[];
    try {
      await this.readFolder();
      if (this.dirty) {
        await this.refreshCountsFromServer();
      }
      if (this.countTotal != this.messages.length) {
        await this.listMessages(false, true);
      }
      if (this.countTotal > this.messages.length) {
        throw new OWAError({ message: "Exchange did not return all messages; cleanup was not started" });
      }
      messages = [...this.messages.contents];
      if (!messages.length) {
        return;
      }
      this.clearProgress = {
        phase: "deleting",
        completed: 0,
        total: messages.length,
      };
      let trash = this.account.findSpecialFolder(SpecialFolder.Trash);
      assert(trash, gt`Trash folder is not set. Please go to folder properties and set Use As: Trash.`);
      if (trash instanceof OWAFolder) {
        await trash.moveMessagesHereForClear(new ArrayColl(messages));
      } else {
        await trash.moveMessagesHere(new ArrayColl(messages));
      }
      this.clearProgress = {
        phase: "deleting",
        completed: messages.length,
        total: messages.length,
      };
    } finally {
      this.clearProgress = null;
    }
  }

  /** Uses Folder's optimistic local bookkeeping with OWA's one-shot MoveItem. */
  protected async moveMessagesHereForClear(messages: Collection<OWAEMail>): Promise<void> {
    if (!messages.hasItems) {
      return;
    }
    let sourceAccount = messages.first.folder.account;
    let sameServer = (sourceAccount.mainAccount ?? sourceAccount) == (this.account.mainAccount ?? this.account) &&
      messages.contents.every(message => message.folder.account == sourceAccount);
    if (!sameServer) {
      await this.moveMessagesHere(messages);
      return;
    }
    await super.moveOrCopyMessagesHere("move", messages, true);
  }

  /** Удаляет корзину/спам пакетными DeleteItem-запросами Exchange. */
  override async deleteAllMessages(): Promise<void> {
    if (this.specialFolder != SpecialFolder.Trash && this.specialFolder != SpecialFolder.Spam) {
      await super.deleteAllMessages();
      return;
    }
    this.clearProgress = {
      phase: "preparing",
      completed: 0,
      total: Math.max(this.countTotal, this.messages.length),
    };
    let messages: OWAEMail[];
    try {
      await this.readFolder();
      if (this.dirty) {
        await this.refreshCountsFromServer();
      }
      // Очистка должна получить все заголовки, а не только локально открытые.
      // force=true не даёт listMessages() перейти в быстрый режим первой страницы
      // из-за рассинхрона локального кеша и серверного счётчика.
      if (this.countTotal != this.messages.length) {
        await this.listMessages(false, true);
      }
      if (this.countTotal > this.messages.length) {
        throw new OWAError({ message: "Exchange did not return all messages; cleanup was not started" });
      }
      messages = [...this.messages.contents];
    } catch (ex) {
      this.clearProgress = null;
      throw ex;
    }
    this.clearProgress = {
      phase: "deleting",
      completed: 0,
      total: messages.length,
    };
    let itemIDs = [...new Set(messages
      .map(message => message.itemID)
      .filter((itemID): itemID is string => !!itemID))];
    let messagesByItemID = new Map<string, OWAEMail[]>();
    for (let message of messages) {
      if (message.itemID) {
        let items = messagesByItemID.get(message.itemID) ?? [];
        items.push(message);
        messagesByItemID.set(message.itemID, items);
      }
    }
    for (let itemID of itemIDs) {
      this.deletions.add(itemID);
    }
    let serverDeleted = new Set<string>();
    let removedMessages = new Set<OWAEMail>();
    let removeLocally = async (message: OWAEMail): Promise<void> => {
      if (removedMessages.has(message)) {
        return;
      }
      removedMessages.add(message);
      let wasUnread = !message.isRead;
      let wasNew = message.isNewArrived;
      await message.deleteMessageLocally();
      this.countTotal = Math.max(0, this.countTotal - 1);
      if (wasUnread) {
        this.countUnread = Math.max(0, this.countUnread - 1);
      }
      if (wasNew) {
        this.countNewArrived = Math.max(0, this.countNewArrived - 1);
      }
    };
    let completed = false;
    try {
      for (let i = 0; i < itemIDs.length; i += kDeleteItemBatchSize) {
        let batchIDs = itemIDs.slice(i, i + kDeleteItemBatchSize);
        let result = await this.account.callOWA(new OWADeleteItemRequest(batchIDs, {
          DeleteType: "HardDelete",
          // Exchange требует этот параметр для элементов календаря. Очистка
          // почтовой папки не должна отправлять участникам отмену встречи.
          SendMeetingCancellations: "SendToNone",
          SuppressReadReceipts: true,
        }));
        let responseItems = result?.ResponseMessages?.Items
          ?? (result?.ResponseClass || result?.ResponseCode ? [result] : null);
        let responses = responseItems ? ensureArray(responseItems) : [];
        if (responses.length != batchIDs.length) {
          throw new OWAError({ message: "Exchange returned an incomplete DeleteItem response" });
        }
        let failedResponse: any = null;
        for (let index = 0; index < batchIDs.length; index++) {
          let response = responses[index];
          let isError = response?.ResponseClass == "Error" ||
            (response?.MessageText && response.ResponseClass != "Success" && response.ResponseCode != "NoError");
          if (isError) {
            failedResponse ??= response;
            continue;
          }
          let itemID = batchIDs[index];
          serverDeleted.add(itemID);
          this.releaseDeletionAfterGracePeriod(itemID);
          for (let message of messagesByItemID.get(itemID) ?? []) {
            await removeLocally(message);
          }
        }
        this.clearProgress = {
          phase: "deleting",
          completed: removedMessages.size,
          total: messages.length,
        };
        if (failedResponse) {
          throw new OWAError({ json: failedResponse });
        }
      }
      // Заголовок без ItemId нельзя отправить в Exchange, но его безопасно
      // удалить из локального кеша после успешного удаления на сервере.
      for (let message of messages) {
        if (!message.itemID) {
          await removeLocally(message);
        }
      }
      this.countTotal = 0;
      this.countUnread = 0;
      this.countNewArrived = 0;
      this.countTotalDecreased = false;
      this.dirty = false;
      completed = true;
      if (this.dbID) {
        await this.storage.saveFolderProperties(this);
      }
    } finally {
      for (let itemID of itemIDs) {
        if (!serverDeleted.has(itemID)) {
          this.deletions.delete(itemID);
        }
      }
      if (!completed && serverDeleted.size) {
        this.countTotalDecreased = true;
        this.dirty = true;
      }
      this.clearProgress = null;
    }
  }

  /** User opened the folder — load headers when the cache is empty or badges moved. */
  async syncOnFolderOpen(): Promise<Collection<OWAEMail>> {
    await this.readFolder();
    this.dedupeMessagesByItemID();
    let needsFetch = (this.messages.isEmpty && (this.countTotal > 0 || this.countUnread > 0))
      || this.dirty
      || this.countNewArrived > 0
      || this.unreadBehindServer()
      || this.isBehindServer();
    if (!needsFetch) {
      this.completeInitialSync();
      if (this.recentMessagesNeedCategoryRefresh()) {
        let messages = await this.syncRecentArrivals();
        this.refreshVisibleMessageMetadataInBackground();
        return messages;
      }
      this.refreshVisibleMessageMetadataInBackground();
      this.backfillMessageActionFlags();
      return this.messages;
    }
    let msgs = await this.getNewMessages(true);
    if (!msgs.hasItems && this.isBehindServer()) {
      // AQS can return an empty result on shared/on-premise OWA while the
      // folder badge is already updated. Retry the regular page on open, and
      // reconcile the whole folder only if the counters still disagree.
      msgs = await this.listMessages(true, true);
      if (!msgs.hasItems && this.isBehindServer()) {
        msgs = await this.listMessages(false, true);
      }
      await this.finishNewMessages(msgs, true);
    }
    this.dirty = false;
    this.completeInitialSync();
    this.refreshVisibleMessageMetadataInBackground();
    this.backfillMessageActionFlags();
    this.notifyObservers();
    return msgs;
  }

  /**
   * GetItem для видимой страницы — единственный надёжный способ подтянуть
   * категории после правки в Outlook (FindItem на shared часто пустой).
   */
  async refreshVisibleMessageMetadata(limit = kRecentCategoryRefreshCount): Promise<void> {
    if (this.visibleMetadataRefreshPromise) {
      return this.visibleMetadataRefreshPromise;
    }
    let refresh = (async () => {
      let ids = this.messages.contents
        .slice(0, limit)
        .map(message => message.pID == null ? "" : String(message.pID))
        .filter(Boolean);
      if (!ids.length) {
        return;
      }
      let lock = await this.listMessagesLock.lock();
      try {
        await this.refreshMessages(ids);
      } finally {
        lock.release();
      }
    })();
    this.visibleMetadataRefreshPromise = refresh;
    try {
      await refresh;
    } finally {
      if (this.visibleMetadataRefreshPromise === refresh) {
        this.visibleMetadataRefreshPromise = null;
      }
    }
  }

  protected refreshVisibleMessageMetadataInBackground(): void {
    void this.refreshVisibleMessageMetadata().catch(ex => this.account.errorCallback(ex));
  }

  /** Интервал фонового GetItem для открытой папки (shared чаще — слабее push). */
  visibleMetadataRefreshIntervalMs(): number {
    return this.account.isDependentAccount || this.account.sharedFolderRoot
      ? kVisibleMetadataRefreshSharedMs
      : kVisibleMetadataRefreshMs;
  }

  protected async finishNewMessages(newMsgs: Collection<OWAEMail>, recentOnly: boolean): Promise<Collection<OWAEMail>> {
    if (recentOnly) {
      void this.downloadMessages(newMsgs).catch(this.account.errorCallback);
    } else {
      await this.downloadMessages(newMsgs);
    }
    if (!this.attachmentFlagsSynced && this.messages.hasItems) {
      void this.syncHasAttachmentFlags().catch(ex => this.account.errorCallback(ex));
    }
    return newMsgs;
  }

  /**
   * OWA sync uses SyncFolderItems when available; otherwise falls back to
   * count-driven FindItem paging (see listMessages).
   */
  async folderCountsChanged() {
    if (this.dirty) {
      this.dirty = false;
      return true;
    }
    let result = await this.account.callOWA(owaFolderCountsRequest(this.id));
    let folder = result?.Folders?.[0];
    if (!folder) {
      return false;
    }
    let countTotal = sanitize.integer(folder.TotalCount, this.countTotal);
    let countUnread = sanitize.integer(folder.UnreadCount, this.countUnread);
    if (this.countTotal == countTotal && this.countUnread == countUnread) {
      // Nothing to do, hopefully.
      this.countTotalDecreased = false;
      return false;
    }
    if (countTotal < this.countTotal) {
      this.countTotalDecreased = true;
    }
    this.applyServerCounts(countTotal, countUnread);
    return true;
  }

  /** Local message list is behind server folder counters. */
  protected needsRecentRefresh(): boolean {
    if (this.dirty) {
      return true;
    }
    if (this.countTotal != this.messages.length) {
      return true;
    }
    let localUnread = 0;
    for (let message of this.messages) {
      if (!message.isRead) {
        localUnread++;
      }
    }
    return this.countUnread != localUnread;
  }

  /** Surplus local messages prove a server-side delete or move. */
  protected needsFullReconcile(): boolean {
    return this.countTotalDecreased || this.messages.length > this.countTotal;
  }

  /**
   * Reads the complete folder when counts changed, or only its first page for
   * the background poll so existing message properties stay current.
   * `force` is used to reconcile a count decrease after the quick poll.
   */
  async listMessages(recentOnly = false, force = false): Promise<Collection<OWAEMail>> {
    await this.readFolder();
    let lock = await this.listMessagesLock.lock();
    try {
      if (!recentOnly && !force) {
        let changed = await this.folderCountsChanged();
        if (!changed) {
          if (this.needsRecentRefresh()) {
            recentOnly = true;
          } else {
            return new ArrayColl<OWAEMail>();
          }
        }
      }

      if (recentOnly) {
        try {
          await this.folderCountsChanged();
        } catch (ex) {
          if (!(ex instanceof OWAError && ex.isSessionLimit)) {
            this.account.errorCallback(ex);
          }
        }
      }

      let isNewMail = this.newMessagesAreArrivals();
      let allMsgs = new ArrayColl<OWAEMail>();
      let newMsgs = new ArrayColl<OWAEMail>();
      let request = owaFindMsgsInFolderRequest(
        this.id,
        kMaxFetchCount,
        recentOnly,
        recentOnly && this.account.isDependentAccount,
      );
      let result: any = { RootFolder: { IncludesLastItemInRange: false } };
      let firstPage = true;
      while (true) {
        result = await this.account.callOWA(request);
        let messages = result?.RootFolder?.Items;
        if (!messages?.length) {
          // This folder is empty or no more items.
          break;
        }
        firstPage = false;
        let newMessageIDs: string[] = [];
        for (let message of messages) {
          let id = sanitize.nonemptystring(message?.ItemId?.Id ?? message?.ItemId, "");
          if (!id || this.deletions.has(id)) {
            continue;
          }
          let email = this.getEmailByItemID(id);
          if (email) {
            if (email.setFlags(message, "list")) {
              await this.persistEmailFlags(email);
            }
            allMsgs.add(email);
          } else {
            newMessageIDs.push(id);
          }
        }
        let newMsgsInIteration = await this.getNewMessageHeaders(newMessageIDs);
        for (let msg of newMsgsInIteration) {
          msg.isNewArrived = isNewMail;
        }
        newMsgs.addAll(newMsgsInIteration);

        if (recentOnly) {
          break;
        }

        let nextOffset = result.RootFolder?.IndexedPagingOffset;
        if (typeof nextOffset === "number" && nextOffset > request.Body.Paging.Offset) {
          request.Body.Paging.Offset = nextOffset;
        } else {
          request.Body.Paging.Offset += messages.length;
        }

        let includesLast = result?.RootFolder?.IncludesLastItemInRange;
        let totalCount = result?.RootFolder?.TotalItemsInView;
        if (includesLast === true) {
          break;
        }
        if (typeof totalCount === "number" && request.Body.Paging.Offset >= totalCount) {
          break;
        }
        if (messages.length < kMaxFetchCount && includesLast !== false) {
          break;
        }
      }

      if (recentOnly) {
        if (newMsgs.hasItems) {
          this.addMessagesIfAbsent(newMsgs);
          this.refreshMessageContacts();
        }
        this.notifyObservers();
      } else if (firstPage && this.countTotal > 0) {
        // The server gave us nothing for a folder it says is not empty. Taking
        // that at face value would delete the whole local copy of the folder.
        this.notifyObservers();
      } else {
        // `subtract()` is a live collection observing both operands, so adding
        // to `allMsgs` while looping over it would skip the following entry
        // and leave that message behind in storage. Snapshot first.
        let stale = this.messages.contents.filter(email => !allMsgs.contains(email));
        for (let email of stale) {
          if (this.shouldPreserveMoved(email)) {
            allMsgs.add(email);
            continue;
          }
          await this.storage.deleteMessage(email);
        }
        allMsgs.addAll(newMsgs);
        this.messages.replaceAll(allMsgs);
        this.refreshMessageContacts();
        if (newMsgs.hasItems) {
          this.notifyObservers();
        }
      }
      this.completeInitialSync();
      this.backfillMessageActionFlags();
      return newMsgs;
    } finally {
      lock.release();
    }
  }

  /** Load attachment metadata for header-only messages (list icon + filters). */
  async syncHasAttachmentFlags(): Promise<void> {
    if (!this.id || this.attachmentFlagsSynced) {
      return;
    }
    let lock = await this.listMessagesLock.lock();
    try {
      if (this.attachmentFlagsSynced) {
        return;
      }
      let request = owaFindMsgsInFolderRequest(
        this.id,
        kMaxFetchCount,
        false,
        this.account.isDependentAccount,
      );
      while (true) {
        let result = await this.account.callOWA(request);
        let messages = result?.RootFolder?.Items ?? [];
        if (!messages.length) {
          break;
        }
        for (let message of messages) {
          let id = sanitize.nonemptystring(message?.ItemId?.Id ?? message?.ItemId, "");
          if (!id) {
            continue;
          }
          let email = this.getEmailByItemID(id);
          if (!email) {
            continue;
          }
          if (email.setFlags(message, "list")) {
            await email.saveWritablePropsLocally();
          }
        }
        let nextOffset = result.RootFolder?.IndexedPagingOffset;
        if (typeof nextOffset === "number" && nextOffset > request.Body.Paging.Offset) {
          request.Body.Paging.Offset = nextOffset;
        } else {
          request.Body.Paging.Offset += messages.length;
        }
        if (result?.RootFolder?.IncludesLastItemInRange === true) {
          break;
        }
        let totalCount = result?.RootFolder?.TotalItemsInView;
        if (typeof totalCount === "number" && request.Body.Paging.Offset >= totalCount) {
          break;
        }
        if (messages.length < kMaxFetchCount && result?.RootFolder?.IncludesLastItemInRange !== false) {
          break;
        }
      }
      this.attachmentFlagsSynced = true;
      await this.storage.saveFolder(this);
      this.notifyObservers();
    } finally {
      lock.release();
    }
  }

  /** Server-side AQS search; returns headers for matching messages (also saved locally). */
  async searchMessages(queryString: string, maxResults = 50): Promise<ArrayColl<OWAEMail>> {
    if (!queryString?.trim() || !this.id) {
      return new ArrayColl<OWAEMail>();
    }
    let result = await this.account.callOWA(
      owaFindMsgsByQueryRequest(this.id, queryString.trim(), maxResults));
    let messages = result?.RootFolder?.Items ?? [];
    let newMessageIDs: string[] = [];
    let found = new ArrayColl<OWAEMail>();
    for (let message of messages) {
      let id = sanitize.nonemptystring(message?.ItemId?.Id ?? message?.ItemId, "");
      if (!id) {
        continue;
      }
      let email = this.getEmailByItemID(id);
      if (email) {
        found.add(email);
      } else {
        newMessageIDs.push(id);
      }
    }
    let headers = await this.getNewMessageHeaders(newMessageIDs);
    found.addAll(headers);
    return found;
  }

  async getNewMessageHeaders(newMessageIDs: string[]): Promise<ArrayColl<OWAEMail>> {
    let newMsgs = new ArrayColl<OWAEMail>();
    // Deduplicate request IDs and skip ones already loaded (notification vs poll race).
    let ids = [...new Set(newMessageIDs.filter(Boolean))]
      .filter(id => !this.deletions.has(id) && !this.getEmailByItemID(id));
    if (!ids.length) {
      return newMsgs;
    }
    try {
      let results = await this.account.callOWA(owaGetNewMsgHeadersRequest(ids));
      let items = results.ResponseMessages ? this.account.itemsFromResponses(results.ResponseMessages.Items) : results.Items;
      for (let item of items) {
        try {
          let id = sanitize.nonemptystring(item?.ItemId?.Id, "");
          if (!id || this.deletions.has(id)) {
            continue;
          }
          let existing = this.getEmailByItemID(id);
          if (existing) {
            if (existing.setFlags(item, "full")) {
              await this.persistEmailFlags(existing);
            }
            this.markMetadataBackfillComplete(id, item, existing);
            existing.contact = computeEMailContact(existing);
            continue;
          }
          let email = this.newEMail();
          email.fromJSON(item);
          await email.saveMetadataLocally();
          // Another concurrent fetch may have inserted the same pID meanwhile.
          let raced = this.getEmailByItemID(id);
          if (raced && raced !== email) {
            continue;
          }
          this.markMetadataBackfillComplete(id, item, email);
          newMsgs.add(email);
        } catch (ex) {
          this.account.errorCallback(ex);
        }
      }
    } catch (ex) {
      this.account.errorCallback(ex);
    }
    return newMsgs;
  }

  /**
   * Applies server-side flag/category changes to messages already loaded in
   * this folder. RowNotification supplies the exact ItemId, so this avoids a
   * full folder scan when an old message is changed in OWA.
   */
  async refreshMessages(itemIDs: string[]): Promise<void> {
    let ids = [...new Set(itemIDs.filter(Boolean))];
    if (!ids.length) {
      return;
    }
    for (let id of ids) {
      this.invalidateMetadataBackfill(id);
    }
    let items: any[];
    try {
      let results = await this.account.callOWA(owaGetNewMsgHeadersRequest(ids));
      items = results.ResponseMessages
        ? this.account.itemsFromResponses(results.ResponseMessages.Items)
        : results.Items;
    } catch (ex) {
      this.account.handleBackgroundSyncError(ex);
      return;
    }
    let missingMessages: OWAEMail[] = [];
    let changed = false;
    for (let item of items ?? []) {
      let id = sanitize.nonemptystring(item?.ItemId?.Id, null);
      let email = id ? (this.getEmailByItemID(id) ?? this.account.getEmailByItemID(id)) : undefined;
      if (email) {
        try {
          let oldTagNames = email.tags.contents.map(tag => tag.name);
          email.fromJSON(item);
          await email.saveMetadataLocally();
          this.markMetadataBackfillComplete(id, item, email);
          let newTagNames = email.tags.contents.map(tag => tag.name);
          if (oldTagNames.length != newTagNames.length ||
              oldTagNames.some((name, i) => name != newTagNames[i])) {
            changed = true;
          }
        } catch (ex) {
          this.account.errorCallback(ex);
        }
      } else if (id) {
        try {
          let newEmail = this.newEMail();
          newEmail.fromJSON(item);
          await newEmail.saveMetadataLocally();
          missingMessages.push(newEmail);
        } catch (ex) {
          this.account.errorCallback(ex);
        }
      }
    }
    if (missingMessages.length > 0) {
      this.addMessagesIfAbsent(missingMessages);
      this.downloadMessages(new ArrayColl(missingMessages))
        .catch(this.account.errorCallback);
      changed = true;
    }
    if (changed) {
      this.notifyObservers();
    }
  }

  /** Adds messages that are not already present by Exchange ItemId. */
  addMessagesIfAbsent(msgs: Iterable<OWAEMail>): void {
    let additions: OWAEMail[] = [];
    let pendingIDs = new Set<string>();
    for (let msg of msgs) {
      let id = msg.itemID;
      if (!id) {
        additions.push(msg);
        continue;
      }
      if (pendingIDs.has(id)) {
        continue;
      }
      let existing = this.getEmailByItemID(id);
      if (!existing) {
        pendingIDs.add(id);
        additions.push(msg);
      }
    }
    if (additions.length) {
      this.messages.addAll(additions);
    }
  }

  /** Drop in-memory duplicates from earlier notification/poll races (keep first). */
  dedupeMessagesByItemID(): void {
    let seen = new Set<string>();
    let dupes: OWAEMail[] = [];
    for (let msg of this.messages) {
      let id = msg.itemID;
      if (!id) {
        continue;
      }
      if (seen.has(id)) {
        dupes.push(msg);
      } else {
        seen.add(id);
      }
    }
    if (dupes.length) {
      this.messages.removeAll(dupes);
    }
  }

  /** Serialize notification ingest with FindItem/listMessages. */
  async withListMessagesLock<T>(fn: () => Promise<T>): Promise<T> {
    let lock = await this.listMessagesLock.lock();
    try {
      return await fn();
    } finally {
      lock.release();
    }
  }

  /** RowDeleted / Hierarchy: next recent sync should full-reconcile. */
  noteServerDeletes(): void {
    this.countTotalDecreased = true;
    this.dirty = true;
  }

  async downloadMessages(emails: Collection<OWAEMail>): Promise<Collection<OWAEMail>> {
    let downloadedEmail = new ArrayColl<OWAEMail>();
    let emailsToDownload = emails.contents;
    for (let i = 0; i < emailsToDownload.length; i += kMaxFetchCount) {
      let batch = emailsToDownload.slice(i, i + kMaxFetchCount);
      batch = batch.filter((email) => !email.downloadRunOnce.running);
      try {
        let results = await this.account.callOWA(owaDownloadMsgsRequest(batch));
        let items = results.ResponseMessages ? this.account.itemsFromResponses(results.ResponseMessages.Items) : results.Items;
        for (let item of items ?? []) {
          let email = emailsToDownload.find(email => email.itemID == item?.ItemId?.Id);
          if (email && !email.downloadComplete) {
            try {
              // The message can be moved or deleted between the header fetch
              // and this download, in which case Exchange omits MimeContent.
              let mimeBase64 = sanitize.nonemptystring(item.MimeContent?.Value);
              email.mime = base64ToUint8Array(mimeBase64);
              await email.parseMIME();
              await email.saveCompleteMessage();
              downloadedEmail.add(email);
            } catch (ex) {
              this.account.errorCallback(ex);
            }
          }
        }
      } catch (ex) {
        this.account.errorCallback(ex);
      }
    }

    /*for (let email of this.messages) {
      if (!email.threadID && email.dbID) {
        await email.findThread(this.messages);
      }
    }*/

    return downloadedEmail;
  }

  /**
   * Delta sync via SyncFolderItems (same model as EWS). Falls back to FindItem
   * when the server rejects the action.
   */
  async updateChangedMessages(): Promise<ArrayColl<OWAEMail>> {
    await this.readFolder();
    let lock = await this.listMessagesLock.lock();
    try {
      let isNewMail = !!this.syncState || this.notifyNextSyncMessagesAsNew;
      let newMsgs = new ArrayColl<OWAEMail>();
      let includesLast = false;
      let syncState: string | null = typeof this.syncState == "string" ? this.syncState : null;
      // This loop holds `listMessagesLock`, and `Lock` has no timeout, so a
      // response that never reports the last item would wedge the folder for
      // the rest of the session. Bound it by page count and by a sync token
      // that stops advancing.
      for (let page = 0; !includesLast && page < kMaxSyncPages; page++) {
        let result: any;
        try {
          result = await this.account.callOWA(
            owaSyncFolderItemsRequest(this.id, syncState, kMaxFetchCount));
        } catch (ex) {
          if (ex instanceof OWAError && ex.type == "ErrorInvalidSyncStateData") {
            this.syncState = null;
            syncState = null;
            isNewMail = false;
            await this.storage.saveFolder(this);
            result = await this.account.callOWA(
              owaSyncFolderItemsRequest(this.id, null, kMaxFetchCount));
          } else {
            throw ex;
          }
        }
        let changes = result?.Changes ?? result?.Body?.Changes ?? result;
        let newMessageIDs = (await Promise.all([
          this.forEachSyncChange(changes?.ReadFlagChange, this.processSyncReadFlagChange, true),
          this.forEachSyncChange(changes?.Update, this.processSyncUpdate, false),
          this.forEachSyncChange(changes?.Create, this.processSyncUpdate, false),
        ])).flat();
        let newMsgsInIteration = await this.getNewMessageHeaders(newMessageIDs);
        for (let msg of newMsgsInIteration) {
          msg.isNewArrived = isNewMail;
        }
        this.addMessagesIfAbsent(newMsgsInIteration);
        newMsgs.addAll(newMsgsInIteration);
        await this.forEachSyncChange(changes?.Delete, this.processSyncDelete, true);
        let previousSyncState = syncState;
        syncState = sanitize.nonemptystring(result?.SyncState ?? changes?.SyncState, syncState);
        this.syncState = syncState;
        await this.storage.saveFolder(this);
        let last = result?.IncludesLastItemInRange ?? changes?.IncludesLastItemInRange;
        includesLast = last === true || last === "true";
        if (!includesLast && syncState === previousSyncState) {
          // The server did not hand out a new token, so the next request would
          // be byte-identical to this one.
          break;
        }
      }
      this.dirty = false;
      this.countTotalDecreased = false;
      this.completeInitialSync();
      return newMsgs;
    } finally {
      lock.release();
    }
  }

  protected syncChangeItem(change: any): any {
    return change?.Message ?? change?.MeetingRequest ?? change?.MeetingMessage
      ?? change?.Item ?? change;
  }

  protected async forEachSyncChange(
    changes: any,
    eachCallback: (email: OWAEMail, change: any) => Promise<void>,
    isDirectList: boolean,
  ): Promise<string[]> {
    let newIDs: string[] = [];
    for (let raw of ensureArray(changes)) {
      let change = isDirectList ? raw : this.syncChangeItem(raw);
      let id = sanitize.nonemptystring(change?.ItemId?.Id ?? change?.ItemId, "");
      if (!id || this.deletions.has(id)) {
        continue;
      }
      let email = this.getEmailByItemID(id);
      if (email) {
        await eachCallback.call(this, email, change);
      } else {
        newIDs.push(id);
      }
    }
    return newIDs;
  }

  protected async processSyncReadFlagChange(email: OWAEMail, change: any) {
    email.setFlags({ IsRead: change.IsRead }, "partial");
    await email.saveWritablePropsLocally();
  }

  protected async processSyncUpdate(email: OWAEMail, update: any) {
    if (email.setFlags(update, "list")) {
      await this.persistEmailFlags(email);
    }
  }

  protected async processSyncDelete(email: OWAEMail) {
    await email.deleteMessageLocally();
  }

  protected isSyncFolderItemsUnsupportedError(ex: unknown): boolean {
    if (!(ex instanceof OWAError)) {
      return false;
    }
    return ex.type == "ErrorInvalidRequest"
      || ex.type == "ErrorInvalidOperation"
      || /SyncFolderItems/i.test(ex.message)
      || /not supported/i.test(ex.message)
      || /не поддержива/i.test(ex.message);
  }

  /** Lists new messages and downloads them.
   *
   * Should be implemented as fast as possible (a few seconds),
   * so that the action can be repeated routinely every few minutes.
   * @param recentOnly read the first page even when folder counts are unchanged
   * @returns the new messages */
  async getNewMessages(recentOnly = false): Promise<Collection<OWAEMail>> {
    // Always hydrate from the local DB first. SyncFolderItems alone must not
    // replace the initial FindItem populate — that left shared Inboxes empty.
    await this.readFolder();
    this.dedupeMessagesByItemID();

    if (recentOnly && this.unreadBehindServer() && !this.needsFullReconcile()) {
      return this.fetchUnreadArrivals(Math.min(50, Math.max(10, this.countUnread)));
    }

    if (this.account.isDependentAccount) {
      try {
        await this.folderCountsChanged();
      } catch (ex) {
        if (!(ex instanceof OWAError && ex.isSessionLimit)) {
          this.account.errorCallback(ex);
        }
      }
    }

    // Delta sync only on primary mailbox. Shared SyncFolderItems often returns
    // success with no Creates while badges already moved — FindItem is reliable.
    let canDeltaSync = !recentOnly
      && !this.syncFolderItemsUnsupported
      && !this.account.isDependentAccount
      && !!this.id
      && typeof this.syncState == "string"
      && this.messages.hasItems;
    if (canDeltaSync) {
      try {
        let synced = await this.updateChangedMessages();
        // If counts say we are behind, do not trust an empty delta — FindItem.
        if ((!synced.hasItems && this.isBehindServer()) ||
            (this.messages.isEmpty && this.countTotal > 0)) {
          this.syncState = null;
          await this.storage.saveFolder(this);
        } else if (!this.isBehindServer()) {
          await this.downloadMessages(synced);
          return synced;
        }
      } catch (ex) {
        if (this.isSyncFolderItemsUnsupportedError(ex)) {
          this.syncFolderItemsUnsupported = true;
          console.warn("OWA SyncFolderItems unsupported; falling back to FindItem", this.name);
        } else if (ex instanceof OWAError && ex.type == "ErrorInvalidSyncStateData") {
          this.syncState = null;
          await this.storage.saveFolder(this);
        } else {
          this.account.errorCallback(ex);
        }
      }
    } else if (typeof this.syncState == "string" && this.messages.isEmpty) {
      // Bad prior sync left a token with no messages — clear it.
      this.syncState = null;
      await this.storage.saveFolder(this);
    }

    if (this.account.isDependentAccount) {
      let newMsgs = await this.listMessages(true);
      if (!newMsgs.hasItems && this.needsRecentRefresh()) {
        newMsgs = await this.listMessages(false, true);
      }
      if (recentOnly && this.needsFullReconcile()) {
        newMsgs.addAll(await this.listMessages(false, true));
        this.countTotalDecreased = false;
      } else if (recentOnly && this.isBehindServer()) {
        this.countTotalDecreased = false;
        if (!newMsgs.hasItems) {
          newMsgs.addAll(await this.listMessages(true, true));
        }
      } else if (!recentOnly && this.countTotalDecreased) {
        newMsgs.addAll(await this.listMessages(false, true));
      }
      // If the recent page still left us empty but the server reports mail,
      // force a full FindItem reconcile (shared SortOrder quirks).
      if (this.messages.isEmpty && this.countTotal > 0) {
        newMsgs = await this.listMessages(false, true);
      }
      return this.finishNewMessages(newMsgs, recentOnly);
    }
    let newMsgs = await this.listMessages(recentOnly);
    if (recentOnly && this.needsFullReconcile()) {
      newMsgs.addAll(await this.listMessages(false, true));
      this.countTotalDecreased = false;
    } else if (this.isBehindServer()) {
      this.countTotalDecreased = false;
      if (recentOnly) {
        if (!newMsgs.hasItems) {
          newMsgs.addAll(await this.listMessages(true, true));
        }
      } else {
        newMsgs = await this.listMessages(false, true);
      }
    }
    if (this.messages.isEmpty && this.countTotal > 0) {
      newMsgs = await this.listMessages(false, true);
    }
    return this.finishNewMessages(newMsgs, recentOnly);
  }

  getEmailByItemID(id: string): OWAEMail | undefined {
    if (!id) {
      return undefined;
    }
    return this.messages.find((m: OWAEMail) => m.itemID == id) as OWAEMail | undefined;
  }

  /**
   * Заполняет стрелки ответа/пересылки для строк кеша, не добавляя нестабильные
   * свойства обратно в FindItem. Обогащение выполняется необязательно: сервер,
   * отклонивший дополнительные поля GetItem, всё равно должен синхронизировать почту.
   */
  protected backfillMessageActionFlags(): void {
    let delay = this.account.isDependentAccount
      ? kActionFlagsBackfillDelaySharedMs
      : kActionFlagsBackfillDelayMs;
    this.scheduleActionFlagsBackfill(delay);
  }

  protected scheduleActionFlagsBackfill(delayMs: number): void {
    if (this.actionFlagsBackfillTimer) {
      clearTimeout(this.actionFlagsBackfillTimer);
    }
    this.actionFlagsBackfillTimer = setTimeout(() => {
      this.actionFlagsBackfillTimer = null;
      void this.runActionFlagsBackfillWhenIdle().catch(() => undefined);
    }, delayMs);
  }

  protected async runActionFlagsBackfillWhenIdle(): Promise<void> {
    if (this.actionFlagsBackfillRunning || this.listMessagesLock.haveWaiting || this.visibleMetadataRefreshPromise) {
      this.scheduleActionFlagsBackfill(this.account.isDependentAccount ? 3_000 : 1_500);
      return;
    }
    let limit = this.account.isDependentAccount
      ? kActionFlagsBackfillLimitShared
      : kActionFlagsBackfillLimit;
    let messages = this.messagesNeedingMetadataBackfill(limit);
    if (!messages.length) {
      return;
    }
    this.actionFlagsBackfillRunning = true;
    try {
      await this.refreshMessageActionFlags(messages);
    } finally {
      this.actionFlagsBackfillRunning = false;
      if (this.messagesNeedingMetadataBackfill(1).length) {
        this.scheduleActionFlagsBackfill(this.categoryBackfillRetryDelayMs());
      }
    }
  }

  protected messagesNeedingMetadataBackfill(limit: number): EMail[] {
    return this.messages.contents
      .filter(message => {
        let id = message.pID == null ? "" : String(message.pID);
        return id && !this.actionFlagsCheckedIDs.has(id);
      })
      .slice(0, limit);
  }

  protected recentMessagesNeedCategoryRefresh(): boolean {
    let now = Date.now();
    return this.messages.contents.slice(0, kRecentCategoryRefreshCount).some(message => {
      if (message.tags.hasItems) {
        return false;
      }
      let id = message.pID == null ? "" : String(message.pID);
      if (!id || this.actionFlagsCheckedIDs.has(id)) {
        return false;
      }
      let received = message.received?.getTime() ?? message.sent?.getTime() ?? 0;
      return now - received <= kRecentCategoryGraceMs;
    });
  }

  protected categoryBackfillRetryDelayMs(): number {
    return this.account.isDependentAccount
      ? kCategoryBackfillRetrySharedMs
      : kCategoryBackfillRetryMs;
  }

  protected markActionFlagsChecked(id: string | null | undefined): void {
    if (id) {
      this.actionFlagsCheckedIDs.add(id);
    }
  }

  invalidateMetadataBackfill(id: string | null | undefined): void {
    if (id) {
      this.actionFlagsCheckedIDs.delete(id);
    }
  }

  /**
   * Сохраняет флаги/метки после setFlags. saveWritableProps и save() уже
   * вызывают saveTags — отдельный saveMessageTags не нужен и падает без dbID.
   */
  protected async persistEmailFlags(email: OWAEMail): Promise<void> {
    if (!email.dbID) {
      await email.saveMetadataLocally();
    } else {
      await email.saveWritablePropsLocally();
    }
  }

  /**
   * Письма без категорий остаются в очереди backfill: Exchange-правила часто
   * проставляют категории через несколько секунд после доставки.
   */
  protected markMetadataBackfillComplete(
    id: string | null | undefined,
    item: Record<string, any> | null | undefined,
    email: OWAEMail,
  ): void {
    if (!id) {
      return;
    }
    if (owaCategoriesPresent(item)) {
      this.markActionFlagsChecked(id);
      return;
    }
    if (owaCategoriesConfirmedAbsent(item)) {
      // GetItem без Categories = «нет меток». Для свежих писем это часто временно:
      // правила Exchange проставляют категории через несколько секунд.
      if (email.tags.hasItems) {
        this.markActionFlagsChecked(id);
        return;
      }
      let received = email.received?.getTime() ?? email.sent?.getTime() ?? 0;
      if (Date.now() - received > kRecentCategoryGraceMs) {
        this.markActionFlagsChecked(id);
      }
    }
  }

  protected actionFlagItemsFromResponse(result: any): any[] {
    if (result?.ResponseMessages?.Items) {
      return this.account.itemsFromResponses(result.ResponseMessages.Items);
    }
    if (result?.Items) {
      return ensureArray(result.Items);
    }
    return [];
  }

  protected async refreshMessageActionFlags(messages: EMail[]): Promise<void> {
    let ids = [...new Set(messages
      .map(message => message.pID == null ? "" : String(message.pID))
      .filter(Boolean))];
    let changed = false;
    for (let i = 0; i < ids.length; i += kMaxFetchCount) {
      let batch = ids.slice(i, i + kMaxFetchCount);
      let items: any[] = [];
      try {
        let result = await this.account.callOWA(owaGetMessageActionFlagsRequest(batch, true));
        items = this.actionFlagItemsFromResponse(result);
      } catch {
        try {
          let result = await this.account.callOWA(owaGetMessageActionFlagsRequest(batch, false));
          items = this.actionFlagItemsFromResponse(result);
        } catch {
          continue;
        }
      }
      for (let id of batch) {
        let item = items.find(entry => sanitize.nonemptystring(entry?.ItemId?.Id ?? entry?.ItemId, "") == id);
        let email = this.getEmailByItemID(id);
        if (email && item && email.setFlags(item, "full")) {
          await this.persistEmailFlags(email);
          changed = true;
        }
        if (item && email) {
          this.markMetadataBackfillComplete(id, item, email);
        } else {
          this.markActionFlagsChecked(id);
        }
      }
    }
    if (changed) {
      this.notifyObservers();
    }
  }

  protected async moveOrCopyMessagesHere(
    action: "move" | "copy",
    messages: Collection<EMail>,
    _sameServer?: boolean,
    onProgress?: MailTransferProgressCallback,
  ) {
    // We can copy messages to and from shared folders for the main account,
    // but the messages all have to be from the same account.
    let sourceAccount = messages.first.folder.account;
    let sameServer = (sourceAccount.mainAccount ?? sourceAccount) == (this.account.mainAccount ?? this.account) &&
      messages.contents.every(msg => msg.folder.account == sourceAccount);
    if (!sameServer) {
      await super.moveOrCopyMessagesHere(action, messages, false, onProgress);
      return;
    }

    let sourceFolder = messages.first.folder;
    assert(sourceFolder, "Need source folder");
    assert(messages.contents.every(msg => msg.folder === sourceFolder), "All messages must be from the same folder");

    let hardError: Error | null = null;
    let needItemIdFix: OWAEMail[] = [];
    let completed = 0;
    for (let msg of messages) {
      let owaMsg = msg as OWAEMail;
      let oldItemID = owaMsg.itemID;
      if (action == "move" && oldItemID) {
        sourceFolder.deletions.add(oldItemID);
      }
      try {
        let newItemIDs = await this.moveOrCopyMessagesReturningIDs(action, new ArrayColl([owaMsg]));
        if (action == "move") {
          sourceFolder.messages.remove(msg);
          sourceFolder.countTotal = Math.max(0, sourceFolder.countTotal - 1);
          if (!msg.isRead) {
            sourceFolder.countUnread = Math.max(0, sourceFolder.countUnread - 1);
            this.countUnread++;
          }
          this.countTotal++;

          let newID = oldItemID ? newItemIDs.get(oldItemID) : null;
          owaMsg.isDeleted = false;
          owaMsg.folder = this;
          if (newID) {
            owaMsg.itemID = newID;
          } else {
            needItemIdFix.push(owaMsg);
          }
          // Keep through the next FindItem reconciles so sync cannot wipe a
          // just-restored message before Exchange returns it in the listing.
          this.markPreservedMoved(owaMsg);
          // A locally deleted header can retain the old completion flag even
          // though its row and MIME body are gone. Persist it as a header-only
          // message; its body will be downloaded when it is opened.
          if (owaMsg.downloadComplete && !owaMsg.dbID && !owaMsg.rawText && !owaMsg.rawHTMLDangerous) {
            owaMsg.downloadComplete = false;
          }
          await owaMsg.saveMetadataLocally();
          this.addMessagesIfAbsent([owaMsg]);
          this.notifyObservers();
        } else {
          // Copy leaves the source message untouched and creates a separate
          // item here. Queueing it for the ItemId repair would make the twin
          // search rewrite the *source*'s ItemId to the copy's and then delete
          // the copy locally. The next sync picks the new item up normally.
          this.countTotal++;
          if (!msg.isRead) {
            this.countUnread++;
          }
        }
        onProgress?.(++completed);
      } catch (ex) {
        if (ex instanceof OWAError && ex.type == "ErrorItemNotFound" && action == "move") {
          sourceFolder.messages.remove(msg);
          await msg.deleteMessageLocally().catch(() => null);
          onProgress?.(++completed);
        } else {
          hardError ??= ex instanceof Error ? ex : new Error(String(ex));
        }
      } finally {
        if (action == "move" && oldItemID && sourceFolder instanceof OWAFolder) {
          sourceFolder.releaseDeletionAfterGracePeriod(oldItemID);
        }
      }
    }
    // Never block the UI on folder sync — that felt like a hang on Restore.
    if (needItemIdFix.length) {
      this.fixMovedItemIdsInBackground(needItemIdFix);
    }
    if (hardError) {
      throw hardError;
    }
  }

  /**
   * Stop listing an ItemId that we just moved or deleted.
   *
   * Exchange's FindItem is eventually consistent, so releasing the id as soon
   * as the request returns lets the very next scan pick the item up again and
   * resurrect it. Hold it for the same window `preserveMovedUntil` uses on the
   * target side.
   */
  releaseDeletionAfterGracePeriod(itemID: string | null | undefined): void {
    if (!itemID) {
      return;
    }
    let id = itemID;
    setTimeout(() => this.deletions.delete(id), kDeletionGracePeriodMs);
  }

  protected markPreservedMoved(msg: OWAEMail): void {
    let key = String(msg.dbID ?? msg.itemID ?? "");
    if (key) {
      this.preserveMovedUntil.set(key, Date.now() + 180_000);
    }
  }

  protected shouldPreserveMoved(email: OWAEMail): boolean {
    let key = String(email.dbID ?? email.itemID ?? "");
    if (!key) {
      return false;
    }
    let until = this.preserveMovedUntil.get(key);
    if (!until) {
      return false;
    }
    if (Date.now() > until) {
      this.preserveMovedUntil.delete(key);
      return false;
    }
    return true;
  }

  /** Background: refresh target folder and rewrite ItemIds after Move without ReturnNewItemIds. */
  protected fixMovedItemIdsInBackground(optimistic: OWAEMail[]): void {
    void this.fixMovedItemIds(optimistic).catch(ex => this.account.errorCallback(ex));
  }

  /** Awaitable ItemId repair for one or more messages after Move/Restore. */
  async ensureMovedItemId(msg: OWAEMail): Promise<void> {
    await this.fixMovedItemIds([msg]);
  }

  async fixMovedItemIds(optimistic: OWAEMail[]): Promise<void> {
    if (!optimistic.length) {
      return;
    }
    // Prefer a cheap first-page FindItem over a full getNewMessages (can stall).
    let recent = await this.listMessages(true, true);
    for (let moved of optimistic) {
      let twin = this.findMovedTwin(moved, recent) ?? this.findMovedTwin(moved, this.messages);
      if (twin && twin !== moved && twin.itemID) {
        if (moved.itemID != twin.itemID) {
          moved.itemID = twin.itemID;
          await moved.saveMetadataLocally();
          this.messages.remove(twin);
          await this.storage.deleteMessage(twin).catch(() => null);
        }
        this.markPreservedMoved(moved);
        continue;
      }
      // Fallback: full delta may surface Creates
      await this.getNewMessages(true);
      twin = this.findMovedTwin(moved, this.messages);
      if (twin && twin !== moved && twin.itemID) {
        moved.itemID = twin.itemID;
        await moved.saveMetadataLocally();
        this.messages.remove(twin);
        await this.storage.deleteMessage(twin).catch(() => null);
        this.markPreservedMoved(moved);
      }
    }
  }

  protected findMovedTwin(moved: OWAEMail, pool: { contents?: OWAEMail[] } | Iterable<OWAEMail>): OWAEMail | undefined {
    let list: OWAEMail[] = (pool as any).contents
      ?? (Array.isArray(pool) ? pool : [...(pool as Iterable<OWAEMail>)]);
    if (moved.id) {
      let byMid = list.find(m => m !== moved && !!m.itemID && m.id == moved.id);
      if (byMid) {
        return byMid;
      }
    }
    let subject = (moved.subject || "").trim();
    let from = moved.from?.emailAddress?.toLowerCase() ?? "";
    let sent = moved.sent?.getTime() ?? 0;
    if (!subject && !from) {
      return undefined;
    }
    return list.find(m => {
      if (m === moved || !m.itemID) {
        return false;
      }
      if ((m.subject || "").trim() != subject) {
        return false;
      }
      if ((m.from?.emailAddress?.toLowerCase() ?? "") != from) {
        return false;
      }
      if (sent && m.sent && Math.abs(m.sent.getTime() - sent) > 2000) {
        return false;
      }
      return true;
    });
  }

  protected async moveOrCopyMessagesOnServer(action: "move" | "copy", messages: Collection<OWAEMail>) {
    await this.moveOrCopyMessagesReturningIDs(action, messages);
  }

  /**
   * One fast Move/Copy round-trip. ReturnNewItemIds often fails or stalls on
   * Exchange — we relocate locally immediately and fix ItemIds in background.
   * @returns old ItemId → new ItemId, for the messages the server reported.
   */
  protected async moveOrCopyMessagesReturningIDs(action: "move" | "copy", messages: Collection<OWAEMail>): Promise<Map<string, string>> {
    let actionVerb = sanitize.translate(action, { move: "Move", copy: "Copy" }) as "Move" | "Copy";
    let withIDs = messages.contents.filter(msg => !!msg.itemID);
    if (!withIDs.length) {
      throw new OWAError({ message: gt`This was deleted on the server` });
    }
    let sourceAccount = messages.first.folder.account;
    let results: any;
    if (sourceAccount.supportsReturnNewItemIds) {
      try {
        results = await sourceAccount.callOWA(
          owaMoveOrCopyMsgsIntoFolderRequest(actionVerb, this.id, withIDs, true));
      } catch (ex) {
        if (!isUnsupportedOptionError(ex)) {
          throw ex;
        }
        // Some shared / on-prem endpoints reject the option. Ask once, then
        // stop paying for the failed round trip on this account.
        sourceAccount.supportsReturnNewItemIds = false;
      }
    }
    if (!results) {
      results = await sourceAccount.callOWA(
        owaMoveOrCopyMsgsIntoFolderRequest(actionVerb, this.id, withIDs, false));
    }
    let responseItems = results?.ResponseMessages?.Items
      ?? (results?.ResponseClass || results?.ResponseCode ? [results] : []);
    for (let result of ensureArray(responseItems)) {
      if (result.ResponseClass == "Error") {
        throw new OWAError({ json: result });
      }
    }
    // Without ReturnNewItemIds the map is empty — callers relocate anyway.
    return this.extractMovedItemIds(withIDs, results);
  }

  protected extractMovedItemIds(withIDs: OWAEMail[], results: any): Map<string, string> {
    let responseItems = results?.ResponseMessages?.Items
      ?? (results?.ResponseClass || results?.ResponseCode ? [results] : []);
    let newIDs = new Map<string, string>();
    let index = 0;
    for (let result of ensureArray(responseItems)) {
      if (result.ResponseClass == "Error") {
        throw new OWAError({ json: result });
      }
      let oldID = withIDs[index]?.itemID;
      let items = result?.Items;
      let first = Array.isArray(items) ? items[0] : items;
      let newID = sanitize.nonemptystring(
        first?.ItemId?.Id
        ?? first?.Message?.ItemId?.Id
        ?? result?.ItemId?.Id
        ?? result?.ItemId,
        null);
      if (oldID && newID) {
        newIDs.set(oldID, newID);
      }
      index++;
    }
    return newIDs;
  }

  async addMessage(message: EMail) {
    message.mime ??= await CreateMIME.getMIME(message);
    let owaMsg = message as OWAEMail;
    let mimeB64 = await blobToBase64(new Blob([message.mime]));

    // Re-save an existing draft via UpdateItem instead of creating orphans.
    if (owaMsg.itemID && message.isDraft) {
      let update = new OWAUpdateItemRequest(owaMsg.itemID, {
        MessageDisposition: "SaveOnly",
        ConflictResolution: "AlwaysOverwrite",
        SendCalendarInvitationsOrCancellations: "SendToNone",
        SuppressReadReceipts: true,
      });
      update.addField("Message", "MimeContent",
        { CharacterSet: "UTF-8", Value: mimeB64 }, "item:MimeContent");
      if (message.tags.hasItems) {
        update.addField("Message", "Categories",
          message.tags.contents.map(tag => tag.name), "item:Categories");
      }
      await this.account.callOWA(update);
      message.folder = this;
      await message.saveMetadataLocally();
      this.addMessagesIfAbsent([owaMsg]);
      return;
    }

    let request = new OWACreateItemRequest({ SavedItemFolderId: { __type: "TargetFolderId:#Exchange", BaseFolderId: { __type: "FolderId:#Exchange", Id: this.id } }, MessageDisposition: "SaveOnly" });
    request.addField("Message", "MimeContent", { CharacterSet: "UTF-8", Value: mimeB64 });
    if (message.tags.hasItems) {
      request.addField("Message", "Categories", message.tags.contents.map(tag => tag.name));
    }
    if (!message.isDraft) {
      request.addField("Message", "ExtendedProperty", [{ ExtendedFieldURI: { PropertyTag: MessageFlagsPidTag, PropertyType: "Integer" }, Value: "0" }]);
    }
    if (message.isStarred) {
      request.addField("Message", "Flag", {
        __type: "FlagType:#Exchange",
        CompleteDate: null,
        DueDate: null,
        StartDate: null,
        FlagStatus: "Flagged",
      });
    }
    request.addField("Message", "IsRead", message.isRead);
    let result = await this.account.callOWA(request);
    let itemID = sanitize.nonemptystring(
      result?.Items?.[0]?.ItemId?.Id
      ?? result?.ItemId?.Id
      ?? result?.ResponseMessages?.Items?.[0]?.Items?.[0]?.ItemId?.Id,
      null);
    if (itemID) {
      owaMsg.itemID = itemID;
    }
    message.folder = this;
    await message.saveMetadataLocally();
    this.addMessagesIfAbsent([owaMsg]);
  }

  async moveFolderHere(folder: OWAFolder) {
    let previousParent = folder.parent;
    await super.moveFolderHere(folder);
    try {
      await this.account.callOWA(owaMoveEntireFolderRequest(folder.id, this.id));
    } catch (ex) {
      if (folder.parent) {
        folder.parent.subFolders.remove(folder);
      } else {
        this.account.rootFolders.remove(folder);
      }
      folder.parent = previousParent;
      if (previousParent) {
        previousParent.subFolders.add(folder);
      } else {
        this.account.rootFolders.add(folder);
      }
      throw ex;
    }
    await folder.save();
  }

  async createSubFolder(name: string): Promise<OWAFolder> {
    let folder = await super.createSubFolder(name) as OWAFolder;
    try {
      let result = await this.account.callOWA(owaCreateNewSubFolderRequest(name, this.id));
      let folderID = sanitize.nonemptystring(result.Folders[0].FolderId.Id);
      let existing = this.account.folderMap.get(folderID)
        ?? (this.account.findFolder(candidate => candidate.id == folderID) as OWAFolder | null);
      if (existing && existing != folder) {
        this.subFolders.remove(folder);
        folder.parent = null;
        return existing;
      }
      folder.id = folderID;
      this.account.folderMap.set(folderID, folder);
      return folder;
    } catch (ex) {
      this.subFolders.remove(folder);
      folder.parent = null;
      throw ex;
    }
  }

  async rename(name: string) {
    await super.rename(name);
    await this.account.callOWA(owaRenameFolderRequest(name, this.id));
  }

  protected async deleteItOnServer() {
    await this.account.callOWA(owaDeleteFolderRequest(this.id));
  }

  async markAllRead() {
    await super.markAllRead();
    await this.account.callOWA(owaFolderMarkAllMsgsReadRequest(this.id, true));
  }

  async markAllUnread() {
    await super.markAllUnread();
    await this.account.callOWA(owaFolderMarkAllMsgsReadRequest(this.id, false));
  }

  async getSharedPersons(): Promise<ArrayColl<PersonUID>> {
    let result = await this.account.callOWA(owaGetPermissionsRequest(this.id));
    return getSharedPersons(result.Folders[0].PermissionSet.Permissions, this.account.emailAddress);
  }

  async getPermissions(): Promise<ExchangePermission[]> {
    let result = await this.account.callOWA(owaGetPermissionsRequest(this.id));
    return result.Folders[0].PermissionSet.Permissions.map(permission => new ExchangePermission(permission));
  }

  async setPermissions(permissions: ExchangePermission[]) {
    await this.account.callOWA(owaSetFolderPermissionsRequest(this.id, permissions));
  }
}
