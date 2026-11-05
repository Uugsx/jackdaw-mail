<vbox class="page out-of-office">
  <PageHeader
    title={$t`Automatic replies`}
    subtitle={$t`Reply automatically to people who write to you while you are away`} />

  {#if !exchangeAccount}
    <Notice tone="info" message={$t`Automatic replies are not available for this account.`} />
  {:else if loading}
    <hbox class="loading" aria-busy="true">
      <Spinner size="16px" />
      <span>{$t`Loading…`}</span>
    </hbox>
  {:else if loadError}
    <ErrorMessageInline ex={loadError} onRetry={load} />
  {:else}
    <HeaderGroupBox>
      <hbox slot="header">{$t`Status`}</hbox>
      <vbox class="choices" role="radiogroup">
        <label class="radio">
          <input type="radio" value="Disabled" bind:group={state} />
          {$t`Don't send automatic replies`}
        </label>
        <label class="radio">
          <input type="radio" value="Enabled" bind:group={state} />
          {$t`Send automatic replies`}
        </label>
        <label class="radio">
          <input type="radio" value="Scheduled" bind:group={state} />
          {$t`Send only during this time period`}
        </label>
      </vbox>
      {#if state == "Scheduled"}
        <hbox class="period">
          <label class="field">
            <span>{$t`Start`}</span>
            <input type="datetime-local" bind:value={startValue} aria-invalid={!!periodError} />
          </label>
          <label class="field">
            <span>{$t`End`}</span>
            <input type="datetime-local" bind:value={endValue} min={startValue} aria-invalid={!!periodError} />
          </label>
        </hbox>
        {#if periodError}
          <p class="field-error" role="alert">{periodError}</p>
        {/if}
      {/if}
    </HeaderGroupBox>

    <HeaderGroupBox>
      <hbox slot="header">{$t`Inside my organization`}</hbox>
      <textarea class="reply" rows="6" bind:value={internalText}
        aria-label={$t`Inside my organization`}></textarea>
    </HeaderGroupBox>

    <HeaderGroupBox>
      <hbox slot="header">{$t`Outside my organization`}</hbox>
      {#if allowExternal == "None"}
        <p class="hint">{$t`Your administrator does not allow automatic replies outside the organization.`}</p>
      {:else}
        <label class="checkbox-row">
          <input type="checkbox" bind:checked={replyExternal} />
          {$t`Reply to people outside my organization`}
        </label>
        <vbox class="choices nested" role="radiogroup">
          <label class="radio" class:disabled={!replyExternal}>
            <input type="radio" value="Known" bind:group={externalAudience} disabled={!replyExternal} />
            {$t`My contacts only`}
          </label>
          <label class="radio" class:disabled={!replyExternal || allowExternal == "Known"}>
            <input type="radio" value="All" bind:group={externalAudience}
              disabled={!replyExternal || allowExternal == "Known"} />
            {$t`Anyone outside my organization`}
          </label>
        </vbox>
        <textarea class="reply" rows="6" bind:value={externalText} disabled={!replyExternal}
          aria-label={$t`Outside my organization`}></textarea>
      {/if}
    </HeaderGroupBox>

    <ErrorMessageInline ex={saveError} onClose={() => saveError = null} />
    <hbox class="actions">
      <!-- Не `onClick`: Button после него возвращает прежний `disabled`, и кнопка оставалась активной -->
      <Button classes="primary" label={$t`Save`} on:click={save}
        disabled={saving || !dirty || !!periodError} />
      {#if savedAt && !dirty}
        <span class="saved" role="status">{$t`Saved`}</span>
      {/if}
    </hbox>
  {/if}
</vbox>

<script lang="ts">
  import type { MailAccount } from "../../../../logic/Mail/MailAccount";
  import { ExchangeMailAccount } from "../../../../logic/Mail/EWS/ExchangeMailAccount";
  import {
    outOfOfficeHTMLToText, outOfOfficeTextToHTML,
    type OutOfOfficeAudience, type OutOfOfficeSettings, type OutOfOfficeState,
  } from "../../../../logic/Mail/EWS/OutOfOffice";
  import PageHeader from "../../Shared/PageHeader.svelte";
  import HeaderGroupBox from "../../../Shared/HeaderGroupBox.svelte";
  import Notice from "../../../Shared/Notice.svelte";
  import ErrorMessageInline from "../../../Shared/ErrorMessageInline.svelte";
  import Button from "../../../Shared/Button.svelte";
  import Spinner from "../../../Shared/Spinner.svelte";
  import { t } from "../../../../l10n/l10n";

  export let account: MailAccount;

  const kHour = 60 * 60 * 1000;
  const kDay = 24 * kHour;

  $: exchangeAccount = account instanceof ExchangeMailAccount && account.canOutOfOffice ? account : null;

  let loading = true;
  let loadError: Error | null = null;
  let saving = false;
  let saveError: Error | null = null;
  let savedAt: Date | null = null;

  /** Как пришло с сервера: HTML ответа сохраняем, если текст не меняли */
  let original: OutOfOfficeSettings | null = null;
  let originalInternalText = "";
  let originalExternalText = "";

  let state: OutOfOfficeState = "Disabled";
  let startValue = "";
  let endValue = "";
  let internalText = "";
  let externalText = "";
  let replyExternal = false;
  let externalAudience: OutOfOfficeAudience = "Known";
  let allowExternal: OutOfOfficeAudience = "All";

  $: exchangeAccount, load();

  async function load() {
    if (!exchangeAccount) {
      return;
    }
    loading = true;
    loadError = null;
    savedAt = null;
    try {
      fill(await exchangeAccount.loadOutOfOffice());
    } catch (ex) {
      loadError = ex;
    } finally {
      loading = false;
    }
  }

  function fill(settings: OutOfOfficeSettings) {
    original = settings;
    state = settings.state;
    let start = settings.start ?? nextHour();
    let end = settings.end && settings.end > start ? settings.end : new Date(start.getTime() + kDay);
    startValue = toLocalInputValue(start);
    endValue = toLocalInputValue(end);
    originalInternalText = internalText = outOfOfficeHTMLToText(settings.internalReply);
    originalExternalText = externalText = outOfOfficeHTMLToText(settings.externalReply);
    allowExternal = settings.allowExternal;
    replyExternal = settings.externalAudience != "None" && settings.allowExternal != "None";
    externalAudience = settings.externalAudience == "All" && settings.allowExternal == "All" ? "All" : "Known";
  }

  $: start = fromLocalInputValue(startValue);
  $: end = fromLocalInputValue(endValue);
  $: periodError = state == "Scheduled" && (!start || !end || end <= start)
    ? $t`The end must be after the start`
    : null;

  $: edited = collect(state, start, end, internalText, externalText, replyExternal, externalAudience);
  $: dirty = !!original && !sameSettings(original, edited);

  function collect(..._dependencies: any[]): OutOfOfficeSettings {
    let base = original ?? {} as OutOfOfficeSettings;
    return {
      ...base,
      state,
      // Даты храним и при выключенном расписании, как Outlook
      start: start ?? base.start,
      end: end ?? base.end,
      externalAudience: replyExternal && allowExternal != "None" ? externalAudience : "None",
      internalReply: internalText == originalInternalText ? base.internalReply : outOfOfficeTextToHTML(internalText),
      externalReply: externalText == originalExternalText ? base.externalReply : outOfOfficeTextToHTML(externalText),
    };
  }

  function sameSettings(a: OutOfOfficeSettings, b: OutOfOfficeSettings): boolean {
    let sameScheduleNeeded = a.state == "Scheduled" || b.state == "Scheduled";
    return a.state == b.state &&
      a.externalAudience == b.externalAudience &&
      a.internalReply == b.internalReply &&
      a.externalReply == b.externalReply &&
      (!sameScheduleNeeded || (a.start?.getTime() == b.start?.getTime() && a.end?.getTime() == b.end?.getTime()));
  }

  async function save() {
    saveError = null;
    saving = true;
    try {
      let settings = edited;
      await exchangeAccount.saveOutOfOffice(settings);
      fill(settings);
      savedAt = new Date();
    } catch (ex) {
      saveError = ex;
    } finally {
      saving = false;
    }
  }

  function nextHour(): Date {
    return new Date(Math.ceil(Date.now() / kHour) * kHour);
  }

  /** Значение для `<input type="datetime-local">`: местное время без часового пояса. */
  function toLocalInputValue(date: Date): string {
    let pad = (number: number) => String(number).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
      `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function fromLocalInputValue(value: string): Date | null {
    if (!value) {
      return null;
    }
    let date = new Date(value);
    return isNaN(date.getTime()) ? null : date;
  }
</script>

<style>
  .out-of-office {
    max-width: 44em;
  }
  .loading {
    align-items: center;
    gap: 8px;
    margin-block-start: 24px;
    color: color-mix(in srgb, var(--main-fg) 72%, transparent);
  }
  .choices {
    gap: 8px;
  }
  .choices.nested {
    margin-block: 8px 12px;
    padding-inline-start: 24px;
  }
  .radio, .checkbox-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .radio.disabled {
    opacity: 0.55;
  }
  .period {
    flex-wrap: wrap;
    gap: 12px 16px;
    margin-block-start: 14px;
    padding-inline-start: 24px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 12px;
    color: color-mix(in srgb, var(--main-fg) 72%, transparent);
  }
  input[type="datetime-local"], .reply {
    box-sizing: border-box;
    border: 1px solid var(--border);
    border-radius: var(--border-radius);
    background: var(--main-bg);
    color: var(--main-fg);
    font: inherit;
    font-size: 13px;
  }
  input[type="datetime-local"] {
    min-height: 32px;
    padding: 4px 8px;
  }
  input[type="datetime-local"]:focus-visible, .reply:focus-visible {
    outline: 2px solid var(--icon-primary);
    outline-offset: 1px;
  }
  input[aria-invalid="true"] {
    border-color: var(--danger-fg, #c62828);
  }
  .field-error {
    margin: 8px 0 0;
    padding-inline-start: 24px;
    color: var(--danger-fg, #c62828);
    font-size: 12px;
  }
  .reply {
    width: 100%;
    min-height: 7em;
    padding: 8px 10px;
    line-height: 1.45;
    resize: vertical;
  }
  .reply:disabled {
    opacity: 0.55;
  }
  .hint {
    margin: 0;
    color: color-mix(in srgb, var(--main-fg) 72%, transparent);
  }
  .actions {
    align-items: center;
    gap: 12px;
    margin-block: 24px 16px;
  }
  .saved {
    color: var(--success-fg, #2F7A3E);
    font-size: 13px;
  }
</style>
