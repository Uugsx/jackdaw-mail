{#if editor}
  <vbox class="compose-ribbon font-smallest">
    <hbox class="ribbon-tabs">
      <button type="button" class="ribbon-tab" class:active={activeTab === "message"}
        on:click={() => activeTab = "message"}>
        {$t`Message`}
      </button>
      <button type="button" class="ribbon-tab" class:active={activeTab === "options"}
        on:click={() => activeTab = "options"}>
        {$t`Options`}
      </button>
    </hbox>

    {#if activeTab === "message"}
      <HorizontalScroll edgeButtons>
      <hbox class="ribbon-row">
        <vbox class="group">
          <hbox class="group-row send-row">
            <button type="button" class="ribbon-btn primary large send-main"
              title={sendDisabledTooltip ?? $t`Send`}
              disabled={!!sendDisabledTooltip || sending}
              on:click={() => dispatch("send")}>
              <SendIcon size="20px" />
              <span>{$t`Send`}</span>
            </button>
            <button type="button" class="ribbon-btn primary send-menu-btn"
              title={$t`Send options`}
              bind:this={sendMenuAnchor}
              disabled={!!sendDisabledTooltip || sending}
              on:click={() => sendMenuOpen = true}>
              <ChevronDownIcon size="14px" />
            </button>
          </hbox>
          <span class="group-label">{$t`Send`}</span>
        </vbox>

        <hbox class="divider" aria-hidden="true" />

        <vbox class="group">
          <hbox class="group-row">
            <button type="button" class="ribbon-btn" title={$t`Paste`}
              on:mousedown={rememberEditorSelection}
              on:click={() => pasteContent("default")}>
              <ClipboardPasteIcon size="18px" />
            </button>
            <button type="button" class="ribbon-btn paste-menu-btn" title={$t`Paste special`}
              bind:this={pasteMenuAnchor}
              on:mousedown={rememberEditorSelection}
              on:click={() => pasteMenuOpen = true}>
              <ChevronDownIcon size="14px" />
            </button>
            <button type="button" class="ribbon-btn" title={$t`Cut`}
              on:mousedown={rememberEditorSelection}
              on:click={onCut}>
              <ScissorsIcon size="18px" />
            </button>
            <button type="button" class="ribbon-btn" title={$t`Copy`}
              on:mousedown={rememberEditorSelection}
              on:click={onCopy}>
              <CopyIcon size="18px" />
            </button>
            <button type="button" class="ribbon-btn" class:on={!!formatPainter}
              title={formatPainter ? $t`Select text to apply formatting` : $t`Copy formatting`}
              aria-label={formatPainter ? $t`Select text to apply formatting` : $t`Copy formatting`}
              aria-pressed={!!formatPainter}
              on:mousedown|preventDefault={() => void 0}
              on:click={toggleFormatPainter}>
              <BrushIcon size="18px" />
            </button>
          </hbox>
          <span class="group-label">{$t`Clipboard`}</span>
        </vbox>

        <hbox class="divider" aria-hidden="true" />

        <vbox class="group basic-text-group">
          <hbox class="group-row font-row">
            <select class="ribbon-select font-family" title={$t`Font`}
              value={displayFontFamily}
              on:mousedown={rememberEditorSelection}
              on:change={onFontFamilyChange}>
              {#if selectedFontFamily && !composeFontFamilies.some(font => font.value === selectedFontFamily)}
                <option value={selectedFontFamily}>{formatFontFamilyLabel(selectedFontFamily)}</option>
              {/if}
              {#each composeFontFamilies as font}
                <option value={font.value}>{font.label()}</option>
              {/each}
            </select>
            <select class="ribbon-select font-size" title={$t`Font size`}
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
            <select class="ribbon-select line-height" title={$t`Line spacing`}
              value={displayLineHeight}
              on:mousedown={rememberEditorSelection}
              on:change={onLineHeightChange}>
              {#if selectedLineHeight && !composeLineHeights.some(lh => lh.value === selectedLineHeight)}
                <option value={selectedLineHeight}>{lineHeightLabel}</option>
              {/if}
              {#each composeLineHeights as lineHeight}
                <option value={lineHeight.value}>{lineHeight.label}</option>
              {/each}
            </select>
          </hbox>
          <hbox class="group-row">
            <button type="button" class="ribbon-btn" title={$t`Bold`}
              class:on={activeBold}
              on:mousedown={rememberEditorSelection}
              on:click={() => runFormattingCommand("bold", () => editor.chain().focus().toggleBold().run())}>
              <BoldIcon size="18px" />
            </button>
            <button type="button" class="ribbon-btn" title={$t`Italic`}
              class:on={activeItalic}
              on:mousedown={rememberEditorSelection}
              on:click={() => runFormattingCommand("italic", () => editor.chain().focus().toggleItalic().run())}>
              <ItalicIcon size="18px" />
            </button>
            <button type="button" class="ribbon-btn" title={$t`Underline`}
              class:on={activeUnderline}
              on:mousedown={rememberEditorSelection}
              on:click={() => runFormattingCommand("underline", () => editor.chain().focus().toggleUnderline().run())}>
              <UnderlineIcon size="18px" />
            </button>
            <button type="button" class="ribbon-btn" title={$t`Strike-through`}
              class:on={activeStrike}
              on:mousedown={rememberEditorSelection}
              on:click={() => runFormattingCommand("strikeThrough", () => editor.chain().focus().toggleStrike().run())}>
              <StrikethroughIcon size="18px" />
            </button>
            <hbox class="split-color-tool">
              <button type="button" class="ribbon-btn color-tool color-tool-main"
                class:on={!!selectedTextColor}
                title={$t`Font color`}
                aria-label={$t`Font color`}
                on:mousedown={rememberEditorSelection}
                on:click|stopPropagation={() => applyTextColor(lastTextColor)}>
                <span class="font-color-glyph">A</span>
                <span class="color-tool-bar" style:background={textColorBar} />
              </button>
              <button type="button" class="ribbon-btn color-tool-dropdown"
                bind:this={textColorMenuAnchor}
                title={$t`Font color`}
                aria-label={$t`Font color`}
                aria-haspopup="menu"
                aria-expanded={textColorMenuOpen}
                on:mousedown={rememberEditorSelection}
                on:click|stopPropagation={toggleTextColorMenu}>
                <ChevronDownIcon size="11px" />
              </button>
            </hbox>
            <hbox class="split-color-tool">
              <button type="button" class="ribbon-btn color-tool color-tool-main"
                class:on={activeHighlight}
                title={$t`Text highlight color`}
                aria-label={$t`Text highlight color`}
                on:mousedown={rememberEditorSelection}
                on:click|stopPropagation={() => applyHighlight(lastHighlightColor)}>
                <HighlighterIcon size="18px" />
                <span class="color-tool-bar" style:background={highlightBarColor} />
              </button>
              <button type="button" class="ribbon-btn color-tool-dropdown"
                bind:this={highlightMenuAnchor}
                title={$t`Text highlight color`}
                aria-label={$t`Text highlight color`}
                aria-haspopup="menu"
                aria-expanded={highlightMenuOpen}
                on:mousedown={rememberEditorSelection}
                on:click|stopPropagation={toggleHighlightMenu}>
                <ChevronDownIcon size="11px" />
              </button>
            </hbox>
          </hbox>
          <span class="group-label">{$t`Basic Text`}</span>
        </vbox>

        <hbox class="divider" aria-hidden="true" />

        <vbox class="group">
          <hbox class="group-row">
            <button type="button" class="ribbon-btn" title={$t`Bulleted list`}
              class:on={activeBulletList}
              on:mousedown={rememberEditorSelection}
              on:click={() => runFormattingCommand("insertUnorderedList", () => editor.chain().focus().toggleBulletList().run())}>
              <ListIcon size="18px" />
            </button>
            <button type="button" class="ribbon-btn" title={$t`Ordered list`}
              class:on={activeOrderedList}
              on:mousedown={rememberEditorSelection}
              on:click={() => runFormattingCommand("insertOrderedList", () => editor.chain().focus().toggleOrderedList().run())}>
              <ListOrderedIcon size="18px" />
            </button>
            <button type="button" class="ribbon-btn" title={$t`Quote of the original email`}
              class:on={activeBlockquote}
              on:mousedown={rememberEditorSelection}
              on:click={() => runFormattingCommand("formatBlock", () => editor.chain().focus().toggleBlockquote().run(), "blockquote")}>
              <QuoteIcon size="18px" />
            </button>
            <button type="button" class="ribbon-btn" title={$t`Align left`}
              class:on={activeAlignLeft}
              on:mousedown={rememberEditorSelection}
              on:click={() => runFormattingCommand("justifyLeft", () => editor.chain().focus().setTextAlign("left").run())}>
              <AlignLeftIcon size="18px" />
            </button>
            <button type="button" class="ribbon-btn" title={$t`Align center`}
              class:on={activeAlignCenter}
              on:mousedown={rememberEditorSelection}
              on:click={() => runFormattingCommand("justifyCenter", () => editor.chain().focus().setTextAlign("center").run())}>
              <AlignCenterIcon size="18px" />
            </button>
            <button type="button" class="ribbon-btn" title={$t`Align right`}
              class:on={activeAlignRight}
              on:mousedown={rememberEditorSelection}
              on:click={() => runFormattingCommand("justifyRight", () => editor.chain().focus().setTextAlign("right").run())}>
              <AlignRightIcon size="18px" />
            </button>
            <button type="button" class="ribbon-btn" title={$t`Justify`}
              class:on={activeAlignJustify}
              on:mousedown={rememberEditorSelection}
              on:click={() => runFormattingCommand("justifyFull", () => editor.chain().focus().setTextAlign("justify").run())}>
              <AlignJustifyIcon size="18px" />
            </button>
            <button type="button" class="ribbon-btn" title={$t`Increase indent`}
              on:mousedown={rememberEditorSelection}
              on:click={() => runFormattingCommand("indent", () => editor.chain().focus().indent().run())}>
              <IndentIncreaseIcon size="18px" />
            </button>
            <button type="button" class="ribbon-btn" title={$t`Decrease indent`}
              on:mousedown={rememberEditorSelection}
              on:click={() => runFormattingCommand("outdent", () => editor.chain().focus().unindent().run())}>
              <IndentDecreaseIcon size="18px" />
            </button>
            <button type="button" class="ribbon-btn" title={$t`Clear formatting`}
              on:mousedown={rememberEditorSelection}
              on:click={() => runFormattingCommand("removeFormat", () => editor.chain().focus().clearNodes().unsetAllMarks().run())}>
              <RemoveFormattingIcon size="18px" />
            </button>
          </hbox>
          <span class="group-label">{$t`Paragraph`}</span>
        </vbox>

        <hbox class="divider" aria-hidden="true" />

        <vbox class="group">
          <hbox class="group-row">
            <button type="button" class="ribbon-btn" title={$t`Link to webpage`}
              class:on={activeLink}
              on:mousedown={rememberEditorSelection}
              on:click={onLinkOpen}>
              <LinkIcon size="18px" />
            </button>
            <button type="button" class="ribbon-btn" title={$t`Insert image`}
              on:click={pickImageFile}>
              <ImageIcon size="18px" />
            </button>
            <button type="button" class="ribbon-btn" title={$t`Table`}
              on:click={insertTable}>
              <TableIcon size="18px" />
            </button>
            <button type="button" class="ribbon-btn" title={$t`Attachments`}
              on:click={() => dispatch("addAttachment")}>
              <PaperclipIcon size="18px" />
            </button>
            <button type="button" class="ribbon-btn" title={$t`Signature`}
              on:click={() => dispatch("insertSignature")}>
              <SignatureIcon size="18px" />
            </button>
            <button type="button" class="ribbon-btn" title={$t`Actions`}
              disabled={!!hasSML}
              on:click={() => dispatch("openActions")}>
              <ListChecksIcon size="18px" />
            </button>
          </hbox>
          <span class="group-label">{$t`Insert`}</span>
        </vbox>

        <hbox class="divider" aria-hidden="true" />

        <vbox class="group">
          <hbox class="group-row">
            <button type="button" class="ribbon-btn danger" title={$t`Important`}
              class:on={importanceLevel === "high"}
              on:click={() => dispatch("toggleHighImportance")}>
              <CircleAlertIcon size="18px" />
            </button>
            <button type="button" class="ribbon-btn low-importance" title={$t`Low importance`}
              class:on={importanceLevel === "low"}
              on:click={() => dispatch("toggleLowImportance")}>
              <ArrowDownIcon size="18px" />
            </button>
            <button type="button" class="ribbon-btn" title={$t`Flagged`}
              class:on={isFlagged}
              on:click={() => dispatch("toggleFlag")}>
              <FlagIcon size="18px" />
            </button>
            <button type="button" class="ribbon-btn" title={$t`Emoji`}
              class:on={showEmojis}
              on:click={() => dispatch("toggleEmojis")}>
              <SmileIcon size="18px" />
            </button>
            <button type="button" class="ribbon-btn" title={$t`Undo the last change`}
              on:mousedown={rememberEditorSelection}
              disabled={!editor.can().chain().focus().undo().run()}
              on:click={() => runFormattingCommand("undo", () => editor.chain().focus().undo().run())}>
              <UndoIcon size="18px" />
            </button>
            <button type="button" class="ribbon-btn" title={$t`Redo the change that was undone before`}
              on:mousedown={rememberEditorSelection}
              disabled={!editor.can().chain().focus().redo().run()}
              on:click={() => runFormattingCommand("redo", () => editor.chain().focus().redo().run())}>
              <RedoIcon size="18px" />
            </button>
          </hbox>
          <span class="group-label">{$t`Tags`}</span>
        </vbox>
      </hbox>
      </HorizontalScroll>
    {:else}
      <HorizontalScroll edgeButtons>
      <hbox class="ribbon-row options-row">
        <vbox class="group">
          <hbox class="group-row">
            <button type="button" class="ribbon-btn option-chip"
              class:on={sendAsHtml}
              title={sendAsHtml ? $t`Send as HTML and Plaintext` : $t`Send as Plaintext only`}
              on:click={toggleSendFormat}>
              HTML
            </button>
            <button type="button" class="ribbon-btn option-chip"
              class:on={spellcheckOn}
              title={$t`Spell check`}
              on:click={() => dispatch("toggleSpellcheck")}>
              <SpellCheckIcon size="16px" />
              <span>{$t`Spell check`}</span>
            </button>
          </hbox>
          <span class="group-label">{$t`Format`}</span>
        </vbox>

        <hbox class="divider" aria-hidden="true" />

        <vbox class="group">
          <hbox class="group-row">
            <button type="button" class="ribbon-btn option-chip"
              class:on={requestReadReceipt}
              title={$t`Request read receipt`}
              on:click={() => dispatch("toggleReadReceipt")}>
              <MailCheckIcon size="16px" />
              <span>{$t`Request read receipt`}</span>
            </button>
            <button type="button" class="ribbon-btn option-chip"
              class:on={requestDeliveryReceipt}
              title={$t`Request delivery receipt`}
              on:click={() => dispatch("toggleDeliveryReceipt")}>
              <MailOpenIcon size="16px" />
              <span>{$t`Request delivery receipt`}</span>
            </button>
          </hbox>
          <span class="group-label">{$t`Tracking`}</span>
        </vbox>

        <hbox class="divider" aria-hidden="true" />

        <vbox class="group">
          <hbox class="group-row zoom-row">
            {#each zoomLevels as level}
              <button type="button" class="ribbon-btn option-chip"
                class:on={editorZoom === level}
                on:click={() => dispatch("setZoom", level)}>
                {level}%
              </button>
            {/each}
          </hbox>
          <span class="group-label">{$t`Zoom`}</span>
        </vbox>
      </hbox>
      </HorizontalScroll>
    {/if}

    {#if isEditingLink}
      <hbox class="link-row">
        <span class="link-label">{$t`Link to webpage`}</span>
        <input type="url" bind:value={linkTargetURL} class="link-input" />
        <button type="button" class="ribbon-btn" title={$t`OK`}
          on:click={onLinkOK}>
          <CheckIcon size="16px" />
        </button>
        <button type="button" class="ribbon-btn" title={$t`Remove link`}
          on:click={onLinkRemove}>
          <UnlinkIcon size="16px" />
        </button>
      </hbox>
    {/if}
  </vbox>

  <Menu bind:isMenuOpen={pasteMenuOpen} anchor={pasteMenuAnchor} boundaryElSel=".mail-composer-window">
    <MenuItem label={$t`Keep source formatting`} onClick={() => pasteContent("source")} />
    <MenuItem label={$t`Merge formatting`} onClick={() => pasteContent("merge")} />
    <MenuItem label={$t`Keep text only`} onClick={() => pasteContent("text")} />
  </Menu>

  {#if sendMenuAnchor}
    <Menu bind:isMenuOpen={sendMenuOpen} anchor={sendMenuAnchor} boundaryElSel=".mail-composer-window">
      <MenuItem label={$t`Save draft`} onClick={() => { sendMenuOpen = false; dispatch("saveDraft"); }} />
    </Menu>
  {/if}

  {#if textColorMenuAnchor}
    <Menu bind:isMenuOpen={textColorMenuOpen} anchor={textColorMenuAnchor}
      boundaryElSel="body" placement="bottom-start" disableReferenceHide={true}>
      <vbox class="color-picker-popup">
        <button type="button" class="color-picker-action"
          on:click={() => applyTextColor(null)}>
          {$t`Automatic`}
        </button>
        <div class="color-grid">
          {#each composeTextColors as color}
            <button type="button" class="color-cell" style:background={color}
              class:selected={selectedTextColor === color}
              title={color}
              on:click={() => applyTextColor(color)} />
          {/each}
        </div>
      </vbox>
    </Menu>
  {/if}

  {#if highlightMenuAnchor}
    <Menu bind:isMenuOpen={highlightMenuOpen} anchor={highlightMenuAnchor}
      boundaryElSel="body" placement="bottom-start" disableReferenceHide={true}>
      <vbox class="color-picker-popup">
        <label class="color-picker-toggle">
          <input type="checkbox" bind:checked={highlightHighContrastOnly} />
          {$t`High contrast only`}
        </label>
        <button type="button" class="color-picker-action"
          on:click={() => applyHighlight(null)}>
          {$t`No color`}
        </button>
        <div class="color-grid">
          {#each visibleHighlightColors as color}
            <button type="button" class="color-cell" style:background={color}
              class:selected={selectedHighlightColor.toUpperCase() === color.toUpperCase()}
              title={color}
              on:click={() => applyHighlight(color)} />
          {/each}
        </div>
      </vbox>
    </Menu>
  {/if}

  <input type="file"
    class="image-file-input"
    accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
    bind:this={imageFileEl}
    on:change={onImageFileSelected} />
{/if}

<script lang="ts">
  import type { Editor } from "@tiptap/core";
  import { createEventDispatcher } from "svelte";
  import { blobToDataURL } from "../../../logic/util/util";
  import {
    composeFontFamilies,
    composeFontSizes,
    composeHighlightColors,
    composeHighlightColorsHighContrast,
    composeTextColors,
    composeDefaultFontFamily,
    composeDefaultFontSize,
    composeDefaultTextColor,
    composeDefaultHighlightColor,
    currentFontFamily,
    currentFontSize,
    currentLineHeight,
    formatFontSizeLabel,
    formatLineHeightLabel,
    fontSizeToCSS,
    normalizeFontSizeValue,
    composeLineHeights,
  } from "../../Shared/Editor/composeEditorExtensions";
  import {
    applyFormatPainter,
    captureFormatPainter,
    captureFormatPainterFromRange,
    type FormatPainterSnapshot,
  } from "../../Shared/Editor/formatPainter";
  import { onDestroy, onMount } from "svelte";
  import { t } from "../../../l10n/l10n";
  import SendIcon from "lucide-svelte/icons/send";
  import ClipboardPasteIcon from "lucide-svelte/icons/clipboard-paste";
  import ScissorsIcon from "lucide-svelte/icons/scissors";
  import CopyIcon from "lucide-svelte/icons/copy";
  import BrushIcon from "lucide-svelte/icons/brush";
  import BoldIcon from "lucide-svelte/icons/bold";
  import ItalicIcon from "lucide-svelte/icons/italic";
  import UnderlineIcon from "lucide-svelte/icons/underline";
  import StrikethroughIcon from "lucide-svelte/icons/strikethrough";
  import ListIcon from "lucide-svelte/icons/list";
  import ListOrderedIcon from "lucide-svelte/icons/list-ordered";
  import QuoteIcon from "lucide-svelte/icons/text-quote";
  import RemoveFormattingIcon from "lucide-svelte/icons/remove-formatting";
  import AlignLeftIcon from "lucide-svelte/icons/align-left";
  import AlignCenterIcon from "lucide-svelte/icons/align-center";
  import AlignRightIcon from "lucide-svelte/icons/align-right";
  import AlignJustifyIcon from "lucide-svelte/icons/align-justify";
  import IndentIncreaseIcon from "lucide-svelte/icons/indent-increase";
  import IndentDecreaseIcon from "lucide-svelte/icons/indent-decrease";
  import LinkIcon from "lucide-svelte/icons/link";
  import UnlinkIcon from "lucide-svelte/icons/unlink";
  import ImageIcon from "lucide-svelte/icons/image-plus";
  import TableIcon from "lucide-svelte/icons/table";
  import PaperclipIcon from "lucide-svelte/icons/paperclip";
  import SignatureIcon from "lucide-svelte/icons/signature";
  import CircleAlertIcon from "lucide-svelte/icons/circle-alert";
  import ArrowDownIcon from "lucide-svelte/icons/arrow-down";
  import SmileIcon from "lucide-svelte/icons/smile";
  import UndoIcon from "lucide-svelte/icons/undo";
  import RedoIcon from "lucide-svelte/icons/redo";
  import SpellCheckIcon from "lucide-svelte/icons/spell-check";
  import MailCheckIcon from "lucide-svelte/icons/mail-check";
  import MailOpenIcon from "lucide-svelte/icons/mail-open";
  import ChevronDownIcon from "lucide-svelte/icons/chevron-down";
  import HighlighterIcon from "lucide-svelte/icons/highlighter";
  import CheckIcon from "lucide-svelte/icons/check";
  import ListChecksIcon from "lucide-svelte/icons/list-checks";
  import FlagIcon from "lucide-svelte/icons/flag";
  import Menu from "../../Shared/Menu/Menu.svelte";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import HorizontalScroll from "../../Shared/HorizontalScroll.svelte";
  import { getLocalStorage } from "../../Util/LocalStorage";
  import type { MailImportanceLevel } from "../../../logic/Mail/EMail";
  import type {
    QuoteEditorCommand,
    QuoteEditorHandle,
    QuoteEditorStyle,
    QuoteTextAlign,
  } from "./quoteEditorCommands";

  export let editor: Editor;
  export let sendDisabledTooltip: string | null = null;
  export let sending = false;
  export let importanceLevel: MailImportanceLevel = "normal";
  export let requestReadReceipt = false;
  export let requestDeliveryReceipt = false;
  export let isFlagged = false;
  export let showEmojis = false;
  export let spellcheckOn = false;
  export let editorZoom = 100;
  export let hasSML = false;
  export let openLinkDialog = false;
  export let quoteEditor: QuoteEditorHandle | null = null;

  const dispatch = createEventDispatcher<{
    send: void;
    addAttachment: void;
    insertSignature: void;
    toggleHighImportance: void;
    toggleLowImportance: void;
    toggleReadReceipt: void;
    toggleDeliveryReceipt: void;
    toggleFlag: void;
    toggleEmojis: void;
    saveDraft: void;
    toggleSpellcheck: void;
    setZoom: number;
    openActions: void;
  }>();

  let activeTab: "message" | "options" = "message";
  const zoomLevels = [90, 100, 125];
  let formatSetting = getLocalStorage("mail.send.format", "html");
  let defaultFontFamilySetting = getLocalStorage("mail.compose.defaultFontFamily", composeDefaultFontFamily);
  let defaultFontSizeSetting = getLocalStorage("mail.compose.defaultFontSize", composeDefaultFontSize);
  let defaultTextColorSetting = getLocalStorage("mail.compose.defaultTextColor", composeDefaultTextColor);
  $: sendAsHtml = formatSetting.value === "html";
  function toggleSendFormat() {
    formatSetting.value = sendAsHtml ? "plaintext" : "html";
  }
  let pasteMenuOpen = false;
  let pasteMenuAnchor: HTMLButtonElement;
  let sendMenuOpen = false;
  let sendMenuAnchor: HTMLButtonElement;
  let textColorMenuOpen = false;
  let textColorMenuAnchor: HTMLButtonElement;
  let highlightMenuOpen = false;
  let highlightMenuAnchor: HTMLButtonElement;
  let highlightHighContrastOnly = false;
  let lastTextColorSetting = getLocalStorage("mail.compose.lastTextColor", composeTextColors[0]);
  let lastHighlightColorSetting = getLocalStorage("mail.compose.lastHighlightColor", composeDefaultHighlightColor);
  let lastTextColor = readRememberedColor(lastTextColorSetting.value, composeTextColors, composeTextColors[0]);
  let lastHighlightColor = readRememberedColor(lastHighlightColorSetting.value, composeHighlightColors, composeDefaultHighlightColor);

  type PasteMode = "default" | "source" | "merge" | "text";

  let isEditingLink = false;
  let linkTargetURL = "";
  let imageFileEl: HTMLInputElement;
  let styleTick = 0;
  let styleListenerCleanup: (() => void) | null = null;
  let nativeStyleListenerCleanup: (() => void) | null = null;
  let subscribedEditor: Editor | null = null;
  let activeEditorSource: "editor" | "quote" = "editor";
  let quoteStyle: QuoteEditorStyle | null = null;

  $: if (editor && editor !== subscribedEditor) {
    styleListenerCleanup?.();
    clearFormatPainter();
    subscribedEditor = editor;
    let bump = () => {
      activeEditorSource = "editor";
      quoteStyle = null;
      styleTick++;
    };
    editor.on("selectionUpdate", bump);
    editor.on("transaction", bump);
    styleListenerCleanup = () => {
      editor.off("selectionUpdate", bump);
      editor.off("transaction", bump);
    };
  } else if (!editor) {
    styleListenerCleanup?.();
    styleListenerCleanup = null;
    subscribedEditor = null;
  }

  onMount(() => {
    let refreshFromNativeSelection = () => {
      if (!editor) {
        return;
      }
      let selection = document.getSelection();
      let quoteRange = quoteEditor?.captureSelection();
      if (quoteRange) {
        activeEditorSource = "quote";
        quoteStyle = quoteEditor?.getCurrentStyle?.(quoteRange) ?? null;
        styleTick++;
        return;
      }
      if (selection?.rangeCount && selectionBelongsToElement(editor.view.dom, selection)) {
        activeEditorSource = "editor";
        quoteStyle = null;
        styleTick++;
      }
    };
    let refreshForEditorEvent = (event: Event) => {
      if (event.target instanceof Element
        && event.target.closest(".compose-quote-html, .ProseMirror")) {
        refreshFromNativeSelection();
      }
    };
    document.addEventListener("selectionchange", refreshFromNativeSelection);
    document.addEventListener("mouseup", refreshFromNativeSelection, true);
    document.addEventListener("keyup", refreshFromNativeSelection, true);
    document.addEventListener("input", refreshForEditorEvent, true);
    nativeStyleListenerCleanup = () => {
      document.removeEventListener("selectionchange", refreshFromNativeSelection);
      document.removeEventListener("mouseup", refreshFromNativeSelection, true);
      document.removeEventListener("keyup", refreshFromNativeSelection, true);
      document.removeEventListener("input", refreshForEditorEvent, true);
    };
    return nativeStyleListenerCleanup;
  });

  onDestroy(() => {
    styleListenerCleanup?.();
    nativeStyleListenerCleanup?.();
    clearFormatPainter();
    styleListenerCleanup = null;
    nativeStyleListenerCleanup = null;
    subscribedEditor = null;
  });

  /** Keep the editor style revision reactive without comma-operator diagnostics. */
  function readEditorStyle<T>(read: () => T, _styleRevision: number): T {
    return read();
  }

  function selectionBelongsToElement(root: Element, selection: Selection): boolean {
    return !!selection.anchorNode
      && !!selection.focusNode
      && root.contains(selection.anchorNode)
      && root.contains(selection.focusNode);
  }

  function currentTextAlign(alignment: QuoteTextAlign): boolean {
    if (quoteSelectionActive) {
      return quoteStyle?.textAlign === alignment;
    }
    if (!editor) {
      return false;
    }
    return editor.isActive({ textAlign: alignment });
  }

  function formatFontFamilyLabel(value: string): string {
    let firstFamily = value.split(",")[0]?.trim().replace(/^['"]|['"]$/g, "");
    return firstFamily || value;
  }

  $: quoteSelectionActive = activeEditorSource === "quote" && !!quoteStyle;
  $: selectedFontFamily = editor
    ? readEditorStyle(() => quoteSelectionActive ? quoteStyle?.fontFamily ?? "" : currentFontFamily(editor), styleTick)
    : "";
  $: displayFontFamily = selectedFontFamily || $defaultFontFamilySetting.value;
  $: selectedFontSize = editor
    ? readEditorStyle(() => quoteSelectionActive ? quoteStyle?.fontSize ?? "" : currentFontSize(editor), styleTick)
    : "";
  $: displayFontSize = selectedFontSize || normalizeFontSizeValue($defaultFontSizeSetting.value || composeDefaultFontSize);
  $: selectedLineHeight = editor
    ? readEditorStyle(() => quoteSelectionActive ? quoteStyle?.lineHeight ?? "" : currentLineHeight(editor), styleTick)
    : "";
  $: displayLineHeight = selectedLineHeight;
  $: lineHeightLabel = formatLineHeightLabel(displayLineHeight);
  $: selectedTextColor = editor
    ? readEditorStyle(() => quoteSelectionActive
      ? quoteStyle?.color ?? ""
      : editor.getAttributes("textStyle").color ?? "", styleTick)
    : "";
  $: textColorBar = selectedTextColor || $defaultTextColorSetting.value || lastTextColor;
  $: selectedHighlightColor = editor
    ? readEditorStyle(() => quoteSelectionActive
      ? quoteStyle?.highlight ?? ""
      : editor.getAttributes("highlight").color ?? "", styleTick)
    : "";
  $: highlightBarColor = selectedHighlightColor || lastHighlightColor;
  $: visibleHighlightColors = highlightHighContrastOnly
    ? composeHighlightColorsHighContrast
    : composeHighlightColors;

  $: activeBold = readEditorStyle(() => quoteSelectionActive
    ? quoteStyle?.bold ?? false
    : !!editor?.isActive("bold"), styleTick);
  $: activeItalic = readEditorStyle(() => quoteSelectionActive
    ? quoteStyle?.italic ?? false
    : !!editor?.isActive("italic"), styleTick);
  $: activeUnderline = readEditorStyle(() => quoteSelectionActive
    ? quoteStyle?.underline ?? false
    : !!editor?.isActive("underline"), styleTick);
  $: activeStrike = readEditorStyle(() => quoteSelectionActive
    ? quoteStyle?.strike ?? false
    : !!editor?.isActive("strike"), styleTick);
  $: activeHighlight = readEditorStyle(() => quoteSelectionActive
    ? !!quoteStyle?.highlight
    : !!editor?.isActive("highlight"), styleTick);
  $: activeBulletList = readEditorStyle(() => quoteSelectionActive
    ? quoteStyle?.bulletList ?? false
    : !!editor?.isActive("bulletList"), styleTick);
  $: activeOrderedList = readEditorStyle(() => quoteSelectionActive
    ? quoteStyle?.orderedList ?? false
    : !!editor?.isActive("orderedList"), styleTick);
  $: activeBlockquote = readEditorStyle(() => quoteSelectionActive
    ? quoteStyle?.blockquote ?? false
    : !!editor?.isActive("blockquote"), styleTick);
  $: activeAlignLeft = readEditorStyle(() => currentTextAlign("left"), styleTick);
  $: activeAlignCenter = readEditorStyle(() => currentTextAlign("center"), styleTick);
  $: activeAlignRight = readEditorStyle(() => currentTextAlign("right"), styleTick);
  $: activeAlignJustify = readEditorStyle(() => currentTextAlign("justify"), styleTick);
  $: activeLink = readEditorStyle(() => quoteSelectionActive
    ? !!quoteStyle?.link
    : !!editor?.isActive("link"), styleTick);
  $: if (openLinkDialog && editor) {
    openLinkDialog = false;
    onLinkOpen();
  }

  type SavedSelection =
    | { source: "editor"; from: number; to: number }
    | { source: "quote"; range: Range };

  let savedSelection: SavedSelection | null = null;
  let formatPainter: FormatPainterSnapshot | null = null;
  let formatPainterSourceSelection: { from: number; to: number; source: "editor" | "quote" } | null = null;
  let formatPainterListenersCleanup: (() => void) | null = null;

  function captureCurrentFormatPainter(): { snapshot: FormatPainterSnapshot; source: "editor" | "quote" } | null {
    let nativeSelection = document.getSelection();
    if (nativeSelection?.rangeCount && !nativeSelection.isCollapsed) {
      let range = nativeSelection.getRangeAt(0);
      let startElement = range.startContainer instanceof Element
        ? range.startContainer
        : range.startContainer.parentElement;
      if (startElement?.closest(".compose-quote-html")) {
        let snapshot = captureFormatPainterFromRange(editor, range);
        return snapshot ? { snapshot, source: "quote" } : null;
      }
    }
    return { snapshot: captureFormatPainter(editor), source: "editor" };
  }

  function toggleFormatPainter() {
    if (formatPainter) {
      clearFormatPainter();
      return;
    }
    if (!editor) {
      return;
    }
    let captured = captureCurrentFormatPainter();
    if (!captured) {
      return;
    }
    formatPainter = captured.snapshot;
    let { from, to } = editor.state.selection;
    formatPainterSourceSelection = { from, to, source: captured.source };

    let onMouseUp = (event: MouseEvent) => {
      if (event.target instanceof Node && editor.view.dom.contains(event.target)) {
        setTimeout(applyFormatPainterToSelection, 0);
      }
    };
    let onKeyUp = () => {
      if (editor.view.hasFocus()) {
        setTimeout(applyFormatPainterToSelection, 0);
      }
    };
    let onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        clearFormatPainter();
      }
    };
    document.addEventListener("mouseup", onMouseUp, true);
    document.addEventListener("keyup", onKeyUp, true);
    document.addEventListener("keydown", onKeyDown, true);
    formatPainterListenersCleanup = () => {
      document.removeEventListener("mouseup", onMouseUp, true);
      document.removeEventListener("keyup", onKeyUp, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }

  function applyFormatPainterToSelection() {
    if (!formatPainter || !editor || !editor.view.hasFocus()) {
      return;
    }
    let selection = editor.state.selection;
    if (formatPainterSourceSelection?.source === "editor"
      && formatPainterSourceSelection.from === selection.from
      && formatPainterSourceSelection.to === selection.to) {
      return;
    }
    let snapshot = formatPainter;
    clearFormatPainter();
    applyFormatPainter(editor, snapshot);
  }

  function clearFormatPainter() {
    formatPainterListenersCleanup?.();
    formatPainterListenersCleanup = null;
    formatPainter = null;
    formatPainterSourceSelection = null;
  }

  function rememberEditorSelection() {
    let quoteRange = quoteEditor?.captureSelection();
    if (quoteRange) {
      savedSelection = { source: "quote", range: quoteRange };
      activeEditorSource = "quote";
      quoteStyle = quoteEditor?.getCurrentStyle?.(quoteRange) ?? quoteStyle;
      styleTick++;
      return;
    }
    if (!editor) {
      return;
    }
    let { from, to } = editor.state.selection;
    savedSelection = { source: "editor", from, to };
    activeEditorSource = "editor";
    quoteStyle = null;
    styleTick++;
  }

  function chainWithSavedSelection() {
    let chain = editor.chain().focus();
    if (savedSelection?.source === "editor") {
      chain = chain.setTextSelection({ from: savedSelection.from, to: savedSelection.to });
    }
    return chain;
  }

  function runFormattingCommand(
    quoteCommand: QuoteEditorCommand,
    editorCommand: () => boolean,
    value?: string | null,
  ): boolean {
    if (savedSelection?.source === "quote") {
      let changed = quoteEditor?.applyCommand(quoteCommand, value, savedSelection.range) ?? false;
      clearSavedSelection();
      return changed;
    }
    return editorCommand();
  }

  function clearSavedSelection() {
    savedSelection = null;
  }

  function onFontFamilyChange(event: Event) {
    let value = (event.currentTarget as HTMLSelectElement).value;
    if (value) {
      runFormattingCommand("fontName", () => chainWithSavedSelection().setFontFamily(value).run(), value);
    } else {
      runFormattingCommand("fontName", () => chainWithSavedSelection().unsetFontFamily().run(), "inherit");
    }
    clearSavedSelection();
  }

  function onFontSizeChange(event: Event) {
    let value = (event.currentTarget as HTMLSelectElement).value;
    if (value) {
      runFormattingCommand("fontSize", () => chainWithSavedSelection().setFontSize(value).run(), quoteFontSizeValue(value));
    } else {
      runFormattingCommand("removeFormat", () => chainWithSavedSelection().unsetFontSize().run());
    }
    clearSavedSelection();
  }

  function onLineHeightChange(event: Event) {
    let value = (event.currentTarget as HTMLSelectElement).value;
    if (value) {
      runFormattingCommand("lineHeight", () => chainWithSavedSelection().setLineHeight(value).run(), value);
    } else {
      runFormattingCommand("lineHeight", () => chainWithSavedSelection().unsetLineHeight().run());
    }
    clearSavedSelection();
  }

  /** Native contenteditable fontSize accepts only the legacy 1–7 scale. */
  function quoteFontSizeValue(value: string): string {
    let size = parseFloat(value);
    if (!Number.isFinite(size)) {
      return "3";
    }
    if (size <= 8) return "1";
    if (size <= 10) return "2";
    if (size <= 12) return "3";
    if (size <= 14) return "4";
    if (size <= 18) return "5";
    if (size <= 24) return "6";
    return "7";
  }

  function applyTextColor(color: string | null) {
    if (color && composeTextColors.includes(color)) {
      lastTextColor = color;
      lastTextColorSetting.value = color;
    }
    if (color) {
      runFormattingCommand("foreColor", () => chainWithSavedSelection().setColor(color).run(), color);
    } else {
      runFormattingCommand("foreColor", () => chainWithSavedSelection().unsetColor().run(), "inherit");
    }
    clearSavedSelection();
    textColorMenuOpen = false;
  }

  function toggleTextColorMenu() {
    highlightMenuOpen = false;
    textColorMenuOpen = !textColorMenuOpen;
  }

  function toggleHighlightMenu() {
    textColorMenuOpen = false;
    highlightMenuOpen = !highlightMenuOpen;
  }

  function applyHighlight(color: string | null) {
    if (color && composeHighlightColors.includes(color)) {
      lastHighlightColor = color;
      lastHighlightColorSetting.value = color;
    }
    if (color) {
      runFormattingCommand("hiliteColor", () => chainWithSavedSelection().setHighlight({ color }).run(), color);
    } else {
      runFormattingCommand("hiliteColor", () => chainWithSavedSelection().unsetHighlight().run(), "transparent");
    }
    clearSavedSelection();
    highlightMenuOpen = false;
  }

  function readRememberedColor(value: unknown, palette: string[], fallback: string): string {
    return typeof value === "string" && palette.includes(value) ? value : fallback;
  }

  function insertTable() {
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  }

  function onCut() {
    if (savedSelection?.source === "quote" && quoteEditor) {
      quoteEditor.applyCommand("cut", undefined, savedSelection.range);
      clearSavedSelection();
      return;
    }
    editor?.chain().focus().run();
    document.execCommand("cut");
  }

  function onCopy() {
    if (savedSelection?.source === "quote" && quoteEditor) {
      quoteEditor.applyCommand("copy", undefined, savedSelection.range);
      clearSavedSelection();
      return;
    }
    editor?.chain().focus().run();
    document.execCommand("copy");
  }

  async function pasteContent(mode: PasteMode) {
    let quoteSelection = savedSelection?.source === "quote" && quoteEditor
      ? savedSelection.range
      : null;
    if (!quoteSelection) {
      editor?.chain().focus().run();
    }
    pasteMenuOpen = false;
    try {
      let items = await navigator.clipboard.read();
      let html = "";
      let text = "";
      for (let item of items) {
        if (!html && item.types.includes("text/html")) {
          html = await (await item.getType("text/html")).text();
        }
        if (!text && item.types.includes("text/plain")) {
          text = await (await item.getType("text/plain")).text();
        }
      }
      if (mode === "text") {
        if (text) {
          if (quoteSelection && quoteEditor) {
            quoteEditor.applyCommand("insertText", text, quoteSelection);
            clearSavedSelection();
          } else {
            editor?.chain().focus().insertContent(text).run();
          }
        }
        return;
      }
      if (mode === "merge" && html) {
        html = mergePasteFormatting(html);
      }
      if ((mode === "default" || mode === "source" || mode === "merge") && html) {
        if (quoteSelection && quoteEditor) {
          quoteEditor.applyCommand("insertHTML", html, quoteSelection);
          clearSavedSelection();
        } else {
          editor?.chain().focus().insertContent(html).run();
        }
        return;
      }
      if (text) {
        if (quoteSelection && quoteEditor) {
          quoteEditor.applyCommand("insertText", text, quoteSelection);
          clearSavedSelection();
        } else {
          editor?.chain().focus().insertContent(text).run();
        }
        return;
      }
    } catch {
      // Fall back to native paste when clipboard API is blocked.
    }
    if (quoteSelection && quoteEditor) {
      quoteEditor.applyCommand("paste", undefined, quoteSelection);
      clearSavedSelection();
    } else {
      document.execCommand("paste");
    }
  }

  function mergePasteFormatting(html: string): string {
    let doc = new DOMParser().parseFromString(html, "text/html");
    doc.body.querySelectorAll("*").forEach(element => {
      element.removeAttribute("style");
      element.removeAttribute("class");
      element.removeAttribute("color");
      element.removeAttribute("face");
      element.removeAttribute("size");
    });
    doc.body.querySelectorAll("font").forEach(element => {
      let parent = element.parentNode;
      if (!parent) {
        return;
      }
      while (element.firstChild) {
        parent.insertBefore(element.firstChild, element);
      }
      parent.removeChild(element);
    });
    return doc.body.innerHTML;
  }

  function onLinkOpen() {
    isEditingLink = true;
    if (savedSelection?.source === "quote") {
      linkTargetURL = quoteStyle?.link ?? "";
      return;
    }
    linkTargetURL = editor.getAttributes("link").href ?? "";
  }

  function onLinkOK() {
    if (linkTargetURL) {
      if (savedSelection?.source === "quote" && !isSafeQuoteLink(linkTargetURL)) {
        clearSavedSelection();
        isEditingLink = false;
        return;
      }
      runFormattingCommand("createLink", () => editor.chain().focus().setLink({ href: linkTargetURL }).run(), linkTargetURL);
    }
    clearSavedSelection();
    isEditingLink = false;
  }

  function isSafeQuoteLink(value: string): boolean {
    try {
      let protocol = new URL(value, window.location.href).protocol;
      return ["http:", "https:", "mailto:", "tel:"].includes(protocol);
    } catch {
      return false;
    }
  }

  function onLinkRemove() {
    runFormattingCommand("unlink", () => editor.chain().focus().unsetLink().run());
    clearSavedSelection();
    isEditingLink = false;
  }

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
    } catch {
      // Image insert failed silently — user can retry.
    }
  }
</script>

<style>
  .compose-ribbon {
    width: 100%;
    min-width: 0;
    align-self: stretch;
    gap: 0;
    border-block-end: 1px solid var(--border);
    background: var(--headerbar-bg);
    color: var(--headerbar-fg);
  }
  .compose-ribbon :global(.h-scroll) {
    width: 100%;
    min-width: 0;
  }
  .ribbon-tabs {
    gap: 0;
    width: 100%;
    padding-inline: 8px;
    border-block-end: 1px solid var(--border);
  }
  .ribbon-tab {
    padding: 6px 14px 5px;
    border: none;
    border-block-end: 2px solid transparent;
    background: transparent;
    color: color-mix(in srgb, var(--headerbar-fg) 72%, transparent);
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    cursor: default;
  }
  .ribbon-tab.active {
    color: var(--headerbar-fg);
    border-block-end-color: var(--icon-primary);
  }
  .ribbon-tab:hover:not(.active) {
    background: var(--hover-bg);
    color: var(--hover-fg);
  }
  .ribbon-row {
    align-items: stretch;
    width: 100%;
    min-width: 100%;
    box-sizing: border-box;
    gap: 2px;
    padding: 6px 8px 4px;
  }
  .group {
    align-items: center;
    justify-content: flex-end;
    gap: 2px;
    min-width: 0;
    flex-shrink: 0;
  }
  .group-row {
    align-items: center;
    gap: 1px;
    min-height: 28px;
  }
  .basic-text-group .group-row:last-of-type {
    min-height: 28px;
  }
  .group-row.font-row {
    min-height: 24px;
    margin-block-end: 2px;
  }
  .ribbon-select {
    height: 24px;
    padding: 2px 6px;
    border: 1px solid var(--toolbar-control-border);
    border-radius: 6px;
    background: var(--toolbar-control-bg);
    color: var(--headerbar-fg);
    font: inherit;
    font-size: 11px;
  }
  .ribbon-select.font-family {
    min-width: 7.5em;
    max-width: 9em;
  }
  .ribbon-select.font-size {
    min-width: 3.5em;
    max-width: 4em;
  }
  .ribbon-select.line-height {
    min-width: 3.5em;
    max-width: 4em;
  }
  .color-tool {
    position: relative;
    gap: 0;
    padding-block: 2px 1px;
  }
  .split-color-tool {
    align-items: stretch;
    gap: 0;
    flex-shrink: 0;
  }
  .split-color-tool .color-tool-main {
    border-start-end-radius: 0;
    border-end-end-radius: 0;
  }
  .split-color-tool .color-tool-dropdown {
    min-width: 16px;
    padding-inline: 2px;
    border-start-start-radius: 0;
    border-end-start-radius: 0;
    margin-inline-start: -1px;
  }
  .font-color-glyph {
    font-size: 15px;
    font-weight: 700;
    line-height: 1;
    color: var(--headerbar-fg);
  }
  .color-tool-bar {
    display: block;
    width: 16px;
    height: 3px;
    border-radius: 1px;
    margin-block-start: 1px;
    border: 1px solid color-mix(in srgb, var(--toolbar-control-border) 80%, transparent);
  }
  .color-picker-popup {
    gap: 8px;
    padding: 8px;
    min-width: 168px;
  }
  .color-picker-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--fg);
    cursor: default;
    user-select: none;
  }
  .color-picker-action {
    box-sizing: border-box;
    width: 100%;
    min-height: 28px;
    padding: 4px 8px;
    border: 1px solid var(--toolbar-control-border);
    border-radius: 6px;
    background: var(--toolbar-control-bg);
    color: var(--fg);
    font: inherit;
    font-size: 11px;
    text-align: start;
    cursor: default;
  }
  .color-picker-action:hover {
    background: var(--hover-bg);
    color: var(--hover-fg);
  }
  .color-grid {
    display: grid;
    grid-template-columns: repeat(5, 28px);
    gap: 4px;
  }
  .color-cell {
    width: 28px;
    height: 22px;
    padding: 0;
    border: 1px solid var(--toolbar-control-border);
    border-radius: 2px;
    cursor: default;
  }
  .color-cell:hover {
    outline: 2px solid var(--icon-primary);
    outline-offset: 1px;
  }
  .color-cell.selected {
    outline: 2px solid var(--icon-primary);
    outline-offset: 1px;
  }
  .group-label {
    color: color-mix(in srgb, var(--headerbar-fg) 58%, transparent);
    font-size: 10px;
    line-height: 1.2;
    text-align: center;
    white-space: nowrap;
  }
  .divider {
    width: 1px;
    align-self: stretch;
    margin-inline: 4px;
    background: var(--border);
    flex-shrink: 0;
  }
  .ribbon-btn {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    min-width: 28px;
    height: 28px;
    padding: 4px 6px;
    border: 1px solid transparent;
    border-radius: 6px;
    background: transparent;
    color: var(--headerbar-fg);
    font: inherit;
    font-size: 10px;
    line-height: 1;
    cursor: default;
    flex-shrink: 0;
    transform-origin: center;
    transition:
      background-color 160ms ease,
      color 160ms ease,
      border-color 160ms ease,
      transform var(--button-motion-duration) var(--button-motion-ease),
      box-shadow 180ms ease;
  }
  .ribbon-btn :global(svg) {
    display: block;
    flex-shrink: 0;
    transform-origin: center;
    transition: transform var(--button-motion-duration) var(--button-motion-ease);
  }
  .paste-menu-btn {
    min-width: 18px;
    padding-inline: 2px;
  }
  .send-row {
    align-items: stretch;
  }
  .send-main {
    border-start-end-radius: 0;
    border-end-end-radius: 0;
    min-width: 56px;
  }
  .send-menu-btn {
    min-width: 20px;
    padding-inline: 2px;
    border-start-start-radius: 0;
    border-end-start-radius: 0;
    margin-inline-start: -1px;
  }
  .ribbon-btn:hover:not(:disabled) {
    background: var(--hover-bg);
    color: var(--hover-fg);
    transform: translateY(var(--button-motion-lift));
    box-shadow: 0 4px 12px rgba(var(--shadow-color), 0.09);
  }
  .ribbon-btn:hover:not(:disabled) :global(svg) {
    transform: translateY(-1px) scale(1.03);
  }
  .ribbon-btn:active:not(:disabled) {
    transform: translateY(0) scale(var(--button-motion-press-scale));
  }
  .ribbon-btn:active:not(:disabled) :global(svg) {
    transform: none;
  }
  .ribbon-btn.color-tool:hover:not(:disabled) .font-color-glyph {
    color: var(--hover-fg);
  }
  .ribbon-btn:disabled {
    opacity: 0.35;
  }
  @media (prefers-reduced-motion: reduce) {
    .ribbon-btn,
    .ribbon-btn :global(svg) {
      transition: none;
    }
    .ribbon-btn:hover:not(:disabled),
    .ribbon-btn:active:not(:disabled),
    .ribbon-btn:hover:not(:disabled) :global(svg),
    .ribbon-btn:active:not(:disabled) :global(svg) {
      transform: none;
    }
  }
  .ribbon-btn.on :global(svg) {
    color: var(--icon-primary);
  }
  .ribbon-btn.danger.on :global(svg) {
    color: var(--danger-fg);
  }
  .ribbon-btn.low-importance.on :global(svg) {
    color: #2563eb;
  }
  .ribbon-btn.primary {
    color: var(--toolbar-control-fg);
  }
  .ribbon-btn.large {
    min-width: 56px;
    height: 56px;
    padding: 6px 10px;
    border-radius: 8px;
    background: var(--inverted-bg);
    color: var(--inverted-fg);
  }
  .ribbon-btn.large:hover:not(:disabled) {
    background: color-mix(in srgb, var(--inverted-bg) 88%, white);
    color: var(--inverted-fg);
  }
  .ribbon-btn.large span {
    font-size: 11px;
    font-weight: 650;
  }
  .option-chip {
    flex-direction: row;
    gap: 4px;
    min-width: auto;
    height: 28px;
    padding-inline: 10px;
    border-color: var(--toolbar-control-border);
    background: var(--toolbar-control-bg);
  }
  .option-chip.on {
    background: var(--selected-bg);
    color: var(--selected-fg);
    border-color: transparent;
  }
  .options-row .group-row {
    min-height: 36px;
  }
  .zoom-row {
    gap: 4px;
  }
  .link-row {
    align-items: center;
    gap: 8px;
    padding: 6px 12px 8px;
    border-block-start: 1px solid var(--border);
  }
  .link-label {
    flex-shrink: 0;
    color: color-mix(in srgb, var(--headerbar-fg) 72%, transparent);
  }
  .link-input {
    flex: 1 1 auto;
    min-width: 0;
    max-width: 28em;
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: var(--border-radius);
    background: var(--input-bg);
    color: var(--input-fg);
    font: inherit;
    font-size: 12px;
  }
  .image-file-input {
    display: none;
  }
</style>
