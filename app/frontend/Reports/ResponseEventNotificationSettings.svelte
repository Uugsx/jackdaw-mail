<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import { t } from "../../l10n/l10n";
  import NotificationSounds from "../Settings/Mail/NotificationSounds.svelte";
  import type { NotificationSoundEvent } from "../Shared/NotificationSound";

  export let notifyWhenOverdue = false;
  export let notifyWhenTakenInWork = false;
  export let disabled = false;

  const soundEvents: NotificationSoundEvent[] = [
    "sla-taken-in-work",
    "sla-overdue",
  ];
  const dispatch = createEventDispatcher<{ change: void }>();

  function notifyChanged(): void {
    dispatch("change");
  }
</script>

<fieldset class="event-notification-settings">
  <legend>{$t`SLA event notifications`}</legend>
  <p class="event-notification-help">
    {$t`Choose separately which SLA events should show a notification. Each event has its own sound.`}
  </p>

  <div class="event-notification-toggles">
    <label class="event-notification-toggle">
      <input
        type="checkbox"
        bind:checked={notifyWhenTakenInWork}
        {disabled}
        on:change={notifyChanged}
      />
      <span>
        <strong>{$t`Notify when a request is taken into work`}</strong>
        <small
          >{$t`A message is considered taken when it is read or assigned an employee category.`}</small
        >
      </span>
    </label>
    <label class="event-notification-toggle">
      <input
        type="checkbox"
        bind:checked={notifyWhenOverdue}
        {disabled}
        on:change={notifyChanged}
      />
      <span>
        <strong>{$t`Notify when a request becomes overdue`}</strong>
        <small
          >{$t`The notification appears once when the working SLA target is exceeded.`}</small
        >
      </span>
    </label>
  </div>

  <div class="event-notification-sounds">
    <span class="event-notification-label">{$t`Event sounds`}</span>
    <NotificationSounds events={soundEvents} />
  </div>
</fieldset>

<style>
  .event-notification-settings {
    min-width: 0;
    min-inline-size: 0;
    margin: 13px 0 0;
    padding: 11px 0 0;
    border: 0;
    border-top: 1px solid color-mix(in srgb, var(--border) 62%, transparent);
  }

  .event-notification-settings legend {
    padding: 0 5px 0 0;
    color: color-mix(in srgb, var(--main-fg) 72%, transparent);
    font-size: 12px;
    font-weight: 700;
  }

  .event-notification-help {
    margin: 0;
    color: color-mix(in srgb, var(--main-fg) 64%, transparent);
    font-size: 12px;
    line-height: 1.4;
  }

  .event-notification-toggles {
    display: grid;
    gap: 7px;
    margin-top: 9px;
  }

  .event-notification-toggle {
    display: flex;
    align-items: flex-start;
    gap: 7px;
    min-width: 0;
    color: color-mix(in srgb, var(--main-fg) 78%, transparent);
    font-size: 12px;
    line-height: 1.35;
  }

  .event-notification-toggle input {
    flex: 0 0 auto;
    margin-top: 1px;
    accent-color: var(--reports-accent, #b97616);
  }

  .event-notification-toggle span {
    display: grid;
    min-width: 0;
    gap: 2px;
  }

  .event-notification-toggle strong {
    font-weight: 700;
  }

  .event-notification-toggle small {
    color: color-mix(in srgb, var(--main-fg) 64%, transparent);
    font-size: 12px;
    line-height: 1.35;
  }

  .event-notification-sounds {
    min-width: 0;
    margin-top: 11px;
    padding-top: 10px;
    border-top: 1px solid color-mix(in srgb, var(--border) 62%, transparent);
  }

  .event-notification-label {
    display: block;
    margin-bottom: 4px;
    color: color-mix(in srgb, var(--main-fg) 67%, transparent);
    font-size: 12px;
    font-weight: 700;
  }

  .event-notification-sounds :global(.sound-list) {
    gap: 5px;
  }

  .event-notification-sounds :global(.sound-row) {
    min-height: 34px;
    padding-block: 3px 5px;
  }

  .event-notification-sounds :global(.sound-copy) {
    min-width: 120px;
  }

  .event-notification-sounds :global(.sound-copy label) {
    font-size: 12px;
    font-weight: 700;
  }

  .event-notification-sounds :global(.sound-copy .hint) {
    font-size: 12px;
  }

  .event-notification-sounds :global(select) {
    min-height: 30px;
    min-width: 112px;
    font-size: 12px;
  }

  .event-notification-sounds :global(.preview-button) {
    width: 27px;
    height: 27px;
  }

  @media (max-width: 600px) {
    .event-notification-sounds :global(.sound-row) {
      flex-wrap: wrap;
    }

    .event-notification-sounds :global(.sound-copy) {
      flex-basis: 100%;
    }
  }
</style>
