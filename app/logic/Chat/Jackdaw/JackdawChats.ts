/**
 * Подключение чата Jackdaw к соединению сервиса звонков.
 * Аккаунт чата создаётся сам, когда у пользователя появляется подтверждённый адрес:
 * отдельной настройки для него нет, так же как для звонков.
 */
import { appGlobal } from "../../app";
import { newChatAccountForProtocol } from "../AccountsList/ChatAccounts";
import { JackdawChatAccount, JACKDAW_CHAT_PROTOCOL } from "./JackdawChatAccount";
import type { JackdawCallClient } from "../../Meet/Jackdaw/JackdawCallClient";
import type { ChatAccount } from "../ChatAccount";
// #if [!WEBMAIL]
import { SQLChatAccount } from "../SQL/SQLChatAccount";
// #endif

let creating: Promise<JackdawChatAccount> | null = null;
let removingDuplicates: Promise<void> | null = null;

/* Соединение с сервером может открыться раньше, чем сохранённые аккаунты
 * прочитаны из базы. Тогда «аккаунта нет» неверно, и при каждом запуске
 * создавался ещё один аккаунт чата «Jackdaw Mail». */
let resolveSavedAccountsRead: () => void;
const savedAccountsRead = new Promise<void>(resolve => {
  resolveSavedAccountsRead = resolve;
});

/** Вызывается при запуске, когда сохранённые чат-аккаунты добавлены в `appGlobal.chatAccounts`. */
export function markChatAccountsRead(): void {
  resolveSavedAccountsRead();
}

export function getJackdawChatAccount(): JackdawChatAccount | null {
  return (appGlobal.chatAccounts.find(acc => acc.protocol == JACKDAW_CHAT_PROTOCOL) as JackdawChatAccount | undefined) ?? null;
}

async function ensureAccount(client: JackdawCallClient): Promise<JackdawChatAccount> {
  await savedAccountsRead;
  removingDuplicates ??= removeEmptyDuplicateAccounts().catch(ex => console.error(ex));
  await removingDuplicates;
  let existing = getJackdawChatAccount();
  if (existing) {
    existing.attachClient(client);
    return existing;
  }
  creating ??= (async () => {
    let account = newChatAccountForProtocol(JACKDAW_CHAT_PROTOCOL) as JackdawChatAccount;
    account.realname = appGlobal.me?.name || appGlobal.emailAccounts.first?.realname || "";
    account.workspace = appGlobal.emailAccounts.first?.workspace ?? account.workspace;
    await account.save();
    appGlobal.chatAccounts.add(account);
    account.attachClient(client);
    await account.login(false);
    return account;
  })().finally(() => {
    creating = null;
  });
  return await creating;
}

/**
 * Убирает лишние аккаунты чата Jackdaw, созданные прежней гонкой при запуске.
 * Остаётся аккаунт с перепиской (или самый первый), удаляются только пустые.
 */
export async function removeEmptyDuplicateAccounts(): Promise<void> {
  // #if [!WEBMAIL]
  let accounts: ChatAccount[] = appGlobal.chatAccounts.contents.filter(acc => acc.protocol == JACKDAW_CHAT_PROTOCOL);
  if (accounts.length < 2) {
    return;
  }
  let roomCounts = new Map<ChatAccount, number | null>();
  for (let account of accounts) {
    roomCounts.set(account, await SQLChatAccount.countRooms(account));
  }
  let keep = accounts.find(account => roomCounts.get(account)) ?? accounts[0];
  for (let account of accounts) {
    if (account != keep && roomCounts.get(account) === 0) {
      await account.deleteIt();
    }
  }
  // #endif
}

/** @returns отписка */
export function startJackdawChat(client: JackdawCallClient): () => void {
  let report = (ex: Error) => getJackdawChatAccount()?.errorCallback(ex) ?? console.error(ex);
  let check = () => {
    if (client.isOnline && client.verifiedEmails.length) {
      ensureAccount(client).catch(report);
    }
  };
  let unsubscribe = client.subscribe(check);
  return unsubscribe;
}
