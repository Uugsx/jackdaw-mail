<!-- Подменю «Напомнить ответить»: те же сроки, что у «Отложить», письмо остаётся во «Входящих» -->
{#if reminder}
  <MenuLabel label={$t`Reminder at ${formatTime(new Date(reminder.at))}`} />
{/if}
{#each kSnoozePresets as preset}
  <MenuItem
    label={presetLabel(preset)}
    tooltip={formatTime(replyReminderTime(preset))}
    icon={ClockIcon}
    onClick={() => setReplyReminder(message, replyReminderTime(preset))} />
{/each}
<MenuItem
  label={$t`Pick date and time…`}
  icon={CalendarIcon}
  onClick={pickDate} />
{#if reminder}
  <MenuDivider />
  <MenuItem
    label={$t`Remove reminder`}
    icon={BellOffIcon}
    onClick={() => clearReplyReminder(message)} />
{/if}

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import { kSnoozePresets, type SnoozePreset } from "../../../logic/Mail/Snooze/Snooze";
  import {
    clearReplyReminder, findReplyReminder, replyReminderTime, replyRemindersChanged, setReplyReminder,
  } from "../../../logic/Mail/ReplyReminder/ReplyReminder";
  import { pickReplyReminderDate } from "./pickReplyReminderDate";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import MenuLabel from "../../Shared/Menu/MenuLabel.svelte";
  import MenuDivider from "../../Shared/Menu/MenuDivider.svelte";
  import ClockIcon from "lucide-svelte/icons/clock";
  import CalendarIcon from "lucide-svelte/icons/calendar-clock";
  import BellOffIcon from "lucide-svelte/icons/bell-off";
  import { getDateTimeLocale, t } from "../../../l10n/l10n";

  export let message: EMail;

  $: reminder = $replyRemindersChanged >= 0 ? findReplyReminder(message) : null;

  function presetLabel(preset: SnoozePreset): string {
    switch (preset) {
      case "later-today": return $t`Later today`;
      case "tomorrow": return $t`Tomorrow`;
      case "weekend": return $t`This weekend`;
      default: return $t`Next week`;
    }
  }

  function formatTime(date: Date): string {
    return date.toLocaleString(getDateTimeLocale(), { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  async function pickDate() {
    let at = await pickReplyReminderDate(reminder ? new Date(reminder.at) : undefined);
    if (at) {
      setReplyReminder(message, at);
    }
  }
</script>
