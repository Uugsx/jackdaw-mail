<!-- Вкладки «Отсортированные / Другие» над списком «Входящих», как в Outlook -->
{#if isFocusedFolder(folder, $enabled.value)}
  <hbox class="focused-tabs" role="tablist">
    <button type="button" role="tab" class="tab font-small"
      aria-selected={$focusedTab == "focused"}
      class:selected={$focusedTab == "focused"}
      on:click={() => $focusedTab = "focused"}>
      {$t`Focused`}
    </button>
    <button type="button" role="tab" class="tab font-small"
      aria-selected={$focusedTab == "other"}
      class:selected={$focusedTab == "other"}
      on:click={() => $focusedTab = "other"}>
      {$t`Other *=> Focused Inbox tab with less important mail`}
      {#if otherUnread}
        <span class="unread" title={$t`Unread`}>{otherUnread}</span>
      {/if}
    </button>
  </hbox>
{/if}

<script lang="ts">
  import type { Folder } from "../../../logic/Mail/Folder";
  import { createClassifier, focusedClassificationChanged, focusedInboxEnabled } from "../../../logic/Mail/Focused/FocusedInbox";
  import { focusedTab, isFocusedFolder } from "./focusedView";
  import { t } from "../../../l10n/l10n";

  export let folder: Folder | null;

  const enabled = focusedInboxEnabled();

  /** Непрочитанные в «Других», как счётчик у вкладки в Outlook */
  $: otherUnread = isFocusedFolder(folder, $enabled.value) && $focusedClassificationChanged >= 0 && $focusedTab == "focused"
    ? countOtherUnread(folder)
    : 0;
  function countOtherUnread(folder: Folder): number {
    let classify = createClassifier();
    return folder.messages.contents.filter(email => !email.isRead && classify(email) == "other").length;
  }
</script>

<style>
  .focused-tabs {
    gap: 4px;
    padding: 4px 12px 0px 12px;
    border-bottom: 1px solid var(--border);
  }
  .tab {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    padding: 6px 10px;
    color: inherit;
    opacity: 0.7;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .tab:hover {
    opacity: 1;
  }
  .tab.selected {
    opacity: 1;
    font-weight: 600;
    border-bottom-color: var(--icon-primary, currentColor);
  }
  .tab:focus-visible {
    outline: 2px solid var(--icon-primary, currentColor);
    outline-offset: -2px;
  }
  .unread {
    font-size: 11px;
    font-weight: 600;
    padding: 0px 6px;
    border-radius: 10px;
    background-color: color-mix(in srgb, var(--icon-primary, #0066cc) 15%, transparent);
  }
</style>
