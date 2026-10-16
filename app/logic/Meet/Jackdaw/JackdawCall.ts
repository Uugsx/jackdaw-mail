import { LiveKitConf } from "../LiveKit/LiveKitConf";
import { LiveKitAccount } from "../LiveKit/LiveKitAccount";
import { MeetingState } from "../VideoConfMeeting";
import { MeetingParticipant, ParticipantRole } from "../Participant";
import type { Person } from "../../Abstract/Person";
import type { RemoteParticipant } from "livekit-client";
import type { JackdawCallClient, JackdawCallSignalTarget } from "./JackdawCallClient";
import { JackdawCallServiceError } from "./JackdawCallClient";
import { endReasonMessage, type JackdawCallEndReason, type JackdawServerMessage } from "./JackdawCallProtocol";
import { notifyChangedProperty } from "../../util/Observable";
import { NotSupported, UserError, type URLString } from "../../util/util";
import { gt } from "../../../l10n/l10n";

/** Звонки Jackdaw ↔ Jackdaw. Медиа идёт через LiveKit, сигналинг — через `JackdawCallClient`.
 * Аккаунт не сохраняется и не показывается в списке аккаунтов: он есть у каждого пользователя Pro. */
export class JackdawCallAccount extends LiveKitAccount {
  readonly protocol: string = "jackdaw-call";
  canVideo = true;
  canAudio = true;
  canScreenShare = true;
  canMultipleParticipants = false;
  canCreateURL = false;

  constructor(readonly client: JackdawCallClient) {
    super();
    this.name = "Jackdaw Mail";
  }

  newMeeting(): JackdawCall {
    return new JackdawCall(this);
  }

  isMeetingURL(_url: URL): boolean {
    return false;
  }

  // Лицензию проверяет сервис звонков при входе.
  needsLicense(): boolean {
    return false;
  }
  async login(): Promise<void> {
  }
}

/** Вызывается, когда звонок закончился не по нашему действию: занято, нет ответа и т.п. */
export let onJackdawCallEnded: (call: JackdawCall, message: string) => void = () => {};
export function setJackdawCallEndedHandler(handler: (call: JackdawCall, message: string) => void): void {
  onJackdawCallEnded = handler;
}

export class JackdawCall extends LiveKitConf implements JackdawCallSignalTarget {
  account: JackdawCallAccount;
  callID: string = crypto.randomUUID();
  /** Адрес собеседника в Jackdaw */
  remoteEmail: string;
  outgoing = false;
  @notifyChangedProperty
  endReason: JackdawCallEndReason | null = null;
  /** Звонок уже закончен на сервере: при `hangup()` ничего не отправляем */
  protected remoteEnded = false;
  protected connecting = false;
  /** Ответ уже отправлен: повторное нажатие «Принять» не должно слать второй `accept` */
  protected answered = false;

  constructor(account: JackdawCallAccount) {
    super(account);
    this.id = this.callID;
  }

  protected get client(): JackdawCallClient {
    return this.account.client;
  }

  /** Готовит исходящий звонок. Звонить начнёт `call()` после подтверждения в интерфейсе. */
  prepareOutgoing(email: string, name: string, video: boolean, person?: Person | null): void {
    this.outgoing = true;
    this.remoteEmail = email;
    this.hasVideo = video;
    this.title = name || email;
    this.addRemotePlaceholder(email, name, person);
    this.state = MeetingState.OutgoingCallConfirm;
  }

  /** Входящий звонок от сервиса. */
  prepareIncoming(message: Extract<JackdawServerMessage, { type: "incoming" }>, person?: Person | null): void {
    this.outgoing = false;
    this.callID = message.callId;
    this.id = message.callId;
    this.remoteEmail = message.from;
    this.hasVideo = message.video;
    this.title = message.fromName || message.from;
    this.addRemotePlaceholder(message.from, message.fromName, person);
    this.client.register(this);
    this.state = MeetingState.IncomingCall;
  }

  protected addRemotePlaceholder(email: string, name: string, person?: Person | null): void {
    let remote = new MeetingParticipant();
    remote.emailAddress = email;
    remote.name = person?.name || name || email;
    remote.role = ParticipantRole.Invited;
    if (person) {
      remote.person = person;
    }
    this.participants.add(remote);
  }

  async call(): Promise<void> {
    await super.call(); // → OutgoingCall
    this.client.register(this);
    try {
      this.client.send({ type: "invite", callId: this.callID, to: this.remoteEmail, video: this.hasVideo });
    } catch (ex) {
      this.client.unregister(this);
      await this.endLocally();
      throw ex;
    }
  }

  async answer(): Promise<void> {
    if (this.state != MeetingState.IncomingCall || this.answered) {
      return;
    }
    this.answered = true;
    this.client.send({ type: "accept", callId: this.callID });
    // Дальше — `joined` в `onSignal()`.
  }

  onSignal(message: JackdawServerMessage): void {
    switch (message.type) {
      case "accepted":
        if (this.outgoing) {
          this.connectRoom(message.livekitURL, message.token);
        }
        break;
      case "joined":
        if (!this.outgoing) {
          this.connectRoom(message.livekitURL, message.token);
        }
        break;
      case "call-ended":
        this.remoteEnded = true;
        this.endReason = message.reason;
        this.reportEnd(endReasonMessage(message.reason, this.outgoing));
        void this.endLocally();
        break;
      case "error":
        this.remoteEnded = true;
        this.reportEnd(new JackdawCallServiceError(message.code).message);
        void this.endLocally();
        break;
    }
  }

  protected reportEnd(message: string | null): void {
    if (message) {
      onJackdawCallEnded(this, message);
    }
  }

  protected connectRoom(url: string, token: string): void {
    if (this.connecting || this.room) {
      return;
    }
    this.connecting = true;
    this.webSocketURL = url as URLString;
    this.myParticipantToken = token;
    this.joinRoom(token).catch(ex => {
      this.reportEnd(gt`Could not connect the call.` + ` (${ex?.message ?? ex})`);
      void this.hangup();
    });
  }

  protected async joinRoom(token: string): Promise<void> {
    await this.joinAfterStart(token);
    this.startNow();
    this.title = this.participants.first?.name || this.remoteEmail;
  }

  protected participantJoined(remoteParticipant: RemoteParticipant): void {
    // Заглушка собеседника, показанная во время вызова, заменяется настоящим участником комнаты.
    let placeholder = this.participants.find(p => p.role == ParticipantRole.Invited);
    super.participantJoined(remoteParticipant);
    let joined = this.participants.find(p => p.id == remoteParticipant.identity);
    if (joined && placeholder) {
      joined.emailAddress = placeholder.emailAddress;
      joined.person = placeholder.person;
      joined.name = placeholder.name || joined.name;
      this.participants.remove(placeholder);
    }
  }

  /** Сервис звонков сам выдаёт токен комнаты; создавать комнату через другой API нельзя. */
  protected async createMyParticipant(): Promise<string> {
    throw new NotSupported(gt`This call is started from the contact`);
  }

  async createInvitationURL(): Promise<URLString> {
    throw new NotSupported(gt`Cannot invite others using a link to this kind of meeting`);
  }

  async start(): Promise<void> {
    throw new UserError(gt`This call is started from the contact`);
  }

  async hangup(): Promise<void> {
    if (!this.remoteEnded) {
      let type = this.state == MeetingState.IncomingCall ? "reject"
        : this.state == MeetingState.OutgoingCall ? "cancel"
        : this.state == MeetingState.Ongoing ? "hangup"
        : null;
      if (type) {
        try {
          this.client.send({ type, callId: this.callID });
        } catch {
          // Без соединения сервер завершит звонок сам по таймауту переподключения.
        }
      }
    }
    this.remoteEnded = true;
    await this.endLocally();
  }

  /** Отвечает «занято», не показывая звонок: пользователь уже в другой встрече. */
  rejectAsBusy(): void {
    try {
      this.client.send({ type: "reject", callId: this.callID, reason: "busy" });
    } catch {
      // Сервер завершит звонок по таймауту.
    }
    this.remoteEnded = true;
    this.client.unregister(this);
  }

  protected async endLocally(): Promise<void> {
    this.client.unregister(this);
    if (this.state == MeetingState.Ended) {
      return;
    }
    await super.hangup();
  }
}
