/**
 * Подключение чата Jackdaw к соединению сервиса звонков.
 * Аккаунт чата создаётся сам, когда у пользователя появляется подтверждённый адрес:
 * отдельной настройки для него нет, так же как для звонков.
 */
import { appGlobal } from "../../app";
import { newChatAccountForProtocol } from "../AccountsList/ChatAccounts";
import { JackdawChatAccount, JACKDAW_CHAT_PROTOCOL } from "./JackdawChatAccount";
import type { JackdawCallClient } from "../../Meet/Jackdaw/JackdawCallClient";

let creating: Promise<JackdawChatAccount> | null = null;

export function getJackdawChatAccount(): JackdawChatAccount | null {
  return (appGlobal.chatAccounts.find(acc => acc.protocol == JACKDAW_CHAT_PROTOCOL) as JackdawChatAccount | undefined) ?? null;
}

async function ensureAccount(client: JackdawCallClient): Promise<JackdawChatAccount> {
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
