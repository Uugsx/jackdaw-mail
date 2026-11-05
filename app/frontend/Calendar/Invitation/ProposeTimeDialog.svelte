<div class="propose-backdrop">
  <div
    class="propose-dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby={titleId}
    tabindex="-1"
    on:keydown={onKeydown}>
    <h2 id={titleId}>{$t`Propose new time`}</h2>
    <p class="hint">{event.title ?? ""}</p>
    <div class="times">
      <label class="field">
        <span>{$t`Start`}</span>
        <hbox class="pair">
          <DateInput date={start} on:change={e => setStart(e.detail)} />
          <TimeInput time={start} on:change={e => setStart(e.detail)} />
        </hbox>
      </label>
      <label class="field">
        <span>{$t`End`}</span>
        <hbox class="pair">
          <DateInput date={end} on:change={e => setEnd(e.detail)} />
          <TimeInput time={end} on:change={e => setEnd(e.detail)} />
        </hbox>
      </label>
    </div>
    <fieldset class="response">
      <legend>{$t`Your response`}</legend>
      <label class="radio">
        <input type="radio" value={InvitationResponse.Tentative} bind:group={response} />
        {$t`Maybe *=> Maybe attend the meeting`}
      </label>
      <label class="radio">
        <input type="radio" value={InvitationResponse.Decline} bind:group={response} />
        {$t`Reject *=> Decline to attend the meeting`}
      </label>
    </fieldset>
    {#if error}
      <p class="error" role="alert">{error}</p>
    {:else}
      <p class="hint">{$t`The organizer gets your proposal and decides whether to move the meeting.`}</p>
    {/if}
    <div class="actions">
      <Button
        label={$t`Cancel`}
        plain
        onClick={cancel} />
      <Button
        label={$t`Send proposal`}
        classes="filled"
        onClick={submit} />
    </div>
  </div>
</div>

<script context="module" lang="ts">
  let nextDialogId = 0;
</script>

<script lang="ts">
  import { onMount, tick } from "svelte";
  import type { Event } from "../../../logic/Calendar/Event";
  import { InvitationResponse } from "../../../logic/Calendar/Invitation/InvitationStatus";
  import { checkTimeProposal, defaultTimeProposal, type ProposalResponse, type TimeProposal } from "../../../logic/Calendar/Invitation/TimeProposal";
  import DateInput from "../EditEvent/DateInput.svelte";
  import TimeInput from "../EditEvent/TimeInput.svelte";
  import Button from "../../Shared/Button.svelte";
  import { t } from "../../../l10n/l10n";

  export let event: Event;
  export let initialResponse: ProposalResponse = InvitationResponse.Tentative;
  export let onDone: (result: { response: ProposalResponse, proposal: TimeProposal } | null) => void;

  const titleId = `propose-time-title-${++nextDialogId}`;
  let { start, end } = defaultTimeProposal(event);
  let response: ProposalResponse = initialResponse;
  let error = "";
  let previouslyFocused: HTMLElement | null = null;

  onMount(() => {
    previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    void tick().then(() => (document.querySelector(".propose-dialog input") as HTMLInputElement)?.focus());
    return () => {
      if (previouslyFocused?.isConnected) {
        previouslyFocused.focus();
      }
    };
  });

  /** Как Outlook: начало двигает и конец, длительность сохраняется */
  function setStart(newStart: Date) {
    let duration = end.getTime() - start.getTime();
    start = newStart;
    end = new Date(newStart.getTime() + Math.max(duration, 0));
    error = "";
  }

  function setEnd(newEnd: Date) {
    end = newEnd;
    error = "";
  }

  function submit() {
    let proposal = { start, end };
    let problem = checkTimeProposal(proposal, event);
    if (problem == "end-before-start") {
      error = $t`The end must be after the start.`;
      return;
    }
    if (problem == "unchanged") {
      error = $t`This is the current time of the meeting. Choose another time.`;
      return;
    }
    if (problem) {
      error = $t`Please enter a valid date and time.`;
      return;
    }
    onDone({ response, proposal });
  }

  function cancel() {
    onDone(null);
  }

  function onKeydown(keyEvent: KeyboardEvent) {
    if (keyEvent.key == "Escape") {
      keyEvent.preventDefault();
      keyEvent.stopPropagation();
      cancel();
    }
  }
</script>

<style>
  .times {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .pair {
    gap: 8px;
  }
  .response {
    margin: 16px 0 0;
    padding: 0;
    border: none;
    font-size: 13px;
  }
  .response legend {
    padding: 0;
    margin-bottom: 6px;
    font-size: 12px;
    color: color-mix(in srgb, var(--main-fg) 72%, transparent);
  }
  .radio {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-block: 4px;
  }
  .propose-backdrop {
    position: fixed;
    inset: 0;
    z-index: 11001;
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    padding: 24px;
    background: rgba(var(--shadow-color), 0.36);
  }
  .propose-dialog {
    width: min(100%, 400px);
    box-sizing: border-box;
    padding: 20px;
    border: 1px solid var(--border);
    border-radius: var(--border-radius);
    background: var(--main-bg);
    color: var(--main-fg);
    box-shadow: 0 14px 40px rgba(var(--shadow-color), 0.24);
  }
  h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    line-height: 1.3;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 16px;
    font-size: 12px;
    color: color-mix(in srgb, var(--main-fg) 72%, transparent);
  }
  .field :global(input) {
    min-height: 32px;
    padding: 4px 8px;
    box-sizing: border-box;
    border: 1px solid var(--border);
    border-radius: var(--border-radius);
    background: var(--main-bg);
    color: var(--main-fg);
    font: inherit;
    font-size: 13px;
  }
  .field :global(input:focus-visible) {
    outline: 2px solid var(--icon-primary);
    outline-offset: 1px;
  }
  .error, .hint {
    margin: 8px 0 0;
    font-size: 12px;
    line-height: 1.4;
  }
  .error {
    color: var(--danger-fg, #c62828);
  }
  .hint {
    color: color-mix(in srgb, var(--main-fg) 72%, transparent);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 20px;
  }
  @media (max-width: 480px) {
    .propose-backdrop {
      padding: 16px;
    }
    .propose-dialog {
      padding: 16px;
    }
  }
</style>
