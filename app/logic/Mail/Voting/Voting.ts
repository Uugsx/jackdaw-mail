/**
 * Кнопки голосования, как в Outlook: отправитель задаёт варианты («Утвердить; Отклонить»),
 * получатель отвечает одним щелчком, отправитель видит сводку ответов.
 *
 * Exchange хранит варианты в именованном свойстве PidLidVerbStream (PSETID_Common, 0x8520,
 * формат — [MS-OXOMSG] 2.2.1.74), а выбранный вариант ответа — в PidLidVerbResponse (0x8524).
 * Для остальных протоколов (и чтобы видеть варианты в MIME) варианты дублируются заголовком
 * `X-Jackdaw-Voting`, ответ — заголовком `X-Jackdaw-Vote`. Ответ, как и в Outlook,
 * начинается с варианта: «Утвердить: Тема».
 */
import type { EMail } from "../EMail";
import { normalizeRelatedSubject } from "../RelatedEMail";
import { gt } from "../../../l10n/l10n";

export const kVotingHeader = "x-jackdaw-voting";
export const kVoteHeader = "x-jackdaw-vote";
const kPSETIDCommon = "00062008-0000-0000-C000-000000000046";
export const kVerbStreamField = { PropertySetId: kPSETIDCommon, PropertyId: 0x8520, PropertyType: "Binary" };
export const kVerbResponseField = { PropertySetId: kPSETIDCommon, PropertyId: 0x8524, PropertyType: "String" };

/** Сколько вариантов и какой длины: имя хранится с однобайтовым счётчиком */
export const kMaxVotingOptions = 20;
export const kMaxOptionLength = 64;

export type VotingPreset = "approve-reject" | "yes-no" | "yes-no-maybe";
export const kVotingPresets: VotingPreset[] = ["approve-reject", "yes-no", "yes-no-maybe"];

export function votingPresetOptions(preset: VotingPreset): string[] {
  switch (preset) {
    case "approve-reject": return [gt`Approve`, gt`Reject`];
    case "yes-no": return [gt`Yes`, gt`No`];
    case "yes-no-maybe": return [gt`Yes`, gt`No`, gt`Maybe`];
  }
}

/** «Да; Нет;; да» → ["Да", "Нет"]: без пустых, повторов и лишней длины */
export function parseVotingOptions(value: string | string[] | null | undefined): string[] {
  let list = Array.isArray(value) ? value : (value ?? "").split(";");
  let seen = new Set<string>();
  let result: string[] = [];
  for (let option of list) {
    let text = option.trim().slice(0, kMaxOptionLength);
    if (text && !seen.has(text.toLowerCase())) {
      seen.add(text.toLowerCase());
      result.push(text);
    }
  }
  return result.slice(0, kMaxVotingOptions);
}

// Заголовки: ASCII, варианты — через encodeURIComponent

export function votingHeaderValue(options: string[]): string {
  return parseVotingOptions(options).map(option => encodeURIComponent(option)).join(";");
}

export function parseVotingHeader(value: string | null | undefined): string[] {
  return parseVotingOptions((value ?? "").split(";").map(part => {
    try {
      return decodeURIComponent(part);
    } catch {
      return "";
    }
  }));
}

// PidLidVerbStream

const kVerbStreamVersion = 0x0102;
const kVerbStreamVersionTwo = 0x0104;
const kVerbTypeVoting = 4;
const kSendBehaviorSendImmediately = 1;

class ByteWriter {
  bytes: number[] = [];
  u8(value: number) { this.bytes.push(value & 0xff); }
  u16(value: number) { this.u8(value); this.u8(value >> 8); }
  u32(value: number) { this.u16(value & 0xffff); this.u16((value >>> 16) & 0xffff); }
  /** Однобайтовая строка: вне ASCII — «?», как делает Outlook для не-Юникод части */
  ansi(text: string) {
    this.u8(text.length);
    for (let char of text) {
      let code = char.charCodeAt(0);
      this.u8(code < 0x80 ? code : 0x3f);
    }
  }
  utf16(text: string) {
    this.u8(text.length);
    for (let i = 0; i < text.length; i++) {
      this.u16(text.charCodeAt(i));
    }
  }
}

/** Двоичное значение PidLidVerbStream для вариантов голосования */
export function buildVerbStream(options: string[]): Uint8Array {
  let list = parseVotingOptions(options);
  let writer = new ByteWriter();
  writer.u16(kVerbStreamVersion);
  writer.u32(list.length);
  for (let [index, option] of list.entries()) {
    writer.u32(kVerbTypeVoting);
    writer.ansi(option); // DisplayName
    writer.ansi("IPM.Note"); // MsgClsName
    writer.u8(0); // Internal1StringCount
    writer.ansi(option); // DisplayNameRepeat
    writer.u32(0); // Internal2
    writer.u8(0); // Internal3
    writer.u32(0); // fUseUSHeaders
    writer.u32(1); // Internal4
    writer.u32(kSendBehaviorSendImmediately);
    writer.u32(2); // Internal5
    writer.u32(index + 1); // ID
    writer.u32(0xffffffff); // Internal6
  }
  writer.u16(kVerbStreamVersionTwo);
  for (let option of list) {
    writer.utf16(option);
    writer.utf16(option);
  }
  return new Uint8Array(writer.bytes);
}

/** Варианты голосования из PidLidVerbStream; Юникод-часть важнее однобайтовой */
export function parseVerbStream(bytes: Uint8Array): string[] {
  let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 0;
  let u8 = () => view.getUint8(pos++);
  let u16 = () => { let value = view.getUint16(pos, true); pos += 2; return value; };
  let u32 = () => { let value = view.getUint32(pos, true); pos += 4; return value; };
  let ansi = () => { let length = u8(); let text = String.fromCharCode(...bytes.subarray(pos, pos + length)); pos += length; return text; };
  let utf16 = () => { let length = u8(); let codes: number[] = []; for (let i = 0; i < length; i++) codes.push(u16()); return String.fromCharCode(...codes); };
  try {
    if (u16() != kVerbStreamVersion) {
      return [];
    }
    let count = u32();
    let verbs: { type: number, name: string }[] = [];
    for (let i = 0; i < count; i++) {
      let type = u32();
      let name = ansi();
      ansi(); // MsgClsName
      let internal1 = u8();
      pos += internal1;
      ansi(); // DisplayNameRepeat
      pos += 4 + 1 + 4 + 4 + 4 + 4 + 4 + 4;
      verbs.push({ type, name });
    }
    if (pos + 2 <= bytes.length && u16() == kVerbStreamVersionTwo) {
      for (let verb of verbs) {
        verb.name = utf16() || verb.name;
        utf16();
      }
    }
    return parseVotingOptions(verbs.filter(verb => verb.type == kVerbTypeVoting).map(verb => verb.name));
  } catch {
    // Обрезанный поток: что успели прочитать
    return [];
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let text = "";
  for (let byte of bytes) {
    text += String.fromCharCode(byte);
  }
  return btoa(text);
}

export function base64ToBytes(value: string): Uint8Array {
  let text = atob(value.replace(/\s+/g, ""));
  return Uint8Array.from(text, char => char.charCodeAt(0));
}

// Ответы

/** Тема ответа, как в Outlook: «Утвердить: Тема» */
export function voteSubject(option: string, subject: string | null | undefined): string {
  return option + ": " + stripReplyPrefixes(subject ?? "");
}

/** «Re: Fwd: Тема» → «Тема», регистр сохраняется (normalizeRelatedSubject приводит к нижнему) */
export function stripReplyPrefixes(subject: string): string {
  return subject.replace(/^(\s*(re|fwd?|aw|wg|sv|antw|tr|отв|пересл|ответ)\s*(\[\d+\])?\s*:)+\s*/iu, "").trim();
}

/** Какой вариант выбран в ответе: заголовок, свойство Exchange или начало темы */
export function voteOfReply(reply: Pick<EMail, "subject"> & { vote?: string | null }, options: string[]): string | null {
  let byField = reply.vote?.trim();
  if (byField) {
    return options.find(option => option.toLowerCase() == byField.toLowerCase()) ?? byField;
  }
  let subject = (reply.subject ?? "").trim().toLowerCase();
  return options.find(option => subject.startsWith(option.toLowerCase() + ":")) ?? null;
}

export interface VotingTally {
  option: string;
  voters: string[];
}

/**
 * Сводка у отправителя: по ответам на письмо `original`.
 * Ответ — письмо с In-Reply-To на Message-ID оригинала либо с темой «Вариант: Тема».
 * От одного человека считается последний ответ.
 */
export function tallyVotes(original: Pick<EMail, "messageID" | "subject">, options: string[],
    replies: Iterable<Pick<EMail, "subject" | "inReplyTo" | "from" | "received" | "sent"> & { vote?: string | null }>): VotingTally[] {
  let topic = normalizeRelatedSubject(original.subject ?? "").toLowerCase();
  let latest = new Map<string, { option: string, time: number }>();
  for (let reply of replies) {
    let option = voteOfReply(reply, options);
    if (!option) {
      continue;
    }
    let related = (original.messageID && reply.inReplyTo == original.messageID) ||
      normalizeRelatedSubject((reply.subject ?? "").slice(option.length + 1)).toLowerCase() == topic;
    if (!related) {
      continue;
    }
    let voter = (reply.from?.emailAddress ?? reply.from?.name ?? "").toLowerCase();
    let time = (reply.received ?? reply.sent)?.getTime() ?? 0;
    let previous = latest.get(voter);
    if (!previous || previous.time <= time) {
      latest.set(voter, { option, time });
    }
  }
  return options.map(option => ({
    option,
    voters: [...latest].filter(([, vote]) => vote.option == option).map(([voter]) => voter),
  }));
}
