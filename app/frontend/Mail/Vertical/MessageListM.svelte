<vbox flex class="message-list-pane"
  on:swipedown={() => catchErrors(onCheckMail)}>
  <FolderHeader folder={selectedFolder} {searchMessages} />
  <FetchingM folder={selectedFolder} bind:this={fetching} />
  <VerticalMessageList {messages} folder={selectedFolder} emptyDueToFilter={!!searchMessages} bind:selectedMessage bind:selectedMessages bind:isAtTop
    on:click={() => catchErrors(goToMessage)} />
  <FolderFooter folder={selectedFolder} bind:searchMessages showGetMail={false} />
  <MessageListBarM folder={selectedFolder} />
</vbox>

<script lang="ts">
  import type { Folder } from "../../../logic/Mail/Folder";
  import type { EMail } from "../../../logic/Mail/EMail";
  import { openEMailMessage } from "../open";
  import VerticalMessageList from "./VerticalMessageList.svelte";
  import FolderHeader from "../LeftPane/FolderHeader.svelte";
  import FolderFooter from "../LeftPane/FolderFooter.svelte";
  import MessageListBarM from "./MessageListBarM.svelte";
  import FetchingM from "./FetchingM.svelte";
  import { catchErrors } from "../../Util/error";
  import { sleep, assert } from "../../../logic/util/util";
  import type { ArrayColl } from 'svelte-collections';

  export let messages: ArrayColl<EMail>; /** in */
  export let searchMessages: ArrayColl<EMail> | null; /** out */
  export let selectedFolder: Folder; /** in */
  export let selectedMessage: EMail; /** in/out */
  export let selectedMessages: ArrayColl<EMail>; /** in/out */

  async function goToMessage() {
    await sleep(0.1); // wait for `<VerticalMessageList>` to set `selectedMessage`
    assert(selectedMessage, "Need message");
    await openEMailMessage(selectedMessage);
  }

  /** From FastList. read only */
  let isAtTop: boolean;
  let fetching: FetchingM;
  async function onCheckMail() {
    if (!isAtTop) {
      return;
    }
    await fetching.onCheckMail();
  }
</script>

<style>
  .message-list-pane {
    background-color: var(--main-bg);
    color: var(--main-fg);
  }
  .message-list-pane {
    box-shadow: 1px 0px 6px 0px rgba(0, 0, 0, 8%); /* Also on MessageList */
    z-index: 2;
  }
</style>
