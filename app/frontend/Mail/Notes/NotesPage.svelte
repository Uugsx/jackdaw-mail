<!-- Страница «Заметки» Exchange: плитки заметок, создание, правка и удаление, как заметки в Outlook -->
<vbox flex class="notes-page">
  <hbox class="header">
    <NoteIcon size="18px" />
    <h2>{$t`Notes *=> Exchange sticky notes`}</h2>
    {#if $notesState.items.length}
      <span class="count">{$notesState.items.length}</span>
    {/if}
    <hbox flex />
    <RoundButton label={$t`Refresh`} icon={RefreshIcon} iconSize="16px" border={false}
      disabled={$notesState.loading} onClick={() => catchErrors(refreshNotes)} />
    <RoundButton label={$t`Close`} icon={CloseIcon} iconSize="16px" border={false}
      onClick={() => $notesViewOpen = false} />
  </hbox>

  {#if !accounts.length}
    <p class="hint">{$t`Notes are stored in Exchange. Add an Exchange or Outlook on the web account to use them.`}</p>
  {:else}
    <form class="new-note" on:submit|preventDefault={() => catchErrors(onAdd)}>
      <textarea bind:value={newText} rows="2" placeholder={$t`New note`} aria-label={$t`New note`}
        disabled={adding}
        on:keydown={event => { if (event.key == "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); catchErrors(onAdd); } }} />
      <vbox class="new-actions">
        {#if accounts.length > 1}
          <select bind:value={newAccount} aria-label={$t`Account`} disabled={adding}>
            {#each accounts as account (account.id)}
              <option value={account}>{account.name || account.emailAddress}</option>
            {/each}
          </select>
        {/if}
        <Button label={$t`Add`} icon={adding ? Spinner : null} classes="filled" disabled={!newText.trim() || adding} />
      </vbox>
    </form>

    {#each $notesState.errors as error}
      <p class="error" role="alert">{error}</p>
    {/each}

    <vbox flex class="scroll">
      {#if $notesState.loading && !$notesState.items.length}
        <hbox class="hint"><Spinner size="16px" /> {$t`Loading…`}</hbox>
      {:else if !$notesState.items.length}
        <p class="hint">{$t`No notes yet`}</p>
      {:else}
        <div class="grid">
          {#each $notesState.items as item (item.note.itemID)}
            <vbox class="note color-{item.note.color}" class:editing={editing == item}>
              {#if editing == item}
                <textarea bind:value={editText} bind:this={editInput} aria-label={$t`Note text`}
                  on:keydown={event => onEditKeydown(event, item)} />
                <hbox class="note-actions">
                  <Button label={$t`Cancel`} plain classes="small" disabled={saving} onClick={() => editing = null} />
                  <Button label={$t`Save`} classes="small filled" icon={saving ? Spinner : null}
                    disabled={saving || !editText.trim()} onClick={() => catchErrors(() => onSave(item))} />
                </hbox>
              {:else}
                <button type="button" class="note-text" title={$t`Edit note`} on:click={() => startEdit(item)}>
                  <span class="title">{noteTitle(item.note.text) || $t`Empty note`}</span>
                  <span class="body">{noteBody(item.note.text)}</span>
                </button>
                <hbox class="note-footer font-smallest">
                  <span>{formatModified(item.note.lastModified)}</span>
                  {#if accounts.length > 1}
                    <span class="account">{item.account.name}</span>
                  {/if}
                  <hbox flex />
                  <RoundButton label={$t`Delete`} icon={DeleteIcon} iconSize="14px" border={false}
                    onClick={() => catchErrors(() => onDelete(item))} />
                </hbox>
              {/if}
            </vbox>
          {/each}
        </div>
      {/if}
    </vbox>
  {/if}
</vbox>

<script lang="ts">
  import type { MailAccount } from "../../../logic/Mail/MailAccount";
  import { noteTitle } from "../../../logic/Mail/Notes/ExchangeNotes";
  import { addNote, noteAccounts, notesState, notesViewOpen, refreshNotes, removeNote, saveNote, type NoteItem } from "./notesStore";
  import { showConfirmDialog } from "../../Shared/askConfirm";
  import Button from "../../Shared/Button.svelte";
  import RoundButton from "../../Shared/RoundButton.svelte";
  import Spinner from "../../Shared/Spinner.svelte";
  import NoteIcon from "lucide-svelte/icons/sticky-note";
  import RefreshIcon from "lucide-svelte/icons/refresh-cw";
  import CloseIcon from "lucide-svelte/icons/x";
  import DeleteIcon from "lucide-svelte/icons/trash-2";
  import { catchErrors } from "../../Util/error";
  import { getUILocale, gt, t } from "../../../l10n/l10n";
  import { onMount, tick } from "svelte";

  const accounts = noteAccounts();
  let newAccount: MailAccount = accounts[0];
  let newText = "";
  let adding = false;
  let editing: NoteItem | null = null;
  let editText = "";
  let editInput: HTMLTextAreaElement;
  let saving = false;

  onMount(() => {
    if (accounts.length) {
      catchErrors(refreshNotes);
    }
  });

  function noteBody(text: string): string {
    let lines = (text ?? "").split(/\r?\n/);
    let first = lines.findIndex(line => line.trim());
    return lines.slice(first + 1).join("\n").trim();
  }

  function formatModified(date: Date | null): string {
    return date ? date.toLocaleString(getUILocale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
  }

  async function onAdd() {
    if (!newText.trim() || adding || !newAccount) {
      return;
    }
    adding = true;
    try {
      await addNote(newAccount, newText.trim());
      newText = "";
    } finally {
      adding = false;
    }
  }

  async function startEdit(item: NoteItem) {
    editing = item;
    editText = item.note.text;
    await tick();
    editInput?.focus();
  }

  async function onSave(item: NoteItem) {
    saving = true;
    try {
      await saveNote(item, editText.trim());
      editing = null;
    } finally {
      saving = false;
    }
  }

  function onEditKeydown(event: KeyboardEvent, item: NoteItem) {
    if (event.key == "Escape") {
      event.preventDefault();
      editing = null;
    } else if (event.key == "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      catchErrors(() => onSave(item));
    }
  }

  async function onDelete(item: NoteItem) {
    let choice = await showConfirmDialog({
      title: gt`Delete this note?`,
      message: noteTitle(item.note.text),
      confirmLabel: gt`Delete`,
    });
    if (choice == "confirm") {
      await removeNote(item);
      if (editing == item) {
        editing = null;
      }
    }
  }
</script>

<style>
  .notes-page {
    min-width: 0;
    min-height: 0;
    background-color: var(--main-bg);
    color: var(--main-fg);
  }
  .header {
    align-items: center;
    gap: 8px;
    min-height: 44px;
    padding: 4px 8px 4px 16px;
    border-block-end: 1px solid var(--border);
  }
  h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
  }
  .count {
    min-width: 18px;
    padding: 0 6px;
    box-sizing: border-box;
    border-radius: 9px;
    background: color-mix(in srgb, var(--main-fg) 10%, transparent);
    font-size: 11px;
    line-height: 18px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .new-note {
    display: flex;
    align-items: stretch;
    gap: 8px;
    margin: 12px 16px 4px;
  }
  .new-note textarea {
    flex: 1 1 auto;
    min-width: 0;
    resize: vertical;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: var(--border-radius);
    background: transparent;
    color: inherit;
    font: inherit;
  }
  .new-note textarea:focus {
    outline: none;
    border-color: var(--icon-primary);
  }
  .new-actions {
    gap: 6px;
    justify-content: flex-end;
  }
  .hint {
    align-items: center;
    gap: 8px;
    margin: 16px;
    opacity: 0.7;
  }
  .error {
    margin: 4px 16px;
    color: var(--danger-fg);
  }
  .scroll {
    min-height: 0;
    overflow-y: auto;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 12px;
    padding: 12px 16px 16px;
  }
  .note {
    min-height: 140px;
    border-radius: 6px;
    border: 1px solid color-mix(in srgb, #000 10%, transparent);
    color: #222;
    overflow: hidden;
  }
  .note.color-yellow { background: #fff5b8; }
  .note.color-blue { background: #d6ebff; }
  .note.color-green { background: #d9f5d0; }
  .note.color-pink { background: #ffd9e8; }
  .note.color-white { background: #ffffff; }
  .note-text {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    gap: 4px;
    padding: 10px 12px 4px;
    border: none;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: start;
    cursor: text;
    min-height: 0;
  }
  .title {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .body {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-line-clamp: 6;
    -webkit-box-orient: vertical;
    overflow: hidden;
    font-size: 13px;
  }
  .note-footer {
    align-items: center;
    gap: 6px;
    padding: 0 4px 2px 12px;
    color: #555;
  }
  .account {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .note.editing textarea {
    flex: 1 1 auto;
    min-height: 120px;
    margin: 8px;
    padding: 6px 8px;
    border: 1px solid color-mix(in srgb, #000 20%, transparent);
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.6);
    color: #222;
    font: inherit;
    resize: vertical;
  }
  .note-actions {
    justify-content: flex-end;
    gap: 6px;
    padding: 0 8px 8px;
  }
</style>
