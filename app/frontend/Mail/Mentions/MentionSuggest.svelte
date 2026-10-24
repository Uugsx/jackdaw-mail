<!-- @упоминания в редакторе письма: «@ива» у курсора — подсказка людей; выбор вставляет
  ссылку «@Имя» и добавляет человека в «Кому», как в Outlook -->
{#if open && candidates.length}
  <vbox class="mention-suggest" role="listbox" aria-label={$t`Mention someone`}
    style:left="{position.left}px" style:top="{position.top}px">
    {#each candidates as person, index (person.emailAddress)}
      <!-- svelte-ignore a11y-click-events-have-key-events -->
      <hbox class="candidate" role="option" aria-selected={index == active}
        class:active={index == active}
        on:mousedown|preventDefault={() => choose(person)}
        on:mouseenter={() => active = index}>
        <span class="name font-small">{person.name || person.emailAddress}</span>
        {#if person.name}
          <span class="address font-smallest">{person.emailAddress}</span>
        {/if}
      </hbox>
    {/each}
  </vbox>
{/if}

<script lang="ts">
  import type { Editor } from "@tiptap/core";
  import type { EMail } from "../../../logic/Mail/EMail";
  import type { PersonUID } from "../../../logic/Abstract/PersonUID";
  import { searchContacts } from "../../../logic/Contacts/Search";
  import { addMentionedRecipient, mentionHTML, mentionQueryBeforeCursor } from "../../../logic/Mail/Mentions/Mentions";
  import { backgroundError } from "../../Util/error";
  import { t } from "../../../l10n/l10n";
  import { onDestroy } from "svelte";

  export let editor: Editor | null;
  export let mail: EMail;
  export let searchFunction: ((searchStr: string, skip: (person: PersonUID) => boolean) => Promise<PersonUID[]>) | null = null;

  /** Сколько людей показывать */
  const kMaxCandidates = 8;

  let open = false;
  let candidates: PersonUID[] = [];
  let active = 0;
  let position = { left: 0, top: 0 };
  let query: { query: string, length: number } | null = null;
  let searchGeneration = 0;
  let attachedTo: Editor | null = null;

  $: attach(editor);
  onDestroy(() => attach(null));

  function attach(target: Editor | null) {
    if (attachedTo == target) {
      return;
    }
    if (attachedTo) {
      attachedTo.off("update", onChange);
      attachedTo.off("selectionUpdate", onChange);
      attachedTo.off("blur", close);
      attachedTo.view?.dom?.removeEventListener("keydown", onKeydown, true);
    }
    attachedTo = target;
    if (target) {
      target.on("update", onChange);
      target.on("selectionUpdate", onChange);
      target.on("blur", close);
      target.view?.dom?.addEventListener("keydown", onKeydown, true);
    }
  }

  function close() {
    open = false;
    candidates = [];
    query = null;
  }

  function onChange() {
    let selection = editor?.state.selection;
    if (!editor || !selection?.empty) {
      close();
      return;
    }
    let { $from } = selection;
    let textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, "￼");
    query = mentionQueryBeforeCursor(textBefore);
    if (!query) {
      close();
      return;
    }
    let coords = editor.view.coordsAtPos(selection.from);
    let host = (editor.view.dom as HTMLElement).closest(".editor") as HTMLElement | null;
    let hostBox = host?.getBoundingClientRect() ?? { left: 0, top: 0 };
    position = { left: coords.left - hostBox.left, top: coords.bottom - hostBox.top + 4 };
    search(query.query).catch(backgroundError);
  }

  /** Сначала получатели этого письма, потом адресные книги */
  async function search(text: string) {
    let generation = ++searchGeneration;
    let lower = text.toLowerCase();
    let matches = (person: PersonUID) => !lower ||
      person.name?.toLowerCase().includes(lower) || person.emailAddress?.toLowerCase().includes(lower);
    let found: PersonUID[] = [...mail.to.contents, ...mail.cc.contents].filter(matches);
    let seen = new Set(found.map(person => person.emailAddress?.toLowerCase()));
    if (text.length >= 2) {
      let more = await (searchFunction ?? searchContacts)(text, person => seen.has(person.emailAddress?.toLowerCase()));
      if (generation != searchGeneration) {
        return;
      }
      for (let person of more) {
        let key = person.emailAddress?.toLowerCase();
        if (key && !seen.has(key)) {
          seen.add(key);
          found.push(person);
        }
      }
    }
    candidates = found.filter(person => !!person.emailAddress).slice(0, kMaxCandidates);
    active = 0;
    open = candidates.length > 0;
  }

  function choose(person: PersonUID) {
    if (!editor || !query) {
      return;
    }
    let to = editor.state.selection.from;
    editor.chain().focus()
      .deleteRange({ from: to - query.length, to })
      .insertContent(mentionHTML(person) + " ")
      .run();
    addMentionedRecipient(mail, person);
    close();
  }

  function onKeydown(event: KeyboardEvent) {
    if (!open || !candidates.length) {
      return;
    }
    if (event.key == "ArrowDown" || event.key == "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      let step = event.key == "ArrowDown" ? 1 : -1;
      active = (active + step + candidates.length) % candidates.length;
    } else if (event.key == "Enter" || event.key == "Tab") {
      event.preventDefault();
      event.stopPropagation();
      choose(candidates[active]);
    } else if (event.key == "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  }
</script>

<style>
  .mention-suggest {
    position: absolute;
    z-index: 20;
    min-width: 16em;
    max-width: 28em;
    padding: 4px 0;
    background: var(--main-bg);
    color: var(--main-fg);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
  }
  .candidate {
    align-items: baseline;
    gap: 8px;
    padding: 4px 12px;
    cursor: pointer;
    overflow: hidden;
  }
  .candidate.active {
    background: var(--hover-bg, rgba(0, 0, 0, 0.06));
  }
  .name {
    white-space: nowrap;
  }
  .address {
    opacity: 0.65;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
