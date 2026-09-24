<FileDropTarget
  on:add-files={(event) => catchErrors(() => onFilesDrop(event))}
  on:inline-files={(event) => catchErrors(() => onFileInlineDrop(event))}
  allowInline={true}>
  <vbox flex class="mail-composer-window" class:floating on:keydown|capture={onComposerKeydown}>
    <vbox class="compose-header">
      <hbox class="compose-top-row">
        <IdentitySelector bind:selectedIdentity={fromIdentity}
          bind:fromAddress={mail.from.emailAddress}
          bind:fromName={mail.from.name}
          workspace={standalone ? mail.folder?.account.workspace : $selectedWorkspace}
          compact />
        <EncryptionButtons {mail} identity={fromIdentity} />
        <hbox flex class="spacer" />
        {#if appGlobal.isMobile}
          <CloseButton {mail} on:close={onClose} />
        {:else if !floating || standalone}
          <hbox class="header-actions">
            <RoundButton
              classes="plain toolbar-chrome"
              label={$t`Save draft`}
              icon={SaveIcon}
              iconSize="16px"
              padding="6px"
              onClick={onSaveDraft}
              />
            <CloseButton {mail} chrome on:close={onClose} />
          </hbox>
        {/if}
      </hbox>

      <grid class="recipients">
        <hbox class="label-cell">
          <span class="label">{$t`To`}</span>
        </hbox>
        <hbox flex class="to-row">
          <MailAutocomplete bind:this={toAutocomplete} addresses={mail.to} collapseAfter={3}
            placeholder={$t`Add recipient`} tabindex={1} autofocus={mail.to.isEmpty && !floating}
            searchFunction={searchContactsInOwner}>
            <svelte:fragment slot="person-popup-buttons" let:person>
              <Button plain label={$t`CC`} onClick={() => onMoveToCC(person)} />
              <Button plain label={$t`BCC`} onClick={() => onMoveToBCC(person)} />
            </svelte:fragment>
          </MailAutocomplete>
          <RoundButton
            classes="plain toolbar-chrome"
            label={$t`Check names`}
            shortCutInfo="Alt+K"
            icon={UserCheckIcon}
            iconSize="16px"
            padding="6px"
            onClick={() => catchErrors(onCheckNames)} />
          <hbox class="cc buttons">
            <Button
              label={$t`Cc`}
              onClick={() => {showCCForce = !showCCForce}}
              selected={showCC}
              />
            <Button
              label={$t`Bcc`}
              onClick={() => {showBCCForce = !showBCCForce}}
              selected={showBCC}
              />
          </hbox>
        </hbox>
        {#if showCC}
          <hbox class="label-cell"><span class="label">{$t`Cc`}</span></hbox>
          <MailAutocomplete bind:this={ccAutocomplete} addresses={mail.cc} collapseAfter={3}
            placeholder={$t`Add CC recipient`} tabindex={1}
            searchFunction={searchContactsInOwner}>
            <svelte:fragment slot="person-popup-buttons" let:person={person}>
              <Button plain label={$t`To`} onClick={() => onMoveToTo(person)} />
              <Button plain label={$t`BCC`} onClick={() => onMoveToBCC(person)} />
            </svelte:fragment>
          </MailAutocomplete>
        {/if}
        {#if showBCC}
          <hbox class="label-cell"><span class="label">{$t`Bcc`}</span></hbox>
          <MailAutocomplete bind:this={bccAutocomplete} addresses={mail.bcc} collapseAfter={3}
            placeholder={$t`Add BCC recipient`} tabindex={1}
            searchFunction={searchContactsInOwner}>
            <svelte:fragment slot="person-popup-buttons" let:person>
              <Button plain label={$t`To`} onClick={() => onMoveToTo(person)} />
              <Button plain label={$t`CC`} onClick={() => onMoveToCC(person)} />
            </svelte:fragment>
          </MailAutocomplete>
        {/if}
      </grid>

      <hbox class="subject-row">
        <span class="label">{$t`Subject`}</span>
        <input type="text" bind:value={mail.subject} tabindex={1} placeholder={$t`Subject`} class="font-normal" />
      </hbox>
    </vbox>
    {#if $mail.shouldEncrypt}
      <EncryptionDetails {mail} identity={fromIdentity} bind:encryptionError />
    {/if}
    <hbox bind:this={smlAddAnchor} class="ribbon-anchor">
      <ComposeRibbon
        {editor}
        {quoteEditor}
        bind:openLinkDialog
      sendDisabledTooltip={sendDisabledTooltip}
      sending={sending || loading}
      importanceLevel={mail.importanceLevel}
      requestReadReceipt={mail.requestReadReceipt}
      requestDeliveryReceipt={mail.requestDeliveryReceipt}
      isFlagged={mail.isStarred}
      {showEmojis}
      spellcheckOn={$spellcheckEnabled.value}
      {editorZoom}
      hasSML={!!$mail.sml}
      on:send={() => catchErrors(onSend)}
      on:addAttachment={() => catchErrors(onAddAttachment)}
      on:insertSignature={insertSignature}
      on:toggleHighImportance={toggleHighImportance}
      on:toggleLowImportance={toggleLowImportance}
      on:toggleReadReceipt={() => mail.requestReadReceipt = !mail.requestReadReceipt}
      on:toggleDeliveryReceipt={() => mail.requestDeliveryReceipt = !mail.requestDeliveryReceipt}
      on:toggleFlag={() => mail.isStarred = !mail.isStarred}
      on:saveDraft={() => catchErrors(onSaveDraft)}
      on:toggleEmojis={() => showEmojis = !showEmojis}
      on:toggleSpellcheck={() => spellcheckEnabled.value = !spellcheckEnabled.value}
      on:setZoom={event => editorZoom = event.detail}
      on:openActions={() => showSMLAdd = true} />
    </hbox>
    {#if showAttachments}
      <hbox class="attachments-row" aria-label={$t`Attachments`}>
        <AttachmentsPane message={mail} on:remove={onAttachmentRemove} />
      </hbox>
    {/if}
    {#if loading}
      <Spinner size="64px" />
    {/if}
    <hbox flex class="editor-and-attachments">
      {#if showEmojis}
        <vbox class="emojis">
          <GraphicSelector
            on:select={event => catchErrors(() => onGraphic(event))}
            on:backspace={() => catchErrors(onEmojiBackspace)}
            bind:isOpen={showEmojis}
            />
        </vbox>
      {/if}
      <vbox flex class="editor-wrapper">
        <Paper>
          <Scroll visibleScrollbars={floating}>
            <SMLComposer {mail} />
            <vbox class="editor" class:loading={loading} spellcheck={$spellcheckEnabled.value}
              style:zoom={editorZoom / 100}>
              <HTMLEditor bind:html={editableHtml} bind:editor tabindex={1}
                fixedImageSize={true}
                onImagePaste={onImagePaste}
                extraExtensions={composeEditorExtensions}
                on:change={onEditorChange} />
            </vbox>
            {#if composeQuoteHtml}
              <vbox class="compose-quote">
                {#if showQuoteAttribution && mail.composeSource && mail.inReplyTo}
                  <p class="quote-header">{mail.composeSource.compose.quotePrefixLine()}</p>
                {/if}
                <ComposeQuoteEditor bind:this={quoteEditor} html={quoteBodyHtml} on:change={onQuoteChange} />
              </vbox>
            {/if}
          </Scroll>
        </Paper>
      </vbox>
    </hbox>
  </vbox>
</FileDropTarget>
{#if smlAddAnchor}
  <Popup
    bind:popupOpen={showSMLAdd}
    popupAnchor={smlAddAnchor}
    boundaryElSel=".mail-composer-window"
    placement="bottom"
    autoClose>
    <vbox class="sml-add-dialog">
      <SMLAddKinds bind:sml={mail.sml} identity={fromIdentity}
        on:close={() => showSMLAdd = false} />
    </vbox>
  </Popup>
{/if}
{#if $appGlobal.isMobile}
  <ComposerBarM message={mail} />
{/if}

<FileSelector bind:this={fileSelector} />

<script lang="ts">
  import type { EMail, MailImportanceLevel } from "../../../logic/Mail/EMail";
  import { PersonUID } from "../../../logic/Abstract/PersonUID";
  import { addFilesAsAttachments } from "../../../logic/Abstract/Attachment";
  import { insertImage, removeImageForAttachment, removeOrphanedInlineAttachments } from "../../Shared/Editor/InsertImage";
  import type { Attachment } from "../../../logic/Abstract/Attachment";
  import { MailIdentity } from "../../../logic/Mail/MailIdentity";
  import { WriteMailJackdawApp, mailApp } from "../MailJackdawApp";
  import { SpecialFolder } from "../../../logic/Mail/Folder";
  import { getLocalStorage } from "../../Util/LocalStorage";
  import { goBack } from "../../AppsBar/selectedApp";
  import { appGlobal } from "../../../logic/app";
  import { UserError, assert } from "../../../logic/util/util";
  import { backgroundError, catchErrors, showUserError } from "../../Util/error";
  import CloseButton from "./CloseButton.svelte";
  import MailAutocomplete from "./MailAutocomplete.svelte";
  import AttachmentsPane from "./Attachments/AttachmentsPane.svelte";
  import FileSelector from "./Attachments/FileSelector.svelte";
  import FileDropTarget from "./Attachments/FileDropTarget.svelte";
  import HTMLEditor from "../../Shared/Editor/HTMLEditor.svelte";
  import ComposeQuoteEditor from "./ComposeQuoteEditor.svelte";
  import {
    applyComposeDefaultBlockFormatting,
    composeEditorExtensions,
    composeDefaultFontFamily,
    composeDefaultFontSize,
    composeDefaultTextColor,
    composeDefaultLineHeight,
    composeDefaultTextAlign,
    composeDefaultParagraphSpacing,
    composeDefaultFirstLineIndent,
    composeFontSizes,
    composeLineHeights,
    composeTextAlignments,
    composeParagraphSpacingValues,
    composeFirstLineIndentValues,
    fontSizeToCSS,
    normalizeComposeTextColor,
  } from "../../Shared/Editor/composeEditorExtensions";
  import { resolveComposeRecipients } from "../../../logic/Mail/composeResolveRecipients";
  import { addSenderToCC } from "../../../logic/Mail/composeRecipients";
  import { closeFloatingCompose } from "./composeFloating";
  import { focusComposeTypingArea } from "./composeCursor";
  import { editorHasNewComposeText } from "./composeBody";
  import { applyQuoteBodyEdit, mergeComposeQuote, quoteDisplayBody, splitComposeQuote } from "./composeQuote";
  import UserCheckIcon from "lucide-svelte/icons/user-check";
  import { createEventDispatcher } from "svelte";
  import ComposeRibbon from "./ComposeRibbon.svelte";
  import IdentitySelector from "./IdentitySelector.svelte";
  import EncryptionButtons from "./EncryptionButtons.svelte";
  import EncryptionDetails from "./EncryptionDetails.svelte";
  import GraphicSelector from "../../Chat/Emoji/GraphicSelector.svelte";
  import type { GraphicSelection } from "../../Chat/Emoji/media";
  import SMLComposer from "./SMLComposer.svelte";
  import SMLAddKinds from "../SML/SMLAddKinds.svelte";
  import ComposerBarM from "./ComposerBarM.svelte";
  import Paper from "../../Shared/Paper.svelte";
  import Spinner from "../../Shared/Spinner.svelte";
  import Popup from "../../Shared/Popup.svelte";
  import RoundButton from "../../Shared/RoundButton.svelte";
  import Button from "../../Shared/Button.svelte";
  import Scroll from "../../Shared/Scroll.svelte";
  import SaveIcon from "lucide-svelte/icons/save";
  import { t, gt } from "../../../l10n/l10n";
  import { tick } from "svelte";
  import { selectedWorkspace } from "../../MainWindow/Selected";
  import type { Editor } from '@tiptap/core';
  import type { QuoteEditorCommand, QuoteEditorHandle } from "./quoteEditorCommands";

  export let mail: EMail;
  export let floating = false;
  export let standalone = false;
  /** Detached windows delegate the actual send to the owning renderer. */
  export let sendInOwner: (() => Promise<void>) | null = null;
  /** Detached windows use the owner's authenticated directory for lookups. */
  export let searchContactsInOwner: (
    (searchText: string, skip: (person: PersonUID) => boolean) => Promise<PersonUID[]>
  ) | null = null;

  const dispatchEvent = createEventDispatcher<{ close: void }>();

  let editor: Editor;
  let editableHtml = "";
  /** Quoted message kept out of TipTap so its original HTML wrapper stays intact. */
  let composeQuoteHtml = "";
  /** Editable body shown in the quote block (may differ from composeQuoteHtml wrapper). */
  let quoteBodyHtml = "";
  let composeContentReady = false;
  let loadingEditorContent = false;
  let quoteEditor: QuoteEditorHandle | null = null;
  $: to = mail.to;
  let fromIdentity: MailIdentity;
  let toAutocomplete: MailAutocomplete;
  let ccAutocomplete: MailAutocomplete;
  let bccAutocomplete: MailAutocomplete;
  let spellcheckEnabled = getLocalStorage("mail.send.spellcheck.enabled", false);
  let quoteAttributionSetting = getLocalStorage("mail.send.quote.attribution", false);
  let defaultFontFamilySetting = getLocalStorage("mail.compose.defaultFontFamily", composeDefaultFontFamily);
  let defaultFontSizeSetting = getLocalStorage("mail.compose.defaultFontSize", composeDefaultFontSize);
  let defaultTextColorSetting = getLocalStorage("mail.compose.defaultTextColor", composeDefaultTextColor);
  let defaultLineHeightSetting = getLocalStorage("mail.compose.defaultLineHeight", composeDefaultLineHeight);
  let defaultTextAlignSetting = getLocalStorage("mail.compose.defaultTextAlign", composeDefaultTextAlign);
  let defaultParagraphSpacingSetting = getLocalStorage("mail.compose.defaultParagraphSpacing", composeDefaultParagraphSpacing);
  let defaultFirstLineIndentSetting = getLocalStorage("mail.compose.defaultFirstLineIndent", composeDefaultFirstLineIndent);
  $: showQuoteAttribution = $quoteAttributionSetting.value;
  $: isReplyQuote = !!(mail.composeSource && mail.inReplyTo);
  let editorZoom = 100;
  let encryptionError: string | null = null;

  // HACK to reload the HTMLEditor to force it to load the new text
  // See <https://github.com/ueberdosis/tiptap/issues/4918>
  let lastMail = null;
  let defaultComposeFormattingApplied = false;
  $: differentMailLoaded(mail);
  function differentMailLoaded(_dummy: any) {
    if (closing) {
      return;
    }
    if (mail == lastMail || !mail) {
      return;
    }
    lastMail = mail;
    composeContentReady = false;
    composeQuoteHtml = "";
    editableHtml = "";
    quoteBodyHtml = "";
    defaultComposeFormattingApplied = false;

    fromIdentity = mail.identity
      ?? mail.folder?.account.identities.first
      ?? appGlobal.emailAccounts.first?.identities.first;
    assert(fromIdentity, "Composer: Need identity or account for email");
    showCCForce = mail.cc.hasItems;
    showBCCForce = mail.bcc.hasItems;
    ensureCopyToSelf();
    // setAuthor() called

    if (mail.from?.emailAddress) {
      let recipients = [mail.from, ...mail.to.contents, ...mail.cc.contents, ...mail.bcc.contents];
      checkInvalidRecipients(recipients);
    }

    let currentLoad = loadText();
    loadTextPromise = currentLoad;
    currentLoad.catch(backgroundError).finally(() => {
      if (loadTextPromise === currentLoad) {
        loadTextPromise = null;
      }
    });
  }

  let loading = false;
  let loadTextPromise: Promise<void> | null = null;
  async function loadText() {
    mail.identity = fromIdentity ?? mail.identity;
    if (!mail.hasHTML) {
      // New empty message: inject signature into the raw body for the editor
      mail.compose.applySignature();
      await ensureEditorContent();
      return;
    }
    loading = true;
    if (mail.composeSource && mail.inReplyTo) {
      await mail.composeSource.loadBody();
    }
    await mail.loadBody();
    loading = false;
    // Drafts already contain signature; replies/forwards need it injected
    if (!mail.isDraft) {
      mail.compose.applySignature();
    } else if (fromIdentity?.signatureHTML && !hasSignatureFooter(mail.rawHTMLDangerous)) {
      mail.compose.applySignature();
    }
    await ensureEditorContent();
  }

  function hasSignatureFooter(html: string | null | undefined): boolean {
    // Ignore footers inside quoted originals; our signature is top-level
    let top = (html ?? "").replace(/<blockquote\b[\s\S]*?<\/blockquote>/gi, "");
    return /<footer\b[^>]*>/i.test(top);
  }

  function syncComposeHtml() {
    if (editor) {
      editableHtml = editor.getHTML();
    }
    mail.rawHTMLDangerous = mergeComposeQuote(editableHtml, composeQuoteHtml);
  }

  function onQuoteChange(event: CustomEvent<string>) {
    if (!composeContentReady || loading) {
      return;
    }
    quoteBodyHtml = event.detail;
    composeQuoteHtml = applyQuoteBodyEdit(composeQuoteHtml, quoteBodyHtml, isReplyQuote);
    syncComposeHtml();
  }

  function refreshQuoteBodyHtml() {
    let sourceHtml = mail.composeSource && mail.inReplyTo && mail.composeSource.loadedBody
      ? mail.composeSource.html
      : null;
    quoteBodyHtml = quoteDisplayBody(composeQuoteHtml, sourceHtml, isReplyQuote);
  }

  function onEditorChange() {
    if (!composeContentReady || loading) {
      return;
    }
    syncComposeHtml();
    removeOrphanedInlineAttachments(editor, mail);
  }

  async function waitForEditor(maxTicks = 40): Promise<boolean> {
    for (let i = 0; i < maxTicks; i++) {
      if (editor) {
        return true;
      }
      await tick();
    }
    return false;
  }

  async function reloadEditorFromMail() {
    let { editable, quote } = splitComposeQuote(mail.rawHTMLDangerous);
    composeQuoteHtml = quote;
    editableHtml = editable;
    refreshQuoteBodyHtml();
    if (editor) {
      editor.commands.setContent(editableHtml || "<p></p>");
    }
    composeContentReady = true;
  }

  let ensureEditorContentPromise: Promise<void> | null = null;

  function ensureEditorContent(): Promise<void> {
    if (composeContentReady) {
      return Promise.resolve();
    }
    if (ensureEditorContentPromise) {
      return ensureEditorContentPromise;
    }
    let currentEnsure = ensureEditorContentInternal();
    ensureEditorContentPromise = currentEnsure.finally(() => {
      if (ensureEditorContentPromise === currentEnsure) {
        ensureEditorContentPromise = null;
      }
    });
    return ensureEditorContentPromise;
  }

  async function ensureEditorContentInternal() {
    if (composeContentReady) {
      return;
    }
    if (!await waitForEditor()) {
      return;
    }
    loadingEditorContent = true;
    try {
      let { editable, quote } = splitComposeQuote(mail.rawHTMLDangerous);
      composeQuoteHtml = quote;
      refreshQuoteBodyHtml();
      let editorHtml = editor.getHTML();
      if (editorHasNewComposeText(editorHtml, editable)) {
        editableHtml = editorHtml;
        mail.rawHTMLDangerous = mergeComposeQuote(editableHtml, composeQuoteHtml);
        if (!mail.isDraft) {
          mail.compose.applySignature();
          ({ editable, quote } = splitComposeQuote(mail.rawHTMLDangerous));
          composeQuoteHtml = quote;
          editableHtml = editable;
          refreshQuoteBodyHtml();
        }
      } else {
        editableHtml = editable;
      }
      refreshQuoteBodyHtml();
      editor.commands.setContent(editableHtml || "<p></p>");
      applyDefaultComposeFormatting();
      await tick();
      setCursorDefault();
      composeContentReady = true;
    } finally {
      loadingEditorContent = false;
    }
  }

  async function waitForComposeReady(): Promise<boolean> {
    if (loadTextPromise) {
      await loadTextPromise;
    }
    if (!composeContentReady) {
      await ensureEditorContent();
    }
    await tick();
    return !!editor && composeContentReady;
  }

  $: if (editor && mail === lastMail && !composeContentReady && !loading && !loadingEditorContent) {
    void ensureEditorContent();
  }

  function applyDefaultComposeFormatting() {
    if (!editor || mail.isDraft || defaultComposeFormattingApplied) {
      return;
    }
    if (editorHasNewComposeText(editor.getHTML(), editableHtml)) {
      return;
    }

    let bodyEnd = 1;
    let hasEditableBlock = false;
    editor.state.doc.forEach((node, position) => {
      if (node.type.name === "footer") {
        return;
      }
      hasEditableBlock = true;
      bodyEnd = Math.max(bodyEnd, position + node.nodeSize - 1);
    });
    if (!hasEditableBlock) {
      return;
    }

    let defaultFontSize = composeFontSizes.includes(defaultFontSizeSetting.value)
      ? defaultFontSizeSetting.value
      : composeDefaultFontSize;
    let defaultLineHeight = composeLineHeights.some(lineHeight => lineHeight.value == defaultLineHeightSetting.value)
      ? defaultLineHeightSetting.value
      : composeDefaultLineHeight;
    let defaultTextAlign = composeTextAlignments.includes(defaultTextAlignSetting.value as typeof composeTextAlignments[number])
      ? defaultTextAlignSetting.value as typeof composeTextAlignments[number]
      : composeDefaultTextAlign;
    let defaultParagraphSpacing = composeParagraphSpacingValues.includes(defaultParagraphSpacingSetting.value)
      ? defaultParagraphSpacingSetting.value
      : composeDefaultParagraphSpacing;
    let defaultFirstLineIndent = composeFirstLineIndentValues.includes(defaultFirstLineIndentSetting.value)
      ? defaultFirstLineIndentSetting.value
      : composeDefaultFirstLineIndent;

    let chain = editor.chain().focus().setTextSelection({ from: 1, to: bodyEnd });
    if (defaultFontFamilySetting.value) {
      chain.setFontFamily(defaultFontFamilySetting.value);
    } else {
      chain.unsetFontFamily();
    }
    let defaultTextColor = normalizeComposeTextColor(defaultTextColorSetting.value);
    if (defaultTextColor) {
      chain.setColor(defaultTextColor);
    }
    if (chain.setFontSize(fontSizeToCSS(defaultFontSize)).run()) {
      applyComposeDefaultBlockFormatting(editor, 1, bodyEnd, {
        lineHeight: defaultLineHeight,
        textAlign: defaultTextAlign,
        paragraphSpacing: defaultParagraphSpacing,
        firstLineIndent: defaultFirstLineIndent,
      });
      defaultComposeFormattingApplied = true;
    }
  }

  async function commitPendingRecipients() {
    await toAutocomplete?.commitPendingInput();
    if (showCC) {
      await ccAutocomplete?.commitPendingInput();
    }
    if (showBCC) {
      await bccAutocomplete?.commitPendingInput();
    }
  }

  async function onCheckNames() {
    await commitPendingRecipients();
    await resolveComposeRecipients(mail, searchContactsInOwner ?? undefined);
  }

  function insertSignature() {
    if (!editor) {
      return;
    }
    syncComposeHtml();
    mail.compose.applySignature();
    void reloadEditorFromMail().then(() => setCursorDefault());
  }

  function toggleHighImportance() {
    mail.importanceLevel = mail.importanceLevel === "high" ? "normal" : "high";
  }

  function toggleLowImportance() {
    mail.importanceLevel = mail.importanceLevel === "low" ? "normal" : "low";
  }

  function isEditorTarget(target: EventTarget | null): boolean {
    return target instanceof Element &&
      !!target.closest(".html-editor, .ProseMirror, .tiptap, .compose-quote-html");
  }

  function isQuoteEditorTarget(target: EventTarget | null): boolean {
    return target instanceof Element && !!target.closest(".compose-quote-html");
  }

  function onComposerKeydown(event: KeyboardEvent) {
    if (event.altKey && !event.metaKey && !event.ctrlKey &&
        event.key.toLowerCase() === "k" && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      catchErrors(onCheckNames);
      return;
    }
    let mod = event.ctrlKey || event.metaKey;
    if (mod && event.key === "Enter" && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      catchErrors(onSend);
      return;
    }
    if (mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "s") {
      event.preventDefault();
      event.stopPropagation();
      catchErrors(onSaveDraft);
      return;
    }
    if (quoteEditor && isQuoteEditorTarget(event.target) && mod && !event.altKey) {
      let quoteCommand: QuoteEditorCommand | null =
        event.key.toLowerCase() === "b" ? "bold" :
        event.key.toLowerCase() === "i" ? "italic" :
        event.key.toLowerCase() === "u" ? "underline" :
        event.key.toLowerCase() === "d" ? "strikeThrough" :
        null;
      if (quoteCommand) {
        event.preventDefault();
        event.stopPropagation();
        quoteEditor.applyCommand(quoteCommand);
        return;
      }
      // Do not fall through to TipTap shortcuts while the quote has focus.
      return;
    }
    if (!editor || !isEditorTarget(event.target)) {
      return;
    }
    if (!mod || event.altKey) {
      return;
    }
    let key = event.key.toLowerCase();
    if (key === "b") {
      event.preventDefault();
      editor.chain().focus().toggleBold().run();
    } else if (key === "i") {
      event.preventDefault();
      editor.chain().focus().toggleItalic().run();
    } else if (key === "u") {
      event.preventDefault();
      editor.chain().focus().toggleUnderline().run();
    } else if (key === "k") {
      event.preventDefault();
      openLinkDialog = true;
    }
  }

  let openLinkDialog = false;

  function setCursorDefault() {
    if (!editor) {
      return;
    }
    if (mail.to.isEmpty) {
      editor.commands.focus("start");
      return;
    }
    focusComposeTypingArea(editor);
  }

  $: fromIdentity && setAuthor()
  function setAuthor() {
    let identityChanged = mail.identity != fromIdentity;
    mail.identity = fromIdentity;
    mail.folder ??= fromIdentity.account.getSpecialFolder(SpecialFolder.Sent)
      ?? fromIdentity.account.inbox;
    if (!fromIdentity.isCatchAll || !mail.from?.emailAddress || mail.from.emailAddress.includes("*")) {
      mail.from = fromIdentity.asPersonUID();
    }
    ensureCopyToSelf();
    // When user switches identity in composer, refresh signature footer
    if (identityChanged && editor && !loading) {
      syncComposeHtml();
      mail.compose.applySignature();
      void reloadEditorFromMail().then(() => setCursorDefault());
    }
  }

  function ensureCopyToSelf() {
    if (!fromIdentity?.account.copyToSelf || !mail?.from?.emailAddress) {
      return;
    }
    addSenderToCC(mail);
    showCCForce = mail.cc.hasItems;
  }

  function checkInvalidRecipients(recipients: PersonUID[]) {
    const kNoReplyRegExp = /no[\-_t]*reply@|invalid$/;
    let invalidTo = recipients.find(person =>
      !person.emailAddress || kNoReplyRegExp.test(person.emailAddress));
    if (invalidTo) {
      let notification = showUserError(new UserError(gt`The recipient ${invalidTo.emailAddress} does not accept email`));
      doOnClose.push(() => notification.remove());
    }
  }

  function onMoveToCC(person: PersonUID) {
    mail.bcc.remove(person);
    mail.to.remove(person);
    mail.cc.add(person);
    showCCForce = true;
  }
  function onMoveToBCC(person: PersonUID) {
    mail.cc.remove(person);
    mail.to.remove(person);
    mail.bcc.add(person);
    showBCCForce = true;
  }
  function onMoveToTo(person: PersonUID) {
    mail.cc.remove(person);
    mail.bcc.remove(person);
    mail.to.add(person);
  }

  let fileSelector: FileSelector;
  async function onAddAttachment() {
    let file = await fileSelector.selectFile();
    if (!file) {
      return;
    }
    addFilesAsAttachments(mail, [file]);
  }

  function onFilesDrop(event: CustomEvent) {
    addFilesAsAttachments(mail, event.detail.files as File[]);
  }

  async function onFileInlineDrop(event: CustomEvent) {
    let files = event.detail.files as File[];
    for (let file of files) {
      await insertImage(editor, file, mail);
    }
  }

  async function onImagePaste(file: File, displayWidth: number) {
    let width = displayWidth;
    try {
      const imageBitmap = await createImageBitmap(file);
      width = Math.min(displayWidth, imageBitmap.width);
      imageBitmap.close();
    } catch {
      // Если формат изображения не поддерживает ImageBitmap, используем ширину редактора.
    }
    await insertImage(editor, file, mail, width, width);
  }

  let showEmojis = false;

  async function onGraphic(ev: CustomEvent<GraphicSelection>) {
    if (ev.detail.file) {
      await insertImage(editor, ev.detail.file, mail, ev.detail.width);
      return;
    }
    let emoji = ev.detail.emoji;
    if (emoji) {
      editor.commands.insertContent(emoji);
    }
  }

  function onAttachmentRemove(event: CustomEvent<Attachment>) {
    removeImageForAttachment(editor, event.detail);
  }

  function onEmojiBackspace() {
    editor.view.focus();
    document.execCommand("delete");
  }

  $: sendDisabledTooltip =
    !mail.subject ? $t`Please enter a subject` :
    $to.isEmpty ? $t`Please add some recipients` :
    encryptionError ??
    null;

  let sending = false;
  async function onSend() {
    if (sending) {
      return;
    }
    sending = true;
    try {
      if (!await waitForComposeReady()) {
        throw new UserError(gt`The message editor is not ready`);
      }
      syncComposeHtml();
      await commitPendingRecipients();
      if (!sendInOwner) {
        await resolveComposeRecipients(mail);
      }
      if (sendInOwner) {
        await sendInOwner();
      } else {
        await mail.compose.send();
      }
      onClose();
    } finally {
      sending = false;
    }
  }

  async function onSaveDraft() {
    if (!await waitForComposeReady()) {
      return;
    }
    syncComposeHtml();
    await mail.compose.saveAsDraft();
  }

  /** Sync editor HTML before save/close from floating window chrome. */
  export function syncEditorContent() {
    syncComposeHtml();
  }

  export async function saveDraft() {
    await onSaveDraft();
  }

  let closing = false;
  let doOnClose: (() => void)[] = [];
  function onClose() {
    if (floating) {
      closeFloatingCompose(mail);
      dispatchEvent("close");
      return;
    }
    if (standalone) {
      closing = true;
      for (let func of doOnClose) {
        func();
      }
      doOnClose = [];
      dispatchEvent("close");
      return;
    }
    closing = true;
    for (let func of doOnClose) {
      func();
    }
    doOnClose = [];

    let me = mailApp.subApps.find(app => app instanceof WriteMailJackdawApp && app.windowParams.mail == mail);
    mailApp.subApps.remove(me);
    goBack();
  }

  let showSMLAdd = false;
  let smlAddAnchor: HTMLElement;
  let showCCForce = false;
  let showBCCForce = false;
  let showAttachmentsForce = false;
  $: ccList = mail.cc;
  $: bccList = mail.bcc;
  $: attachmentsList = mail.attachments;
  $: hasCC = $ccList.hasItems;
  $: hasBCC = $bccList.hasItems;
  $: hasAttachments = $attachmentsList.some(attachment => !attachment.hidden);
  $: showCC = showCCForce;
  $: showBCC = showBCCForce;
  $: showAttachments = showAttachmentsForce || hasAttachments;
</script>

<style>
  .mail-composer-window {
    padding: 0 16px 12px;
    background-color: var(--main-bg, var(--bg));
    color: var(--main-fg, var(--fg));
  }
  .mail-composer-window.floating {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    padding: 0 12px 8px;
    min-height: 0;
    flex: 1 1 0;
    height: 100%;
    box-sizing: border-box;
  }
  .mail-composer-window.floating .ribbon-anchor {
    flex-shrink: 0;
    min-width: 0;
    overflow: visible;
  }
  .mail-composer-window.floating .editor-and-attachments {
    flex: 1 1 0;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
  }
  .mail-composer-window.floating .editor-wrapper {
    flex: 1 1 0;
    min-height: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .mail-composer-window.floating .editor-wrapper :global(.paper) {
    flex: 1 1 0;
    min-height: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .mail-composer-window.floating .editor-wrapper :global(.scroll) {
    flex: 1 1 0;
    min-height: 0;
    min-width: 0;
  }
  .mail-composer-window.floating .editor {
    max-width: none;
    width: auto;
    min-width: 0;
    box-sizing: border-box;
  }
  .compose-header {
    gap: 2px;
    padding-block-end: 4px;
    border-block-end: 1px solid var(--border);
  }
  .compose-top-row {
    align-items: center;
    gap: 6px;
    min-height: 34px;
    padding-block: 2px 4px;
  }
  .header-actions {
    gap: 4px;
    align-items: center;
  }
  .header-actions :global(.toolbar-chrome) {
    width: 32px;
    height: 32px;
    min-width: 32px;
    min-height: 32px;
    border-radius: var(--border-radius);
    border: 1px solid var(--border);
    background: var(--input-bg);
    color: color-mix(in srgb, var(--main-fg) 84%, transparent);
  }
  .header-actions :global(.toolbar-chrome:hover:not(.disabled)) {
    background: var(--hover-bg);
    color: var(--hover-fg);
  }
  .header-actions :global(.button-menu > .toolbar-chrome) {
    width: 32px;
    height: 32px;
    min-width: 32px;
    min-height: 32px;
    border-radius: var(--border-radius);
    border: 1px solid var(--border);
    background: var(--input-bg);
    color: color-mix(in srgb, var(--main-fg) 84%, transparent);
  }
  .header-actions :global(.button-menu > .toolbar-chrome:hover:not(.disabled)) {
    background: var(--hover-bg);
    color: var(--hover-fg);
  }
  .to-row :global(.toolbar-chrome) {
    width: 32px;
    height: 32px;
    min-width: 32px;
    min-height: 32px;
    flex-shrink: 0;
    border-radius: var(--border-radius);
    border: 1px solid var(--border);
    background: var(--input-bg);
    color: color-mix(in srgb, var(--main-fg) 84%, transparent);
  }
  .to-row :global(.toolbar-chrome:hover:not(.disabled)) {
    background: var(--hover-bg);
    color: var(--hover-fg);
  }
  .cc.buttons {
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }
  .cc.buttons > :global(button) {
    border: none;
    margin: 0;
    padding-inline: 6px;
    min-height: 28px;
    font-size: 11px;
  }
  .cc.buttons > :global(button:not(.selected)) {
    background-color: transparent;
    color: color-mix(in srgb, var(--main-fg) 72%, transparent);
  }
  .cc.buttons > :global(button.selected) {
    background-color: color-mix(in srgb, var(--icon-primary) 12%, transparent);
    color: var(--icon-primary);
  }
  grid.recipients {
    grid-template-columns: 3.25rem 1fr;
    max-width: none;
    margin-block: 2px 0;
  }
  .to-row {
    align-items: center;
    gap: 4px;
    min-width: 0;
  }
  .to-row :global(.persons-autocomplete) {
    flex: 1 1 auto;
    min-width: 0;
  }
  .recipients :global(.persons-autocomplete) {
    font-size: 13px;
    line-height: 1.2;
  }
  .recipients :global(.persons-autocomplete .person) {
    font-size: 13px;
  }
  .recipients :global(.persons-autocomplete input.autocomplete-input) {
    font-size: 13px;
  }
  .subject-row {
    display: grid;
    grid-template-columns: 3.25rem 1fr;
    align-items: center;
    gap: 8px;
    max-width: none;
    margin-block: 2px 0;
    padding-block: 2px 4px;
  }
  .subject-row input {
    width: 100%;
    border: none;
    background: transparent;
    color: inherit;
    padding: 4px 0;
  }
  .label {
    color: var(--input-placeholder);
    font-size: 11px;
  }
  .label-cell,
  .subject-row .label {
    align-items: center;
    padding-block-start: 4px;
  }
  .editor {
    margin: 12px 0;
    padding-block: 12px 16px;
    padding-inline: 12px;
    max-width: none;
    width: auto;
    min-width: 0;
    flex-shrink: 0;
    box-sizing: border-box;
  }
  .editor.loading {
    pointer-events: none;
    opacity: 0.72;
  }
  .editor :global(.ProseMirror) {
    /* Оставляем прокрутку композера на внешней поверхности. Вложенная
       горизонтальная прокрутка смещается браузером при фокусе на медиа,
       из-за чего отступ пропадает и текст касается рамки письма. */
    overflow: visible;
    max-height: none;
    max-width: 100%;
    line-height: 1;
  }
  .editor :global(.tiptap) {
    /* В самостоятельном редакторе HTMLEditor добавляет отрицательный
       внешний отступ. В письме положение текста задаёт отступ бумаги. */
    margin-block: 0;
  }
  .editor :global(.ProseMirror p) {
    margin-block: 0;
  }
  .compose-quote {
    margin: 0 12px 12px;
    padding-block-start: 8px;
    border-block-start: 1px solid var(--border);
    flex-shrink: 0;
  }
  .compose-quote .quote-header {
    margin: 0 0 8px;
    color: var(--input-placeholder);
    font-size: 12px;
  }
  .editor-wrapper {
    flex: 3 0 0;
    margin-block-start: 4px;
  }
  .composer-subject {
    max-width: 900px;
    margin-block-start: 4px;
    margin-block-end: 4px;
  }
  .ribbon-anchor {
    width: 100%;
    min-width: 0;
    align-self: stretch;
  }
  .ribbon-anchor :global(.compose-ribbon) {
    flex: 1 1 auto;
  }
  .editor-wrapper :global(.paper) {
    background-color: var(--input-bg);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: none;
  }
  .attachments-row {
    flex: 0 0 auto;
    min-width: 0;
    min-height: 0;
    padding-block: 4px 8px;
    border-block-end: 1px solid var(--border);
  }
  .attachments-row :global(.attachments-pane) {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
  }
  .attachments-row :global(.attachments-pane .scroll) {
    flex: 0 0 auto;
    max-height: 96px;
    overflow-y: auto;
  }
  .attachments-row :global(.attachments-pane .inside) {
    flex-direction: row;
    flex-wrap: wrap;
    align-items: flex-start;
    min-height: 0;
  }
  .attachments-row :global(.attachments-pane .attachment) {
    flex: 0 1 280px;
    min-width: 200px;
    max-width: 360px;
  }
  .attachments-row :global(.attachments-pane .inside > .buttons) {
    margin-inline-start: 8px;
    margin-block-start: 0;
    align-self: center;
  }
  .subject {
    margin-inline: 2px 24px;
    font-weight: bold;
  }
  .subject input {
    width: 100%;
    padding-block: 8px;
    border: none;
    border-block-end: 1px solid var(--border);
    background-color: transparent;
    color: var(--main-fg);
    font-size: 16px;
  }
  .buttons :global(.send.disabled) {
    opacity: 30%;
  }
  .emojis {
    min-height: 0;
    min-width: 0;
    width: 400px;
  }
  .sml-add-dialog {
    padding: 16px 24px;
    background-color: var(--leftbar-bg);
    color: var(--leftbar-fg);
    z-index: 1000;
  }
</style>
