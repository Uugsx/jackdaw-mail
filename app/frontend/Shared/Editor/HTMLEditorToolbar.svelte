{#if editor}
  <Toolbar>
    {#if showFontControls}
      <select class="font-select font-family" title={$t`Font`}
        value={selectedFontFamily}
        on:mousedown={rememberEditorSelection}
        on:change={onFontFamilyChange}>
        {#each composeFontFamilies as font}
          <option value={font.value}>{font.label()}</option>
        {/each}
      </select>
      <select class="font-select font-size" title={$t`Font size`}
        value={displayFontSize}
        on:mousedown={rememberEditorSelection}
        on:change={onFontSizeChange}>
        {#if selectedFontSize && !composeFontSizes.includes(selectedFontSize)}
          <option value={selectedFontSize}>{formatFontSizeLabel(selectedFontSize)}</option>
        {/if}
        {#each composeFontSizes as size}
          <option value={size}>{formatFontSizeLabel(size)}</option>
        {/each}
      </select>
      <select class="font-select line-height" title={$t`Line spacing`}
        value={displayLineHeight}
        on:mousedown={rememberEditorSelection}
        on:change={onLineHeightChange}>
        {#if selectedLineHeight && !composeLineHeights.some(lh => lh.value === selectedLineHeight)}
          <option value={selectedLineHeight}>{lineHeightLabel}</option>
        {/if}
        {#each composeLineHeights as lh}
          <option value={lh.value}>{lh.label}</option>
        {/each}
      </select>
    {/if}
    <slot name="start" />

    <Button
      label={$t`Bold`}
      shortCutInfo={$t`*bold* or **bold**`}
      onClick={() => editor.chain().focus().toggleBold().run()}
      disabled={!editor.can().chain().focus().toggleBold().run()}
      selected={editor.isActive('bold')}
      iconOnly
      >
      <hbox slot="icon" class="bold-icon font-normal">B</hbox>
    </Button>
    <Button
      label={$t`Italic`}
      shortCutInfo={$t`/italic/ or _italic_`}
      onClick={() => editor.chain().focus().toggleItalic().run()}
      disabled={!editor.can().chain().focus().toggleItalic().run()}
      selected={editor.isActive('italic')}
      icon={ItalicIcon}
      iconSize="16px"
      iconOnly
      />
    <Button
      label={$t`Strike-through`}
      onClick={() => editor.chain().focus().toggleStrike().run()}
      disabled={!editor.can().chain().focus().toggleStrike().run()}
      selected={editor.isActive('strike')}
      iconOnly
      >
      <hbox slot="icon" class="strike-through-icon">s</hbox>
    </Button>
    <Button
      label={$t`Code word, within a phrase`}
      shortCutInfo={$t`\`code\``}
      onClick={() => editor.chain().focus().toggleCode().run()}
      disabled={!editor.can().chain().focus().toggleCode().run()}
      selected={editor.isActive('code')}
      icon={CodeWordIcon}
      iconSize="16px"
      iconOnly
      />
    <Button
      label="Code block with multiple lines"
      shortCutInfo="
```
code
block
3xENTER"
      onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      disabled={!editor.can().chain().focus().toggleCodeBlock().run()}
      selected={editor.isActive('codeBlock')}
      icon={CodeBlockIcon}
      iconSize="16px"
      iconOnly
      />
    <Button
      label={$t`Quote of the original email`}
      shortCutInfo={$t`> Quote`}
      onClick={() => editor.chain().focus().toggleBlockquote().run()}
      disabled={!editor.can().chain().focus().toggleBlockquote().run()}
      selected={editor.isActive('blockquote')}
      icon={QuoteMailIcon}
      iconSize="16px"
      iconOnly
      />
    <!--
    <Button
      label="Third party quote"
      onClick={() => editor.chain().focus().toggleBlockquote().run()}
      disabled={!editor.can().chain().focus().toggleBlockquote().run()}
      selected={editor.isActive('blockquote')}
      icon={QuoteIcon}
      iconSize="16px"
      iconOnly
      />
    -->
    <Button
      label={$t`Bulleted list`}
      shortCutInfo={$t`* Item`}
      onClick={() => editor.chain().focus().toggleBulletList().run()}
      disabled={!editor.can().chain().focus().toggleBulletList().run()}
      selected={editor.isActive('bulletList')}
      icon={ListBulletedIcon}
      iconOnly
      />
    <Button
      label={$t`Ordered list`}
      shortCutInfo={$t`1. Item`}
      onClick={() => editor.chain().focus().toggleOrderedList().run()}
      disabled={!editor.can().chain().focus().toggleOrderedList().run()}
      selected={editor.isActive('orderedList')}
      icon={ListNumberedIcon}
      iconOnly
      />
    <Button
      label={$t`Horizontal line`}
      shortCutInfo={$t`---`}
      onClick={() => editor.chain().focus().setHorizontalRule().run()}
      disabled={!editor.can().chain().focus().setHorizontalRule().run()}
      selected={editor.isActive('horizontalRule')}
      icon={SeparatorIcon}
      iconOnly
      />

    <Button
      label={$t`Title`}
      shortCutInfo={$t`# Big title`}
      onClick={() => editor.chain().focus().toggleHeading({ level: 1}).run()}
      disabled={!editor.can().chain().focus().toggleHeading({ level: 1}).run()}
      selected={editor.isActive('heading', { level: 1 })}
      iconOnly
      >
      <hbox slot="icon" class="header-icon">H1</hbox>
    </Button>
    <Button
      label={$t`Heading, hierarchy level 2`}
      shortCutInfo={$t`## Sub header`}
      onClick={() => editor.chain().focus().toggleHeading({ level: 2}).run()}
      disabled={!editor.can().chain().focus().toggleHeading({ level: 2}).run()}
      selected={editor.isActive('heading', { level: 2 })}
      iconOnly
      >
      <hbox slot="icon" class="header-icon">H2</hbox>
    </Button>
    <Button
      label={$t`Heading, hierarchy level 3`}
      shortCutInfo={$t`### Sub sub header`}
      onClick={() => editor.chain().focus().toggleHeading({ level: 3}).run()}
      disabled={!editor.can().chain().focus().toggleHeading({ level: 3}).run()}
      selected={editor.isActive('heading', { level: 3 })}
      iconOnly
      >
      <hbox slot="icon" class="header-icon">H3</hbox>
    </Button>
    <Button
      label={$t`Link to webpage`}
      onClick={onLinkOpen}
      selected={editor.isActive('link')}
      icon={LinkIcon}
      iconOnly
      />
    <Button
      label={$t`Remove link`}
      onClick={() => { editor.chain().focus().unsetLink().run(); isEditingLink = false; }}
      disabled={!editor.can().chain().focus().unsetLink().run()}
      icon={LinkRemoveIcon}
      iconOnly
      />
    <Button
      label={$t`Insert image`}
      tooltip={$t`Insert an image from your computer`}
      onClick={pickImageFile}
      icon={ImageIcon}
      iconOnly
      />
    <input type="file"
      class="image-file-input"
      accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
      bind:this={imageFileEl}
      on:change={onImageFileSelected}
      />
    <Button
      label={$t`Clear formatting`}
      onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}
      icon={ClearIcon}
      iconSize="16px"
      iconOnly
      />
    <slot name="before-undo" />

    <Button
      label={$t`Undo the last change`}
      shortCutInfo={$t`Ctrl-Z`}
      onClick={() => editor.chain().focus().undo().run()}
      disabled={!editor.can().chain().focus().undo().run()}
      icon={UndoIcon}
      iconOnly
      />
    <Button
      label={$t`Redo the change that was undone before`}
      shortCutInfo={$t`Ctrl-Y`}
      onClick={() => editor.chain().focus().redo().run()}
      disabled={!editor.can().chain().focus().redo().run()}
      icon={RedoIcon}
      iconOnly
      />
      <slot name="last" />

      <hbox flex />
      <slot name="end" />
  </Toolbar>
{/if}

{#if isEditingLink}
  <Toolbar>
    <hbox flex class="link-dialog">
      <!-- <label for="linktext">Link text</label>
      <input type="text" bind:value={linkText} id="linktext" /> -->
      <label for="linktargeturl">Link target URL</label>
      <input type="url" bind:value={linkTargetURL} id="linktargeturl" />
      <Button
        onClick={onLinkOK}
        label={$t`OK`}
        icon={OKIcon}
        iconOnly
        />
      <Button
        label={$t`Remove link`}
        onClick={() => { editor.chain().focus().unsetLink().run(); isEditingLink = false; }}
        disabled={!editor.can().chain().focus().unsetLink().run()}
        icon={LinkRemoveIcon}
        iconOnly
        />
    </hbox>
  </Toolbar>
{/if}

<script lang="ts">
  import Toolbar from '../../Shared/Toolbar/Toolbar.svelte';
  import Button from '../../Shared/Button.svelte';
  import ItalicIcon from "lucide-svelte/icons/italic";
  import CodeWordIcon from "lucide-svelte/icons/code";
  import CodeBlockIcon from "lucide-svelte/icons/code-xml";
  import QuoteMailIcon from "lucide-svelte/icons/text-quote";
  import QuoteIcon from "lucide-svelte/icons/quote";
  import LinkIcon from "lucide-svelte/icons/link";
  import LinkRemoveIcon from "lucide-svelte/icons/unlink";
  import ImageIcon from "lucide-svelte/icons/image-plus";
  import OKIcon from "lucide-svelte/icons/check";
  import ListBulletedIcon from "lucide-svelte/icons/list";
  import ListNumberedIcon from "lucide-svelte/icons/list-ordered";
  import ClearIcon from "lucide-svelte/icons/remove-formatting";
  import UndoIcon from "lucide-svelte/icons/undo";
  import RedoIcon from "lucide-svelte/icons/redo";
  import SeparatorIcon from "lucide-svelte/icons/separator-horizontal";
  import type { Editor } from '@tiptap/core';
  import { onDestroy } from 'svelte';
  import { blobToDataURL } from '../../../logic/util/util';
  import { t } from '../../../l10n/l10n';
  import {
    composeFontFamilies,
    composeFontSizes,
    composeLineHeights,
    composeDefaultFontSize,
    currentFontFamily,
    currentFontSize,
    currentLineHeight,
    formatFontSizeLabel,
    formatLineHeightLabel,
    normalizeMailLinkURL,
    normalizeFontSizeValue,
  } from './composeEditorExtensions';

  /* in only */
  export let editor: Editor;
  export let showFontControls = false;
  /** Shown in the size dropdown when the selection has no explicit size */
  export let defaultFontSize = normalizeFontSizeValue(composeDefaultFontSize);

  let styleTick = 0;
  let styleListenerCleanup: (() => void) | null = null;
  let subscribedEditor: Editor | null = null;
  $: if (editor && showFontControls && editor !== subscribedEditor) {
    styleListenerCleanup?.();
    subscribedEditor = editor;
    let bump = () => styleTick++;
    editor.on("selectionUpdate", bump);
    editor.on("transaction", bump);
    styleListenerCleanup = () => {
      editor.off("selectionUpdate", bump);
      editor.off("transaction", bump);
    };
  } else if (!editor || !showFontControls) {
    styleListenerCleanup?.();
    styleListenerCleanup = null;
    subscribedEditor = null;
  }

  onDestroy(() => {
    styleListenerCleanup?.();
    styleListenerCleanup = null;
    subscribedEditor = null;
  });

  $: selectedFontFamily = editor && showFontControls ? (styleTick, currentFontFamily(editor)) : "";
  $: selectedFontSize = editor && showFontControls ? (styleTick, currentFontSize(editor)) : "";
  $: selectedLineHeight = editor && showFontControls ? (styleTick, currentLineHeight(editor)) : "";
  $: displayFontSize = selectedFontSize || defaultFontSize;
  $: displayLineHeight = selectedLineHeight;
  $: lineHeightLabel = formatLineHeightLabel(displayLineHeight);

  let savedSelection: { from: number; to: number } | null = null;

  function rememberEditorSelection() {
    if (!editor) {
      return;
    }
    let { from, to } = editor.state.selection;
    savedSelection = { from, to };
  }

  function chainWithSavedSelection() {
    let chain = editor.chain().focus();
    if (savedSelection) {
      chain = chain.setTextSelection(savedSelection);
    }
    return chain;
  }

  function clearSavedSelection() {
    savedSelection = null;
  }

  function onFontFamilyChange(event: Event) {
    let value = (event.currentTarget as HTMLSelectElement).value;
    if (value) {
      chainWithSavedSelection().setFontFamily(value).run();
    } else {
      chainWithSavedSelection().unsetFontFamily().run();
    }
    clearSavedSelection();
  }

  function onFontSizeChange(event: Event) {
    let value = (event.currentTarget as HTMLSelectElement).value;
    chainWithSavedSelection().setFontSize(value).run();
    clearSavedSelection();
  }

  function onLineHeightChange(event: Event) {
    let value = (event.currentTarget as HTMLSelectElement).value;
    if (value) {
      chainWithSavedSelection().setLineHeight(value).run();
    } else {
      chainWithSavedSelection().unsetLineHeight().run();
    }
    clearSavedSelection();
  }

  let isEditingLink = false;
  let linkTargetURL: string = null;
  function onLinkOpen() {
    isEditingLink = true;
    linkTargetURL = editor.getAttributes('link').href
  }
  function onLinkOK() {
    let href = normalizeMailLinkURL(linkTargetURL);
    if (href) {
      editor.chain().focus().setLink({ href }).run();
    }
    isEditingLink = false;
  }

  let imageFileEl: HTMLInputElement;
  function pickImageFile() {
    imageFileEl?.click();
  }
  async function onImageFileSelected() {
    try {
      let file = imageFileEl?.files?.[0];
      if (imageFileEl) {
        imageFileEl.value = "";
      }
      if (!file || !editor) {
        return;
      }
      let url = await blobToDataURL(file);
      editor.chain().focus().setImage({ src: url }).run();
    } catch (ex) {
      console.error(ex);
    }
  }
</script>

<style>
  .bold-icon {
    font-weight: bold;
    height: 16px;
    align-items: center;
  }
  .strike-through-icon {
    text-decoration: line-through;
    font-size: 18px;
    height: 16px;
    align-items: center;
  }
  .header-icon {
    font-weight: bold;
  }
  .link-dialog {
    align-items: baseline;
  }
  .link-dialog input {
    max-width: 30em;
    margin-inline-end: 32px;
  }
  .link-dialog label {
    margin-inline-end: 8px;
  }
  .image-file-input {
    display: none;
  }
  .font-select {
    height: 24px;
    padding: 2px 6px;
    margin-inline-end: 4px;
    border: 1px solid var(--toolbar-control-border, var(--border));
    border-radius: 6px;
    background: var(--toolbar-control-bg, var(--bg));
    color: var(--text);
    font: inherit;
    font-size: 11px;
  }
  .font-select.font-family {
    min-width: 7.5em;
    max-width: 9em;
  }
  .font-select.font-size {
    min-width: 3em;
    max-width: 4.5em;
  }
  .font-select.line-height {
    min-width: 3em;
    max-width: 4em;
  }
</style>
