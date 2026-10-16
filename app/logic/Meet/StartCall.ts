import type { VideoConfMeeting } from "./VideoConfMeeting";
import type { MeetAccount } from "./MeetAccount";
import { WhatsAppMeetAccount } from "./WhatsApp/WhatsAppMeetAccount";
import { JID } from "../Chat/WhatsApp/Binary/JID";
import { Person } from "../Abstract/Person";
import type { Group } from "../Abstract/Group";
import { PersonUID } from "../Abstract/PersonUID";
import { canJackdawCall, startJackdawCall } from "./Jackdaw/JackdawCalls";
/*
import { Person, ContactEntry } from "../Abstract/Person";
import { Group } from "../Abstract/Group";
import type { ChatAccount } from "../Chat/ChatAccount";
import type { Chat } from "../Chat/Chat";
import { MatrixAccount } from "../Chat/Matrix/MatrixAccount";
import { MatrixVideoConf } from "./Matrix/MatrixVideoConf";
*/
import { appGlobal } from "../app";
import { UserError, type URLString, assert } from "../util/util";
import { gt } from "../../l10n/l10n";

/** Кому можно звонить. `PersonUID` — собеседник по email, например в режиме чата почты. */
export type CallRecipient = Person | Group | PersonUID;

export async function startVideoCall(to: CallRecipient): Promise<VideoConfMeeting> {
  return await startCall(to, true);
}

/*
export async function startVideoCall(to: Person | Group): Promise<VideoConfMeeting> {
  let haveChat = getExistingChat(to);
  if (!haveChat) {
    if (to instanceof Person) {
      haveChat = await createNewPersonChat(to);
    } else if (to instanceof Group) {
      haveChat = await createNewGroupChat(to);
    }
  }
  if (!haveChat) {
    throw new Error("No suitable contact methods found for " + to.name);
  }
  let conf: VideoConfMeeting | null = null;
  if (haveChat.account instanceof MatrixAccount) {
    conf = await MatrixVideoConf.call(haveChat.chat, haveChat.account.client);
  }
  if (!conf) {
    throw new Error("Call not possible for this type of contact");
  }
  appGlobal.meetings.add(conf);
  return conf;
}

function getExistingChat(person: Person | Group): { chat: Chat, account: ChatAccount } | null {
  for (let account of appGlobal.chatAccounts) {
    if (!accountSuitableForCall(account)) {
      continue;
    }
    for (let chat of account.chats) {
      if (chat.contact == person) {
        return { chat, account };
      }
    }
  }
  return null;
}

function accountSuitableForCall(account: ChatAccount) {
  return account instanceof MatrixAccount;
}

async function createNewPersonChat(to: Person): Promise<{ chat: Chat, account: ChatAccount } | null> {
  // Check available contact methods, and pick the preferred one for this person
  let iHaveMatrix = haveAccountType(MatrixAccount);
  console.log("User has a Matrix account");
  let entries = to.chatAccounts.sortBy(entry => entry.preference);
  for (let entry of entries) {
    if (iHaveMatrix && entryIsMatrix(entry)) {
      return createNewMatrixChat(to, entry.value);
    }
  }
  return null;
}

async function createNewGroupChat(to: Group): Promise<{ chat: Chat, account: ChatAccount } | null> {
  // TODO implement creating a group chat to an arbitrary list of people
  let iHaveMatrix = haveAccountType(MatrixAccount);
  let theyAllHaveMatrix =
    to.participants.contents.every(person =>
      person.chatAccounts.some(entry => entryIsMatrix(entry)));
  if (iHaveMatrix && theyAllHaveMatrix) {
    let matrixIDs = to.participants.map(person =>
      person.chatAccounts.filter(entry => entryIsMatrix(entry))
        .sortBy(contact => contact.preference)
        .first.value)
      .values().contents;
    return createNewMatrixGroupChat(to, matrixIDs);
  }
  return null;
}

async function createNewMatrixChat(to: Person, matrixID: string): Promise<{ chat: Chat, account: MatrixAccount } | null> {
  throw new Error("Not implemented: Create Matrix chat room to person");
  // TODO Create Matrix chat room with that person
  return null;
}

async function createNewMatrixGroupChat(to: Group, matrixIDs: string[]): Promise<{ chat: Chat, account: MatrixAccount } | null> {
  throw new Error("Not implemented: Create Matrix chat room to group");
  // TODO Create Matrix chat room with those persons
  return null;
}

function haveAccountType(type: typeof ChatAccount): boolean {
  return appGlobal.chatAccounts.some(account => account instanceof type);
}

function entryIsMatrix(contact: ContactEntry) {
  return contact.purpose?.toLowerCase() == "matrix";
}
*/

export async function startAudioCall(to: CallRecipient): Promise<VideoConfMeeting> {
  return await startCall(to, false);
}

/** Порядок способов: WhatsApp, затем звонок между пользователями Jackdaw по email.
 * Звонок Jackdaw — только голосовой, даже если просили видео. */
async function startCall(to: CallRecipient, video: boolean): Promise<VideoConfMeeting> {
  let person = to instanceof PersonUID ? to.findPerson() : to;
  let whatsAppCall = person ? startWhatsAppCall(person, video) : null;
  if (whatsAppCall) {
    return whatsAppCall;
  }
  if (to instanceof Person || to instanceof PersonUID) {
    let jackdawCall = await startJackdawCall(to, video);
    if (jackdawCall) {
      return jackdawCall;
    }
  }
  throw new UserError(gt`Calls to this contact are not available yet. Calls work with contacts who use Jackdaw Mail and are online, or have a linked WhatsApp account.`);
}

/** Можно ли сейчас позвонить с видео. Между пользователями Jackdaw — только голосовые звонки,
 * поэтому видео есть только через WhatsApp. */
export function canStartVideoCall(to: CallRecipient | null | undefined): boolean {
  let person = to instanceof PersonUID ? to.findPerson() : to;
  return person instanceof Person && !!findWhatsAppCallTarget(person);
}

/** Есть ли сейчас способ позвонить. Кнопки звонка показываются только тогда.
 * Для звонка через Jackdaw результат меняется вместе с `getJackdawCallClient().presenceVersion`. */
export function canStartCall(to: CallRecipient | null | undefined): boolean {
  if (!to) {
    return false;
  }
  let person = to instanceof PersonUID ? to.findPerson() : to;
  if (person instanceof Person && findWhatsAppCallTarget(person)) {
    return true;
  }
  return (to instanceof Person || to instanceof PersonUID) && canJackdawCall(to);
}

function findWhatsAppCallTarget(to: Person): { account: WhatsAppMeetAccount, jid: string } | null {
  let account = appGlobal.meetAccounts.find(acc => acc instanceof WhatsAppMeetAccount) as WhatsAppMeetAccount | undefined;
  let entry = account ? to.chatAccounts.find(e => e.protocol == "whatsapp") : null;
  return account && entry ? { account, jid: entry.value } : null;
}

/** If the contact has a WhatsApp ID and a WhatsApp Meet account exists, starts a
 * WhatsApp call to them. Returns null otherwise (so callers fall back). */
function startWhatsAppCall(to: Person | Group, video: boolean): VideoConfMeeting | null {
  let target = to instanceof Person ? findWhatsAppCallTarget(to) : null;
  if (!target) {
    return null;
  }
  let call = target.account.newMeeting();
  call.prepareOutgoing(JID.parse(target.jid), video);
  appGlobal.meetings.add(call);
  return call;
}

/**
 * The user received invitation URL out-of-band (using other communication methods)
 * from the conference organizer.
 * The URL should contain both the room and the ticket to permit joining.
 * @returns meeting
 *   `meeting.join()` was already called. You still need to `meeting.start()`.
 * @throws if the URL is not supported
 */
export async function joinConferenceByURL(url: URLString, account?: MeetAccount): Promise<VideoConfMeeting> {
  assert(url, "Need URL");
  let urlParsed: URL;
  try {
    urlParsed = new URL(url);
  } catch (ex) {
    throw new UserError(gt`This is not a meeting URL`);
  }
  account ??= appGlobal.meetAccounts.find(acc => acc.isMeetingURL(urlParsed));
  if (!account) {
    // TODO Open `url` in embedded browser window, as fallback
    throw new UserError(gt`This meeting URL is not supported`);
  }
  let conf = account.newMeeting();
  await conf.join(url);
  return conf;
}
