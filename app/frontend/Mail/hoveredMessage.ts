import { get } from "svelte/store";
import type { EMail } from "../../logic/Mail/EMail";
import { selectedMessage, selectedMessages } from "./Selected";

/**
 * Письмо под курсором мыши для горячих клавиш действий, как в Outlook:
 * клавиша применяется к строке под курсором, а не к выделенной.
 *
 * Строки списка (обычный и табличный вид, «разговоры по людям») помечаются
 * действием `use:hoverMessageRow`. Строку под курсором ищем через `:hover`
 * в момент нажатия: FastList переиспользует DOM-элементы при прокрутке,
 * поэтому pointerenter/pointerleave отдельной строки ненадёжны.
 */

const kRowAttribute = "data-hover-message-row";
const rowMessages = new WeakMap<Element, EMail>();

/**
 * Курсор двигался после последней навигации с клавиатуры. Если пользователь
 * листает список стрелками, а мышь просто лежит над какой-то строкой, клавиши
 * должны по-прежнему действовать на выделенное письмо.
 */
let pointerMovedSinceKeyboardNavigation = false;
let trackingInstalled = false;

const kNavigationKeys = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"]);

function installTracking(): void {
  if (trackingInstalled || typeof document == "undefined") {
    return;
  }
  trackingInstalled = true;
  document.addEventListener("pointermove", () => {
    pointerMovedSinceKeyboardNavigation = true;
  }, { capture: true, passive: true });
  document.addEventListener("keydown", event => {
    if (kNavigationKeys.has(event.key)) {
      suppressHoveredMessage();
    }
  }, { capture: true, passive: true });
}

/** Выделение сдвинуто с клавиатуры: до движения мыши действуем на выделенное. */
export function suppressHoveredMessage(): void {
  pointerMovedSinceKeyboardNavigation = false;
}

/** Svelte-действие для корневого элемента строки письма. */
export function hoverMessageRow(node: HTMLElement, message: EMail) {
  installTracking();
  node.setAttribute(kRowAttribute, "");
  rowMessages.set(node, message);
  return {
    update(next: EMail) {
      rowMessages.set(node, next);
    },
    destroy() {
      rowMessages.delete(node);
    },
  };
}

/** Письмо строки, над которой сейчас курсор, или null. */
export function getHoveredMessage(): EMail | null {
  if (!pointerMovedSinceKeyboardNavigation || typeof document == "undefined") {
    return null;
  }
  // Нативный WebView тела письма может оставить устаревший :hover на строке
  if (document.body?.classList.contains("mail-webview-pointer-active")) {
    return null;
  }
  let rows = document.querySelectorAll(`[${kRowAttribute}]:hover`);
  let row = rows[rows.length - 1];
  return row?.isConnected ? rowMessages.get(row) ?? null : null;
}

export type MailActionTargets = {
  messages: EMail[];
  /** Письмо под курсором не входит в выделение: выделение не трогаем. */
  hoverOnly: boolean;
};

/**
 * Курсор над письмом вне выделения — действие только для него.
 * Курсор над одним из выделенных — для всего выделения, как контекстное меню.
 * Курсор не над списком — как раньше, выделенные письма.
 */
export function resolveMailActionTargets(
  selected: readonly EMail[],
  current: EMail | null | undefined,
  hovered: EMail | null,
): MailActionTargets {
  let messages = selected.length ? selected.slice() : current ? [current] : [];
  if (!hovered || messages.includes(hovered)) {
    return { messages, hoverOnly: false };
  }
  return { messages: [hovered], hoverOnly: true };
}

export function getMailActionTargets(): MailActionTargets {
  return resolveMailActionTargets(
    get(selectedMessages).contents,
    get(selectedMessage),
    getHoveredMessage(),
  );
}
