<!-- Подменю «Отложить»: сроки как в Outlook, свой срок и «Вернуть сейчас» -->
{#if snooze}
  <MenuLabel label={$t`Snoozed until ${formatTime(new Date(snooze.until))}`} />
{/if}
{#each kSnoozePresets as preset}
  <MenuItem
    label={presetLabel(preset)}
    tooltip={formatTime(snoozePresetTime(preset))}
    icon={ClockIcon}
    onClick={() => snoozeMessage(message, snoozePresetTime(preset))} />
{/each}
<MenuItem
  label={$t`Pick date and time…`}
  icon={CalendarIcon}
  onClick={pickDate} />
{#if snooze}
  <MenuDivider />
  <MenuItem
    label={$t`Return to Inbox now`}
    icon={UnsnoozeIcon}
    onClick={() => unsnoozeMessage(message, appGlobal.emailAccounts)} />
{/if}

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import {
    findSnooze, kSnoozePresets, snoozeMessage, snoozePresetTime, unsnoozeMessage, type SnoozePreset,
  } from "../../../logic/Mail/Snooze/Snooze";
  import { pickSnoozeDate } from "./pickSnoozeDate";
  import { appGlobal } from "../../../logic/app";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import MenuLabel from "../../Shared/Menu/MenuLabel.svelte";
  import MenuDivider from "../../Shared/Menu/MenuDivider.svelte";
  import ClockIcon from "lucide-svelte/icons/clock";
  import CalendarIcon from "lucide-svelte/icons/calendar-clock";
  import UnsnoozeIcon from "lucide-svelte/icons/inbox";
  import { getDateTimeLocale, t } from "../../../l10n/l10n";

  export let message: EMail;

  $: snooze = findSnooze(message);

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
    let until = await pickSnoozeDate(snooze ? new Date(snooze.until) : undefined);
    if (until) {
      await snoozeMessage(message, until);
    }
  }
</script>
