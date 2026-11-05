<vbox class="scheduled-sends" aria-label={$t`Scheduled`}>
  {#if !$scheduledSends.loaded}
    <hbox class="state" role="status">{$t`Loading scheduled messages…`}</hbox>
  {:else if $scheduledSends.error && !items.length}
    <vbox class="state error" role="alert">
      <span>{$t`Could not load scheduled messages.`}</span>
      <button type="button" class="retry" on:click={() => catchErrors(refreshScheduledSends)}>{$t`Retry`}</button>
    </vbox>
  {:else if !items.length}
    <vbox class="state empty">
      <span>{$t`No scheduled messages.`}</span>
      <span class="hint">{$t`Use the arrow next to Send in the message editor and choose “Send later”.`}</span>
    </vbox>
  {:else}
    <vbox class="rows">
      {#each items as item (item.queueID)}
        <hbox class="row" class:failed={item.status == "failed"} class:paused={item.status == "paused"}
          on:contextmenu={event => openMenu(event, item)}>
          <button type="button" class="open"
            title={rowTooltip(item)}
            disabled={item.status == "sending"}
            on:click={() => catchErrors(() => editScheduledSend(item.queueID))}>
            <span class="subject">{item.subject || $t`(no subject)`}</span>
            <span class="meta">
              <span class="when">{statusText(item, now)}</span>
              <span class="recipients">{recipientsText(item)}</span>
            </span>
            {#if item.status == "failed" && scheduledSendErrorText(item)}
              <span class="error-text">{scheduledSendErrorText(item)}</span>
            {/if}
          </button>
          <button type="button" class="more"
            aria-label={$t`Scheduled message actions`}
            title={$t`Scheduled message actions`}
            disabled={item.status == "sending"}
            on:click={event => openMenu(event, item)}>
            <MoreIcon size="14px" />
          </button>
        </hbox>
      {/each}
    </vbox>
  {/if}
</vbox>

<ContextMenu bind:this={contextMenu}>
  {#if menuItem}
    <MenuItem
      label={$t`Edit`}
      icon={EditIcon}
      onClick={() => editScheduledSend(menuItem.queueID)} />
    <MenuItem
      label={menuItem.status == "failed" ? $t`Retry now` : $t`Send now`}
      icon={SendIcon}
      onClick={() => sendScheduledNow(menuItem.queueID)} />
    {#if menuItem.status == "paused"}
      <MenuItem
        label={$t`Resume`}
        icon={ResumeIcon}
        onClick={() => resumeScheduledSend(menuItem.queueID)} />
    {:else if menuItem.status != "failed"}
      <MenuItem
        label={$t`Cancel sending`}
        icon={PauseIcon}
        onClick={() => pauseScheduledSend(menuItem.queueID)} />
    {/if}
    <MenuDivider />
    <MenuItem
      label={$t`Delete`}
      icon={TrashIcon}
      onClick={() => onDelete(menuItem)} />
  {/if}
</ContextMenu>

<script lang="ts">
  import { onMount } from "svelte";
  import type { ScheduledSend } from "../../../logic/Mail/SendLater/SendLater";
  import {
    deleteScheduledSendFromUI, editScheduledSend, pauseScheduledSend, refreshScheduledSends,
    resumeScheduledSend, scheduledSendErrorText, scheduledSends, sendScheduledNow,
  } from "./sendQueue";
  import { formatSendLaterTime } from "./pickSendLaterDate";
  import { accountName } from "../FollowUp/followUpReminders";
  import { appGlobal } from "../../../logic/app";
  import ContextMenu from "../../Shared/Menu/ContextMenu.svelte";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import MenuDivider from "../../Shared/Menu/MenuDivider.svelte";
  import MoreIcon from "lucide-svelte/icons/ellipsis";
  import EditIcon from "lucide-svelte/icons/pencil";
  import SendIcon from "lucide-svelte/icons/send";
  import ResumeIcon from "lucide-svelte/icons/play";
  import PauseIcon from "lucide-svelte/icons/circle-pause";
  import TrashIcon from "lucide-svelte/icons/trash-2";
  import { catchErrors } from "../../Util/error";
  import { gt, t } from "../../../l10n/l10n";

  const MINUTE_MS = 60_000;

  let contextMenu: ContextMenu;
  let menuItem: ScheduledSend | null = null;
  let now = new Date();

  // Короткая задержка отмены не «запланирована»: её видно на полосе внизу
  $: items = $scheduledSends.items.filter(item => item.kind == "later" || item.status != "pending");
  $: emailAccounts = appGlobal.emailAccounts;
  $: showAccount = $emailAccounts.length > 1;

  onMount(() => {
    void refreshScheduledSends();
    let interval = setInterval(() => now = new Date(), MINUTE_MS);
    return () => clearInterval(interval);
  });

  function statusText(item: ScheduledSend, at: Date): string {
    switch (item.status) {
      case "sending":
        return $t`Sending…`;
      case "failed":
        return $t`Not sent`;
      case "paused":
        return $t`Paused`;
      case "server":
        return $t`Server sends ${formatSendLaterTime(item.sendAt, at)}`;
      default:
        return item.attempts > 0
          ? $t`No connection. Will retry at ${formatSendLaterTime(item.sendAt, at)}`
          : formatSendLaterTime(item.sendAt, at);
    }
  }

  function recipientsText(item: ScheduledSend): string {
    let recipients = item.recipients.slice(0, 2).join(", ") +
      (item.recipients.length > 2 ? ` +${item.recipients.length - 2}` : "");
    return showAccount
      ? [accountName(item.accountID), recipients].filter(Boolean).join(" · ")
      : recipients;
  }

  function rowTooltip(item: ScheduledSend): string {
    return [item.subject, item.recipients.join(", "), scheduledSendErrorText(item)]
      .filter(Boolean).join("\n");
  }

  function openMenu(event: MouseEvent, item: ScheduledSend) {
    if (item.status == "sending") {
      return;
    }
    menuItem = item;
    contextMenu.onContextMenu(event);
  }

  async function onDelete(item: ScheduledSend) {
    if (!confirm(gt`Delete the scheduled message “${item.subject || gt`(no subject)`}”? It will not be sent.`)) {
      return;
    }
    await deleteScheduledSendFromUI(item.queueID);
  }
</script>

<style>
  .scheduled-sends {
    padding: 2px 0 4px 22px;
    min-width: 0;
  }
  .state {
    padding: 4px 8px;
    color: color-mix(in srgb, var(--leftbar-fg) 64%, transparent);
    font-size: 11px;
    line-height: 1.4;
  }
  .state.error {
    color: var(--danger-fg, #c62828);
    align-items: flex-start;
    gap: 2px;
  }
  .state.empty {
    gap: 2px;
  }
  .hint {
    color: color-mix(in srgb, var(--leftbar-fg) 52%, transparent);
  }
  .retry {
    padding: 0;
    border: none;
    background: transparent;
    color: inherit;
    font: inherit;
    text-decoration: underline;
    cursor: pointer;
  }
  .rows {
    max-height: 264px;
    overflow-y: auto;
    gap: 2px;
  }
  .row {
    align-items: stretch;
    min-width: 0;
    border-radius: var(--border-radius);
  }
  .row:hover,
  .row:focus-within {
    background: var(--hover-bg);
    color: var(--hover-fg);
  }
  .open {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
    padding: 4px 4px 4px 8px;
    border: none;
    border-radius: var(--border-radius);
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: start;
    cursor: default;
  }
  .open:disabled {
    opacity: 0.6;
  }
  .subject,
  .recipients {
    display: block;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Время и причина ошибки важнее всего: переносятся, а не обрезаются */
  .when,
  .error-text {
    display: block;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .error-text {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .subject {
    font-size: 12px;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    column-gap: 6px;
    min-width: 0;
    font-size: 11px;
    line-height: 1.35;
    color: color-mix(in srgb, currentColor 62%, transparent);
  }
  .when {
    flex: 0 1 auto;
    max-width: 100%;
  }
  .recipients {
    flex: 1 1 64px;
  }
  .row.failed .when,
  .error-text {
    color: var(--danger-fg, #c62828);
  }
  .row.failed .when {
    font-weight: 600;
  }
  .error-text {
    font-size: 11px;
  }
  .row.paused .when {
    font-style: italic;
  }
  .more {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 24px;
    width: 24px;
    padding: 0;
    border: none;
    border-radius: var(--border-radius);
    background: transparent;
    color: inherit;
    opacity: 0;
    cursor: default;
  }
  .row:hover .more,
  .row:focus-within .more,
  .more:focus-visible {
    opacity: 1;
  }
  .open:focus-visible,
  .more:focus-visible {
    outline: 2px solid var(--icon-primary);
    outline-offset: -2px;
  }
</style>
