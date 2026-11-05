{#if entries.length}
  <ul class="call-log" aria-label={$t`Recent calls`}>
    {#each entries as entry (entry.id)}
      <li class="entry" class:missed={entry.missed}>
        <span class="kind" aria-hidden="true">
          <svelte:component this={kindIcon(entry)} size={16} />
        </span>
        <span class="text">
          <span class="name">{entry.name}</span>
          <span class="summary font-small">{callLogSummary(entry)}</span>
        </span>
        <time class="time font-small" datetime={new Date(entry.at).toISOString()}>{getDateTimeString(new Date(entry.at))}</time>
        <span class="actions">
          <Button
            icon={PhoneIcon}
            iconOnly
            plain
            label={$t`Call ${entry.name}`}
            onClick={() => startAudioCall(target(entry))}
            {errorCallback} />
          <Button
            icon={VideoIcon}
            iconOnly
            plain
            label={$t`Video call ${entry.name}`}
            onClick={() => startVideoCall(target(entry))}
            {errorCallback} />
          {#if removable}
            <Button
              icon={RemoveIcon}
              iconOnly
              plain
              label={$t`Remove from call history`}
              onClick={() => removeCallLogEntry(entry)}
              {errorCallback} />
          {/if}
        </span>
      </li>
    {/each}
  </ul>
{:else}
  <slot name="emptyMsg" />
{/if}

<script lang="ts">
  import { loadCallLog, callLogSummary, removeCallLogEntry, type CallLogEntry } from "../../../logic/Meet/Jackdaw/callLog";
  import { startAudioCall, startVideoCall } from "../../../logic/Meet/StartCall";
  import { PersonUID } from "../../../logic/Abstract/PersonUID";
  import Button from "../../Shared/Button.svelte";
  import PhoneIcon from "lucide-svelte/icons/phone";
  import PhoneIncomingIcon from "lucide-svelte/icons/phone-incoming";
  import PhoneOutgoingIcon from "lucide-svelte/icons/phone-outgoing";
  import PhoneMissedIcon from "lucide-svelte/icons/phone-missed";
  import VideoIcon from "lucide-svelte/icons/video";
  import RemoveIcon from "lucide-svelte/icons/x";
  import { getDateTimeString } from "../../Util/date";
  import { showError } from "../../Util/error";
  import { t } from "../../../l10n/l10n";

  /** Сколько последних звонков показать; null — все */
  export let limit: number | null = null;
  /** Можно убрать отдельный звонок из журнала */
  export let removable = false;
  export let errorCallback = showError;

  const callLog = loadCallLog();
  $: entries = limit == null ? $callLog.contents : $callLog.contents.slice(0, limit);

  function target(entry: CallLogEntry): PersonUID {
    return new PersonUID(entry.email, entry.name);
  }

  function kindIcon(entry: CallLogEntry) {
    if (entry.missed) {
      return PhoneMissedIcon;
    }
    if (entry.video) {
      return VideoIcon;
    }
    return entry.outgoing ? PhoneOutgoingIcon : PhoneIncomingIcon;
  }
</script>

<style>
  .call-log {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .entry {
    display: grid;
    grid-template-columns: 24px minmax(0, 1fr) auto auto;
    align-items: center;
    column-gap: 8px;
    min-height: 48px;
    padding: 4px 8px;
    border-radius: 8px;
  }
  .entry:hover,
  .entry:focus-within {
    background-color: var(--hover-bg);
    color: var(--hover-fg);
  }
  .kind {
    display: flex;
    justify-content: center;
    opacity: 0.75;
  }
  .missed .kind,
  .missed .summary {
    color: var(--danger-fg);
    opacity: 1;
  }
  .text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .name,
  .summary {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .name {
    font-weight: 600;
    line-height: 1.3;
  }
  .summary {
    opacity: 0.75;
    line-height: 1.3;
  }
  .time {
    font-variant-numeric: tabular-nums;
    opacity: 0.75;
    white-space: nowrap;
  }
  .actions {
    display: flex;
  }
</style>
