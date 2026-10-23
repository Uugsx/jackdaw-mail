import type { MailAccount } from "../../../../logic/Mail/MailAccount";
import { SpecialFolder, type Folder } from "../../../../logic/Mail/Folder";
import type { InboxRuleFolder } from "../../../../logic/Mail/EWS/InboxRules";

/** Папка для выпадающего списка в правиле */
export interface FolderChoice {
  /** ID папки на сервере */
  key: string;
  /** Имя с отступом по вложенности */
  label: string;
}

/** Стандартные папки Exchange (`DistinguishedFolderId`) → наши особые папки */
const kDistinguishedFolders: Record<string, SpecialFolder> = {
  inbox: SpecialFolder.Inbox,
  deleteditems: SpecialFolder.Trash,
  junkemail: SpecialFolder.Spam,
  drafts: SpecialFolder.Drafts,
  sentitems: SpecialFolder.Sent,
  archive: SpecialFolder.Archive,
  outbox: SpecialFolder.Outbox,
};

function depthOf(folder: Folder): number {
  let depth = 0;
  for (let parent = folder.parent; parent; parent = parent.parent) {
    depth++;
  }
  return depth;
}

export function folderChoicesFor(account: MailAccount): FolderChoice[] {
  let choices: FolderChoice[] = [];
  let add = (folders: Iterable<Folder>) => {
    for (let folder of folders) {
      if (folder.id) {
        choices.push({ key: folder.id, label: " ".repeat(depthOf(folder)) + folder.name });
      }
      add(folder.subFolders);
    }
  };
  add(account.rootFolders);
  return choices;
}

export function findRuleFolder(account: MailAccount, folder: InboxRuleFolder): Folder | null {
  if (folder.distinguishedId) {
    let special = kDistinguishedFolders[folder.distinguishedId.toLowerCase()];
    return special ? account.findFolder(entry => entry.specialFolder == special) : null;
  }
  return account.findFolder(entry => entry.id == folder.id);
}

export function folderNameFor(account: MailAccount, folder: InboxRuleFolder): string | null {
  return findRuleFolder(account, folder)?.name ?? null;
}

/** Ключ для списка папок; папку, которой у нас нет, помечаем отдельно, чтобы не потерять */
export function folderKeyFor(account: MailAccount, folder: InboxRuleFolder | null): string {
  if (!folder) {
    return "";
  }
  return findRuleFolder(account, folder)?.id ?? "server:" + (folder.distinguishedId ?? folder.id);
}
