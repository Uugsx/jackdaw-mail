import type { MailAccount } from "../../../logic/Mail/MailAccount";
import type { EMail } from "../../../logic/Mail/EMail";
import { SMLData } from "../../../logic/Mail/SML/SMLData";
import { assert } from "../../../logic/util/util";
import {
  isMessageWindowPayload,
  type MessageWindowPayload,
} from "../../../logic/Mail/MessageWindowProtocol";
import {
  deserializeComposeMail,
  serializeComposeMail,
} from "../Composer/composeWindow";

/** Преобразует письмо в безопасный payload для отдельного окна просмотра. */
export async function serializeMessageWindowMail(
  message: EMail,
  windowID: string,
): Promise<MessageWindowPayload> {
  // Для окна просмотра достаточно тела письма. Принудительная загрузка MIME
  // здесь делала режим нестабильным: у отдельных писем MIME ещё не был
  // доступен, из-за чего нативное окно не создавалось и вызывающий код молча
  // переходил на полноэкранный маршрут.
  await message.loadBody();
  let smlJSON = message.sml?.sml == null ? null : JSON.stringify(message.sml.sml) ?? null;
  let payload: MessageWindowPayload = {
    windowID,
    mail: await serializeComposeMail(message, windowID, { includeAttachmentContent: false }),
    isSpam: !!message.isSpam,
    isReplied: !!message.isReplied,
    isForwarded: !!message.isForwarded,
    smlJSON,
  };
  assert(isMessageWindowPayload(payload), "Message window: payload is too large or malformed");
  return payload;
}

/** Восстанавливает объект письма в renderer отдельного окна просмотра. */
export function deserializeMessageWindowMail(
  payload: MessageWindowPayload,
  account: MailAccount,
): EMail {
  let message = deserializeComposeMail(payload.mail, account);
  message.isSpam = payload.isSpam;
  message.isReplied = payload.isReplied;
  message.isForwarded = payload.isForwarded;
  if (payload.smlJSON) {
    let sml = new SMLData();
    sml.fromJSON(JSON.parse(payload.smlJSON));
    message.sml = sml;
  }
  return message;
}
