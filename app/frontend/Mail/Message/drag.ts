import type { EMail } from "../../../logic/Mail/EMail";
import type { Folder } from "../../../logic/Mail/Folder";
import { selectedMessage, selectedMessages } from "../Selected";
import { appGlobal } from "../../../logic/app";
import { ArrayColl } from "svelte-collections";
import { get } from "svelte/store";
import { showError } from "../../Util/error";
import { gt } from "../../../l10n/l10n";

const kDragMIME = "message/drag-ids";

/** Stable drag key: Message-ID alone is empty/duplicate for many Exchange mails. */
function dragKey(msg: EMail): string {
  let accountID = msg.folder?.account?.id ?? "";
  let folderID = msg.folder?.id ?? "";
  let pid = msg.pID != null ? String(msg.pID) : "";
  if (accountID && folderID && pid) {
    return `${accountID}\t${folderID}\t${pid}`;
  }
  // Fallback for protocols without pID yet
  return `${accountID}\t${folderID}\tmsgid:${msg.id || ""}`;
}

function selectionColl(): ArrayColl<EMail> {
  let messages = get(selectedMessages);
  if (!messages) {
    messages = new ArrayColl<EMail>();
    selectedMessages.set(messages);
  }
  return messages;
}

/** The source folders named by the drag keys. */
function sourceFoldersForKeys(keys: string[]): Folder[] {
  let wanted = new Set(keys.map(key => key.split("\t").slice(0, 2).join("\t")));
  let folders: Folder[] = [];
  for (let account of appGlobal.emailAccounts) {
    for (let folder of account.getAllFolders()) {
      if (wanted.has(`${folder.account?.id ?? ""}\t${folder.id ?? ""}`)) {
        folders.push(folder);
      }
    }
  }
  return folders;
}

/** Find emails by drag keys. */
function resolveMessagesByKeys(keys: string[]): EMail[] {
  let wanted = new Set(keys);
  let found: EMail[] = [];
  let collect = (msg: EMail) => {
    let key = dragKey(msg);
    if (wanted.has(key)) {
      found.push(msg);
      wanted.delete(key);
    }
  };
  for (let msg of selectionColl().contents) {
    collect(msg);
  }
  // The key encodes the account and folder, so look only there rather than
  // walking every message of every folder - inboxes here hold tens of
  // thousands of messages and that scan froze the UI on each drop.
  for (let folder of wanted.size ? sourceFoldersForKeys([...wanted]) : []) {
    for (let msg of folder.messages) {
      collect(msg);
      if (!wanted.size) {
        return found;
      }
    }
  }
  return found;
}

export function onDragStartMail(event: DragEvent, message: EMail) {
  if (!event.dataTransfer) {
    return;
  }
  let messages = selectionColl();
  // Dragging a row that isn't in the multi-selection → move only that message
  if (!messages.contains(message)) {
    messages.clear();
    messages.add(message);
  }
  selectedMessage.set(message);

  let ids = messages.contents.map(msg => dragKey(msg)).join("\n");
  // Custom type for our drop handler; text/plain as Electron/Chromium fallback
  event.dataTransfer.setData(kDragMIME, ids);
  event.dataTransfer.setData("text/plain", ids);
  event.dataTransfer.effectAllowed = "copyMove";
  if (messages.length == 1) {
    addDesktopDownload(event, message);
  }
}

/**
 * Перетаскивание письма на рабочий стол или в папку Finder/Проводника: Chromium
 * сохраняет файл .eml по `DownloadURL`. MIME нужен сразу, во время dragstart,
 * поэтому если письмо ещё не загружено, начинаем загрузку и в этот раз
 * перетаскиваем только внутри приложения.
 */
export function addDesktopDownload(event: DragEvent, message: EMail): boolean {
  if (!message.mime?.length) {
    message.loadMIME().catch(() => undefined);
    return false;
  }
  let filename = emlFilename(message.subject);
  let url = URL.createObjectURL(new Blob([message.mime], { type: "message/rfc822" }));
  event.dataTransfer.setData("DownloadURL", `message/rfc822:${filename}:${url}`);
  // Сохранение идёт уже после отпускания: ссылку освобождаем позже
  (event.target as EventTarget)?.addEventListener?.("dragend", () =>
    setTimeout(() => URL.revokeObjectURL(url), kRevokeDownloadMS), { once: true });
  return true;
}

const kRevokeDownloadMS = 60 * 1000;

/** Имя файла по теме: без `:` (разделитель в DownloadURL) и запрещённых в Windows символов */
export function emlFilename(subject: string | null | undefined): string {
  let name = (subject ?? "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  return (name || "email") + ".eml";
}

export async function onDropMail(event: DragEvent, folder: Folder) {
  event.preventDefault();
  event.stopPropagation();
  let msgIDsStr = event.dataTransfer?.getData(kDragMIME)
    || event.dataTransfer?.getData("text/plain")
    || "";
  let msgIDs = msgIDsStr.split("\n").map(s => s.trim()).filter(Boolean);
  if (!msgIDs.length) {
    return;
  }
  let messages = resolveMessagesByKeys(msgIDs);
  // Report rather than silently doing nothing: a drop that visibly lands on a
  // folder and then has no effect reads as data loss.
  if (!messages.length) {
    showError(new Error(gt`Could not find the messages that were dragged`));
    return;
  }
  if (messages.every(msg => msg.folder == folder)) {
    return;
  }
  // Move/copy requires a single source folder
  let sourceFolder = messages[0].folder;
  if (!messages.every(msg => msg.folder === sourceFolder)) {
    showError(new Error(gt`Please drag messages from only one folder at a time`));
    return;
  }
  let coll = new ArrayColl(messages);
  try {
    if (event.ctrlKey || event.metaKey) {
      await folder.copyMessagesHere(coll);
    } else {
      await folder.moveMessagesHere(coll);
    }
  } catch (ex) {
    // Drop handlers are wired up as `on:drop={...}`, so nothing awaits this.
    showError(ex as Error);
  }
}

export function onDragOverMail(event: DragEvent, folder: Folder) {
  event.preventDefault();
  event.stopPropagation();
  if (!event.dataTransfer) {
    return;
  }
  // Must set dropEffect or some engines refuse the drop
  event.dataTransfer.dropEffect = (event.ctrlKey || event.metaKey) ? "copy" : "move";
}
