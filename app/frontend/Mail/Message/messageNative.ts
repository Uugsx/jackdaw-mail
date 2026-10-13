import type { EMail } from "../../../logic/Mail/EMail";
import { serializeMessageWindowMail } from "./messageWindow";
import type { MessageWindowPayload } from "../../../logic/Mail/MessageWindowProtocol";

type NativeMessageAPI = {
  openMessageWindow(windowID: string, payload: MessageWindowPayload): void;
  focusMessageWindow(windowID: string): void;
  onMessageWindowClosed(callback: (windowID: string) => void): () => void;
};

const messageWindowIDs = new Map<string, string>();
const messageKeysByWindowID = new Map<string, string>();
const openingWindows = new Map<string, Promise<void>>();
let closedListenerInstalled = false;

function getNativeMessageAPI(): NativeMessageAPI | null {
  if (typeof window === "undefined") {
    return null;
  }
  let api = (window as any).api;
  if (
    typeof api?.openMessageWindow !== "function" ||
    typeof api?.focusMessageWindow !== "function" ||
    typeof api?.onMessageWindowClosed !== "function"
  ) {
    return null;
  }
  return api as NativeMessageAPI;
}

function installClosedListener(api: NativeMessageAPI): void {
  if (closedListenerInstalled) {
    return;
  }
  closedListenerInstalled = true;
  api.onMessageWindowClosed((windowID) => {
    let key = messageKeysByWindowID.get(windowID);
    if (!key) {
      return;
    }
    messageKeysByWindowID.delete(windowID);
    if (messageWindowIDs.get(key) === windowID) {
      messageWindowIDs.delete(key);
    }
  });
}

function messageKey(message: EMail): string {
  return [
    message.folder?.account?.id ?? "",
    message.folder?.id ?? "",
    message.id || String(message.dbID ?? ""),
  ].join("\u0000");
}

export function supportsNativeMessageWindow(): boolean {
  let api = getNativeMessageAPI();
  if (!api) {
    return false;
  }
  installClosedListener(api);
  return true;
}

/** Открывает или фокусирует отдельное системное окно просмотра письма. */
export async function openNativeMessageWindow(message: EMail): Promise<void> {
  let api = getNativeMessageAPI();
  if (!api) {
    throw new Error("Native message windows are unavailable");
  }
  installClosedListener(api);

  let key = messageKey(message);
  let existingWindowID = messageWindowIDs.get(key);
  if (existingWindowID) {
    let pending = openingWindows.get(existingWindowID);
    if (pending) {
      return pending;
    }
    api.focusMessageWindow(existingWindowID);
    return;
  }

  let windowID = crypto.randomUUID();
  messageWindowIDs.set(key, windowID);
  messageKeysByWindowID.set(windowID, key);
  let operation = (async () => {
    let payload = await serializeMessageWindowMail(message, windowID);
    api.openMessageWindow(windowID, payload);
  })();
  openingWindows.set(windowID, operation);
  try {
    await operation;
  } catch (ex) {
    messageKeysByWindowID.delete(windowID);
    if (messageWindowIDs.get(key) === windowID) {
      messageWindowIDs.delete(key);
    }
    throw ex;
  } finally {
    if (openingWindows.get(windowID) === operation) {
      openingWindows.delete(windowID);
    }
  }
}

/** Запрашивает ответ в главном renderer, который владеет состоянием почты. */
export function requestNativeMessageReply(
  messageWindowID: string,
  replyAll = false,
): void {
  if (typeof window === "undefined") {
    throw new Error("Native message windows are unavailable");
  }
  let api = (window as any).api;
  if (typeof api?.requestMessageWindowReply !== "function") {
    throw new Error("Native message reply is unavailable");
  }
  api.requestMessageWindowReply(messageWindowID, replyAll);
}
