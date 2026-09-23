import { ArrayColl } from "svelte-collections";
import { gt } from "../../l10n/l10n";
import type { MailAccount } from "../../logic/Mail/MailAccount";
import { SpecialFolder, type Folder } from "../../logic/Mail/Folder";
import type { EMail } from "../../logic/Mail/EMail";
import { throwFirstBulkActionError, uniqueMailMessages } from "./mailBulkActions";

/** Архивирует сообщения пакетно, не создавая архивную папку несколько раз. */
export async function moveMessagesToArchive(
  messages: readonly EMail[],
  onProgress?: (completed: number) => void,
): Promise<void> {
  let uniqueMessages = uniqueMailMessages(messages);
  if (!uniqueMessages.length) {
    return;
  }

  let archiveByAccount = new Map<MailAccount, Promise<Folder>>();
  let resolved = await Promise.all(uniqueMessages.map(async message => ({
    message,
    archive: await getArchiveFolder(message.folder.account, archiveByAccount),
  })));
  let groups = new Map<Folder, { target: Folder; messages: EMail[] }>();
  for (let { message, archive } of resolved) {
    let source = message.folder;
    let group = groups.get(source);
    if (!group) {
      group = { target: archive, messages: [] };
      groups.set(source, group);
    }
    group.messages.push(message);
  }

  let progressByGroup = new Map<Folder, number>();
  let results = await Promise.allSettled([...groups.entries()].map(([source, group]) =>
    group.target.moveMessagesHere(new ArrayColl(group.messages), completed => {
      let previous = progressByGroup.get(source) ?? 0;
      if (completed <= previous) {
        return;
      }
      progressByGroup.set(source, completed);
      onProgress?.([...progressByGroup.values()].reduce((total, value) => total + value, 0));
    })));
  throwFirstBulkActionError(results);
}

function getArchiveFolder(
  account: MailAccount,
  archiveByAccount: Map<MailAccount, Promise<Folder>>,
): Promise<Folder> {
  let existing = archiveByAccount.get(account);
  if (existing) {
    return existing;
  }
  let archive = account.findSpecialFolder(SpecialFolder.Archive);
  let folderPromise = archive
    ? Promise.resolve(archive)
    : account.inbox.createSubFolder(gt`Archive`).then(folder => {
      folder.specialFolder = SpecialFolder.Archive;
      return folder;
    });
  archiveByAccount.set(account, folderPromise);
  return folderPromise;
}
