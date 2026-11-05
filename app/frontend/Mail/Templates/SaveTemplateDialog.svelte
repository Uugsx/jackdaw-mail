<div class="template-backdrop">
  <div
    class="template-dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby={titleId}
    tabindex="-1"
    on:keydown={onKeydown}>
    <h2 id={titleId}>{$t`Save as template`}</h2>
    <label class="field">
      <span>{$t`Template name`}</span>
      <input
        type="text"
        bind:this={inputElement}
        bind:value={name}
        maxlength={kMaxTemplateNameLength}
        placeholder={$t`For example, Price list for a new customer`}
        aria-invalid={!!error}
        aria-describedby={hintId} />
    </label>
    {#if error}
      <p class="error" role="alert" id={hintId}>{error}</p>
    {:else if duplicate}
      <p class="hint" id={hintId}>{$t`A template with this name already exists. It will be replaced.`}</p>
    {/if}
    {#if attachmentCount > 0}
      <label class="checkbox">
        <input type="checkbox" bind:checked={includeAttachments} />
        <span>{$t`Include attachments (${attachmentCount})`}</span>
      </label>
    {/if}
    <div class="actions">
      <Button
        label={$t`Cancel`}
        plain
        onClick={cancel} />
      <Button
        label={duplicate ? $t`Replace` : $t`Save`}
        classes="filled"
        disabled={!name.trim()}
        onClick={submit} />
    </div>
  </div>
</div>

<script context="module" lang="ts">
  let nextDialogId = 0;
</script>

<script lang="ts">
  import { onMount, tick } from "svelte";
  import Button from "../../Shared/Button.svelte";
  import {
    checkTemplateName, kMaxTemplateNameLength, normalizeTemplateName, type MailTemplateSummary,
  } from "../../../logic/Mail/Templates/MailTemplate";
  import type { SaveTemplateChoice } from "./mailTemplates";
  import { t } from "../../../l10n/l10n";

  export let initialName = "";
  export let existing: MailTemplateSummary[] = [];
  /** Сколько вложений в письме; 0 — флажок не показываем */
  export let attachmentCount = 0;
  export let onDone: (choice: SaveTemplateChoice | null) => void;

  const dialogNumber = ++nextDialogId;
  const titleId = `save-template-title-${dialogNumber}`;
  const hintId = `save-template-hint-${dialogNumber}`;
  let name = initialName;
  let includeAttachments = true;
  let error = "";
  let inputElement: HTMLInputElement;
  let previouslyFocused: HTMLElement | null = null;

  $: name, error = "";
  $: duplicate = checkTemplateName(name, existing) == "duplicate";

  onMount(() => {
    previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    void tick().then(() => inputElement?.select());
    return () => {
      if (previouslyFocused?.isConnected) {
        previouslyFocused.focus();
      }
    };
  });

  function submit() {
    let problem = checkTemplateName(name, existing);
    if (problem == "empty") {
      error = $t`Please enter a name for the template.`;
      return;
    }
    if (problem == "too-long") {
      error = $t`The name is too long.`;
      return;
    }
    let normalized = normalizeTemplateName(name);
    let replace = problem == "duplicate"
      ? existing.find(template => normalizeTemplateName(template.name).toLocaleLowerCase() == normalized.toLocaleLowerCase())
      : null;
    onDone({
      name: normalized,
      includeAttachments: attachmentCount > 0 && includeAttachments,
      replaceID: replace?.id ?? null,
    });
  }

  function cancel() {
    onDone(null);
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key == "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    } else if (event.key == "Enter" && event.target == inputElement) {
      event.preventDefault();
      submit();
    }
  }
</script>

<style>
  .template-backdrop {
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
  .template-dialog {
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
  input[type="text"] {
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
  input[type="text"]:focus-visible {
    outline: 2px solid var(--icon-primary);
    outline-offset: 1px;
  }
  input[aria-invalid="true"] {
    border-color: var(--danger-fg, #c62828);
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
  .checkbox {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 16px;
    font-size: 13px;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 20px;
  }
  @media (max-width: 480px) {
    .template-backdrop {
      padding: 16px;
    }
    .template-dialog {
      padding: 16px;
    }
  }
</style>
