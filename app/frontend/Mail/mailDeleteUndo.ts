import { writable } from "svelte/store";
import type { EMail } from "../../logic/Mail/EMail";
import { SpecialFolder, type Folder } from "../../logic/Mail/Folder";
import { DeleteStrategy } from "../../logic/Mail/MailAccount";
import { openEMailMessage } from "./open";
import { throwFirstBulkActionError, uniqueMailMessages } from "./mailBulkActions";
import { gt } from "../../l10n/l10n";
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
  showDeleteUndoToast(entries);
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
      let last: EMail | null = null;
      for (let entry of entries) {
        let message = entry.message;
        if (!message.folder || message.folder === entry.sourceFolder) {
          continue;
        }
        await entry.sourceFolder.moveMessageHere(message);
        last = message;
      }
      if (last) {
        await openEMailMessage(last);
      }
      mailUndoToast.update(state => state?.id == id ? null : state);
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
