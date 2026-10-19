import { writable } from "svelte/store";
import type { EMail } from "../../logic/Mail/EMail";
import { SpecialFolder, type Folder } from "../../logic/Mail/Folder";
import { DeleteStrategy } from "../../logic/Mail/MailAccount";
import { openEMailMessage } from "./open";
import { throwFirstBulkActionError, uniqueMailMessages } from "./mailBulkActions";
import { gt } from "../../l10n/l10n";
import { UserError } from "../../logic/util/util";
import { ArrayColl } from "svelte-collections";

type DeletedEntry = {
  message: EMail;
  sourceFolder: Folder;
};

export type MailUndoToastState = {
  id: number;
  label: string;
  undo: () => Promise<void>;
};

export const mailUndoToast = writable<MailUndoToastState | null>(null);

let toastCounter = 0;
let dismissTimer: ReturnType<typeof setTimeout> | null = null;

/** Группирует удаление по исходным папкам, чтобы протокол мог отправить batch-запрос. */
async function deleteMailMessages(messages: readonly EMail[], strategy?: DeleteStrategy): Promise<void> {
  let byFolder = new Map<Folder, EMail[]>();
  for (let message of uniqueMailMessages(messages)) {
    let folder = message.folder;
    if (!folder) {
      continue;
    }
    let folderMessages = byFolder.get(folder);
    if (!folderMessages) {
      folderMessages = [];
      byFolder.set(folder, folderMessages);
    }
    folderMessages.push(message);
  }
  let results = await Promise.allSettled([...byFolder].map(([folder, folderMessages]) =>
    folder.deleteMessages(new ArrayColl(folderMessages), strategy)));
  throwFirstBulkActionError(results);
}

/** Soft-delete with a bottom toast offering undo (move back from Trash). */
export async function deleteMessagesWithUndo(
  messages: readonly EMail[],
  beforeDelete?: () => void,
): Promise<void> {
  let list = messages.filter(m => !!m?.folder);
  if (!list.length) {
    return;
  }
  let entries: DeletedEntry[] = list.map(message => ({
    message,
    sourceFolder: message.folder,
  }));
  beforeDelete?.();
  await deleteMailMessages(list);
  // При немедленном удалении копии в Корзине нет — отменять нечего
  // (`deleteStrategy` есть только у протоколов, где её можно настроить)
  if (entries.every(entry => (entry.sourceFolder.account as { deleteStrategy?: DeleteStrategy })
    ?.deleteStrategy == DeleteStrategy.DeleteImmediately)) {
    return;
  }
  showDeleteUndoToast(entries);
}

/** Индекс копий в Корзине по Message-ID; каждую копию можно выдать только один раз. */
class TrashCopyIndex {
  protected byMessageID: Map<string, EMail[]> | null = null;
  protected taken = new Set<EMail>();
  protected synced = false;

  constructor(protected readonly trash: Folder) {
  }

  take(message: EMail): EMail | null {
    if (!this.byMessageID) {
      this.byMessageID = new Map();
      for (let candidate of this.trash.messages.contents) {
        if (candidate.isDeleted || !candidate.messageID) {
          continue;
        }
        let copies = this.byMessageID.get(candidate.messageID);
        if (!copies) {
          copies = [];
          this.byMessageID.set(candidate.messageID, copies);
        }
        copies.push(candidate);
      }
    }
    let copy = this.byMessageID.get(message.messageID)?.find(candidate =>
      candidate !== message && !this.taken.has(candidate)) ?? null;
    if (copy) {
      this.taken.add(copy);
    }
    return copy;
  }

  /** Синхронизирует Корзину не больше одного раза за отмену. */
  async syncOnce(): Promise<boolean> {
    if (this.synced) {
      return false;
    }
    this.synced = true;
    await this.trash.fetchNewMailQuick();
    this.byMessageID = null;
    return true;
  }
}

/**
 * Находит письма, которые удаление перенесло в Корзину.
 * OWA переносит сам объект (меняет `message.folder`), а IMAP, EWS, JMAP и Graph
 * создают в Корзине новую копию с другим ID — её ищем по Message-ID.
 * Каждая Корзина синхронизируется не больше одного раза, даже для сотен писем.
 */
async function findDeletedMessages(entries: readonly DeletedEntry[]): Promise<(EMail | null)[]> {
  let found: (EMail | null)[] = entries.map(() => null);
  let indexes = new Map<Folder, TrashCopyIndex>();
  let pending: { position: number, index: TrashCopyIndex }[] = [];
  entries.forEach((entry, position) => {
    let message = entry.message;
    if (message.folder && message.folder !== entry.sourceFolder) {
      found[position] = message;
      return;
    }
    let trash = entry.sourceFolder.account?.getSpecialFolder(SpecialFolder.Trash);
    if (!trash || trash === entry.sourceFolder || !message.messageID) {
      return;
    }
    let index = indexes.get(trash);
    if (!index) {
      index = new TrashCopyIndex(trash);
      indexes.set(trash, index);
    }
    found[position] = index.take(message);
    if (!found[position]) {
      pending.push({ position, index });
    }
  });
  if (!pending.length) {
    return found;
  }
  await Promise.all([...new Set(pending.map(item => item.index))].map(index => index.syncOnce()));
  for (let { position, index } of pending) {
    found[position] = index.take(entries[position].message);
  }
  return found;
}

/**
 * Возвращает письма группами: одна пачка на пару «папка назначения + текущая папка»,
 * так как `moveMessagesHere()` требует общую исходную папку.
 * @returns последнее (в порядке удаления) восстановленное письмо
 */
async function restoreDeletedMessages(entries: readonly DeletedEntry[], found: readonly (EMail | null)[]): Promise<EMail | null> {
  let groups = new Map<Folder, Map<Folder, EMail[]>>();
  let seen = new Set<EMail>();
  let last: EMail | null = null;
  entries.forEach((entry, position) => {
    let message = found[position];
    if (!message?.folder || seen.has(message)) {
      return;
    }
    seen.add(message);
    let bySource = groups.get(entry.sourceFolder);
    if (!bySource) {
      bySource = new Map();
      groups.set(entry.sourceFolder, bySource);
    }
    let group = bySource.get(message.folder);
    if (!group) {
      group = [];
      bySource.set(message.folder, group);
    }
    group.push(message);
    last = message;
  });
  let moves: Promise<void>[] = [];
  for (let [targetFolder, bySource] of groups) {
    for (let group of bySource.values()) {
      moves.push(targetFolder.moveMessagesHere(new ArrayColl(group)));
    }
  }
  throwFirstBulkActionError(await Promise.allSettled(moves));
  return last;
}

function showDeleteUndoToast(entries: DeletedEntry[]) {
  if (dismissTimer) {
    clearTimeout(dismissTimer);
    dismissTimer = null;
  }
  let id = ++toastCounter;
  let label = entries.length == 1
    ? gt`Deleted`
    : gt`Deleted ${entries.length} messages`;
  mailUndoToast.set({
    id,
    label,
    undo: async () => {
      let notFound = 0;
      try {
        let found = await findDeletedMessages(entries);
        notFound = found.filter(message => !message).length;
        let last = await restoreDeletedMessages(entries, found);
        if (last) {
          await openEMailMessage(last);
        }
      } finally {
        mailUndoToast.update(state => state?.id == id ? null : state);
      }
      if (notFound) {
        throw new UserError(gt`Could not restore the deleted message from Trash. Open Trash and move it back manually.`);
      }
    },
  });
  dismissTimer = setTimeout(() => {
    mailUndoToast.update(state => state?.id == id ? null : state);
    dismissTimer = null;
  }, 8000);
}

/** Permanent delete from Trash/Spam — no undo toast. */
export async function deleteMessagesPermanent(messages: readonly EMail[], beforeDelete?: () => void): Promise<void> {
  let list = messages.filter(m => !!m?.folder);
  if (!list.length) {
    return;
  }
  beforeDelete?.();
  await deleteMailMessages(list, DeleteStrategy.DeleteImmediately);
}

export function deleteMessagesFromUI(messages: readonly EMail[], beforeDelete?: () => void): Promise<void> {
  let list = messages.filter(m => !!m?.folder);
  if (!list.length) {
    return Promise.resolve();
  }
  let inTrashOrSpam = list.every(m =>
    m.folder.specialFolder == SpecialFolder.Trash ||
    m.folder.specialFolder == SpecialFolder.Spam);
  if (inTrashOrSpam) {
    return deleteMessagesPermanent(list, beforeDelete);
  }
  return deleteMessagesWithUndo(list, beforeDelete);
}
