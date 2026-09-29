<Route path="compose">
  {#if !appGlobal.isMobile && shouldOpenComposeInWindow()}
    <FloatingComposeRedirect mail={params?.mail ?? $selectedFolder.newEMail()} />
  {:else}
    <MailComposer mail={params?.mail ?? $selectedFolder.newEMail()} />
  {/if}
</Route>
{#if appGlobal.isMobile}
  <Route path="folder/:accountID/:folderID/message-list">
    <MsgListM
      messages={searchMessages ?? params?.messages ?? $selectedFolder?.messages ?? requiredParam()}
      bind:searchMessages
      selectedFolder={$selectedFolder}
      bind:selectedMessage={$selectedMessage}
      bind:selectedMessages={$selectedMessages} />
  </Route>
  <Route path="message/:accountID/:folderID/:messageID/display">
    <MessageDisplay message={params?.message ?? $selectedMessage ?? requiredParam()} />
  </Route>
  <Route path="person">
    <SearchResultsM searchMessages={params.searchMessages ?? requiredParam()} />
  </Route>
  <Route path="search">
    <SearchM />
  </Route>
  <Route path="/">
    <AccountsM
      {accounts}
      {folders}
      bind:selectedAccount={$selectedAccount}
      bind:selectedFolder={$selectedFolder} />
  </Route>
{:else}
  <Route path="/">
    <MailApp />
  </Route>
{/if}

<script lang="ts">
  import { showAccounts } from "../../logic/Mail/AccountsList/ShowAccounts";
  import type { Folder } from "../../logic/Mail/Folder";
  import type { EMail } from "../../logic/Mail/EMail";
  import { selectedAccount, selectedFolder, selectedMessage, selectedMessages, folderSyncing, setFolderFetchBusy } from "./Selected";
  import { selectedWorkspace } from "../MainWindow/Selected";
  import { getLocalStorage } from "../Util/LocalStorage";
  import { appGlobal } from "../../logic/app";
  import MailApp from "./MailApp.svelte";
  import MailComposer from "./Composer/MailComposer.svelte";
  import FloatingComposeRedirect from "./Composer/FloatingComposeRedirect.svelte";
  import { shouldOpenComposeInWindow } from "./Composer/composeFloating";
  import MsgListM from "./Vertical/MessageListM.svelte";
  import SearchM from "./Search/SearchM.svelte";
  import SearchResultsM from "./Search/SearchResultsM.svelte";
  import MessageDisplay from "./Message/MessageDisplay.svelte";
  import AccountsM from "./LeftPane/AccountsM.svelte";
  import { ArrayColl } from "svelte-collections";
  import { getParams } from "../AppsBar/selectedApp";
  import { requiredParam } from "../Util/route";
  import { catchErrors } from "../Util/error";
  import { Route, useLocation } from "svelte-navigator";
  import { onDestroy } from "svelte";
  import { OWAAccount } from "../../logic/Mail/OWA/OWAAccount";
  import { OWAFolder } from "../../logic/Mail/OWA/OWAFolder";
  import { OWAError } from "../../logic/Mail/OWA/OWAError";

  $: accounts = showAccounts.filterObservable(acc => acc.workspace == $selectedWorkspace || !$selectedWorkspace); // ?? acc == allAccountsAccount
  $: folders = $selectedAccount?.rootFolders ?? new ArrayColl<Folder>();
  $: location = useLocation();
  $: params = getParams($location?.state);
  $: params, setFolder()
  // Set only when params.foo changes, not when $selectedFoo changes
  let lastAccount = null;
  let lastFolder = null;
  function setFolder() {
    if (params.account && params.account != lastAccount) {
      $selectedAccount = params.account;
      lastAccount = params.account;
    }
    if (params.folder && params.folder != lastFolder) {
      $selectedFolder = params.folder;
      lastFolder = params.folder;
    }
  }

  let searchMessages: ArrayColl<EMail> | null;

  $: $selectedFolder, catchErrors(() => loadFolder($selectedFolder));
  $: $selectedFolder, setupOpenFolderWatch($selectedFolder);
  $: watchSharedFolder($selectedFolder);

  /** Tell the main OWA poller which shared folder is open so it refreshes like Inbox. */
  function watchSharedFolder(folder: Folder | null | undefined): void {
    for (let account of appGlobal.emailAccounts) {
      if (account instanceof OWAAccount && account.isDependentAccount && account !== folder?.account) {
        account.setWatchedFolder(null).catch(account.errorCallback);
      }
    }
    if (folder instanceof OWAFolder && folder.account instanceof OWAAccount && folder.account.isDependentAccount) {
      folder.account.setWatchedFolder(folder).catch(folder.account.errorCallback);
    }
  }
  onDestroy(() => {
    watchSharedFolder(null);
    clearSharedWatchTimer();
    clearPrimaryWatchTimer();
    clearMetadataWatchTimer();
    teardownOpenFolderWatch();
  });

  /** Background push updates folder badges but not the open list — mirror loadFolder(). */
  let openFolderUnsub: (() => void) | undefined;
  let openFolderRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  let openFolderCounts = { unread: 0, total: 0, newArrived: 0 };

  function teardownOpenFolderWatch(): void {
    openFolderUnsub?.();
    openFolderUnsub = undefined;
    if (openFolderRefreshTimer) {
      clearTimeout(openFolderRefreshTimer);
      openFolderRefreshTimer = null;
    }
  }

  function setupOpenFolderWatch(folder: Folder | undefined): void {
    teardownOpenFolderWatch();
    if (!folder) {
      return;
    }
    folder.markViewed();
    openFolderCounts = {
      unread: folder.countUnread,
      total: folder.countTotal,
      newArrived: folder.countNewArrived,
    };
    openFolderUnsub = folder.subscribe((_obj, prop) => {
      onOpenFolderPropertyChange(folder, prop);
    });
  }

  function onOpenFolderPropertyChange(folder: Folder, prop: string | null): void {
    let countsIncreased =
      folder.countUnread > openFolderCounts.unread ||
      folder.countTotal > openFolderCounts.total ||
      folder.countNewArrived > openFolderCounts.newArrived;
    openFolderCounts = {
      unread: folder.countUnread,
      total: folder.countTotal,
      newArrived: folder.countNewArrived,
    };
    if (!countsIncreased) {
      return;
    }
    scheduleOpenFolderRefresh(folder);
  }

  function scheduleOpenFolderRefresh(folder: Folder): void {
    if (openFolderRefreshTimer) {
      clearTimeout(openFolderRefreshTimer);
    }
    openFolderRefreshTimer = setTimeout(() => {
      openFolderRefreshTimer = null;
      catchErrors(() => refreshOpenFolderMessages(folder));
    }, 50);
  }

  async function refreshOpenFolderMessages(folder: Folder): Promise<void> {
    if ($selectedFolder !== folder || folder.account.protocol != "owa") {
      return;
    }
    let owaFolder = folder as OWAFolder;
    await owaFolder.syncRecentArrivals();
    folder.notifyObservers();
  }

  /** While a shared folder is open, refresh it on a short interval (delegate access, one folder). */
  let sharedWatchTimer: ReturnType<typeof setInterval> | null = null;
  let primaryWatchTimer: ReturnType<typeof setInterval> | null = null;
  let metadataWatchTimer: ReturnType<typeof setInterval> | null = null;
  function clearSharedWatchTimer(): void {
    if (sharedWatchTimer) {
      clearInterval(sharedWatchTimer);
      sharedWatchTimer = null;
    }
  }
  function clearPrimaryWatchTimer(): void {
    if (primaryWatchTimer) {
      clearInterval(primaryWatchTimer);
      primaryWatchTimer = null;
    }
  }
  function clearMetadataWatchTimer(): void {
    if (metadataWatchTimer) {
      clearInterval(metadataWatchTimer);
      metadataWatchTimer = null;
    }
  }
  async function refreshOpenFolderMetadata(folder: OWAFolder): Promise<void> {
    if ($selectedFolder !== folder || !folder.account.isLoggedIn) {
      return;
    }
    await folder.refreshVisibleMessageMetadata();
    folder.notifyObservers();
  }
  $: {
    clearSharedWatchTimer();
    clearPrimaryWatchTimer();
    clearMetadataWatchTimer();
    let folder = $selectedFolder;
    if (folder instanceof OWAFolder && folder.account instanceof OWAAccount && folder.account.isLoggedIn) {
      let tick = () => {
        if ($selectedFolder !== folder || !folder.account.isLoggedIn) {
          return;
        }
        catchErrors(async () => {
          if (!(folder instanceof OWAFolder) ||
              (!folder.unreadCountsDifferFromServer() && !folder.isBehindServer())) {
            return;
          }
          await folder.syncRecentArrivals();
          folder.notifyObservers();
        });
      };
      let metadataTick = () => {
        void refreshOpenFolderMetadata(folder as OWAFolder);
      };
      if (folder.account.isDependentAccount) {
        sharedWatchTimer = setInterval(tick, 3_000);
      } else if (folder.account.protocol == "owa") {
        primaryWatchTimer = setInterval(tick, 2_000);
      }
      metadataWatchTimer = setInterval(metadataTick, folder.visibleMetadataRefreshIntervalMs());
    }
  }

  async function loadFolder(folder: Folder) {
    if (!folder) {
      return;
    }
    setFolderFetchBusy(folder, true);
    if ($selectedFolder === folder) {
      folderSyncing.set(true);
    }
    try {
      if ($selectedMessage?.folder != folder) {
        $selectedMessage = null;
      }
      if (folder.account.protocol == "owa") {
        let owaFolder = folder as OWAFolder;
        await owaFolder.syncOnFolderOpen();
        folder.notifyObservers();
      } else {
        let newMessages = await folder.listMessages();
        await folder.downloadMessages(newMessages);
      }
    } catch (ex) {
      if (ex.authFail) {
        if (!folder.account.isLoggedIn) {
          await folder.account.login(true);
          await folder.listMessages();
        }
      } else if (ex instanceof OWAError && ex.isSessionLimit) {
        // Keep showing cached messages; shared mailbox sessions recover later.
      } else {
        folder.account.errorCallback(ex);
      }
    } finally {
      if ($selectedFolder === folder) {
        folderSyncing.set(false);
      }
      setFolderFetchBusy(folder, false);
    }
  }

  let viewSetting = getLocalStorage("mail.view", "vertical");
  $: view = $viewSetting.value;

  /*
  function ensureFolder(folder: Writable<Folder>, params: any): string {
    if (get(folder)) {
      return "";
    }
    folder.set(getFolderByID(params.accountID, params.folderID));
    return "";
  }
  function ensureMessage(message: Writable<EMail>, params: any): string {
    if (get(message)) {
      return "";
    }
    message.set(getMessageByID(params.accountID, params.folderID, params.messageID));
    return "";
  }
  function getAccountByID(accountID: string): MailAccount {
    let account = appGlobal.emailAccounts.find(acc => acc.id == accountID);
    assert(account, `Account ID ${accountID} not found`);
    return account;
  }
  function getFolderByID(accountID: string, folderID: string): Folder {
    let account = getAccountByID(accountID);
    let folder = account.findFolder(folder => folder.id == folderID);
    assert(folder, `Folder ID ${folderID} in account ${account.name} not found`);
    return folder;
  }
  function getMessageByID(accountID: string, folderID: string, messageID: string): EMail {
    let folder = getFolderByID(accountID, folderID);
    let message = folder.messages.find(msg => msg.id == messageID);
    assert(message, `Message ID ${messageID} in folder ${folder.name} in account ${folder.account.name} not found`);
    return message;
  }
  */
</script>
