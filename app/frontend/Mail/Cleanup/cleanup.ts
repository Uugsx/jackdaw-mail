import type { EMail } from "../../../logic/Mail/EMail";
import type { Folder } from "../../../logic/Mail/Folder";
import {
  conversationOf, findRedundantMessages, folderMessagesForCleanup, loadBodiesForCleanup,
} from "../../../logic/Mail/Cleanup/ConversationCleanup";
import { showConfirmDialog } from "../../Shared/askConfirm";
import { gt } from "../../../l10n/l10n";
import { ArrayColl } from "svelte-collections";

const kShownSubjects = 5;

/** «Очистка»: находит лишние письма, спрашивает и удаляет их (в «Удалённые»). Возвращает число удалённых. */
async function cleanUp(messages: EMail[]): Promise<number> {
  let loaded = await loadBodiesForCleanup(messages);
  let redundant = findRedundantMessages(loaded).map(candidate => candidate.email);
  if (!redundant.length) {
    await showConfirmDialog({
      title: gt`Nothing to clean up`,
      message: gt`Every message has text that is not quoted in a later reply. Unread, flagged and categorized messages are always kept.`,
      confirmLabel: gt`OK`,
      showCancel: false,
    });
    return 0;
  }
  let subjects = redundant.slice(0, kShownSubjects).map(email => "• " + (email.subject || gt`(no subject)`)).join("\n");
  let more = redundant.length > kShownSubjects ? "\n" + gt`… and ${redundant.length - kShownSubjects} more` : "";
  let choice = await showConfirmDialog({
    title: gt`Delete ${redundant.length} redundant messages?`,
    message: gt`Their whole text is quoted in later replies:` + "\n" + subjects + more,
    confirmLabel: gt`Delete`,
  });
  if (choice != "confirm") {
    return 0;
  }
  let byFolder = new Map<Folder, EMail[]>();
  for (let email of redundant) {
    byFolder.set(email.folder, [...(byFolder.get(email.folder) ?? []), email]);
  }
  for (let [folder, list] of byFolder) {
    await folder.deleteMessages(new ArrayColl(list));
  }
  return redundant.length;
}

export async function cleanUpConversation(email: EMail): Promise<number> {
  return await cleanUp(conversationOf(email));
}

export async function cleanUpFolder(folder: Folder): Promise<number> {
  return await cleanUp(folderMessagesForCleanup(folder.messages.contents));
}
