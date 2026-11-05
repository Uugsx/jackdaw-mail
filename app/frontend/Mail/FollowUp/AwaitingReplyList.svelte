<vbox class="awaiting-reply" aria-label={$t`Waiting for a reply`}>
  {#if !$followUpSnapshot.loaded}
    <hbox class="state" role="status">{$t`Checking for replies…`}</hbox>
  {:else if $followUpSnapshot.hasError && !reminders.length}
    <hbox class="state error" role="alert">{$t`Could not check for replies. Retrying in a minute.`}</hbox>
  {:else if !reminders.length}
    <vbox class="state empty">
      <span>{$t`Nothing is waiting for a reply.`}</span>
      <span class="hint">{$t`Use the bell in the message editor, or “Remind me if nobody replies” in the menu of a sent message.`}</span>
    </vbox>
  {:else}
    <vbox class="rows">
      {#each reminders as reminder (reminder.id)}
        <hbox class="row" class:overdue={isOverdue(reminder, now)}
          on:contextmenu={event => openMenu(event, reminder)}>
          <button type="button" class="open"
            title={rowTooltip(reminder, now)}
            on:click={() => catchErrors(() => openFollowUpMessage(reminder))}>
            <span class="subject">{reminder.subject || $t`(no subject)`}</span>
            <span class="meta">
              <span class="due">
                {isOverdue(reminder, now)
                  ? $t`Overdue since ${formatFollowUpDate(reminder.dueAt, now)}`
                  : $t`Until ${formatFollowUpDate(reminder.dueAt, now)}`}
              </span>
              <span class="recipients">{recipientsText(reminder)}</span>
            </span>
          </button>
          <button type="button" class="more"
            aria-label={$t`Reminder actions`}
            title={$t`Reminder actions`}
            on:click={event => openMenu(event, reminder)}>
            <MoreIcon size="14px" />
          </button>
        </hbox>
      {/each}
    </vbox>
  {/if}
</vbox>

<ContextMenu bind:this={contextMenu}>
  {#if menuReminder}
    <MenuItem
      label={$t`Open sent message`}
      icon={OpenIcon}
      onClick={() => openFollowUpMessage(menuReminder)} />
    <MenuDivider />
    <MenuItem
      label={$t`Snooze for 1 day`}
      icon={SnoozeIcon}
      onClick={() => snoozeFollowUp(menuReminder, 1)} />
    <MenuItem
      label={$t`Snooze for 3 days`}
      icon={SnoozeIcon}
      onClick={() => snoozeFollowUp(menuReminder, 3)} />
    <MenuItem
      label={$t`Snooze for 1 week`}
      icon={SnoozeIcon}
      onClick={() => snoozeFollowUp(menuReminder, 7)} />
    <MenuDivider />
    <MenuItem
      label={$t`Don't remind`}
      icon={BellOffIcon}
      onClick={() => cancelFollowUp(menuReminder)} />
  {/if}
</ContextMenu>

<script lang="ts">
  import { onMount } from "svelte";
  import type { FollowUpReminder } from "../../../logic/Mail/FollowUp/FollowUpReminder";
  import { followUpState } from "../../../logic/Mail/FollowUp/FollowUpReminder";
  import {
    accountName,
    cancelFollowUp,
    followUpSnapshot,
    formatFollowUpDate,
    openFollowUpMessage,
    snoozeFollowUp,
  } from "./followUpReminders";
  import { appGlobal } from "../../../logic/app";
  import ContextMenu from "../../Shared/Menu/ContextMenu.svelte";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import MenuDivider from "../../Shared/Menu/MenuDivider.svelte";
  import MoreIcon from "lucide-svelte/icons/ellipsis";
  import OpenIcon from "lucide-svelte/icons/mail-open";
  import SnoozeIcon from "lucide-svelte/icons/alarm-clock";
  import BellOffIcon from "lucide-svelte/icons/bell-off";
  import { catchErrors } from "../../Util/error";
  import { t } from "../../../l10n/l10n";

  const MINUTE_MS = 60_000;

  let contextMenu: ContextMenu;
  let menuReminder: FollowUpReminder | null = null;
  let now = new Date();

  $: reminders = $followUpSnapshot.reminders;
  $: emailAccounts = appGlobal.emailAccounts;
  $: showAccount = $emailAccounts.length > 1;

  onMount(() => {
    // Сроки и «просрочено» пересчитываются без новой проверки базы.
    let interval = setInterval(() => now = new Date(), MINUTE_MS);
    return () => clearInterval(interval);
  });

  function isOverdue(reminder: FollowUpReminder, at: Date): boolean {
    return followUpState(reminder, at) == "overdue";
  }

  function recipientsText(reminder: FollowUpReminder): string {
    let recipients = reminder.recipients.slice(0, 2).join(", ") +
      (reminder.recipients.length > 2 ? ` +${reminder.recipients.length - 2}` : "");
    return showAccount
      ? [accountName(reminder.accountId), recipients].filter(Boolean).join(" · ")
      : recipients;
  }

  function rowTooltip(reminder: FollowUpReminder, at: Date): string {
    return [
      reminder.subject,
      $t`Sent ${formatFollowUpDate(reminder.sentAt, at)}`,
      reminder.recipients.join(", "),
    ].filter(Boolean).join("\n");
  }

  function openMenu(event: MouseEvent, reminder: FollowUpReminder) {
    menuReminder = reminder;
    contextMenu.onContextMenu(event);
  }
</script>

<style>
  .awaiting-reply {
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
  }
  .state.empty {
    gap: 2px;
  }
  .hint {
    color: color-mix(in srgb, var(--leftbar-fg) 52%, transparent);
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
  .subject,
  .recipients,
  .due {
    display: block;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .subject {
    font-size: 12px;
  }
  /* Срок важнее получателей: он не обрезается, а получатели при нехватке
     места уходят на следующую строку. */
  .meta {
    display: flex;
    flex-wrap: wrap;
    column-gap: 6px;
    min-width: 0;
    font-size: 11px;
    line-height: 1.35;
    color: color-mix(in srgb, currentColor 62%, transparent);
  }
  .due {
    flex: 0 1 auto;
    max-width: 100%;
  }
  .recipients {
    flex: 1 1 64px;
  }
  .row.overdue .due {
    color: var(--danger-fg, #c62828);
    font-weight: 600;
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
