<vbox flex class="scheduled-page">
  <hbox class="header">
    <CalendarClockIcon size="18px" />
    <h2>{$t`Scheduled`}</h2>
    {#if $scheduledSends.items.length}
      <span class="count">{$scheduledSends.items.length}</span>
    {/if}
    <hbox flex />
    <RoundButton
      label={$t`Refresh`}
      icon={RefreshIcon}
      iconSize="16px"
      border={false}
      disabled={refreshing}
      onClick={() => catchErrors(refresh)} />
    <RoundButton
      label={$t`Close`}
      icon={CloseIcon}
      iconSize="16px"
      border={false}
      onClick={() => $scheduledViewOpen = false} />
  </hbox>

  {#if $scheduledSends.error}
    <hbox class="notice">
      <ErrorMessageInline
        ex={new Error($t`Could not load scheduled messages: ${$scheduledSends.error}`)}
        onRetry={() => catchErrors(refresh)} />
    </hbox>
  {/if}

  <vbox flex class="list" role="list" aria-busy={!$scheduledSends.loaded}>
    {#if !$scheduledSends.loaded}
      {#each [0, 1, 2] as index (index)}
        <hbox class="row skeleton" aria-hidden="true">
          <span class="dot" />
          <span class="bar" style="width: {64 - index * 14}%" />
        </hbox>
      {/each}
      <span class="sr-only" role="status">{$t`Loading scheduled messages…`}</span>
    {:else if !$scheduledSends.items.length && !$scheduledSends.error}
      <vbox class="empty">
        <CalendarClockIcon size="32px" />
        <span class="empty-title">{$t`No scheduled messages`}</span>
        <span class="hint">{$t`To send a message later, open the menu next to Send in the message editor and choose Send later.`}</span>
      </vbox>
    {:else}
      {#each $scheduledSends.items as item (item.id)}
        <hbox class="row" class:failed={item.status == "failed"} role="listitem">
          <span class="state" aria-hidden="true">
            {#if busyID == item.id || item.status == "sending"}
              <Spinner size="16px" />
            {:else if item.status == "failed"}
              <AlertIcon size="16px" />
            {:else if item.mode == "server"}
              <ServerIcon size="16px" />
            {:else}
              <ClockIcon size="16px" />
            {/if}
          </span>
          <vbox flex class="text">
            <span class="title">{item.subject || $t`(no subject)`}</span>
            <span class="meta">
              <span class="time" class:overdue={item.status == "failed"}>{statusText(item)}</span>
              {#if item.recipients}
                <span class="secondary" title={item.recipients}>{item.recipients}</span>
              {/if}
            </span>
            <span class="where">{whereText(item)}</span>
            {#if item.error}
              <span class="error" title={item.error}>
                {item.status == "failed" ? item.error : $t`Retrying: ${item.error}`}
              </span>
            {/if}
          </vbox>
          <hbox class="actions">
            <Button
              label={item.status == "failed" ? $t`Try again` : $t`Send now`}
              icon={SendIcon}
              plain
              disabled={busyID != null || item.status == "sending"}
              onClick={() => run(item, sendScheduledNow)} />
            <Button
              label={$t`Edit message`}
              icon={PencilIcon}
              plain
              iconOnly
              disabled={busyID != null || item.status == "sending"}
              onClick={() => run(item, editScheduled)} />
            <Button
              label={$t`Delete`}
              icon={TrashIcon}
              plain
              iconOnly
              disabled={busyID != null || item.status == "sending"}
              onClick={() => run(item, deleteWithConfirm)} />
          </hbox>
        </hbox>
      {/each}
    {/if}
  </vbox>
</vbox>

<script lang="ts">
  import {
    deleteScheduled, editScheduled, refreshScheduledSends, scheduledSends, scheduledViewOpen, sendScheduledNow,
    type ScheduledSendItem,
  } from "./scheduledSend";
  import { formatFollowUpDate } from "../FollowUp/followUpReminders";
  import Button from "../../Shared/Button.svelte";
  import Spinner from "../../Shared/Spinner.svelte";
  import RoundButton from "../../Shared/RoundButton.svelte";
  import ErrorMessageInline from "../../Shared/ErrorMessageInline.svelte";
  import CalendarClockIcon from "lucide-svelte/icons/calendar-clock";
  import ClockIcon from "lucide-svelte/icons/clock";
  import ServerIcon from "lucide-svelte/icons/server";
  import AlertIcon from "lucide-svelte/icons/triangle-alert";
  import SendIcon from "lucide-svelte/icons/send";
  import PencilIcon from "lucide-svelte/icons/pencil";
  import TrashIcon from "lucide-svelte/icons/trash-2";
  import RefreshIcon from "lucide-svelte/icons/refresh-cw";
  import CloseIcon from "lucide-svelte/icons/x";
  import { catchErrors } from "../../Util/error";
  import { onMount } from "svelte";
  import { t } from "../../../l10n/l10n";

  let busyID: number | null = null;
  let refreshing = false;

  onMount(() => {
    catchErrors(refresh);
  });

  async function refresh() {
    refreshing = true;
    try {
      await refreshScheduledSends();
    } finally {
      refreshing = false;
    }
  }

  function whereText(item: ScheduledSendItem): string {
    let where = item.mode == "server" ? $t`Waiting on the Exchange server` : $t`Waiting in Jackdaw Mail`;
    return item.accountName ? `${where} · ${item.accountName}` : where;
  }

  function statusText(item: ScheduledSendItem): string {
    if (item.status == "failed") {
      return $t`Not sent`;
    }
    if (item.status == "sending") {
      return $t`Sending…`;
    }
    return $t`Send at ${formatFollowUpDate(item.sendAt)}`;
  }

  async function deleteWithConfirm(item: ScheduledSendItem) {
    if (!confirm($t`Delete the scheduled message "${item.subject || $t`(no subject)`}"? It will not be sent.`)) {
      return;
    }
    await deleteScheduled(item);
  }

  function run(item: ScheduledSendItem, action: (item: ScheduledSendItem) => Promise<void>) {
    if (busyID != null) {
      return;
    }
    busyID = item.id;
    catchErrors(async () => {
      try {
        await action(item);
      } finally {
        busyID = null;
      }
    });
  }
</script>

<style>
  .scheduled-page {
    min-width: 0;
    min-height: 0;
    background: var(--main-bg);
    color: var(--main-fg);
    container: scheduled-page / inline-size;
  }
  .header {
    align-items: center;
    gap: 8px;
    min-height: 44px;
    padding: 4px 8px 4px 16px;
    border-block-end: 1px solid var(--border);
  }
  h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
  }
  .count {
    min-width: 18px;
    padding: 0 6px;
    box-sizing: border-box;
    border-radius: 9px;
    background: color-mix(in srgb, var(--main-fg) 10%, transparent);
    font-size: 11px;
    font-weight: 500;
    line-height: 18px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .notice {
    margin: 8px 16px 0;
  }
  .list {
    min-height: 0;
    padding: 8px 8px 16px;
    overflow-y: auto;
  }
  .row {
    align-items: flex-start;
    gap: 12px;
    padding: 10px 8px 10px 12px;
    border-radius: var(--border-radius);
  }
  .row:hover {
    background: var(--hover-bg);
  }
  .row + .row {
    border-block-start: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
  }
  .state {
    display: flex;
    flex: none;
    padding-block-start: 2px;
    color: color-mix(in srgb, var(--main-fg) 55%, transparent);
  }
  .row.failed .state {
    color: var(--danger-fg);
  }
  .text {
    min-width: 0;
    gap: 2px;
  }
  .title {
    overflow: hidden;
    font-size: 13px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    display: flex;
    gap: 8px;
    min-width: 0;
    font-size: 12px;
  }
  .time {
    flex: none;
    font-variant-numeric: tabular-nums;
  }
  .time.overdue {
    color: var(--danger-fg);
    font-weight: 600;
  }
  .secondary {
    overflow: hidden;
    color: color-mix(in srgb, var(--main-fg) 64%, transparent);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .where {
    overflow: hidden;
    color: color-mix(in srgb, var(--main-fg) 55%, transparent);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .error {
    color: var(--danger-fg);
    font-size: 12px;
    line-height: 1.4;
    overflow-wrap: anywhere;
  }
  .actions {
    flex: none;
    align-items: center;
    gap: 2px;
  }
  .hint {
    margin: 0;
    color: color-mix(in srgb, var(--main-fg) 60%, transparent);
    font-size: 12px;
    line-height: 1.45;
  }
  .empty {
    align-items: center;
    gap: 8px;
    margin: 48px auto 0;
    max-width: 26em;
    padding: 0 16px;
    color: color-mix(in srgb, var(--main-fg) 45%, transparent);
    text-align: center;
  }
  .empty-title {
    color: var(--main-fg);
    font-size: 14px;
    font-weight: 600;
  }
  .row.skeleton {
    align-items: center;
    min-height: 52px;
  }
  .row.skeleton:hover {
    background: none;
  }
  .skeleton .dot,
  .skeleton .bar {
    background: color-mix(in srgb, var(--main-fg) 9%, transparent);
    animation: pulse 1.4s ease-in-out infinite;
  }
  .skeleton .dot {
    flex: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
  }
  .skeleton .bar {
    height: 10px;
    border-radius: 5px;
  }
  @keyframes pulse {
    50% {
      opacity: 0.45;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .skeleton .dot,
    .skeleton .bar {
      animation: none;
    }
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  /* Узкое окно: кнопки под текстом */
  @container scheduled-page (max-width: 520px) {
    .row {
      flex-wrap: wrap;
    }
    .actions {
      flex-basis: 100%;
      justify-content: flex-end;
    }
  }
</style>
