import { DeleteStrategy } from "../../../logic/Mail/MailAccount";
import { deleteMessagesFromUI } from "../mailDeleteUndo";
import { runMailActions } from "../mailBulkActions";
import { moveMessagesToArchive } from "../mailArchiveActions";
import type { EMail } from "../../../logic/Mail/EMail";
import { selectedMessage, selectedMessages, listVisibleMessages } from "../Selected";
import { openComposer } from "../open";
import { markMessagesRead } from "../mailReadActions";
import { get } from "svelte/store";
import { isMailPaneFocused } from "../../MainWindow/paneFocus";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  return !!target.closest("input, textarea, select, [contenteditable=true]");
}

function isInsideFastList(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  return !!target.closest(".fast-list");
}

function selectAllVisibleMessages(event: KeyboardEvent): boolean {
  if (!((event.ctrlKey || event.metaKey) && event.key == "a" && !event.shiftKey && !event.altKey)) {
    return false;
  }
  if (isEditableTarget(event.target) || isInsideFastList(event.target)) {
    return false;
  }
  let visible = get(listVisibleMessages);
  if (!visible?.hasItems) {
    return false;
  }
  event.preventDefault();
  event.stopPropagation();
  let coll = get(selectedMessages);
  coll.replaceAll(visible.contents);
  if (visible.first) {
    selectedMessage.set(visible.first);
  }
  return true;
}

export async function onKeyOnList(event: KeyboardEvent) {
  if (event.defaultPrevented || !isMailPaneFocused()) {
    return;
  }
  if (isEditableTarget(event.target)) {
    return;
  }
  if (selectAllVisibleMessages(event)) {
    return;
  }
  let selectedMessagesColl = get(selectedMessages);
  /** Important to use normal static array here. If were were to use `selectedMessages` Collection,
   * it would observe changes to selection even in the future and keep triggering
   * the action for all future selections. */
  let messages = selectedMessagesColl?.contents;
  if (!messages?.length) {
    return;
  }
  let message = get(selectedMessage) ?? messages[0];

  function goToNextMessage(previous = false, from: EMail = message) {
    let next = from?.nextMessage(previous) ?? null;
    selectedMessagesColl.clear();
    if (next) {
      selectedMessagesColl.add(next);
    }
    selectedMessage.set(next);
  }

  function consume(event: KeyboardEvent) {
    event.preventDefault();
    event.stopPropagation();
  }

  // No modifier
  if (!event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
    if (event.key == "m") { // Thunderbird
      consume(event);
      let isRead = majority(messages, msg => msg.isRead);
      await markMessagesRead(messages, !isRead);
      return;
    } else if (event.key == "s" || event.key == "Insert") { // s: Thunderbird, Insert: Outlook
      consume(event);
      let isStarred = majority(messages, msg => msg.isStarred);
      await runMailActions(messages, msg => msg.markStarred(!isStarred));
      return;
    } else if (event.key == "i") {
      consume(event);
      let isImportant = majority(messages, msg => msg.isImportant);
      await runMailActions(messages, msg => msg.markImportant(!isImportant));
      return;
    } else if (event.key == "j") { // Thunderbird
      consume(event);
      goToNextMessage();
      await runMailActions(messages, msg => msg.treatSpam());
      return;
    } else if (event.key == "a") { // Archive
      consume(event);
      goToNextMessage();
      await moveMessagesToArchive(messages);
      return;
    } else if (event.key == "Delete" || event.key == "Backspace") {
      consume(event);
      goToNextMessage();
      await deleteMessagesFromUI(messages);
      return;
    } else if (event.key == "f") { // Thunderbird
      consume(event);
      goToNextMessage();
      return;
    } else if (event.key == "b") { // Thunderbird
      consume(event);
      goToNextMessage(true);
      return;
    } else if (event.key == "F5" || event.key == "F9") { // F5: Thunderbird, F9: Outlook
      consume(event);
      await message.folder.fetchNewMailQuick();
      return;
    }
  }
  // Ctrl+ (or Cmd+)
  if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) {
    if (event.key == "r") { // Thunderbird
      consume(event);
      openComposer(message.compose.replyToAuthor());
      return;
    } else if (event.key == "l") { // Thunderbird
      consume(event);
      openComposer(await message.compose.forward());
      return;
    } else if (event.key == "u") { // Outlook
      consume(event);
      await markMessagesRead(messages, false);
      return;
    } else if (event.key == "q" && event.ctrlKey && !event.metaKey) { // Outlook; Cmd+Q — системное завершение работы macOS
      consume(event);
      await markMessagesRead(messages, true);
      return;
    } else if (event.key == "m") { // Outlook
      consume(event);
      await message.folder.fetchNewMailQuick();
      return;
    } else if (event.key == "n") { // Thunderbird
      consume(event);
      openComposer(message.folder.account.newEMailFrom());
      return;
    } else if (event.key == "e") { // Thunderbird
      consume(event);
      openComposer(await message.compose.editAsNew());
      return;
    }
  }
  // Ctrl+Shift+
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey) {
    if (event.key == "R") { // Thunderbird
      consume(event);
      await message.loadForDisplay();
      openComposer(message.compose.replyAll());
      return;
    } else if (event.key == "L") { // Thunderbird
      consume(event);
      openComposer(await message.compose.forwardAsAttachment());
      return;
    } else if (event.key == "N") { // Jackdaw
      consume(event);
      openComposer(message.compose.newToAll());
      return;
    }
  }
  // Shift+
  if (event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
    if (event.key == "J") { // Thunderbird
      consume(event);
      await runMailActions(messages, msg => msg.treatSpam(false));
      return;
    } else if (event.key == "Delete" || event.key == "Backspace") { // Thunderbird
      consume(event);
      goToNextMessage();
      await runMailActions(messages, msg => msg.deleteMessage(DeleteStrategy.DeleteImmediately));
      return;
    }
  }
}

export async function onKeyOnMessage(event: KeyboardEvent, onZoomKey?: (event: KeyboardEvent) => boolean) {
  if (onZoomKey?.(event)) {
    return;
  }
  if (!isMailPaneFocused()) {
    return;
  }
  await onKeyOnList(event);

  let message = get(selectedMessage);
  let selectedMessagesColl = get(selectedMessages);
  if (!event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
    if (event.key == "ArrowDown" || event.key == "ArrowUp") {
      if (!message) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      let next = message.nextMessage(event.key == "ArrowUp");
      if (!next) {
        return;
      }
      selectedMessagesColl.clear();
      selectedMessagesColl.add(next);
      selectedMessage.set(next);
      return;
    }
    // Message shortcuts already work just with `onKeyOnList()`
  }
}

function majority<T>(array: Array<T>, condition: (item: T) => boolean): boolean {
  return array.filter(condition).length / array.length > 0.5;
}


/**
 * Electron InputEvent uses shift / control / alt / meta, but
 * KeyboardEvent init needs shiftKey / ctrlKey / altKey / metaKey.
 * Generic utility function
 * @see https://www.electronjs.org/docs/latest/api/web-contents#event-before-input-event
 * @see https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent
 */
export function newElectronKeyboardEvent(event: any) {
  return new KeyboardEvent("keydown", {
    key: event.key,
    code: event.code,
    repeat: event.isAutoRepeat,
    isComposing: event.isComposing,
    shiftKey: event.shift,
    ctrlKey: event.control,
    altKey: event.alt,
    metaKey: event.meta,
    location: event.location,
  });
}
