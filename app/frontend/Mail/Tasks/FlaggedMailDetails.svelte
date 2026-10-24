<vbox class="details">
  <hbox class="top">
    <span class="kind">{$t`Flagged message`}</span>
    <hbox flex />
    <RoundButton
      label={$t`Close`}
      icon={CloseIcon}
      iconSize="14px"
      border={false}
      onClick={() => dispatch("close")} />
  </hbox>

  <h3>{row.subject || $t`(no subject)`}</h3>
  {#if row.contactName || row.contactEmail}
    <span class="from">{row.contactName || row.contactEmail}</span>
  {/if}
  <span class="due">
    {row.dueDay ? $t`Due ${formatTaskDay(row.dueDay)}` : $t`No due date`}
  </span>

  <vbox class="choices" role="group" aria-label={$t`Due date`}>
    <FlagDueChoices
      dueDay={row.dueDay}
      disabled={busy}
      onSelect={choice => run(() => setFlaggedDue(row, choice))} />
  </vbox>

  <ErrorMessageInline ex={error} onClose={() => error = null} />

  <hbox class="actions">
    <Button
      label={$t`Open message`}
      icon={OpenIcon}
      plain
      disabled={busy}
      onClick={() => openFlaggedEMail(row)} />
    <Button
      label={$t`Mark as complete`}
      icon={CheckIcon}
      plain
      disabled={busy}
      onClick={() => run(() => completeFlagged(row))} />
    <Button
      label={$t`Clear flag`}
      icon={FlagOffIcon}
      plain
      disabled={busy}
      onClick={() => run(() => clearFlagged(row))} />
  </hbox>
</vbox>

<script lang="ts">
  import { clearFlagged, completeFlagged, openFlaggedEMail, setFlaggedDue } from "./tasksStore";
  import type { FlaggedEMailRow } from "../../../logic/Mail/Tasks/ExchangeTaskData";
  import { formatTaskDay } from "./formatTaskDay";
  import FlagDueChoices from "./FlagDueChoices.svelte";
  import Button from "../../Shared/Button.svelte";
  import RoundButton from "../../Shared/RoundButton.svelte";
  import ErrorMessageInline from "../../Shared/ErrorMessageInline.svelte";
  import CloseIcon from "lucide-svelte/icons/x";
  import CheckIcon from "lucide-svelte/icons/check";
  import OpenIcon from "lucide-svelte/icons/mail-open";
  import FlagOffIcon from "lucide-svelte/icons/flag-off";
  import { createEventDispatcher } from "svelte";
  import { t } from "../../../l10n/l10n";

  export let row: FlaggedEMailRow;

  const dispatch = createEventDispatcher<{ close: void }>();
  let busy = false;
  let error: Error | null = null;

  async function run(action: () => Promise<void>) {
    busy = true;
    error = null;
    try {
      await action();
    } catch (ex) {
      error = ex;
    } finally {
      busy = false;
    }
  }
</script>

<style>
  .details {
    gap: 8px;
    padding: 12px 16px 16px;
  }
  .top {
    align-items: center;
    min-height: 28px;
  }
  .kind {
    color: color-mix(in srgb, var(--main-fg) 60%, transparent);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }
  h3 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }
  .from,
  .due {
    color: color-mix(in srgb, var(--main-fg) 64%, transparent);
    font-size: 12px;
    overflow-wrap: anywhere;
  }
  .choices {
    gap: 2px;
    margin-block: 4px;
  }
  .actions {
    flex-wrap: wrap;
    gap: 4px 8px;
  }
</style>
