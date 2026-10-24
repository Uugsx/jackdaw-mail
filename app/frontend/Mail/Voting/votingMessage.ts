import type { EMail } from "../../../logic/Mail/EMail";
import { kVoteHeader, kVotingHeader, parseVotingHeader, tallyVotes, voteSubject, type VotingTally } from "../../../logic/Mail/Voting/Voting";
import { headerValue, loadExchangeVoting } from "../../../logic/Mail/Voting/VotingExchange";
import { escapeHTML } from "../../../logic/Files/FileType/htmlHelper";
import { getLocalStorage } from "../../Util/LocalStorage";
import { gt } from "../../../l10n/l10n";

/** Свои ответы на голосования: Message-ID → вариант */
const kMyVotesKey = "mail.voting.myVotes.v1";
/** Сколько своих ответов помнить */
const kMaxRememberedVotes = 500;

/** Ответ Exchange по письму: спрашиваем один раз */
const exchangeCache = new WeakMap<EMail, Promise<string[]>>();

/** Варианты голосования письма: из заголовка (любой протокол) или из Exchange */
export async function votingOptionsOf(email: EMail): Promise<string[]> {
  if (!email.headers.hasItems && email.mime instanceof Uint8Array) {
    try {
      await email.parseHeaders();
    } catch {
      // Без заголовков останется Exchange
    }
  }
  let fromHeader = parseVotingHeader(headerValue(email, kVotingHeader));
  if (fromHeader.length) {
    return fromHeader;
  }
  let cached = exchangeCache.get(email);
  if (!cached) {
    cached = loadExchangeVoting(email).then(voting => voting?.options ?? [], () => []);
    exchangeCache.set(email, cached);
  }
  return await cached;
}

function myVotes(): Record<string, string> {
  let value = getLocalStorage<Record<string, string>>(kMyVotesKey, {}).value;
  return value && typeof value == "object" ? { ...value } : {};
}

export function myVoteOn(email: EMail): string | null {
  return email.messageID ? myVotes()[email.messageID] ?? null : null;
}

/** Отвечает на голосование сразу, как «Отправить ответ сейчас» в Outlook */
export async function sendVote(email: EMail, option: string): Promise<void> {
  let reply = email.compose.replyToAuthor();
  reply.subject = voteSubject(option, email.subject);
  reply.html = `<p>${escapeHTML(option)}</p>`;
  reply.headers.set("X-Jackdaw-Vote", encodeURIComponent(option));
  await reply.compose.send();
  if (email.messageID) {
    let votes = myVotes();
    delete votes[email.messageID];
    votes[email.messageID] = option;
    let entries = Object.entries(votes).slice(-kMaxRememberedVotes);
    getLocalStorage<Record<string, string>>(kMyVotesKey, {}).value = Object.fromEntries(entries);
  }
}

/** Сводка у отправителя по уже загруженным письмам ящика */
export function tallyForSent(email: EMail, options: string[]): VotingTally[] {
  let account = email.folder?.account;
  let replies = account ? account.getAllFolders().contents
    .filter(folder => folder != email.folder)
    .flatMap(folder => folder.messages.contents)
    .filter(message => !message.outgoing)
    .map(message => ({
      subject: message.subject, inReplyTo: message.inReplyTo, from: message.from,
      received: message.received, sent: message.sent, vote: voteFromHeader(message),
    })) : [];
  return tallyVotes(email, options, replies);
}

function voteFromHeader(email: EMail): string | null {
  let value = headerValue(email, kVoteHeader);
  if (!value) {
    return null;
  }
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function tallyText(tally: VotingTally[]): string {
  return tally.map(entry => `${entry.option} — ${entry.voters.length}`).join(", ") || gt`No replies yet`;
}
