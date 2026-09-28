<Splitter name="mail.3pane.folders" initialRightRatio={5}
  hasLeft={$mailFolderPaneExpandedSetting.value}
  leftMinWidth={230} rightMinWidth={560}>
  <LeftPane {accounts} {folders}
    bind:selectedAccount bind:selectedFolder bind:selectedFolders bind:searchMessages
    bind:activeTab={$selectedSearchTab}
    slot="left" />
  <vbox flex class="mail-main" slot="right">
    <MailToolbar
      {selectedAccount}
      {selectedFolder}
      {selectedMessage}
      {selectedMessages}
      bind:searchMessages />
    <vbox flex>
      <SplitterBidirectional {horizontal}
        name={horizontal ? "mail.3pane.msgs" : "mail.widetable.msgs"}
        initialSecondRatio={horizontal ? 2 : 1.55}
        firstMinPx={horizontal ? 30 : 340}
        secondMinPx={horizontal ? 30 : 480}>
        <vbox flex class="message-list-pane" slot="first">
          <FolderHeader folder={selectedFolder} {searchMessages} />
          <MailUndoToast />
          {#key selectedFolder?.id ?? ""}
            <VerticalMessageList {messages} folder={selectedFolder} emptyDueToFilter={!!searchMessages}
              bind:selectedMessage bind:selectedMessages />
          {/key}
        </vbox>
        <vbox flex class="message-display-pane mail-backdrop" slot="second">
          {#if selectedMessage}
            <MessageDisplay message={selectedMessage} />
          {:else}
            <StartPage />
          {/if}
        </vbox>
      </SplitterBidirectional>
    </vbox>
  </vbox>
</Splitter>

<script lang="ts">
  import type { MailAccount } from "../../../logic/Mail/MailAccount";
  import type { Folder } from "../../../logic/Mail/Folder";
  import type { EMail } from "../../../logic/Mail/EMail";
  import { selectedSearchTab } from "../Selected";
  import VerticalMessageList from "../Vertical/VerticalMessageList.svelte";
  import LeftPane from "../LeftPane/LeftPane.svelte";
  import FolderHeader from "../LeftPane/FolderHeader.svelte";
  import MailToolbar from "../MailToolbar.svelte";
  import MessageDisplay from "../Message/MessageDisplay.svelte";
  import StartPage from "../StartPage.svelte";
  import Splitter from "../../Shared/Splitter.svelte";
  import SplitterBidirectional from "../../Shared/SplitterBidirectional.svelte";
  import MailUndoToast from "../MailUndoToast.svelte";
  import { ArrayColl, type Collection } from 'svelte-collections';
  import { onMount } from "svelte";
  import { ensureAccountExpanded } from "../mailSidebarState";
  import { mailFolderPaneExpandedSetting } from "../mailFolderPaneState";

  export let horizontal: boolean = true;
  export let accounts: Collection<MailAccount>; /** in */
  export let folders: Collection<Folder>; /** in */
  export let searchMessages: ArrayColl<EMail> | null; /** out */
  export let selectedAccount: MailAccount; /** in/out */
  export let selectedFolder: Folder; /** in/out */
  export let selectedMessage: EMail; /** in/out */
  export let selectedMessages: ArrayColl<EMail>; /** in/out */
  let selectedFolders: ArrayColl<Folder>;

  $: folderMessages = selectedFolder?.messages;
  $: messages = searchMessages ?? folderMessages ?? new ArrayColl<EMail>();
  $: if (selectedAccount) {
    ensureAccountExpanded(selectedAccount);
  }

  onMount(() => {
    ensureFolderSplitterRatio();
  });

  function ensureFolderSplitterRatio(): void {
    let key = "ui.splitter.mail.3pane.folders";
    let raw = localStorage.getItem(key);
    if (!raw) {
      return;
    }
    try {
      let ratio = JSON.parse(raw);
      if (typeof ratio == "number" && ratio > 8) {
        localStorage.removeItem(key);
      }
    } catch {
      localStorage.removeItem(key);
    }
  }
</script>

<style>
  .mail-main {
    min-width: 0;
    background-color: var(--main-bg);
  }
  .message-list-pane,
  .message-display-pane {
    background-color: var(--main-bg);
    color: var(--main-fg);
  }
  .message-list-pane {
    container-type: inline-size;
    container-name: mail-message-list;
    min-width: 0;
    position: relative;
    --msg-list-fs: clamp(11px, 0.2rem + 2.4cqi, 14px);
    --msg-list-fs-sm: clamp(10px, 0.15rem + 2cqi, 12px);
  }
  .message-list-pane :global(.correspondent),
  .message-list-pane :global(.contact),
  .message-list-pane :global(.subject) {
    font-size: var(--msg-list-fs);
  }
  .message-list-pane :global(.date) {
    font-size: var(--msg-list-fs-sm) !important;
    min-width: 0 !important;
    font-variant-numeric: tabular-nums;
  }
  @container mail-message-list (max-width: 560px) {
    .message-list-pane :global(.attachment) {
      visibility: hidden;
      overflow: hidden;
      padding: 0;
      min-width: 0;
      max-width: 0;
    }
  }
  .message-display-pane {
    flex: 2 0 0;
    border-inline-start: 1px solid var(--border);
  }
</style>
