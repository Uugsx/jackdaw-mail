import { gt } from "../../l10n/l10n";
import type { KeyboardShortcut } from "./KeyboardShortcuts";

export type ConfigurableKeyboardActionId =
  | "mail.toggleRead"
  | "mail.markRead"
  | "mail.markUnread"
  | "mail.toggleStar"
  | "mail.toggleImportant"
  | "mail.markSpam"
  | "mail.markNotSpam"
  | "mail.archive"
  | "mail.delete"
  | "mail.permanentDelete"
  | "mail.nextMessage"
  | "mail.previousMessage"
  | "mail.refresh"
  | "mail.reply"
  | "mail.replyAll"
  | "mail.forward"
  | "mail.forwardAsAttachment"
  | "mail.newEmail"
  | "mail.editAsNew"
  | "mail.newToAll"
  | "mail.selectAll"
  | "mail.openSelected";

export type ConfigurableKeyboardAction = {
  id: ConfigurableKeyboardActionId;
  group: string;
  label: string;
  defaultShortcut?: KeyboardShortcut;
};

function shortcut(
  code: string,
  key: string,
  modifiers: Partial<Pick<KeyboardShortcut, "ctrl" | "alt" | "shift" | "meta">> = {},
): KeyboardShortcut {
  return {
    kind: "keyboard",
    code,
    key,
    ctrl: modifiers.ctrl ?? false,
    alt: modifiers.alt ?? false,
    shift: modifiers.shift ?? false,
    meta: modifiers.meta ?? false,
  };
}

const mailGroup = gt`Mail`;

export const configurableKeyboardActions: readonly ConfigurableKeyboardAction[] = [
  { id: "mail.toggleRead", group: mailGroup, label: gt`Toggle read status`, defaultShortcut: shortcut("KeyM", "m") },
  { id: "mail.markRead", group: mailGroup, label: gt`Mark as read`, defaultShortcut: shortcut("KeyQ", "q", { ctrl: true }) },
  { id: "mail.markUnread", group: mailGroup, label: gt`Mark as unread`, defaultShortcut: shortcut("KeyU", "u", { ctrl: true }) },
  { id: "mail.toggleStar", group: mailGroup, label: gt`Toggle flag`, defaultShortcut: shortcut("KeyS", "s") },
  { id: "mail.toggleImportant", group: mailGroup, label: gt`Toggle importance`, defaultShortcut: shortcut("KeyI", "i") },
  { id: "mail.markSpam", group: mailGroup, label: gt`Mark as spam`, defaultShortcut: shortcut("KeyJ", "j") },
  { id: "mail.markNotSpam", group: mailGroup, label: gt`Mark as not spam`, defaultShortcut: shortcut("KeyJ", "j", { shift: true }) },
  { id: "mail.archive", group: mailGroup, label: gt`Archive`, defaultShortcut: shortcut("KeyA", "a") },
  { id: "mail.delete", group: mailGroup, label: gt`Delete`, defaultShortcut: shortcut("Delete", "Delete") },
  { id: "mail.permanentDelete", group: mailGroup, label: gt`Delete permanently`, defaultShortcut: shortcut("Delete", "Delete", { shift: true }) },
  { id: "mail.nextMessage", group: mailGroup, label: gt`Next message`, defaultShortcut: shortcut("KeyF", "f") },
  { id: "mail.previousMessage", group: mailGroup, label: gt`Previous message`, defaultShortcut: shortcut("KeyB", "b") },
  { id: "mail.refresh", group: mailGroup, label: gt`Get new mail`, defaultShortcut: shortcut("F5", "F5") },
  { id: "mail.reply", group: mailGroup, label: gt`Reply`, defaultShortcut: shortcut("KeyR", "r", { ctrl: true }) },
  { id: "mail.replyAll", group: mailGroup, label: gt`Reply all`, defaultShortcut: shortcut("KeyR", "R", { ctrl: true, shift: true }) },
  { id: "mail.forward", group: mailGroup, label: gt`Forward *=> Send this message to somebody else`, defaultShortcut: shortcut("KeyL", "l", { ctrl: true }) },
  { id: "mail.forwardAsAttachment", group: mailGroup, label: gt`Forward as attachment`, defaultShortcut: shortcut("KeyL", "L", { ctrl: true, shift: true }) },
  { id: "mail.newEmail", group: mailGroup, label: gt`New email`, defaultShortcut: shortcut("KeyN", "n", { ctrl: true }) },
  { id: "mail.editAsNew", group: mailGroup, label: gt`Edit as new`, defaultShortcut: shortcut("KeyE", "e", { ctrl: true }) },
  { id: "mail.newToAll", group: mailGroup, label: gt`New message to all`, defaultShortcut: shortcut("KeyN", "N", { ctrl: true, shift: true }) },
  { id: "mail.selectAll", group: mailGroup, label: gt`Select all visible messages`, defaultShortcut: shortcut("KeyA", "a", { ctrl: true }) },
  { id: "mail.openSelected", group: mailGroup, label: gt`Open selected message`, defaultShortcut: shortcut("Enter", "Enter") },
];

const configurableKeyboardActionMap = new Map(
  configurableKeyboardActions.map(action => [action.id, action]),
);

export function getConfigurableKeyboardAction(actionId: string): ConfigurableKeyboardAction | null {
  return configurableKeyboardActionMap.get(actionId as ConfigurableKeyboardActionId) ?? null;
}

export function isConfigurableKeyboardActionId(
  actionId: string,
): actionId is ConfigurableKeyboardActionId {
  return configurableKeyboardActionMap.has(actionId as ConfigurableKeyboardActionId);
}
