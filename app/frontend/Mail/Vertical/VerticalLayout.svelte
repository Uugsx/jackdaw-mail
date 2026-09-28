<Splitter name="mail.vertical.folders" initialRightRatio={4}>
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
    <Splitter name="mail.vertical.msgs" initialRightRatio={2}>
      <vbox flex class="message-list-pane" slot="left">
        <FolderHeader folder={selectedFolder} {searchMessages} />
        <MailUndoToast />
        {#key selectedFolder?.id ?? ""}
        <VerticalMessageList {messages} folder={selectedFolder} emptyDueToFilter={!!searchMessages}
          bind:selectedMessage bind:selectedMessages />
        {/key}
        <FolderFooter folder={selectedFolder} bind:searchMessages />
      </vbox>
      <vbox flex class="message-display-pane mail-backdrop" slot="right">
        {#if selectedMessage}
          <MessageDisplay message={selectedMessage} />
        {:else}
          <StartPage />
        {/if}
      </vbox>
    </Splitter>
  </vbox>
</Splitter>

<script lang="ts">
  import type { MailAccount } from "../../../logic/Mail/MailAccount";
  import type { Folder } from "../../../logic/Mail/Folder";
  import type { EMail } from "../../../logic/Mail/EMail";
  import { selectedSearchTab } from "../Selected";
  import VerticalMessageList from "./VerticalMessageList.svelte";
  import LeftPane from "../LeftPane/LeftPane.svelte";
  import MessageDisplay from "../Message/MessageDisplay.svelte";
  import StartPage from "../StartPage.svelte";
  import FolderHeader from "../LeftPane/FolderHeader.svelte";
  import FolderFooter from "../LeftPane/FolderFooter.svelte";
  import MailToolbar from "../MailToolbar.svelte";
  import MailUndoToast from "../MailUndoToast.svelte";
  import Splitter from "../../Shared/Splitter.svelte";
  import { ArrayColl, type Collection } from 'svelte-collections';

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
</script>

<style>
  .message-list-pane,
  .message-display-pane {
    background-color: var(--main-bg);
    color: var(--main-fg);
  }
  .message-list-pane {
    box-shadow: 1px 0px 6px 0px rgba(0, 0, 0, 8%); /* Also on MessageList */
    z-index: 2;
    position: relative;
  }
  .mail-main {
    min-width: 0;
    background-color: var(--main-bg);
  }
</style>
