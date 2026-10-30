{#if replyMessage}
  <hbox class="show-reply font-small">
    <Button
      icon={ReplyIcon}
      iconSize="16px"
      label={$t`Show reply`}
      onClick={showReply}
      plain
      />
  </hbox>
{/if}

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import { findReplyToMessage } from "../../../logic/Mail/findReplyToMessage";
  import { openEMailMessage } from "../open";
  import { getOpenMessageHandler } from "../openMessageContext";
  import Button from "../../Shared/Button.svelte";
  import ReplyIcon from "lucide-svelte/icons/reply";
  import { t } from "../../../l10n/l10n";

  export let message: EMail;

  const openHere = getOpenMessageHandler();
  let replyMessage: EMail | undefined;
  let lookupKey = "";

  $: void refreshReply(message);

  async function refreshReply(current: EMail) {
    if (!current?.isReplied || !current.messageID) {
      replyMessage = undefined;
      lookupKey = "";
      return;
    }
    let key = `${current.dbID ?? ""}:${current.messageID}:${current.isReplied}`;
    lookupKey = key;
    let reply = await findReplyToMessage(current);
    if (lookupKey == key) {
      replyMessage = reply;
    }
  }

  function showReply() {
    if (replyMessage) {
      if (openHere) {
        openHere(replyMessage);
        return;
      }
      void openEMailMessage(replyMessage);
    }
  }
</script>

<style>
  .show-reply {
    margin-block: 0.5rem 0.25rem;
    padding: 0.375rem 0.625rem;
    border-radius: 6px;
    background-color: var(--surface-subtle, color-mix(in srgb, var(--border) 18%, transparent));
    border: 1px solid var(--border);
    width: fit-content;
    max-width: 100%;
  }
  .show-reply :global(button) {
    font-variant-numeric: tabular-nums;
  }
</style>
