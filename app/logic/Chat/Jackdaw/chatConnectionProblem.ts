/**
 * Почему чат Jackdaw сейчас не может отправить сообщение: честный текст для баннера по состоянию соединения.
 */
import type { JackdawCallStatus } from "../../Meet/Jackdaw/JackdawCallClient";
import type { JackdawChatAccount } from "./JackdawChatAccount";
import { getDateTimeString } from "../../../frontend/Util/date";
import { UserError } from "../../util/util";
import { gt } from "../../../l10n/l10n";

export interface ChatConnectionState {
  /** null — чат ещё не подключён к соединению сервиса */
  status: JackdawCallStatus | null;
  /** Лицензия Pro на устройстве ещё проверяется */
  proChecking: boolean;
  /** Пояснение сервиса лицензий о состоянии Pro на устройстве, если есть */
  proMessage?: string | null;
  lastError: string | null;
  offlineSince: Date | null;
  hasVerifiedEmail: boolean;
  isRegistered: boolean;
}

export type ChatConnectionProblemKind =
  /** На устройстве нет Pro или пробного периода, учётных данных для входа нет */
  | "no-pro"
  /** Лицензия на устройстве ещё проверяется */
  | "checking-pro"
  | "connecting"
  | "offline"
  /** Сервер отказал во входе */
  | "rejected"
  /** Связь есть, но ни один адрес не подтверждён */
  | "not-verified"
  /** Связь есть, устройство чата ещё регистрируется */
  | "registering";

export interface ChatConnectionProblem {
  kind: ChatConnectionProblemKind;
  message: string;
}

/** Состояния, из которых может вывести кнопка «Переподключить». Неподтверждённый адрес — только настройки. */
const RECONNECTABLE = new Set<ChatConnectionProblemKind>(["no-pro", "checking-pro", "connecting", "offline", "rejected", "registering"]);

/** @returns null, если чат на связи */
export function chatConnectionProblem(state: ChatConnectionState): ChatConnectionProblem | null {
  switch (state.status) {
    case null:
    case "disabled":
      if (state.proChecking) {
        return { kind: "checking-pro", message: gt`Checking the Jackdaw Pro license on this device. Unsent messages will be sent as soon as the chat connects.` };
      }
      return {
        kind: "no-pro",
        message: [gt`The chat cannot connect: Jackdaw Pro is not active on this device. Check the license in Settings → Jackdaw Pro.`, state.proMessage]
          .filter(Boolean).join(" "),
      };
    case "connecting":
      return { kind: "connecting", message: gt`Connecting to the Jackdaw server. Unsent messages will be sent as soon as the connection is established.` };
    case "offline": {
      if (!state.offlineSince) {
        return { kind: "offline", message: gt`No connection to the Jackdaw server. Unsent messages will be sent automatically when the connection is restored.` };
      }
      let since = getDateTimeString(state.offlineSince);
      if (state.lastError) {
        return { kind: "offline", message: gt`No connection to the Jackdaw server since ${since}. Server response: ${state.lastError} Unsent messages will be sent automatically when the connection is restored.` };
      }
      return { kind: "offline", message: gt`No connection to the Jackdaw server since ${since}. Unsent messages will be sent automatically when the connection is restored.` };
    }
    case "rejected":
      return {
        kind: "rejected",
        message: state.lastError
          ? gt`The Jackdaw server refused the connection: ${state.lastError}`
          : gt`The Jackdaw server refused the connection.`,
      };
  }
  if (!state.hasVerifiedEmail) {
    return { kind: "not-verified", message: gt`The chat is not connected. Confirm your address in Settings → Jackdaw Pro → Calls and chat.` };
  }
  if (!state.isRegistered) {
    return { kind: "registering", message: gt`The chat is still connecting. Try again in a moment.` };
  }
  return null;
}

/** Чат не на связи. Баннер с этой ошибкой предлагает «Переподключить», если это может помочь. */
export class JackdawChatConnectionError extends UserError {
  /** Признак для показа баннера без `instanceof`: см. `showError()` */
  readonly chatConnectionProblem = true;
  readonly kind: ChatConnectionProblemKind;

  constructor(problem: ChatConnectionProblem, readonly account: JackdawChatAccount) {
    super(problem.message);
    this.kind = problem.kind;
  }

  get canReconnect(): boolean {
    return RECONNECTABLE.has(this.kind);
  }
}
