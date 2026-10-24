import { gt } from "../../../l10n/l10n";

/** Сервер отказал в отправке от чужого адреса: нет прав «Отправить как» / «Отправить от имени» */
export class SendAsDeniedError extends Error {
  readonly fromAddress: string;
  readonly serverError: unknown;
  readonly isSendAsDenied = true;

  constructor(fromAddress: string, cause?: unknown) {
    super(gt`You don't have permission to send from ${fromAddress}. Ask your administrator to grant you "Send As" or "Send on Behalf" for this mailbox, or choose another sender.`);
    this.fromAddress = fromAddress;
    this.serverError = cause;
  }
}

/** EWS/OWA `ErrorSendAsDenied`, SMTP Exchange `5.7.60 SendAsDenied`
 * и похожие отказы SMTP-серверов из-за чужого From */
export function isSendAsDeniedError(ex: any): boolean {
  if (!ex) {
    return false;
  }
  if (ex instanceof SendAsDeniedError || ex.type == "ErrorSendAsDenied") {
    return true;
  }
  let text = `${ex.message ?? ""} ${ex.response ?? ""}`;
  return /ErrorSendAsDenied|SendAsDenied|5\.7\.60\b|not (?:authorized|allowed|permitted) to send (?:as|on behalf)|(?:does not|doesn't) have permissions? to send as|sender address rejected: not owned by user/i.test(text);
}

/** Заменяет отказ сервера понятной ошибкой, остальное пробрасывает как есть */
export function rethrowSendAsDenied(ex: unknown, fromAddress: string | null | undefined): never {
  if (fromAddress && isSendAsDeniedError(ex) && !(ex instanceof SendAsDeniedError)) {
    throw new SendAsDeniedError(fromAddress, ex);
  }
  throw ex;
}
