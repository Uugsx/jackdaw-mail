{#if $message.isStarred && $message.flagDueDay}
  <MenuLabel label={$t`Due ${formatTaskDay($message.flagDueDay)}`} />
{/if}
{#each kFlagPresets as preset (preset)}
  <MenuItem
    label={presetLabel(preset)}
    icon={preset == "no-date" ? FlagIcon : CalendarIcon}
    onClick={() => setDue(preset)} />
{/each}
<MenuItem
  label={$t`Custom date…`}
  icon={CalendarClockIcon}
  onClick={pickDate} />
{#if $message.isStarred}
  <MenuDivider />
  <MenuItem
    label={$t`Mark as complete`}
    icon={CheckIcon}
    onClick={() => runAndRefresh(mail => mail.markFlagComplete())} />
  <MenuItem
    label={$t`Clear flag`}
    icon={FlagOffIcon}
    onClick={() => runAndRefresh(mail => mail.clearFlag())} />
{/if}

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import type { FlagDueChoice } from "../../../logic/Mail/Tasks/ExchangeTask";
  import { kFlagPresets, presetLabel } from "./FlagDueChoices.svelte";
  import { formatTaskDay } from "./formatTaskDay";
  import { pickFlagDate } from "./pickFlagDate";
  import { runMailActions } from "../mailBulkActions";
  import { refreshFlaggedEMails } from "./tasksStore";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import MenuLabel from "../../Shared/Menu/MenuLabel.svelte";
  import MenuDivider from "../../Shared/Menu/MenuDivider.svelte";
  import CalendarIcon from "lucide-svelte/icons/calendar";
  import CalendarClockIcon from "lucide-svelte/icons/calendar-clock";
  import FlagIcon from "lucide-svelte/icons/flag";
  import FlagOffIcon from "lucide-svelte/icons/flag-off";
  import CheckIcon from "lucide-svelte/icons/check";
  import { t } from "../../../l10n/l10n";

  export let message: EMail;
  /** Все выбранные письма; по умолчанию — только это */
  export let messages: EMail[] = [message];

  $: targets = messages?.length ? messages : [message];

  async function setDue(choice: FlagDueChoice) {
    await runAndRefresh(mail => mail.setFlagDue(choice));
  }

  /** Список задач и счётчик в левой панели видят новый флажок сразу */
  async function runAndRefresh(action: (mail: EMail) => Promise<void>) {
    try {
      await runMailActions(targets, action);
    } finally {
      await refreshFlaggedEMails().catch(() => undefined);
    }
  }

  async function pickDate() {
    let dueDay = await pickFlagDate($message.flagDueDay);
    if (dueDay) {
      await setDue({ dueDay });
    }
  }
</script>
