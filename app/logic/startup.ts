import { appGlobal } from './app';
import { readMailAccounts } from './Mail/AccountsList/MailAccounts';
import { readChatAccounts } from './Chat/AccountsList/ChatAccounts';
import { readAddressbooks } from './Contacts/AccountsList/Addressbooks';
import { readCalendars } from './Calendar/AccountsList/Calendars';
import { readMeetAccounts } from './Meet/AccountsList/MeetAccounts';
import { readFileSharingAccounts } from './Files/AccountsList/FileSharingAccounts';
import { readTopicAccounts } from './Topic/TopicAccounts';
import { readSavedSearches } from './Mail/Virtual/SavedSearchFolder';
import { loadWorkspaces } from './Abstract/Workspace';
import { loadTagsList } from './Abstract/Tag';
import { loadTagCombinations } from './Abstract/TagCombination';
import { type Account, getAllAccounts, setMainAccounts } from './Abstract/Account';
import { getComputerOn } from './util/backend-wrapper';
import JPCWebSocket from '../../lib/jpc-ws';
import { production, webMail } from './build';
import { retryOnTransientError } from './util/netUtil';
import { catchErrors, logError, showError } from '../frontend/Util/error';
import { OWAAccount } from './Mail/OWA/OWAAccount';
import { assert, sleep } from './util/util';
import { refreshProEntitlement } from './Billing/ProEntitlement';

/** Read JPC secret from frontent URL hash `jpcSecret=password`.
 * Before svelte-navigator `<Router>` mounts and rewrites `location.hash` */
let startupURLParameters = new URLSearchParams(location.hash.slice(1));
let jpcSecretFromURL = startupURLParameters.get("jpcSecret");
let demoModeFromURL = startupURLParameters.get("demo") == "1";

export function isDemoMode(): boolean {
  return demoModeFromURL;
}

/**
 * Desktop: frontend URL hash `jpcSecret=password`
 * Mobile: Capacitor IPC bridge
 */
async function getJPCSecret(): Promise<string> {
  // #if [MOBILE]
  // runtime-registered `Capacitor.Plugins.NodeJS` from `capacitor-nodejs`
  const NodeJS = (globalThis as any).Capacitor?.Plugins?.CapacitorNodeJS;
  await NodeJS.whenReady();
  return await new Promise<string>(async (resolve, reject) => {
    try {
      const listener = await NodeJS.addListener('jpc:secret', (data: { args: any[] }) => {
        listener.remove();
        resolve(data.args[0]);
      });
      await NodeJS.send({ eventName: 'jpc:get-secret', args: [] });
    } catch (ex) {
      reject(ex);
    }
  });
  // #else
  if (webMail) {
    return "";
  }
  assert(jpcSecretFromURL, "No JPC secret was passed in the frontend URL");
  return jpcSecretFromURL;
  // #endif
}

async function connectToBackend(jpc: JPCWebSocket, secret: string, port: number) {
  const delaysMS = [0, 300, 700, 1500, 3000];
  let lastEx: Error | undefined;
  for (let delayMS of delaysMS) {
    if (delayMS) {
      await sleep(delayMS / 1000);
    }
    try {
      await jpc.connect(secret, "localhost", port);
      return;
    } catch (ex) {
      lastEx = ex as Error;
    }
  }
  throw lastEx ?? new Error("JPC: Could not connect to backend");
}

export async function getStartObjects(): Promise<void> {
  const secret = await getJPCSecret();
  let jpc = new JPCWebSocket(null);
  await connectToBackend(jpc, secret, production ? 5455 : 5453);
  jpc.errorCallback = showError;
  jpc.reconnectCallback = checkAccounts;
  console.log("Connected to backend");
  appGlobal.remoteApp = await jpc.getRemoteStartObject();
  await loadWorkspaces();
  appGlobal.emailAccounts.addAll(await readMailAccounts());
  appGlobal.chatAccounts.addAll(await readChatAccounts());
  appGlobal.meetAccounts.addAll(await readMeetAccounts());
  appGlobal.fileSharingAccounts.addAll(await readFileSharingAccounts());
  appGlobal.addressbooks.addAll(await readAddressbooks());
  appGlobal.calendars.addAll(await readCalendars());
  appGlobal.topicAccounts.addAll(await readTopicAccounts());
  setMainAccounts();

  // TODO Save the address book type and ensure that they are of the right type
  appGlobal.personalAddressbook = appGlobal.addressbooks.first;
  appGlobal.collectedAddressbook = appGlobal.addressbooks.get(1);
  readSavedSearches();
  await loadTagsList();
  await loadTagCombinations();
  // Отдельные окна письма и редактора — свой JS-контекст. Без проверки статус Pro
  // в них навсегда остаётся «checking», и подпись Pro вырезается из письма.
  void refreshProEntitlement().catch(logError);
}

/**
 * Logs in to all accounts for which we have the credentials stored.
 *
 * @param startupErrorCallback Called for login errors.
 *   May be called multiple times, e.g. once per account.
 */
export function loginOnStartup(startupErrorCallback: (ex: Error) => void): void {
  let allAccounts = getAllAccounts();
  for (let account of allAccounts) {
    account.errorCallback = (ex) => backgroundErrorInAccount(ex, account);
  }
  for (let account of allAccounts) {
    (async () => {
      await account.readFromDB();
      if (account.loginOnStartup && !account.isDependentAccount) {
        await account.login(false);
        await account.startup();
      }
    })().catch(errorWithAccountName(account, startupErrorCallback));
  }

  checkWakeUp();
}

/** When the computer wakes up from sleep mode, or the network comes back up,
 * log in again and check for new mail. Connections are re-opened as needed. */
export function checkWakeUp(): void {
  let wasSleeping = false;
  let computerOn = getComputerOn();
  computerOn.subscribe(() => catchErrors(async () => {
    await sleep(1);
    if (wasSleeping && !computerOn.isSleeping && navigator.onLine) {
      checkAccounts();
    }
    // If the network is still down here, the `online` event below follows
    wasSleeping = computerOn.isSleeping;
  }));
  window.addEventListener("online", checkAccounts); // network is back up
}

/** On wake up */
function checkAccounts(): void {
  for (let account of getAllAccounts()) {
    if (!account.isLoggedIn && account.loginOnStartup && !account.isDependentAccount) {
      if (account instanceof OWAAccount) {
        account.recoverAfterNetworkRestored().catch(account.errorCallback);
        continue;
      }
      // VPN tunnel needs several seconds after the computer network woke up
      retryOnTransientError(async () => {
        await account.login(false);
        await account.startup();
      }, 2, 4).catch(account.errorCallback);
    }
  }
  // Accounts that stayed logged in didn't run startup() above,
  // but new mail may have arrived while we were sleeping
  for (let account of appGlobal.emailAccounts) {
    if (account.isLoggedIn && !account.isDependentAccount) {
      if (account instanceof OWAAccount) {
        account.recoverAfterNetworkRestored().catch(account.errorCallback);
      } else {
        account.inbox?.getNewMessages()
          .catch(account.errorCallback);
      }
    }
  }
}

function errorWithAccountName(account: Account, errorCallback: (ex: Error) => void) {
  return (ex: Error) => {
    account.addError(ex);
    addAccountName(ex, account);
    errorCallback(ex);
  };
}

function backgroundErrorInAccount(ex: Error, account: Account) {
  account.addError(ex);
  addAccountName(ex, account);
  logError(ex);
}

/** The account name is shown to the user, but must not end up in `ex.message`:
 * We send the message to the error log server, where the account name would
 * deanonymize the user and prevent grouping of identical errors.
 * `errorMessage()` adds it back for the console and UI. */
function addAccountName(ex: Error, account: Account) {
  if (ex) {
    (ex as any).accountName = account.name;
  }
}
