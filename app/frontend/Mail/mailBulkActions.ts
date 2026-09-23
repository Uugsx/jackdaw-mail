import type { EMail } from "../../logic/Mail/EMail";
import { messagesRepresentSameMail } from "./mailReadActions";

/** Запускает массовое действие для всех писем одновременно и ждёт каждый результат. */
export async function runMailActions(
  messages: readonly EMail[],
  action: (message: EMail) => Promise<unknown>,
): Promise<void> {
  let results = await Promise.allSettled(uniqueMailMessages(messages).map(message => action(message)));
  throwFirstBulkActionError(results);
}

export function uniqueMailMessages(messages: readonly EMail[]): EMail[] {
  let uniqueMessages: EMail[] = [];
  for (let message of messages) {
    if (!uniqueMessages.some(existing => messagesRepresentSameMail(existing, message))) {
      uniqueMessages.push(message);
    }
  }
  return uniqueMessages;
}

export function throwFirstBulkActionError(results: readonly PromiseSettledResult<unknown>[]): void {
  let failed = results.find((result): result is PromiseRejectedResult => result.status == "rejected");
  if (failed) {
    throw failed.reason;
  }
}
