<form class="editor" on:submit|preventDefault={() => catchErrors(save)}>
  <hbox class="top">
    <span class="kind">{$t`Task`}{accountLabel ? ` · ${accountLabel}` : ""}</span>
    <hbox flex />
    <RoundButton
      label={$t`Close`}
      icon={CloseIcon}
      iconSize="14px"
      border={false}
      onClick={() => dispatch("close")} />
  </hbox>

  <label class="field">
    <span>{$t`Subject`}</span>
    <input type="text" bind:value={input.subject} maxlength={kMaxSubjectLength}
      aria-invalid={problem == "subject"} disabled={busy} />
  </label>
  <hbox class="dates">
    <label class="field">
      <span>{$t`Start date`}</span>
      <input type="date" bind:value={startValue} max={dueValue || undefined} disabled={busy} />
    </label>
    <label class="field">
      <span>{$t`Due date`}</span>
      <input type="date" bind:value={dueValue} min={startValue || undefined}
        aria-invalid={problem == "dates"} disabled={busy} />
    </label>
  </hbox>
  <label class="field">
    <span>{$t`Importance`}</span>
    <select bind:value={input.importance} disabled={busy}>
      <option value="High">{$t`High`}</option>
      <option value="Normal">{$t`Normal`}</option>
      <option value="Low">{$t`Low`}</option>
    </select>
  </label>
  <label class="field notes">
    <span>{$t`Notes`}</span>
    <textarea bind:value={input.notes} rows="6" disabled={busy} />
  </label>

  {#if problem == "subject"}
    <p class="error" role="alert">{$t`Enter a subject for the task.`}</p>
  {:else if problem == "dates"}
    <p class="error" role="alert">{$t`The due date can't be before the start date.`}</p>
  {/if}
  <ErrorMessageInline ex={error} onClose={() => error = null} />

  <hbox class="actions">
    <Button
      label={done ? $t`Mark as not complete` : $t`Mark as complete`}
      icon={done ? UndoIcon : CheckIcon}
      plain
      disabled={busy}
      onClick={toggleDone} />
    <hbox flex />
    <hbox class="end">
      <Button
        label={$t`Delete`}
        icon={TrashIcon}
        classes="danger"
        plain
        disabled={busy}
        onClick={() => { catchErrors(remove); }} />
      <Button
        label={$t`Save`}
        icon={saving ? Spinner : null}
        classes="filled"
        disabled={!dirty || busy} />
    </hbox>
  </hbox>
</form>

<script lang="ts">
  import { removeTask, saveTask, toggleTaskCompleted } from "./tasksStore";
  import {
    isTaskCompleted, sanitizeDay, validateTaskInput, type ExchangeTask, type ExchangeTaskInput,
  } from "../../../logic/Mail/Tasks/ExchangeTask";
  import type { MailAccount } from "../../../logic/Mail/MailAccount";
  import { showConfirmDialog } from "../../Shared/askConfirm";
  import Button from "../../Shared/Button.svelte";
  import Spinner from "../../Shared/Spinner.svelte";
  import RoundButton from "../../Shared/RoundButton.svelte";
  import ErrorMessageInline from "../../Shared/ErrorMessageInline.svelte";
  import CloseIcon from "lucide-svelte/icons/x";
  import CheckIcon from "lucide-svelte/icons/check";
  import UndoIcon from "lucide-svelte/icons/undo-2";
  import TrashIcon from "lucide-svelte/icons/trash-2";
  import { catchErrors } from "../../Util/error";
  import { createEventDispatcher } from "svelte";
  import { t } from "../../../l10n/l10n";

  export let account: MailAccount;
  export let task: ExchangeTask;

  const kMaxSubjectLength = 255;
  const dispatch = createEventDispatcher<{ close: void }>();

  let input: ExchangeTaskInput = fromTask(task);
  let startValue = task.startDay ?? "";
  let dueValue = task.dueDay ?? "";
  let saving = false;
  let working = false;
  let problem: ReturnType<typeof validateTaskInput> = null;
  let error: Error | null = null;

  $: busy = saving || working;
  $: done = isTaskCompleted(task);
  $: accountLabel = account?.name || account?.emailAddress || "";
  $: current = { ...input, startDay: sanitizeDay(startValue), dueDay: sanitizeDay(dueValue) };
  $: dirty = JSON.stringify(current) != JSON.stringify(fromTask(task));
  $: if (problem) {
    problem = validateTaskInput(current);
  }

  function fromTask(source: ExchangeTask): ExchangeTaskInput {
    return {
      subject: source.subject,
      notes: source.notes,
      startDay: source.startDay,
      dueDay: source.dueDay,
      importance: source.importance,
    };
  }

  async function save() {
    problem = validateTaskInput(current);
    if (problem || !dirty || busy) {
      return;
    }
    saving = true;
    error = null;
    try {
      task = await saveTask(account, task, current);
      input = fromTask(task);
    } catch (ex) {
      error = ex;
    } finally {
      saving = false;
    }
  }

  async function toggleDone() {
    working = true;
    error = null;
    try {
      await toggleTaskCompleted(account, task);
    } catch (ex) {
      error = ex;
    } finally {
      working = false;
    }
  }

  async function remove() {
    let choice = await showConfirmDialog({
      title: $t`Delete this task?`,
      message: task.subject,
      confirmLabel: $t`Delete`,
    });
    if (choice != "confirm") {
      return;
    }
    working = true;
    error = null;
    try {
      await removeTask(account, task);
      dispatch("close");
    } catch (ex) {
      error = ex;
    } finally {
      working = false;
    }
  }
</script>

<style>
  .editor {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px 16px 16px;
  }
  .top {
    align-items: center;
    min-height: 28px;
  }
  .kind {
    overflow: hidden;
    color: color-mix(in srgb, var(--main-fg) 60%, transparent);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.02em;
    text-overflow: ellipsis;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .field {
    display: flex;
    flex-direction: column;
    flex: 1 1 0;
    gap: 4px;
    min-width: 0;
    font-size: 12px;
  }
  .field > span {
    color: color-mix(in srgb, var(--main-fg) 64%, transparent);
  }
  .dates {
    gap: 12px;
    flex-wrap: wrap;
  }
  .dates .field {
    min-width: 9em;
  }
  input,
  select,
  textarea {
    box-sizing: border-box;
    min-height: 30px;
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: var(--border-radius);
    background: var(--main-bg);
    color: var(--main-fg);
    font: inherit;
    font-size: 13px;
  }
  textarea {
    resize: vertical;
    min-height: 6em;
  }
  input:focus-visible,
  select:focus-visible,
  textarea:focus-visible {
    outline: 2px solid var(--icon-primary);
    outline-offset: 1px;
  }
  [aria-invalid="true"] {
    border-color: var(--danger-fg);
  }
  .error {
    margin: 0;
    color: var(--danger-fg);
    font-size: 12px;
    line-height: 1.4;
  }
  .actions {
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }
  /* «Удалить» и «Сохранить» переносятся вместе, а не по одной */
  .end {
    align-items: center;
    flex-wrap: nowrap;
    gap: 8px;
    margin-inline-start: auto;
  }
  .actions :global(.button.filled.disabled) {
    opacity: 0.45;
  }
</style>
