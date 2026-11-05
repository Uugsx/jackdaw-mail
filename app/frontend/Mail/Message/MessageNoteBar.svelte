<!--
  Личная заметка к письму над текстом: показ со ссылками и ключами трекера,
  правка, удаление. Открывается по запросу из меню, кнопки или горячей клавиши.
-->
{#if editing}
  <vbox class="note-bar editing">
    <!-- svelte-ignore a11y_autofocus -->
    <textarea
      bind:this={input}
      bind:value={draft}
      rows="3"
      maxlength={kMaxNoteLength}
      placeholder={$t`Note on this message, for example a ticket number`}
      aria-label={$t`Note on message`}
      on:keydown={onKeydown}
      />
    <hbox class="actions">
      <Button classes="secondary" label={$t`Save`} onClick={save} />
      <Button plain label={$t`Cancel`} onClick={cancel} />
      {#if text}
        <Button plain label={$t`Delete`} onClick={remove} />
      {/if}
    </hbox>
  </vbox>
{:else if text}
  <hbox class="note-bar font-small" role="note">
    <span class="icon" aria-hidden="true"><NoteIcon size="16px" /></span>
    <span class="text">
      {#each tokens as token}
        {#if token.href}
          <a href={token.href} on:click|preventDefault={() => open(token.href)}>{token.text}</a>
        {:else}{token.text}{/if}
      {/each}
    </span>
    <Button plain iconOnly icon={EditIcon} iconSize="14px" label={$t`Edit note`} onClick={startEdit} />
  </hbox>
{/if}

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import { getMessageNoteText, messageNotesChanged, noteEditRequest, setMessageNote, removeMessageNote } from "../../../logic/Mail/MessageNotes/MessageNotes";
  import { kMaxNoteLength, tokenizeNote } from "../../../logic/Mail/MessageNotes/MessageNote";
  import { openExternalURL } from "../../../logic/util/os-integration";
  import { getLocalStorage } from "../../Util/LocalStorage";
  import { catchErrors } from "../../Util/error";
  import Button from "../../Shared/Button.svelte";
  import NoteIcon from "lucide-svelte/icons/notebook-pen";
  import EditIcon from "lucide-svelte/icons/pencil";
  import { t } from "../../../l10n/l10n";
  import { tick } from "svelte";

  export let message: EMail;

  const trackerSetting = getLocalStorage<string>("mail.notes.trackerURL", "");

  let editing = false;
  let draft = "";
  let input: HTMLTextAreaElement;
  let lastNonce = 0;

  $: text = $messageNotesChanged >= 0 ? getMessageNoteText(message) : null;
  $: tokens = text ? tokenizeNote(text, $trackerSetting.value) : [];
  // Другое письмо — выходим из правки
  $: message, (editing = false);

  $: if ($noteEditRequest && $noteEditRequest.nonce != lastNonce && $noteEditRequest.message === message) {
    lastNonce = $noteEditRequest.nonce;
    startEdit();
  }

  async function startEdit() {
    draft = text ?? "";
    editing = true;
    await tick();
    input?.focus();
  }

  function cancel() {
    editing = false;
  }

  function save() {
    catchErrors(async () => {
      await setMessageNote(message, draft);
      editing = false;
    });
  }

  function remove() {
    catchErrors(async () => {
      await removeMessageNote(message);
      editing = false;
    });
  }

  function open(url: string) {
    catchErrors(() => openExternalURL(url));
  }

  function onKeydown(event: KeyboardEvent) {
    event.stopPropagation(); // не запускать горячие клавиши писем при вводе
    if (event.key == "Escape") {
      event.preventDefault();
      cancel();
    } else if (event.key == "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      save();
    }
  }
</script>

<style>
  .note-bar {
    margin-block: 4px 6px;
    margin-inline: 8px 16px;
    padding: 4px 6px 4px 10px;
    box-sizing: border-box;
    border: 1px solid var(--border);
    border-radius: 6px;
    background-color: var(--surface-subtle, color-mix(in srgb, var(--border) 18%, transparent));
    color: var(--main-fg);
    align-items: flex-start;
    gap: 8px;
  }
  .note-bar.editing {
    padding: 8px;
    gap: 6px;
  }
  .icon {
    display: flex;
    flex: none;
    padding-block: 2px;
    color: var(--icon-primary);
  }
  .text {
    flex: 1;
    min-width: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    padding-block: 2px;
  }
  textarea {
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
    font: inherit;
  }
  .actions {
    gap: 6px;
  }
</style>
