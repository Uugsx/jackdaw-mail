<vbox class="feedback page">
  <PageHeader
    title={$t`Feedback`}
    subtitle={$t`Report a bug or suggest an improvement. Your message goes straight to the Jackdaw Mail developers.`}
    />

  {#if sentID != null}
    <HeaderGroupBox>
      <hbox slot="header">{$t`Thank you!`}</hbox>
      <div class="sent" role="status">
        <CheckIcon size="20px" aria-hidden="true" />
        <div>
          <strong>{$t`Your message has been sent.`}</strong>
          {#if sentID}
            <p>{$t`Message number: ${sentID}`}</p>
          {/if}
          {#if sentWithEmail}
            <p>{$t`If we have questions, we will reply to the email address you gave.`}</p>
          {/if}
        </div>
      </div>
      <hbox class="actions">
        <Button label={$t`Write another message`} classes="secondary" onClick={reset} />
      </hbox>
    </HeaderGroupBox>
  {:else}
    <form class="form" on:submit|preventDefault={submit} novalidate>
      <HeaderGroupBox>
        <hbox slot="header">{$t`What is it about?`}</hbox>
        <fieldset class="kinds">
          <legend class="visually-hidden">{$t`What is it about?`}</legend>
          {#each kinds as option (option.value)}
            <label class="kind" class:checked={kind == option.value}>
              <input type="radio" name="feedback-kind" value={option.value} bind:group={kind} />
              <svelte:component this={option.icon} size="16px" aria-hidden="true" />
              <span>{option.label}</span>
            </label>
          {/each}
        </fieldset>
      </HeaderGroupBox>

      <HeaderGroupBox>
        <hbox slot="header">{$t`Message`}</hbox>
        <label class="field-label" for="feedback-message">
          {kind == "bug" ? $t`What happened and what did you expect?` : $t`Your message`}
        </label>
        <textarea
          id="feedback-message"
          bind:value={message}
          rows="8"
          maxlength={kFeedbackMaxChars}
          placeholder={kind == "bug" ? $t`Steps: 1. … 2. … What went wrong:` : ""}
          aria-describedby="feedback-message-help"
          aria-invalid={messageTooShort && touched}
          disabled={sending}
          />
        <hbox class="field-meta" id="feedback-message-help">
          <span>{$t`Please do not include passwords or other private data.`}</span>
          <hbox flex />
          <span class="counter" class:near={message.length > kFeedbackMaxChars * 0.9}>{message.length} / {kFeedbackMaxChars}</span>
        </hbox>

        <label class="field-label" for="feedback-email">{$t`Email for a reply (optional)`}</label>
        <input
          id="feedback-email"
          type="email"
          bind:value={contactEmail}
          autocomplete="email"
          maxlength="254"
          aria-invalid={emailInvalid}
          aria-describedby="feedback-email-help"
          disabled={sending}
          />
        <p class="help" id="feedback-email-help">
          {emailInvalid ? $t`Please check the email address for the reply.` : $t`Only the developers see this address. It is not published anywhere.`}
        </p>

        <Checkbox bind:checked={includeDiagnostics} allowIndetermined={false}
          label={$t`Attach the app version, platform and language`} disabled={sending} />
        {#if includeDiagnostics}
          <p class="help diagnostics">{diagnosticsPreview}</p>
        {/if}

        <!-- Ловушка для ботов: человек это поле не видит и не заполняет -->
        <div class="trap" aria-hidden="true">
          <label for="feedback-website">Website</label>
          <input id="feedback-website" type="text" tabindex="-1" autocomplete="off" bind:value={website} />
        </div>
      </HeaderGroupBox>

      <p class="privacy">
        {$t`Bug reports also become a task for the developers: the description, app version and platform, without your email address.`}
      </p>

      {#if error}
        <p class="error" role="alert">{error}</p>
      {/if}

      <hbox class="actions">
        <Button
          label={sending ? $t`Sending…` : $t`Send`}
          icon={SendIcon}
          classes="filled"
          disabled={sending || messageTooShort}
          onClick={submit}
          />
      </hbox>
    </form>
  {/if}
</vbox>

<script lang="ts">
  import {
    collectDiagnostics,
    isValidContactEmail,
    kFeedbackMaxChars,
    kFeedbackMinChars,
    sendFeedback,
    type FeedbackKind,
  } from "../../../logic/Feedback/Feedback";
  import { appGlobal } from "../../../logic/app";
  import Button from "../../Shared/Button.svelte";
  import Checkbox from "../../Shared/Checkbox.svelte";
  import HeaderGroupBox from "../../Shared/HeaderGroupBox.svelte";
  import PageHeader from "../Shared/PageHeader.svelte";
  import BugIcon from "lucide-svelte/icons/bug";
  import LightbulbIcon from "lucide-svelte/icons/lightbulb";
  import MessageIcon from "lucide-svelte/icons/message-square";
  import CheckIcon from "lucide-svelte/icons/circle-check";
  import SendIcon from "lucide-svelte/icons/send";
  import { t } from "../../../l10n/l10n";

  let kinds: { value: FeedbackKind; label: string; icon: any }[];
  $: kinds = [
    { value: "bug", label: $t`Bug`, icon: BugIcon },
    { value: "idea", label: $t`Suggestion`, icon: LightbulbIcon },
    { value: "other", label: $t`Other`, icon: MessageIcon },
  ];

  let kind: FeedbackKind = "bug";
  let message = "";
  let contactEmail = appGlobal.emailAccounts.first?.emailAddress ?? "";
  let includeDiagnostics = true;
  let website = "";
  let sending = false;
  let touched = false;
  let error: string | null = null;
  let sentID: string | null = null;
  let sentWithEmail = false;
  let runtimeVersion: string | undefined;

  $: messageTooShort = message.trim().length < kFeedbackMinChars;
  $: emailInvalid = !!contactEmail.trim() && !isValidContactEmail(contactEmail.trim());
  $: diagnostics = collectDiagnostics(runtimeVersion);
  $: diagnosticsPreview = [diagnostics.appVersion, diagnostics.platform, diagnostics.locale].filter(Boolean).join(" · ");

  loadRuntimeVersion();
  async function loadRuntimeVersion() {
    try {
      let version = await (appGlobal.remoteApp as any)?.getAppVersion?.();
      if (typeof version == "string" && version) {
        runtimeVersion = version;
      }
    } catch {
      // Версия из сборки уже подставлена по умолчанию.
    }
  }

  async function submit() {
    touched = true;
    if (sending || messageTooShort || emailInvalid) {
      return;
    }
    sending = true;
    error = null;
    try {
      sentID = await sendFeedback({ kind, message, contactEmail, includeDiagnostics, website }, runtimeVersion);
      sentWithEmail = !!contactEmail.trim();
    } catch (ex) {
      error = ex?.message ?? String(ex);
    } finally {
      sending = false;
    }
  }

  function reset() {
    message = "";
    error = null;
    touched = false;
    sentID = null;
  }
</script>

<style>
  .page {
    max-width: 52em;
    padding-block-end: 48px;
  }
  .form {
    display: contents;
  }
  .kinds {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    border: none;
    margin: 0;
    padding: 0;
  }
  .kind {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    border: 1px solid var(--border);
    border-radius: 8px;
    cursor: pointer;
    transition:
      background-color 160ms ease,
      border-color 160ms ease,
      transform var(--button-motion-duration) var(--button-motion-ease);
  }
  .kind:hover {
    background-color: var(--hover-bg);
  }
  .kind:active {
    transform: translateY(var(--button-motion-press-shift)) scale(var(--button-motion-press-scale));
  }
  .kind.checked {
    border-color: var(--icon-primary);
    background-color: color-mix(in srgb, var(--icon-primary) 12%, transparent);
  }
  .kind input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }
  .kind:has(input:focus-visible) {
    outline: 2px solid var(--input-focus, var(--selected-bg));
    outline-offset: 2px;
  }
  .field-label {
    display: block;
    margin-block: 4px 6px;
    font-weight: 600;
  }
  textarea,
  input[type="email"] {
    width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--main-bg);
    color: var(--main-fg);
    font: inherit;
  }
  textarea {
    resize: vertical;
    min-height: 140px;
    line-height: 1.45;
  }
  textarea:focus-visible,
  input[type="email"]:focus-visible {
    outline: 2px solid var(--input-focus, var(--selected-bg));
    outline-offset: 1px;
  }
  [aria-invalid="true"] {
    border-color: var(--danger-fg);
  }
  .field-meta {
    margin-block: 6px 16px;
    gap: 12px;
    font-size: 12px;
    color: color-mix(in srgb, var(--main-fg) 68%, transparent);
  }
  .counter {
    font-variant-numeric: tabular-nums;
  }
  .counter.near {
    color: var(--danger-fg);
  }
  .help,
  .privacy {
    margin: 6px 0 12px;
    font-size: 12px;
    line-height: 1.45;
    color: color-mix(in srgb, var(--main-fg) 68%, transparent);
  }
  .diagnostics {
    font-variant-numeric: tabular-nums;
    margin-inline-start: 28px;
  }
  .error {
    margin: 8px 0;
    color: var(--danger-fg);
  }
  .actions {
    gap: 8px;
    margin-block-start: 8px;
  }
  .sent {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    color: var(--main-fg);
  }
  .sent :global(svg) {
    flex: 0 0 auto;
    color: var(--icon-primary);
    margin-block-start: 2px;
  }
  .sent p {
    margin: 4px 0 0;
    color: color-mix(in srgb, var(--main-fg) 72%, transparent);
  }
  .trap,
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  @media (prefers-reduced-motion: reduce) {
    .kind {
      transition: none;
    }
    .kind:active {
      transform: none;
    }
  }
</style>
