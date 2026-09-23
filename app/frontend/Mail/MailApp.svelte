{#if $openFolderProperties}
  <FolderPropertiesPage
    bind:folder={$selectedFolder}
    bind:selectedAccount={$selectedAccount}
    {accounts} />
{:else if view == "chat"}
  <MailChat {accounts} />
{:else}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <vbox flex class="mail-app-root"
    on:keydown={event => catchErrors(() => onKeyOnList(event))}
    tabindex={-1}>
    <ThreePane {accounts} {folders}
        bind:searchMessages
        bind:selectedAccount={$selectedAccount}
        bind:selectedFolder={$selectedFolder}
        bind:selectedMessage={$selectedMessage}
        bind:selectedMessages={$selectedMessages}
        horizontal={view != "widetable"} />
  </vbox>
{/if}

<script lang="ts">
  import { showAccounts } from "../../logic/Mail/AccountsList/ShowAccounts";
  import type { Folder } from "../../logic/Mail/Folder";
  import type { EMail } from "../../logic/Mail/EMail";
  import { selectedAccount, selectedFolder, selectedMessage, selectedMessages } from "./Selected";
  import { selectedWorkspace } from "../MainWindow/Selected";
  import { getLocalStorage } from "../Util/LocalStorage";
  import { SpecialFolder } from "../../logic/Mail/Folder";
  import { findInboxFolder } from "./mailUnreadCounts";
  import ThreePane from "./3pane/3Pane.svelte";
  import MailChat from "./MailChat/MailChat.svelte";
  import FolderPropertiesPage, { openFolderProperties } from "./FolderPropertiesPage.svelte";
  import { ArrayColl } from "svelte-collections";
  import { onKeyOnList } from "./Message/MessageKeyboard";
  import { catchErrors } from "../Util/error";

  $: accounts = showAccounts.filterObservable(acc => acc.workspace == $selectedWorkspace || !$selectedWorkspace); // || acc == allAccountsAccount
  $: folders = $selectedAccount?.rootFolders ?? new ArrayColl<Folder>();

  let searchMessages: ArrayColl<EMail> | null;

  let viewSetting = getLocalStorage("mail.view", "widetable");
  $: view = $viewSetting.value;

  let fixedWrongStartupFolder = false;

  $: $folders, selectInbox();

  /** We read the folders from the database and fetch them from the server only
   * after the window is up, so we can select the inbox once they are there. */
  function selectInbox() {
    let account = $selectedAccount;
    if (!account) {
      return;
    }
    let inbox = findInboxFolder(account);
    if (!inbox || inbox.specialFolder !== SpecialFolder.Inbox) {
      return;
    }
    let current = $selectedFolder;
    if (!current) {
      $selectedFolder = inbox;
      return;
    }
    if (fixedWrongStartupFolder) {
      return;
    }
    if (current.account === account &&
        current.specialFolder !== SpecialFolder.Inbox &&
        (current.specialFolder === SpecialFolder.Sent || current === account.rootFolders.first)) {
      $selectedFolder = inbox;
    }
    fixedWrongStartupFolder = true;
  }
</script>

<style>
  .mail-app-root {
    box-sizing: border-box;
    flex: 1 0 0;
    min-width: 0;
    min-height: 0;
    margin-inline: 8px;
    margin-block: 8px;
    overflow: hidden;
    border-radius: var(--border-radius);
    background: var(--main-bg);
    outline: none;
  }

  :global(.main-window.mobile) .mail-app-root {
    margin-block-start: 0;
  }
</style>
