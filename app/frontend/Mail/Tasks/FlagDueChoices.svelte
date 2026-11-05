{#each kFlagPresets as preset (preset)}
  <button type="button" class="choice" {disabled}
    on:click={() => catchErrors(() => onSelect(preset))}>
    <CalendarIcon size="14px" />
    <span class="label">{presetLabel(preset)}</span>
    <span class="day">{presetDay(preset, now)}</span>
  </button>
{/each}
<form class="custom" on:submit|preventDefault={submitCustom}>
  <label>
    <span>{$t`Custom date`}</span>
    <input type="date" bind:value={customValue} min={localDay(now)} {disabled} />
  </label>
  <Button label={$t`Set`} plain disabled={disabled || !sanitizeDay(customValue)} />
</form>

<script lang="ts" context="module">
  import type { FlagDueChoice } from "../../../logic/Mail/Tasks/ExchangeTask";
  import { gt } from "../../../l10n/l10n";

  export const kFlagPresets: Exclude<FlagDueChoice, { dueDay: string }>[] = ["today", "tomorrow", "this-week", "next-week", "no-date"];

  export function presetLabel(preset: Exclude<FlagDueChoice, { dueDay: string }>): string {
    switch (preset) {
      case "today": return gt`Today`;
      case "tomorrow": return gt`Tomorrow`;
      case "this-week": return gt`This week`;
      case "next-week": return gt`Next week`;
      default: return gt`No date`;
    }
  }
</script>

<script lang="ts">
  import { flagDaysForChoice, localDay, sanitizeDay, type DayString } from "../../../logic/Mail/Tasks/ExchangeTask";
  import { formatTaskDay } from "./formatTaskDay";
  import Button from "../../Shared/Button.svelte";
  import CalendarIcon from "lucide-svelte/icons/calendar";
  import { catchErrors } from "../../Util/error";
  import { t } from "../../../l10n/l10n";

  export let dueDay: DayString | null = null;
  export let disabled = false;
  export let onSelect: (choice: FlagDueChoice) => void | Promise<void>;

  let now = new Date();
  let customValue = dueDay ?? "";

  function presetDay(preset: Exclude<FlagDueChoice, { dueDay: string }>, now: Date): string {
    let { dueDay } = flagDaysForChoice(preset, now);
    return dueDay ? formatTaskDay(dueDay, now) : "";
  }

  function submitCustom() {
    let day = sanitizeDay(customValue);
    if (day && !disabled) {
      catchErrors(() => onSelect({ dueDay: day }));
    }
  }
</script>

<style>
  .choice {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 32px;
    padding: 4px 8px;
    border: none;
    border-radius: var(--border-radius);
    background: transparent;
    color: var(--main-fg);
    font: inherit;
    font-size: 13px;
    text-align: start;
    cursor: default;
  }
  .choice:hover:not(:disabled) {
    background: var(--hover-bg);
    color: var(--hover-fg);
  }
  .choice:focus-visible {
    outline: 2px solid var(--icon-primary);
    outline-offset: 1px;
  }
  .choice:disabled {
    opacity: 0.5;
  }
  .label {
    flex: 1 1 auto;
  }
  .day {
    color: color-mix(in srgb, currentColor 58%, transparent);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  .custom {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    margin-top: 6px;
  }
  .custom label {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    gap: 4px;
    min-width: 0;
    color: color-mix(in srgb, var(--main-fg) 64%, transparent);
    font-size: 12px;
  }
  .custom input {
    min-height: 30px;
    padding: 4px 8px;
    box-sizing: border-box;
    border: 1px solid var(--border);
    border-radius: var(--border-radius);
    background: var(--main-bg);
    color: var(--main-fg);
    font: inherit;
    font-size: 13px;
  }
</style>
