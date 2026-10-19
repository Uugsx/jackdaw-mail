import { gt } from "../../l10n/l10n";
import { Cancelled } from "./flow/Abortable";

/**
 * Понятные пользователю сообщения об ошибках.
 *
 * Исходная ошибка не меняется: в логи и Sentry она уходит как есть,
 * а здесь только выбирается текст для экрана, подсказка «что делать»
 * и свёрнутая техническая деталь для поддержки.
 */

export type FriendlyErrorKind =
  | "cancelled"
  | "offline"
  | "timeout"
  | "server-not-found"
  | "server-unreachable"
  | "connection-lost"
  | "network"
  | "certificate"
  | "login"
  | "password-rejected"
  | "forbidden"
  | "not-found"
  | "rate-limit"
  | "server"
  | "too-large"
  | "recipient-rejected"
  | "mailbox-full"
  | "disk-full"
  | "no-permission"
  | "database-busy"
  | "database-damaged"
  | "database"
  /** Приложение уже написало понятный текст — показываем его. */
  | "app"
  | "unknown";

/** Что предложить пользователю сделать дальше. */
export type FriendlyErrorAction = "retry" | "login" | "none";

export interface FriendlyError {
  kind: FriendlyErrorKind;
  /** Короткий понятный текст: что случилось. */
  message: string;
  /** Что сделать дальше. Может отсутствовать. */
  hint: string | null;
  action: FriendlyErrorAction;
  /** Исходное сообщение, коды и HTTP-статус — для «Подробнее» и поддержки.
   * Пусто, если показывать нечего сверх `message`. */
  technical: string;
}

const kTimeoutCodes = ["ETIMEDOUT", "ETIMEOUT", "ESOCKETTIMEDOUT", "CONNECT_TIMEOUT",
  "GREETING_TIMEOUT", "UPGRADE_TIMEOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT", "ERR_TIMED_OUT", "ERR_CONNECTION_TIMED_OUT"];
const kOfflineCodes = ["ENETDOWN", "ENETUNREACH", "ERR_INTERNET_DISCONNECTED", "ERR_NETWORK_IO_SUSPENDED"];
const kNotFoundCodes = ["ENOTFOUND", "EAI_AGAIN", "EAI_NONAME", "ERR_NAME_NOT_RESOLVED", "ERR_NAME_RESOLUTION_FAILED"];
const kRefusedCodes = ["ECONNREFUSED", "EHOSTUNREACH", "EHOSTDOWN", "ERR_CONNECTION_REFUSED",
  "ERR_ADDRESS_UNREACHABLE", "NoConnection", "NoConn"];
const kResetCodes = ["ECONNRESET", "ECONNABORTED", "EPIPE", "UND_ERR_SOCKET", "ERR_CONNECTION_RESET",
  "ERR_CONNECTION_CLOSED", "ERR_CONNECTION_ABORTED", "ERR_NETWORK_CHANGED", "ERR_EMPTY_RESPONSE",
  "ERR_INCOMPLETE_CHUNKED_ENCODING", "ERR_CONTENT_LENGTH_MISMATCH", "ClosedAfterConnectTLS"];
const kCertificateCodes = ["CERT_HAS_EXPIRED", "CERT_NOT_YET_VALID", "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "ERR_TLS_CERT_ALTNAME_INVALID", "CERT_UNTRUSTED",
  "CERT_REVOKED", "ERR_SSL_PROTOCOL_ERROR", "ERR_SSL_VERSION_OR_CIPHER_MISMATCH",
  "EPROTO", "ERR_SSL_WRONG_VERSION_NUMBER"];

/** Сетевые и системные коды Node, Chromium и библиотек, которые могут
 * прийти не в `code`, а прямо в тексте («read ETIMEDOUT»). */
const kCodeInMessage = /\b(E[A-Z]{3,}|ERR_[A-Z_]+|UND_ERR_[A-Z_]+|SQLITE_[A-Z_]+|[A-Z_]*CERT[A-Z_]*|[A-Z_]+_TIMEOUT)\b/;
const kChromiumCode = /net::(ERR_[A-Z_]+)/;

/** Признаки текста, который писал не человек для человека,
 * а библиотека или протокол: коды, трассировки, ответы серверов. */
const kTechnicalMessage = new RegExp([
  String.raw`\bE[A-Z]{3,}\b`,
  String.raw`\b(?:UND_)?ERR_[A-Z_]+`,
  String.raw`\bSQLITE_[A-Z]+`,
  String.raw`net::ERR_`,
  String.raw`\bHTTP \d{3}\b`,
  String.raw`\bfailed with \d{3}\b`,
  String.raw`\b(?:Type|Reference|Range|Syntax)Error\b`,
  String.raw`Cannot read propert`,
  String.raw`is not a function`,
  String.raw`is not defined`,
  String.raw`\bundefined\b`,
  String.raw`\bnull\b`,
  String.raw`Unexpected token`,
  String.raw`\bat [\w.$<>]+ \(`,
  String.raw`\bsocket hang up\b`,
  String.raw`\bfetch failed\b`,
  String.raw`\bFailed to fetch\b`,
  String.raw`\bNetworkError\b`,
  String.raw`\bJPC\b`,
  String.raw`^\s*\d{3}[ -]\d\.\d\.\d`,
].join("|"));

/** @returns понятное описание ошибки для экрана */
export function describeError(ex: unknown): FriendlyError {
  let err = (ex ?? {}) as any;
  let rawMessage = rawErrorMessage(ex);
  let kind = classifyError(err, rawMessage);
  let technical = technicalErrorDetails(ex);

  if (kind == "app" || kind == "unknown") {
    let keepOriginal = rawMessage && (err.isUserError || !looksTechnical(rawMessage));
    if (keepOriginal) {
      return {
        kind: "app",
        message: rawMessage,
        hint: null,
        action: "none",
        // Деталь не нужна, если в ней ровно то же, что уже на экране
        technical: technical == rawMessage ? "" : technical,
      };
    }
    return {
      kind: "unknown",
      message: gt`Something went wrong.`,
      hint: technical
        ? gt`Try again. If it happens again, send the details below to support.`
        : gt`Try again.`,
      action: "retry",
      technical,
    };
  }
  let { message, hint, action } = textForKind(kind);
  return { kind, message, hint, action, technical };
}

/** Короткий текст ошибки для мест, где помещается одна строка:
 * уведомления, всплывающие подсказки, строка состояния аккаунта. */
export function friendlyErrorMessage(ex: unknown): string {
  return describeError(ex).message;
}

/** Текст с подсказкой одной строкой, например для системного уведомления ОС. */
export function friendlyErrorText(ex: unknown): string {
  let described = describeError(ex);
  return described.hint ? `${described.message} ${described.hint}` : described.message;
}

function classifyError(err: any, message: string): FriendlyErrorKind {
  if (err instanceof Cancelled || err.name == "Cancelled" || err.name == "UserCancelled" ||
      (err.isUserError && err.doNotShow)) {
    return "cancelled";
  }
  if (err.passwordRejected) {
    return "password-rejected";
  }
  if (err.authFail || err.authenticationFailed || err.code == "EAUTH") {
    return "login";
  }
  // Текст, который приложение написало для человека, не подменяем,
  // даже если в причине (cause) лежит сетевой код
  if (err.isUserError && message && !looksTechnical(message)) {
    return "app";
  }

  let codes = errorCodes(err, message);
  let has = (list: string[]) => codes.some(code => list.includes(code));

  if (codes.some(code => code.startsWith("SQLITE_"))) {
    return sqliteKind(codes);
  }
  if (has(["ENOSPC"])) {
    return "disk-full";
  }
  if (has(["EACCES", "EPERM", "EROFS"])) {
    return "no-permission";
  }
  if (has(kCertificateCodes) || codes.some(code => code.startsWith("ERR_CERT_") || code.startsWith("ERR_SSL_")) ||
      /\bcertificate\b|self[- ]signed|SSL routines|wrong version number|unable to verify the first certificate/i.test(message)) {
    return "certificate";
  }
  if (has(kOfflineCodes) || (typeof navigator != "undefined" && navigator.onLine === false && isNetworkLike(err, message, codes))) {
    return "offline";
  }
  if (has(kTimeoutCodes) || err.name == "TimeoutError" || /\btimed? ?out\b/i.test(message)) {
    return "timeout";
  }
  if (has(kNotFoundCodes) || /getaddrinfo/i.test(message)) {
    return "server-not-found";
  }
  if (has(kRefusedCodes)) {
    return "server-unreachable";
  }
  if (has(kResetCodes) || /socket hang up|connection (?:was )?(?:reset|closed)/i.test(message)) {
    return "connection-lost";
  }

  let mailKind = mailServerKind(err, message);
  if (mailKind) {
    return mailKind;
  }
  let httpKind = httpStatusKind(httpStatus(err, message));
  if (httpKind) {
    return httpKind;
  }
  if (isNetworkLike(err, message, codes)) {
    return "network";
  }
  return err.isUserError ? "app" : "unknown";
}

function isNetworkLike(err: any, message: string, codes: string[]): boolean {
  return codes.some(code => code.startsWith("ERR_") && !code.startsWith("ERR_CERT_")) ||
    err.name == "AbortError" ||
    /network ?error|failed to fetch|fetch failed|load failed|operation was aborted|request was aborted/i.test(message);
}

function sqliteKind(codes: string[]): FriendlyErrorKind {
  if (codes.some(code => /^SQLITE_(BUSY|LOCKED)/.test(code))) {
    return "database-busy";
  }
  if (codes.some(code => /^SQLITE_FULL/.test(code))) {
    return "disk-full";
  }
  if (codes.some(code => /^SQLITE_(CORRUPT|NOTADB)/.test(code))) {
    return "database-damaged";
  }
  if (codes.some(code => /^SQLITE_(READONLY|PERM|CANTOPEN|AUTH)/.test(code))) {
    return "no-permission";
  }
  return "database";
}

/** Ответы почтовых серверов: IMAP/SMTP коды, OWA/EWS типы ошибок. */
function mailServerKind(err: any, message: string): FriendlyErrorKind | null {
  let type = String(err.type ?? err.ResponseCode ?? "");
  let smtpCode = Number(err.responseCode) || 0;
  if (/AUTHENTICATIONFAILED|Invalid credentials|authentication failed|Username and Password not accepted|LOGIN failed|ErrorInvalidCredentials|Unauthorized/i.test(message) ||
      smtpCode == 535 || smtpCode == 534 ||
      /ErrorInvalidCredentials|ErrorAccessDenied.*Auth/i.test(type)) {
    return "login";
  }
  if (/ErrorServerBusy|ErrorTooManyObjectsOpened|ErrorMailboxSessionLimit|throttl|too many (?:requests|connections|login|simultaneous)|rate limit/i.test(type + " " + message) ||
      smtpCode == 421 || ((smtpCode == 450 || smtpCode == 451) && /too many|rate/i.test(message))) {
    return "rate-limit";
  }
  if (/ErrorQuotaExceeded|ErrorMailboxFull|OVERQUOTA|quota exceeded|mailbox (?:is )?full|over ?quota/i.test(type + " " + message) ||
      (smtpCode == 552 && /quota|full/i.test(message))) {
    return "mailbox-full";
  }
  if (/ErrorMessageSizeExceeded|message size exceeds|message too (?:big|large)|size limit/i.test(type + " " + message) ||
      smtpCode == 552) {
    return "too-large";
  }
  if (smtpCode == 550 || smtpCode == 553 || /recipient (?:address )?rejected|user unknown|no such user|mailbox unavailable|ErrorInvalidRecipients/i.test(type + " " + message)) {
    return "recipient-rejected";
  }
  if (/ErrorMailboxStoreUnavailable|ErrorInternalServerError|ErrorInternalServerTransientError|ErrorConnectionFailed/i.test(type)) {
    return "server";
  }
  return null;
}

function httpStatusKind(status: number): FriendlyErrorKind | null {
  if (!status) {
    return null;
  }
  if (status == 401 || status == 440) {
    return "login";
  }
  if (status == 403) {
    return "forbidden";
  }
  if (status == 404 || status == 410) {
    return "not-found";
  }
  if (status == 408 || status == 504 || status == 524) {
    return "timeout";
  }
  if (status == 413) {
    return "too-large";
  }
  if (status == 429) {
    return "rate-limit";
  }
  if (status >= 500 && status < 600) {
    return "server";
  }
  return null;
}

/** HTTP-статус: из свойств разных классов ошибок или из текста
 * («HTTP 503 …», «failed with 401 …»). */
export function httpStatus(err: any, message = rawErrorMessage(err)): number {
  for (let value of [err?.httpCode, err?.status, err?.statusCode, err?.response?.status]) {
    let status = Number(value);
    if (Number.isInteger(status) && status >= 400 && status < 600) {
      return status;
    }
  }
  let match = /\bHTTP (\d{3})\b|\bfailed with (\d{3})\b|\bstatus(?: code)?:? (\d{3})\b/i.exec(`${err?.type ?? ""} ${message}`);
  let status = Number(match?.[1] ?? match?.[2] ?? match?.[3]);
  return status >= 400 && status < 600 ? status : 0;
}

/** Все коды ошибки: собственный, причины (`cause`) и найденные в тексте. */
function errorCodes(err: any, message: string): string[] {
  let codes: string[] = [];
  let seen = new Set<any>();
  for (let current = err; current && typeof current == "object" && !seen.has(current); current = current.cause) {
    seen.add(current);
    for (let value of [current.code, current.errno, current.sqliteCode]) {
      if (typeof value == "string" && value) {
        codes.push(value);
      }
    }
    let currentMessage = typeof current.message == "string" ? current.message : "";
    for (let pattern of [kChromiumCode, kCodeInMessage]) {
      let match = pattern.exec(currentMessage);
      if (match) {
        codes.push(match[1]);
      }
    }
    // AggregateError (dual-stack: IPv4 и IPv6) — коды внутри
    if (Array.isArray(current.errors)) {
      for (let inner of current.errors) {
        if (typeof inner?.code == "string") {
          codes.push(inner.code);
        }
      }
    }
  }
  if (!err || typeof err != "object") {
    let match = kChromiumCode.exec(message) ?? kCodeInMessage.exec(message);
    if (match) {
      codes.push(match[1]);
    }
  }
  return codes;
}

function textForKind(kind: FriendlyErrorKind): { message: string; hint: string | null; action: FriendlyErrorAction } {
  switch (kind) {
  case "cancelled":
    return { message: gt`The action was cancelled.`, hint: null, action: "none" };
  case "offline":
    return {
      message: gt`No internet connection.`,
      hint: gt`Check your Wi-Fi or cable, then try again.`,
      action: "retry",
    };
  case "timeout":
    return {
      message: gt`The server took too long to respond.`,
      hint: gt`Check your internet connection and try again. If you use a VPN or proxy, make sure it is working.`,
      action: "retry",
    };
  case "server-not-found":
    return {
      message: gt`Could not find the server.`,
      hint: gt`Check the server address in the account settings and your internet connection.`,
      action: "retry",
    };
  case "server-unreachable":
    return {
      message: gt`The server is not accepting connections.`,
      hint: gt`It may be temporarily down, or a firewall is blocking the port. Try again later.`,
      action: "retry",
    };
  case "connection-lost":
    return {
      message: gt`The connection to the server was interrupted.`,
      hint: gt`Try again. If it keeps happening, check your network.`,
      action: "retry",
    };
  case "network":
    return {
      message: gt`Could not connect to the server.`,
      hint: gt`Check your internet connection and try again.`,
      action: "retry",
    };
  case "certificate":
    return {
      message: gt`Could not set up a secure connection to the server.`,
      hint: gt`The server certificate is not trusted or has expired. Check the date and time on this computer. For a company server, ask your administrator.`,
      action: "none",
    };
  case "login":
    return {
      message: gt`The server did not accept the login or password.`,
      hint: gt`Check the user name and password. Gmail, Yandex, Mail.ru, iCloud and Outlook.com with two-step verification need an app password, not your regular password.`,
      action: "login",
    };
  case "password-rejected":
    return {
      message: gt`The server rejected the saved password.`,
      hint: gt`The password may have been changed. Enter the new password in the account settings.`,
      action: "login",
    };
  case "forbidden":
    return {
      message: gt`Access denied.`,
      hint: gt`Your account does not have permission for this. Ask the mailbox owner or administrator.`,
      action: "none",
    };
  case "not-found":
    return {
      message: gt`The server could not find what was requested.`,
      hint: gt`It may have been moved or deleted. Refresh and try again.`,
      action: "retry",
    };
  case "rate-limit":
    return {
      message: gt`The server is limiting requests right now.`,
      hint: gt`Wait a minute and try again.`,
      action: "retry",
    };
  case "server":
    return {
      message: gt`The server had a problem.`,
      hint: gt`This is on the server side. Try again in a few minutes.`,
      action: "retry",
    };
  case "too-large":
    return {
      message: gt`The message or file is too large for the server.`,
      hint: gt`Remove some attachments or send a link to the file instead.`,
      action: "none",
    };
  case "recipient-rejected":
    return {
      message: gt`The server did not accept one of the recipients.`,
      hint: gt`Check the email addresses and try again.`,
      action: "none",
    };
  case "mailbox-full":
    return {
      message: gt`The mailbox is full.`,
      hint: gt`Delete old messages or empty the trash, then try again.`,
      action: "none",
    };
  case "disk-full":
    return {
      message: gt`Not enough free space on this computer.`,
      hint: gt`Free up some disk space and try again.`,
      action: "retry",
    };
  case "no-permission":
    return {
      message: gt`Jackdaw cannot write its data files.`,
      hint: gt`Check the access rights to the app data folder, then restart Jackdaw.`,
      action: "none",
    };
  case "database-busy":
    return {
      message: gt`Local data is busy right now.`,
      hint: gt`Try again in a moment.`,
      action: "retry",
    };
  case "database-damaged":
    return {
      message: gt`Local data is damaged.`,
      hint: gt`Restart Jackdaw. If it happens again, send the details below to support.`,
      action: "none",
    };
  case "database":
    return {
      message: gt`Could not read or save local data.`,
      hint: gt`Try again. If it happens again, restart Jackdaw.`,
      action: "retry",
    };
  default:
    return { message: gt`Something went wrong.`, hint: null, action: "retry" };
  }
}

/** Текст ошибки как есть, без имени аккаунта. */
function rawErrorMessage(ex: unknown): string {
  if (ex == null) {
    return "";
  }
  if (typeof ex == "string") {
    return ex.trim();
  }
  let message = (ex as any).message;
  return (typeof message == "string" ? message : String(ex)).trim();
}

/** Похоже ли сообщение на технический текст, а не на фразу для человека. */
export function looksTechnical(message: string): boolean {
  if (!message?.trim()) {
    return true;
  }
  return kTechnicalMessage.test(message);
}

/**
 * Техническая деталь для «Подробнее» и копирования в поддержку:
 * имя класса, коды, HTTP-статус, исходный текст и причины.
 * Секреты из URL (токены, пароли в адресе) заменяются на «•••».
 */
export function technicalErrorDetails(ex: unknown): string {
  if (ex == null) {
    return "";
  }
  if (typeof ex != "object") {
    return redactSecrets(String(ex));
  }
  let lines: string[] = [];
  let seen = new Set<any>();
  for (let current = ex as any; current && typeof current == "object" && !seen.has(current); current = current.cause) {
    seen.add(current);
    let parts: string[] = [];
    let name = typeof current.name == "string" && current.name != "Error" ? current.name : "";
    let codes = [current.code, current.type, current.responseCode]
      .filter(value => value != null && value !== "" && typeof value != "object")
      .map(String);
    let status = Number(current.httpCode ?? current.status ?? current.statusCode);
    if (Number.isInteger(status) && status >= 100 && status < 600 && !codes.some(code => code.includes(String(status)))) {
      codes.push(`HTTP ${status}`);
    }
    let head = [name, ...codes].filter(Boolean).join(" · ");
    if (head) {
      parts.push(`[${head}]`);
    }
    let message = typeof current.message == "string" ? current.message.trim() : "";
    if (message) {
      parts.push(message);
    }
    if (parts.length) {
      lines.push(parts.join(" "));
    }
  }
  let debugInfo = (ex as any).debugInfo;
  if (typeof debugInfo == "string" && debugInfo.trim()) {
    lines.push(debugInfo.trim());
  }
  return redactSecrets(lines.join("\n"));
}

/** Убирает из текста то, что нельзя пересылать: токены и пароли в URL. */
export function redactSecrets(text: string): string {
  return text
    // user:password@host
    .replace(/(\/\/)[^\s/:@]+:[^\s/@]+@/g, "$1•••@")
    // ?access_token=…&code=…
    .replace(/([?&#](?:access_token|refresh_token|id_token|token|code|password|pass|pwd|key|secret|auth|sig|signature)=)[^&#\s>"']+/gi, "$1•••")
    // Authorization: Bearer …
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g, "$1 •••");
}
