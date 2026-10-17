{#if haveText}
  <ButtonMenu bind:isMenuOpen>
    <RoundButton
      slot="control"
      label={$t`Close and optionally save`}
      icon={CloseIcon}
      classes={buttonClasses}
      filled={false}
      iconSize={iconSize}
      padding={buttonPadding}
      onClick={onMenuToggle}
      />
    <MenuItem
      label={$t`Save`}
      icon={SaveIcon}
      onClick={onSave}
      />
    <MenuItem
      label={$t`Discard`}
      icon={TrashIcon}
      onClick={onDelete}
      />
  </ButtonMenu>
{:else}
  <RoundButton
    label={$t`Discard`}
    icon={CloseIcon}
    classes={buttonClasses}
    filled={false}
    iconSize={iconSize}
    padding={buttonPadding}
    onClick={onDelete}
    />
{/if}

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import RoundButton from "../../Shared/RoundButton.svelte";
  import CloseIcon from "lucide-svelte/icons/x";
  import TrashIcon from "lucide-svelte/icons/trash-2";
  import SaveIcon from "lucide-svelte/icons/save";
  import { t } from "../../../l10n/l10n";
  import ButtonMenu from "../../Shared/Menu/ButtonMenu.svelte";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import { createEventDispatcher } from 'svelte';
  const dispatchEvent = createEventDispatcher<{ close: void }>();

  export let mail: EMail;
  /** Icon-only chrome button matching mail toolbar style */
  export let chrome = false;
  /** Compact icon in floating window title bar */
  export let compact = false;
  /** Sync editor content before saving from close menu */
  export let beforeSave: (() => void | Promise<void>) | null = null;

  $: buttonClasses = chrome
    ? compact ? "plain toolbar-chrome qat" : "plain toolbar-chrome"
    : "plain";
  $: iconSize = chrome ? "16px" : undefined;
  $: buttonPadding = chrome ? "6px" : undefined;

  let isMenuOpen = false;
  function onMenuToggle(event: Event) {
    isMenuOpen = !isMenuOpen;
    checkDirty();
  }

  let haveText = true;
  async function onSave() {
    if (beforeSave) {
      await beforeSave();
    }
    await mail.compose.saveAsDraft();
    dispatchEvent("close");
  }
  async function onDelete() {
    dispatchEvent("close");
    await mail.compose.deleteDrafts();
  }

  function checkDirty() {
    if (isComposeDirty()) {
      return;
    }
    // Ни своего текста, ни вложений, ни темы — закрываем без вопроса
    isMenuOpen = false;
    dispatchEvent("close");
  }

  function isComposeDirty(): boolean {
    if (mail.attachments?.hasItems) {
      return true;
    }
    if (!mail.composeSource && (!!mail.subject?.trim() || mail.to?.hasItems)) {
      return true;
    }
    // Любой свой текст (даже короткий «Да, согласен») считается изменением.
    // Цитата, строка «X написал:» и подпись своим текстом не считаются.
    let text = notQuote().body.textContent ?? "";
    return text.replace(/\s+/g, "").length > 0;
  }

  function notQuote(): Document {
    let doc = new DOMParser().parseFromString(mail.html ?? "", "text/html");
    for (let element of doc.body.querySelectorAll("blockquote, .quote-header, footer")) {
      element.remove();
    }
    return doc;
  }
</script>
