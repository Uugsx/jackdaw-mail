import { gt } from "../../../l10n/l10n";

export class OWAError extends Error {
  readonly type: string;
  /** Sync / session noise — do not toast the user. */
  doNotShow = false;
  /** Сервер отказал в доступе к общему ящику (Explicit Logon), а сессия
   * основного ящика при этом жива. */
  mailboxAccessDenied = false;

  constructor(response: any) {
    let message = response.message || `HTTP ${response.status} ${response.statusText}`;
    let type = `HTTP ${response.status}`
    if (response.json) {
      let body = response.json.Body || response.json;
      if (body.FaultMessage) {
        message = body.FaultMessage;
        type = body.ExceptionName;
      }
      if (body.ResponseMessages?.Items?.[0]) {
        body = body.ResponseMessages.Items[0];
      }
      if (body.MessageText) {
        message = body.MessageText;
        type = body.ResponseCode;
      }
    }
    message = humanizeOWAMessage(type, message);
    super(message);
    this.type = type;
    if (this.isSessionLimit || isSyncNoise(type)) {
      this.doNotShow = true;
    }
  }

  get isSessionLimit(): boolean {
    return /too many active sessions/i.test(this.message) ||
      /активных сеансов/i.test(this.message) ||
      this.type === "ErrorTooManyObjectsOpened" ||
      this.type === "ErrorMailboxSessionLimit" ||
      this.type === "ErrorServerBusy";
  }
}

/** Transient or session-level codes that a background sync recovers from on
 * its own. Errors the user has to act on - a full mailbox, an oversized
 * message - must not be listed here, or sending fails with no feedback. */
function isSyncNoise(type: string): boolean {
  return type == "ErrorItemNotFound"
    || type == "ErrorIrresolvableConflict"
    || type == "ErrorExceededConnectionCount"
    || type == "ErrorServerBusy"
    || type == "ErrorTimeoutExpired";
}

/** The server does not understand `ReturnNewItemIds` on Move/Copy. */
export function isUnsupportedOptionError(ex: unknown): boolean {
  return ex instanceof OWAError &&
    ["ErrorPropertyRequestFailed", "ErrorInvalidArgument", "ErrorInvalidRequest",
      "ErrorSchemaValidation", "ErrorInternalServerError"].includes(ex.type);
}

function humanizeOWAMessage(type: string, fallback: string): string {
  switch (type) {
  case "ErrorItemNotFound":
    return gt`This was deleted on the server`;
  case "ErrorTooManyObjectsOpened":
  case "ErrorMailboxSessionLimit":
  case "ErrorExceededConnectionCount":
  case "ErrorServerBusy":
    return gt`Too many active sessions for this mailbox. Please wait a few minutes.`;
  case "ErrorAccessDenied":
    return gt`Access denied`;
  case "ErrorFolderNotFound":
    return gt`Folder not found`;
  case "ErrorInvalidIdMalformed":
  case "ErrorInvalidId":
    return gt`This was deleted on the server`;
  case "ErrorQuotaExceeded":
    return gt`Mailbox is full`;
  case "ErrorMessageSizeExceeded":
    return gt`Message is too large`;
  case "ErrorTimeoutExpired":
    return gt`The server took too long to respond`;
  case "ErrorConnectionFailed":
    return gt`Could not connect to the server`;
  default:
    // Prefer short ResponseCode over raw Russian/English Exchange MessageText
    if (type && type.startsWith("Error") && fallback && fallback.length > 120) {
      return type.replace(/^Error/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
    }
    return fallback;
  }
}
