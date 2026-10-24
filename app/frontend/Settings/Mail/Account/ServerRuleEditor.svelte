<vbox class="rule-editor">
  <HeaderGroupBox>
    <hbox slot="header">{rule.id ? $t`Edit rule` : $t`New rule`}</hbox>
    <vbox class="fields">
      <label class="field">
        <span>{$t`Rule name`}</span>
        <input type="text" bind:value={name} aria-invalid={showErrors && !!nameError} />
        {#if showErrors && nameError}
          <span class="field-error" role="alert">{nameError}</span>
        {/if}
      </label>
      <label class="checkbox-row">
        <input type="checkbox" bind:checked={enabled} />
        {$t`Rule enabled`}
      </label>
    </vbox>
  </HeaderGroupBox>

  <HeaderGroupBox>
    <hbox slot="header">{$t`When a message arrives and`}</hbox>
    <vbox class="fields">
      <p class="hint">{$t`All filled conditions must match. Separate several values with commas.`}</p>
      <label class="field">
        <span>{$t`From`}</span>
        <input type="text" bind:value={fromText} placeholder="name@example.com"
          aria-invalid={showErrors && !!fromError} />
        {#if showErrors && fromError}
          <span class="field-error" role="alert">{fromError}</span>
        {/if}
      </label>
      <label class="field">
        <span>{$t`Sent to`}</span>
        <input type="text" bind:value={sentToText} placeholder="name@example.com"
          aria-invalid={showErrors && !!sentToError} />
        {#if showErrors && sentToError}
          <span class="field-error" role="alert">{sentToError}</span>
        {/if}
      </label>
      <label class="field">
        <span>{$t`Subject contains`}</span>
        <input type="text" bind:value={subjectText} />
      </label>
      <label class="field">
        <span>{$t`Body contains`}</span>
        <input type="text" bind:value={bodyText} />
      </label>
      <label class="field">
        <span>{$t`Importance`}</span>
        <select bind:value={importance}>
          <option value="">{$t`Any`}</option>
          <option value="High">{$t`High`}</option>
          <option value="Normal">{$t`Normal`}</option>
          <option value="Low">{$t`Low`}</option>
        </select>
      </label>
      <label class="checkbox-row">
        <input type="checkbox" bind:checked={hasAttachments} />
        {$t`Has attachments`}
      </label>
    </vbox>
  </HeaderGroupBox>

  <HeaderGroupBox>
    <hbox slot="header">{$t`Do the following`}</hbox>
    <vbox class="fields">
      <label class="field">
        <span>{$t`Move to folder`}</span>
        <select bind:value={moveKey}>
          <option value="">—</option>
          {#each folderOptions(originalMoveKey) as option (option.key)}
            <option value={option.key}>{option.label}</option>
          {/each}
        </select>
      </label>
      <label class="field">
        <span>{$t`Copy to folder`}</span>
        <select bind:value={copyKey}>
          <option value="">—</option>
          {#each folderOptions(originalCopyKey) as option (option.key)}
            <option value={option.key}>{option.label}</option>
          {/each}
        </select>
      </label>
      <label class="field">
        <span>{$t`Assign categories`}</span>
        <input type="text" bind:value={categoriesText} />
      </label>
      <label class="field">
        <span>{$t`Forward to`}</span>
        <input type="text" bind:value={forwardText} placeholder="name@example.com"
          aria-invalid={showErrors && !!forwardError} />
        {#if showErrors && forwardError}
          <span class="field-error" role="alert">{forwardError}</span>
        {/if}
      </label>
      <label class="checkbox-row">
        <input type="checkbox" bind:checked={markAsRead} />
        {$t`Mark as read`}
      </label>
      <label class="checkbox-row">
        <input type="checkbox" bind:checked={deleteMessage} />
        {$t`Delete`}
      </label>
      <label class="checkbox-row">
        <input type="checkbox" bind:checked={stopProcessing} />
        {$t`Stop processing more rules`}
      </label>
      {#if showErrors && actionError}
        <p class="field-error" role="alert">{actionError}</p>
      {/if}
    </vbox>
  </HeaderGroupBox>

  <ErrorMessageInline ex={saveError} onClose={() => saveError = null} />
  <hbox class="actions">
    <Button classes="primary" label={$t`Save`} on:click={save} disabled={saving} />
    <Button label={$t`Cancel`} on:click={onCancel} disabled={saving} />
  </hbox>
</vbox>

<script lang="ts">
  import type { MailAccount } from "../../../../logic/Mail/MailAccount";
  import {
    hasInboxRuleAction, hasInboxRuleCondition, splitInboxRuleList,
    type InboxRule, type InboxRuleAddress, type InboxRuleFolder, type InboxRuleImportance,
  } from "../../../../logic/Mail/EWS/InboxRules";
  import { folderKeyFor, type FolderChoice } from "./serverRuleFolders";
  import HeaderGroupBox from "../../../Shared/HeaderGroupBox.svelte";
  import ErrorMessageInline from "../../../Shared/ErrorMessageInline.svelte";
  import Button from "../../../Shared/Button.svelte";
  import { t } from "../../../../l10n/l10n";

  /** Копия правила, её можно менять */
  export let rule: InboxRule;
  export let account: MailAccount;
  export let folders: FolderChoice[];
  /** @returns ошибка сервера или null */
  export let onSave: (rule: InboxRule) => Promise<Error | null>;
  export let onCancel: () => void;

  let c = rule.conditions;
  let a = rule.actions;

  let name = rule.name;
  let enabled = rule.enabled;
  let originalFromText = formatAddresses(c.from);
  let originalSentToText = formatAddresses(c.sentTo);
  let originalForwardText = formatAddresses(a.forwardTo);
  let fromText = originalFromText;
  let sentToText = originalSentToText;
  let subjectText = c.subjectContains.join(", ");
  let bodyText = c.bodyContains.join(", ");
  let importance: InboxRuleImportance | "" = c.importance ?? "";
  let hasAttachments = c.hasAttachments;
  let originalMoveKey = folderKeyFor(account, a.moveTo);
  let originalCopyKey = folderKeyFor(account, a.copyTo);
  let moveKey = originalMoveKey;
  let copyKey = originalCopyKey;
  let categoriesText = a.categories.join(", ");
  let forwardText = originalForwardText;
  let markAsRead = a.markAsRead;
  let deleteMessage = a.delete;
  let stopProcessing = a.stopProcessing;

  let showErrors = false;
  let saving = false;
  let saveError: Error | null = null;

  $: nameError = name.trim() ? null : $t`Enter a name for the rule`;
  $: fromError = addressError(fromText, originalFromText);
  $: sentToError = addressError(sentToText, originalSentToText);
  $: forwardError = addressError(forwardText, originalForwardText);
  $: actionError = moveKey || copyKey || deleteMessage || markAsRead ||
    splitInboxRuleList(categoriesText).length || splitInboxRuleList(forwardText).length
    ? null
    : $t`Choose at least one action`;

  /** Папка с сервера, которой нет в нашем списке: показываем, чтобы не потерять при сохранении */
  function folderOptions(originalKey: string): FolderChoice[] {
    if (originalKey.startsWith("server:")) {
      return [{ key: originalKey, label: $t`Folder on the server` }, ...folders];
    }
    return folders;
  }

  function formatAddresses(addresses: InboxRuleAddress[]): string {
    return addresses.map(entry =>
      entry.name && entry.name != entry.address && /@/.test(entry.address)
        ? `${entry.name} <${entry.address}>`
        : entry.name || entry.address).join(", ");
  }

  /** Текст поля → адреса. Неизменённое поле оставляет адреса с сервера как были. */
  function parseAddresses(text: string, originalText: string, original: InboxRuleAddress[]): InboxRuleAddress[] {
    if (text.trim() == originalText.trim()) {
      return original;
    }
    let formattedOriginal = new Map(original.map(entry => [formatAddresses([entry]).toLowerCase(), entry]));
    return splitInboxRuleList(text).map(entry => {
      let known = formattedOriginal.get(entry.toLowerCase());
      if (known) {
        return known;
      }
      let match = /^(.*?)\s*<([^<>]+)>$/.exec(entry);
      return match
        ? { name: match[1].replace(/^"|"$/g, "").trim(), address: match[2].trim() }
        : { name: "", address: entry };
    });
  }

  function addressError(text: string, originalText: string): string | null {
    if (text.trim() == originalText.trim()) {
      return null;
    }
    let original = new Set(splitInboxRuleList(originalText).map(entry => entry.toLowerCase()));
    let wrong = splitInboxRuleList(text).filter(entry =>
      !original.has(entry.toLowerCase()) && !/^[^\s@<>]+@[^\s@<>]+$/.test(entry.replace(/^.*<([^<>]+)>$/, "$1").trim()));
    return wrong.length ? $t`Not an email address: ${wrong.join(", ")}` : null;
  }

  function folderFor(key: string, originalKey: string, original: InboxRuleFolder | null): InboxRuleFolder | null {
    if (!key) {
      return null;
    }
    if (key == originalKey) {
      return original;
    }
    return { id: key, distinguishedId: null };
  }

  function collect(): InboxRule {
    return {
      ...rule,
      name: name.trim(),
      enabled,
      conditions: {
        from: parseAddresses(fromText, originalFromText, c.from),
        sentTo: parseAddresses(sentToText, originalSentToText, c.sentTo),
        subjectContains: splitInboxRuleList(subjectText),
        bodyContains: splitInboxRuleList(bodyText),
        importance: importance || null,
        hasAttachments,
      },
      actions: {
        moveTo: folderFor(moveKey, originalMoveKey, a.moveTo),
        copyTo: folderFor(copyKey, originalCopyKey, a.copyTo),
        delete: deleteMessage,
        markAsRead,
        categories: splitInboxRuleList(categoriesText),
        forwardTo: parseAddresses(forwardText, originalForwardText, a.forwardTo),
        stopProcessing,
      },
    };
  }

  async function save() {
    showErrors = true;
    saveError = null;
    if (nameError || fromError || sentToError || forwardError || actionError) {
      return;
    }
    let edited = collect();
    if (!hasInboxRuleAction(edited)) {
      return;
    }
    if (!hasInboxRuleCondition(edited) &&
        !confirm($t`This rule has no conditions and will apply to every incoming message. Save it anyway?`)) {
      return;
    }
    saving = true;
    try {
      saveError = await onSave(edited);
    } finally {
      saving = false;
    }
  }
</script>

<style>
  .rule-editor {
    max-width: 44em;
  }
  .fields {
    gap: 12px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 12px;
    color: color-mix(in srgb, var(--main-fg) 72%, transparent);
  }
  .field input, .field select {
    box-sizing: border-box;
    min-height: 32px;
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: var(--border-radius);
    background: var(--main-bg);
    color: var(--main-fg);
    font: inherit;
    font-size: 13px;
    max-width: 100%;
  }
  .field input:focus-visible, .field select:focus-visible {
    outline: 2px solid var(--icon-primary);
    outline-offset: 1px;
  }
  .field input[aria-invalid="true"] {
    border-color: var(--danger-fg, #c62828);
  }
  .field-error {
    margin: 0;
    color: var(--danger-fg, #c62828);
    font-size: 12px;
  }
  .checkbox-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .hint {
    margin: 0;
    font-size: 12px;
    color: color-mix(in srgb, var(--main-fg) 72%, transparent);
  }
  .actions {
    align-items: center;
    gap: 12px;
    margin-block: 24px 16px;
  }
</style>
