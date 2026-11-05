<vbox class="mail-templates" flex>
  <h2>{$t`Templates *=> Email templates`}</h2>
  <hbox class="subtitle">{$t`Save messages you send often and insert them from the message editor: Insert → Templates.`}</hbox>

  {#if state == "loading"}
    <vbox class="state" aria-busy="true">
      <Spinner size="32px" />
      <span>{$t`Loading templates…`}</span>
    </vbox>
  {:else if state == "error"}
    <vbox class="state" role="alert">
      <span class="state-title">{$t`Could not load templates`}</span>
      <span class="state-hint">{errorText}</span>
      <Button label={$t`Try again`} icon={RetryIcon} onClick={load} />
    </vbox>
  {:else if templates.length == 0 && !draft}
    <vbox class="state">
      <TemplateIcon size="32px" />
      <span class="state-title">{$t`No templates yet`}</span>
      <span class="state-hint">{$t`In the message editor, open Insert → Templates and choose “Save as template…”. Or create one here.`}</span>
      <Button label={$t`New template`} icon={AddIcon} classes="filled" onClick={onNew} />
    </vbox>
  {:else}
    <hbox class="layout" flex>
      <vbox class="list" role="listbox" aria-label={$t`Templates *=> Email templates`}>
        <hbox class="list-header font-small">
          <span>{$t`Templates *=> Email templates`}</span>
          <hbox flex />
          <RoundButton
            label={$t`New template`}
            icon={AddIcon}
            iconSize="10px"
            padding="3px"
            classes="small"
            onClick={onNew} />
        </hbox>
        <vbox class="list-items">
          {#each templates as template (template.id)}
            <button type="button" class="list-item"
              role="option"
              aria-selected={draft?.id === template.id}
              class:selected={draft?.id === template.id}
              title={template.name}
              on:click={() => catchErrors(() => select(template.id))}>
              <span class="item-name">{template.name}</span>
              <span class="item-subject">{template.subject || $t`(no subject)`}</span>
            </button>
          {/each}
          {#if draft && draft.id == null}
            <button type="button" class="list-item selected" role="option" aria-selected="true">
              <span class="item-name">{draft.name || $t`New template`}</span>
              <span class="item-subject">{$t`Not saved`}</span>
            </button>
          {/if}
        </vbox>
      </vbox>

      <vbox class="details" flex>
        {#if loadingTemplate}
          <vbox class="state" aria-busy="true"><Spinner size="24px" /></vbox>
        {:else if draft}
          {#key editorKey}
            <Scroll>
              <vbox class="form">
                <grid class="fields">
                  <label for="template-name">{$t`Template name`}</label>
                  <vbox>
                    <input type="text" id="template-name" bind:value={draft.name}
                      maxlength={kMaxTemplateNameLength}
                      aria-invalid={!!nameError}
                      on:input={() => { dirty = true; nameError = ""; }} />
                    {#if nameError}
                      <span class="field-error" role="alert">{nameError}</span>
                    {/if}
                  </vbox>

                  <label for="template-subject">{$t`Subject`}</label>
                  <input type="text" id="template-subject" bind:value={draft.subject}
                    placeholder={$t`Leave empty to keep the subject of the message`}
                    on:input={() => dirty = true} />
                </grid>

                <vbox class="body-editor">
                  <HTMLEditorToolbar {editor} showFontControls />
                  <HTMLEditor bind:this={htmlEditor} bind:html={draft.html} bind:editor
                    fixedImageSize={true}
                    extraExtensions={composeEditorExtensions}
                    on:change={() => dirty = true} />
                </vbox>

                <vbox class="attachments">
                  <hbox class="attachments-header">
                    <span>{$t`Attachments`}</span>
                    <hbox flex />
                    <Button plain label={$t`Add file…`} icon={PaperclipIcon} onClick={() => fileInput.click()} />
                  </hbox>
                  {#if draft.attachments.length}
                    {#each draft.attachments as attachment, index}
                      <hbox class="attachment">
                        <PaperclipIcon size="14px" />
                        <span class="attachment-name" title={attachment.filename}>{attachment.filename}</span>
                        <span class="attachment-size">{formatSize(attachment.size)}</span>
                        <RoundButton
                          label={$t`Remove ${attachment.filename}`}
                          icon={RemoveIcon}
                          border={false}
                          padding="2px"
                          iconSize="12px"
                          onClick={() => removeAttachment(index)} />
                      </hbox>
                    {/each}
                  {:else}
                    <span class="state-hint">{$t`No attachments`}</span>
                  {/if}
                </vbox>
              </vbox>
            </Scroll>
          {/key}
          <hbox class="buttons">
            {#if draft.id != null}
              <Button plain label={$t`Delete`} icon={DeleteIcon} classes="danger" onClick={onDelete} />
            {/if}
            <hbox flex />
            {#if dirty}
              <span class="unsaved">{$t`Unsaved changes`}</span>
            {/if}
            <Button label={$t`Save`} icon={SaveIcon} classes="filled" disabled={!dirty} onClick={onSave} />
          </hbox>
        {/if}
      </vbox>
    </hbox>
  {/if}
  <input type="file" multiple class="file-input" bind:this={fileInput} on:change={event => catchErrors(() => onFilesPicked(event))} />
</vbox>

<script lang="ts">
  import { onMount } from "svelte";
  import type { Editor } from "@tiptap/core";
  import {
    checkTemplateName, kMaxTemplateNameLength, type MailTemplateSummary,
  } from "../../../logic/Mail/Templates/MailTemplate";
  import {
    deleteMailTemplate, getMailTemplate, insertMailTemplate, listMailTemplates,
    MailTemplateTooLargeError, updateMailTemplate, type MailTemplateContent,
  } from "../../../logic/Mail/Templates/MailTemplateData";
  import type { ComposeWindowAttachment } from "../../../logic/Mail/Composer/ComposeWindowProtocol";
  import { kMaxTemplateBytes } from "../../../logic/Mail/Templates/MailTemplate";
  import HTMLEditor from "../../Shared/Editor/HTMLEditor.svelte";
  import HTMLEditorToolbar from "../../Shared/Editor/HTMLEditorToolbar.svelte";
  import { composeEditorExtensions } from "../../Shared/Editor/composeEditorExtensions";
  import Scroll from "../../Shared/Scroll.svelte";
  import Spinner from "../../Shared/Spinner.svelte";
  import Button from "../../Shared/Button.svelte";
  import RoundButton from "../../Shared/RoundButton.svelte";
  import AddIcon from "lucide-svelte/icons/plus";
  import DeleteIcon from "lucide-svelte/icons/trash-2";
  import SaveIcon from "lucide-svelte/icons/save";
  import RetryIcon from "lucide-svelte/icons/refresh-cw";
  import TemplateIcon from "lucide-svelte/icons/file-text";
  import PaperclipIcon from "lucide-svelte/icons/paperclip";
  import RemoveIcon from "lucide-svelte/icons/x";
  import { backgroundError, catchErrors, userMessage } from "../../Util/error";
  import { blobToBase64, UserError } from "../../../logic/util/util";
  import { t } from "../../../l10n/l10n";

  interface TemplateDraft extends MailTemplateContent {
    /** null — ещё не сохранён */
    id: number | null;
  }

  let state: "loading" | "error" | "ready" = "loading";
  let errorText = "";
  let templates: MailTemplateSummary[] = [];
  let draft: TemplateDraft | null = null;
  let loadingTemplate = false;
  let dirty = false;
  let nameError = "";
  let editorKey = 0;
  let editor: Editor;
  let htmlEditor: HTMLEditor;
  let fileInput: HTMLInputElement;

  onMount(load);

  async function load() {
    state = "loading";
    try {
      templates = await listMailTemplates();
      state = "ready";
      if (!draft && templates.length) {
        await select(templates[0].id, true);
      }
    } catch (ex) {
      backgroundError(ex);
      errorText = userMessage(ex);
      state = "error";
    }
  }

  function confirmDiscard(): boolean {
    return !dirty || confirm($t`Discard the unsaved changes to the template?`);
  }

  async function select(id: number, force = false) {
    if (draft?.id === id || !force && !confirmDiscard()) {
      return;
    }
    loadingTemplate = true;
    try {
      let template = await getMailTemplate(id);
      if (!template) {
        // Удалён в другом окне
        templates = await listMailTemplates();
        draft = null;
        return;
      }
      nameError = "";
      draft = {
        id: template.id,
        name: template.name,
        subject: template.subject,
        html: template.html,
        attachments: template.attachments,
      };
      dirty = false;
      editorKey++;
    } finally {
      loadingTemplate = false;
    }
  }

  function onNew() {
    if (!confirmDiscard()) {
      return;
    }
    draft = { id: null, name: "", subject: "", html: "", attachments: [] };
    dirty = true;
    nameError = "";
    editorKey++;
  }

  async function onSave() {
    htmlEditor?.syncContent();
    let problem = checkTemplateName(draft.name, templates, draft.id);
    if (problem) {
      nameError = problem == "empty"
        ? $t`Please enter a name for the template.`
        : problem == "too-long"
          ? $t`The name is too long.`
          : $t`A template with this name already exists.`;
      return;
    }
    let content: MailTemplateContent = {
      name: draft.name,
      subject: draft.subject.trim(),
      html: draft.html == "<p></p>" ? "" : draft.html,
      attachments: draft.attachments,
    };
    try {
      if (draft.id == null || !await updateMailTemplate(draft.id, content)) {
        draft.id = await insertMailTemplate(content);
      }
    } catch (ex) {
      if (ex instanceof MailTemplateTooLargeError) {
        throw tooLargeError();
      }
      throw ex;
    }
    dirty = false;
    templates = await listMailTemplates();
    draft = draft;
  }

  async function onDelete() {
    if (!confirm($t`Delete the template “${draft.name}”?`)) {
      return;
    }
    await deleteMailTemplate(draft.id);
    draft = null;
    dirty = false;
    templates = await listMailTemplates();
    if (templates.length) {
      await select(templates[0].id, true);
    }
  }

  function removeAttachment(index: number) {
    draft.attachments = draft.attachments.filter((_, i) => i != index);
    dirty = true;
  }

  function tooLargeError(): UserError {
    return new UserError($t`The template is larger than ${Math.round(kMaxTemplateBytes / 1_000_000)} MB. Remove some attachments or images and try again.`);
  }

  async function onFilesPicked(event: Event) {
    let input = event.currentTarget as HTMLInputElement;
    let files = [...(input.files ?? [])];
    input.value = "";
    let total = draft.attachments.reduce((sum, attachment) => sum + (attachment.size ?? 0), 0);
    let added: ComposeWindowAttachment[] = [];
    for (let file of files) {
      total += file.size;
      if (total > kMaxTemplateBytes) {
        throw tooLargeError();
      }
      added.push({
        filename: file.name,
        filepathLocal: null,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        disposition: "attachment",
        related: false,
        contentID: null,
        contentBase64: await blobToBase64(file),
      });
    }
    if (added.length) {
      draft.attachments = [...draft.attachments, ...added];
      dirty = true;
    }
  }

  function formatSize(bytes: number | null): string {
    if (bytes == null) {
      return "";
    }
    return bytes < 1024 * 1024
      ? $t`${Math.max(1, Math.round(bytes / 1024))} KB`
      : $t`${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
</script>

<style>
  .mail-templates {
    min-height: 0;
  }
  h2 {
    margin-block-start: -8px;
    margin-block-end: 8px;
  }
  .subtitle {
    margin-block-end: 24px;
    margin-inline-start: 1px;
  }
  .state {
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 48px 16px;
    text-align: center;
    color: color-mix(in srgb, var(--main-fg) 72%, transparent);
  }
  .state-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--main-fg);
  }
  .state-hint {
    max-width: 420px;
    font-size: 12px;
    line-height: 1.4;
    color: color-mix(in srgb, var(--main-fg) 65%, transparent);
  }
  .state :global(button) {
    margin-block-start: 8px;
  }
  .layout {
    min-height: 0;
    gap: 24px;
  }
  .list {
    flex: 0 0 240px;
    min-width: 0;
    border: 1px solid var(--border);
    border-radius: var(--border-radius);
    overflow: hidden;
  }
  .list-header {
    align-items: center;
    padding: 6px 8px 6px 12px;
    border-block-end: 1px solid var(--border);
  }
  .list-items {
    overflow-y: auto;
  }
  .list-item {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    width: 100%;
    padding: 8px 12px;
    border: none;
    border-block-end: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
    background: none;
    color: var(--main-fg);
    text-align: start;
    font: inherit;
    cursor: pointer;
  }
  .list-item:hover {
    background: var(--hover-bg);
  }
  .list-item:focus-visible {
    outline: 2px solid var(--icon-primary);
    outline-offset: -2px;
  }
  .list-item.selected {
    background: var(--selected-bg);
    color: var(--selected-fg);
  }
  .item-name, .item-subject {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .item-name {
    font-size: 13px;
    font-weight: 600;
  }
  .item-subject {
    font-size: 12px;
    opacity: 0.7;
  }
  .details {
    min-width: 0;
    min-height: 0;
  }
  .form {
    gap: 16px;
    padding-inline-end: 8px;
  }
  .fields {
    grid-template-columns: max-content minmax(0, 1fr);
    align-items: baseline;
    gap: 8px 24px;
    max-width: 40em;
  }
  .fields input {
    width: 100%;
    box-sizing: border-box;
  }
  input[aria-invalid="true"] {
    border-color: var(--danger-fg, #c62828);
  }
  .field-error {
    margin-block-start: 4px;
    font-size: 12px;
    color: var(--danger-fg, #c62828);
  }
  .body-editor {
    border: 1px solid var(--border);
    border-radius: 5px;
  }
  .body-editor :global(.html-editor) {
    min-height: 12em;
    padding: 8px 12px;
  }
  .attachments {
    gap: 4px;
  }
  .attachments-header {
    align-items: center;
    font-size: 13px;
    font-weight: 600;
  }
  .attachment {
    align-items: center;
    gap: 8px;
    font-size: 12px;
  }
  .attachment-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .attachment-size {
    flex-shrink: 0;
    opacity: 0.65;
  }
  .buttons {
    align-items: center;
    gap: 8px;
    padding-block: 12px 4px;
  }
  .unsaved {
    font-size: 12px;
    color: color-mix(in srgb, var(--main-fg) 65%, transparent);
  }
  .file-input {
    display: none;
  }
  @media (max-width: 720px) {
    .layout {
      flex-direction: column;
    }
    .list {
      flex: 0 0 auto;
      max-height: 180px;
    }
  }
</style>
