import type { ComposeWindowMail } from "./Composer/ComposeWindowProtocol";
import { isComposeWindowPayload } from "./Composer/ComposeWindowProtocol";

/** IPC-каналы отдельного окна просмотра письма. */
export const messageWindowOpenChannel = "message-window:open";
export const messageWindowFocusChannel = "message-window:focus";
export const messageWindowCloseChannel = "message-window:close";
export const messageWindowDataChannel = "message-window:data";
export const messageWindowClosedChannel = "message-window:closed";
export const messageWindowReplyChannel = "message-window:reply";
export const messageWindowReplyRequestChannel = "message-window:reply-request";

export type MessageWindowReplyMode = "reply" | "replyAll";

export function isMessageWindowReplyMode(
  value: unknown,
): value is MessageWindowReplyMode {
  return value === "reply" || value === "replyAll";
}

export interface MessageWindowPayload {
  windowID: string;
  mail: ComposeWindowMail;
  isSpam: boolean;
  isReplied: boolean;
  isForwarded: boolean;
  /** JSON-представление SML-блока письма, если он есть. */
  smlJSON: string | null;
}

const kMaxSMLJSONLength = 4_000_000;

function isSerializedSML(value: unknown): value is string | null {
  if (value === null) {
    return true;
  }
  if (typeof value !== "string" || value.length > kMaxSMLJSONLength) {
    return false;
  }
  try {
    let parsed = JSON.parse(value);
    return !!parsed && typeof parsed === "object";
  } catch (_ex) {
    return false;
  }
}

/** Проверяет данные окна просмотра до их передачи из главного процесса. */
export function isMessageWindowPayload(
  value: unknown,
): value is MessageWindowPayload {
  if (!value || typeof value !== "object") {
    return false;
  }
  let payload = value as Record<string, unknown>;
  return (
    typeof payload.windowID === "string" &&
    payload.windowID.length > 0 &&
    payload.windowID.length <= 128 &&
    isComposeWindowPayload(payload.mail) &&
    (payload.mail as ComposeWindowMail).windowID === payload.windowID &&
    typeof payload.isSpam === "boolean" &&
    typeof payload.isReplied === "boolean" &&
    typeof payload.isForwarded === "boolean" &&
    isSerializedSML(payload.smlJSON)
  );
}
