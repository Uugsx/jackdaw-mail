{#if dueAt}
  <MenuLabel label={$t`Waiting for a reply until ${formatFollowUpDate(dueAt)}`} />
{/if}
{#each FOLLOW_UP_PRESETS as preset}
  <MenuItem
    label={presetLabel(preset)}
    icon={preset.mode == "working" ? WorkingDaysIcon : CalendarDaysIcon}
    selected={isSameFollowUpChoice(preset, selected)}
    onClick={() => onSelect(preset)} />
{/each}
<MenuItem
  label={$t`Pick date and time…`}
  icon={CalendarIcon}
  selected={selected?.mode == "date"}
  onClick={pickDate} />
{#if dueAt || selected}
  <MenuDivider />
  <MenuItem
    label={$t`Don't remind`}
    icon={BellOffIcon}
    onClick={onClear} />
{/if}

<script lang="ts">
  import {
    FOLLOW_UP_PRESETS,
    isSameFollowUpChoice,
    type FollowUpChoice,
  } from "../../../logic/Mail/FollowUp/FollowUpReminder";
  import { formatFollowUpDate } from "./followUpReminders";
  import { pickFollowUpDate } from "./pickFollowUpDate";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import MenuLabel from "../../Shared/Menu/MenuLabel.svelte";
  import MenuDivider from "../../Shared/Menu/MenuDivider.svelte";
  import CalendarIcon from "lucide-svelte/icons/calendar-clock";
  import BellOffIcon from "lucide-svelte/icons/bell-off";
  import CalendarDaysIcon from "lucide-svelte/icons/clock";
  import WorkingDaysIcon from "lucide-svelte/icons/briefcase";
  import { t } from "../../../l10n/l10n";

  /** Выбор в редакторе, пока письмо не отправлено. */
  export let selected: FollowUpChoice | null = null;
  /** Срок уже поставленного напоминания у отправленного письма. */
  export let dueAt: Date | null = null;
  export let onSelect: (choice: FollowUpChoice) => void | Promise<void>;
  export let onClear: () => void | Promise<void>;

  /** Варианты фиксированы (1, 3, 7 дней): отдельные строки вместо склонения числа. */
  function presetLabel(choice: FollowUpChoice): string {
    if (choice.mode == "date") {
      return formatFollowUpDate(choice.dueAt);
    }
    if (choice.mode == "working") {
      return choice.days == 1 ? $t`In 1 working day` : $t`In 3 working days`;
    }
    return choice.days == 1
      ? $t`In 1 day`
      : choice.days == 3
        ? $t`In 3 days`
        : $t`In 1 week`;
  }

  async function pickDate() {
    let current = selected?.mode == "date" ? selected.dueAt : dueAt ?? undefined;
    let picked = await pickFollowUpDate(current);
    if (picked) {
      await onSelect({ mode: "date", dueAt: picked });
    }
  }
</script>
