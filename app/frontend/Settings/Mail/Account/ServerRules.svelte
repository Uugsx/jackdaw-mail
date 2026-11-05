<vbox class="page server-rules">
  <PageHeader
    title={$t`Server rules`}
    subtitle={$t`Rules stored on the Exchange server sort incoming mail even when Jackdaw Mail is closed — on your phone, in Outlook and on the web.`} />

  <p class="difference">
    {$t`Jackdaw's own rules in the "Rules" section work only while the app is running and can do more, for example tag messages. Server rules work all the time, but support fewer conditions.`}
  </p>

  {#if !exchangeAccount}
    <Notice tone="info" message={$t`Server rules are not available for this account.`} />
  {:else if loading}
    <hbox class="loading" aria-busy="true">
      <Spinner size="16px" />
      <span>{$t`Loading…`}</span>
    </hbox>
  {:else if loadError}
    <ErrorMessageInline ex={loadError} onRetry={load} />
  {:else if editing}
    <ServerRuleEditor
      rule={editing}
      account={exchangeAccount}
      folders={folderChoices}
      onSave={saveEdited}
      onCancel={() => editing = null} />
  {:else}
    <ErrorMessageInline ex={actionError} onClose={() => actionError = null} />
    <hbox class="toolbar">
      <Button classes="primary" icon={AddIcon} label={$t`New rule`} on:click={addRule} disabled={busy} />
    </hbox>
    {#if !rules.length}
      <vbox class="empty">
        <span>{$t`There are no server rules yet.`}</span>
      </vbox>
    {:else}
      <vbox class="rule-list" role="list" aria-busy={busy}>
        {#each rules as rule, index (rule.id)}
          {@const readOnly = isInboxRuleReadOnly(rule)}
          <vbox class="rule" class:disabled={!rule.enabled} role="listitem">
            <hbox class="rule-head">
              <label class="enable" title={readOnly ? $t`Set up in Outlook. Change it in Outlook.` : null}>
                <input type="checkbox" checked={rule.enabled} disabled={busy || readOnly}
                  aria-label={$t`Rule enabled`}
                  on:change={event => toggleEnabled(rule, event.currentTarget)} />
              </label>
              <hbox class="title" flex>
                <span class="name">{rule.name || $t`Unnamed rule`}</span>
                {#if readOnly}
                  <span class="badge" title={$t`This rule uses conditions or actions that Jackdaw Mail can't edit. It still works on the server.`}>
                    {$t`Set up in Outlook`}
                  </span>
                {/if}
                {#if rule.inError}
                  <span class="badge error">{$t`Error on the server`}</span>
                {/if}
              </hbox>
              <hbox class="rule-buttons">
                <Button plain iconOnly icon={UpIcon} label={$t`Move up`}
                  disabled={busy || readOnly || index == 0}
                  on:click={() => move(index, -1)} />
                <Button plain iconOnly icon={DownIcon} label={$t`Move down`}
                  disabled={busy || readOnly || index == rules.length - 1}
                  on:click={() => move(index, 1)} />
                <Button plain iconOnly icon={EditIcon} label={$t`Edit`}
                  disabled={busy || readOnly}
                  on:click={() => editRule(rule)} />
                <Button plain iconOnly icon={DeleteIcon} label={$t`Delete rule`}
                  disabled={busy}
                  on:click={() => deleteRule(rule)} />
              </hbox>
            </hbox>
            <vbox class="summary">
              {#each describe(rule) as line}
                <span>{line}</span>
              {/each}
            </vbox>
          </vbox>
        {/each}
      </vbox>
    {/if}
  {/if}
</vbox>

<script lang="ts">
  import type { MailAccount } from "../../../../logic/Mail/MailAccount";
  import { ExchangeMailAccount } from "../../../../logic/Mail/EWS/ExchangeMailAccount";
  import {
    isInboxRuleReadOnly, isOutlookRuleBlobError, newInboxRule,
    type InboxRule, type InboxRuleFolder, type InboxRuleOperation,
  } from "../../../../logic/Mail/EWS/InboxRules";
  import { folderChoicesFor, folderNameFor, type FolderChoice } from "./serverRuleFolders";
  import ServerRuleEditor from "./ServerRuleEditor.svelte";
  import PageHeader from "../../Shared/PageHeader.svelte";
  import Notice from "../../../Shared/Notice.svelte";
  import ErrorMessageInline from "../../../Shared/ErrorMessageInline.svelte";
  import Button from "../../../Shared/Button.svelte";
  import Spinner from "../../../Shared/Spinner.svelte";
  import AddIcon from "lucide-svelte/icons/plus";
  import UpIcon from "lucide-svelte/icons/arrow-up";
  import DownIcon from "lucide-svelte/icons/arrow-down";
  import EditIcon from "lucide-svelte/icons/pencil";
  import DeleteIcon from "lucide-svelte/icons/trash-2";
  import { t } from "../../../../l10n/l10n";

  export let account: MailAccount;

  $: exchangeAccount = account instanceof ExchangeMailAccount && account.canServerRules ? account : null;

  let loading = true;
  let loadError: Error | null = null;
  let actionError: Error | null = null;
  let busy = false;
  let rules: InboxRule[] = [];
  let editing: InboxRule | null = null;
  let folderChoices: FolderChoice[] = [];

  $: exchangeAccount, load();

  async function load() {
    if (!exchangeAccount) {
      return;
    }
    loading = true;
    loadError = null;
    actionError = null;
    editing = null;
    try {
      folderChoices = folderChoicesFor(exchangeAccount);
      rules = (await exchangeAccount.loadInboxRules()).rules;
    } catch (ex) {
      loadError = ex;
    } finally {
      loading = false;
    }
  }

  /** Отправляет изменения и перечитывает правила: порядок и номера знает только сервер */
  async function apply(operations: InboxRuleOperation[]): Promise<boolean> {
    busy = true;
    actionError = null;
    try {
      try {
        await exchangeAccount.updateInboxRules(operations);
      } catch (ex) {
        if (!isOutlookRuleBlobError(ex)) {
          throw ex;
        }
        if (!confirm($t`Outlook keeps its own client-only rules in this mailbox. To save, Exchange must delete them; server rules stay. Continue?`)) {
          return false;
        }
        await exchangeAccount.updateInboxRules(operations, true);
      }
      rules = (await exchangeAccount.loadInboxRules()).rules;
      return true;
    } catch (ex) {
      actionError = ex;
      return false;
    } finally {
      busy = false;
    }
  }

  function addRule() {
    let rule = newInboxRule();
    // Новое правило — последним, как в Outlook
    rule.priority = (rules.at(-1)?.priority ?? 0) + 1;
    editing = rule;
  }

  function editRule(rule: InboxRule) {
    editing = structuredClone(rule);
  }

  async function saveEdited(rule: InboxRule): Promise<Error | null> {
    let ok = await apply([rule.id ? { kind: "set", rule } : { kind: "create", rule }]);
    if (ok) {
      editing = null;
      return null;
    }
    let error = actionError;
    actionError = null;
    return error;
  }

  async function toggleEnabled(rule: InboxRule, checkbox: HTMLInputElement) {
    let changed = { ...structuredClone(rule), enabled: !rule.enabled };
    if (!await apply([{ kind: "set", rule: changed }])) {
      checkbox.checked = rule.enabled;
    }
  }

  async function move(index: number, direction: -1 | 1) {
    let rule = rules[index];
    let neighbour = rules[index + direction];
    if (!rule || !neighbour) {
      return;
    }
    let operations: InboxRuleOperation[] = [
      { kind: "set", rule: { ...structuredClone(rule), priority: neighbour.priority } },
    ];
    // Правило из Outlook не трогаем: сервер сам сдвинет его
    if (!isInboxRuleReadOnly(neighbour)) {
      operations.push({ kind: "set", rule: { ...structuredClone(neighbour), priority: rule.priority } });
    }
    await apply(operations);
  }

  async function deleteRule(rule: InboxRule) {
    if (!confirm($t`Do you want to delete the rule '${rule.name}'?`)) {
      return;
    }
    await apply([{ kind: "delete", id: rule.id }]);
  }

  function folderName(folder: InboxRuleFolder): string {
    return folderNameFor(exchangeAccount, folder) ?? $t`Unknown folder`;
  }

  function people(addresses: { name: string, address: string }[]): string {
    return addresses.map(entry => entry.name || entry.address).join(", ");
  }

  function words(list: string[]): string {
    return list.map(word => `"${word}"`).join(", ");
  }

  /** Человеческое описание: строка «Если …» и строка «То …» */
  function describe(rule: InboxRule): string[] {
    let c = rule.conditions;
    let conditions: string[] = [];
    if (c.from.length) {
      conditions.push($t`from ${people(c.from)}`);
    }
    if (c.sentTo.length) {
      conditions.push($t`sent to ${people(c.sentTo)}`);
    }
    if (c.subjectContains.length) {
      conditions.push($t`subject contains ${words(c.subjectContains)}`);
    }
    if (c.bodyContains.length) {
      conditions.push($t`body contains ${words(c.bodyContains)}`);
    }
    if (c.importance == "High") {
      conditions.push($t`high importance`);
    } else if (c.importance == "Low") {
      conditions.push($t`low importance`);
    } else if (c.importance == "Normal") {
      conditions.push($t`normal importance`);
    }
    if (c.hasAttachments) {
      conditions.push($t`has attachments`);
    }

    let a = rule.actions;
    let actions: string[] = [];
    if (a.moveTo) {
      actions.push($t`move to ${folderName(a.moveTo)}`);
    }
    if (a.copyTo) {
      actions.push($t`copy to ${folderName(a.copyTo)}`);
    }
    if (a.delete) {
      actions.push($t`delete`);
    }
    if (a.markAsRead) {
      actions.push($t`mark as read`);
    }
    if (a.categories.length) {
      actions.push($t`assign category ${a.categories.join(", ")}`);
    }
    if (a.forwardTo.length) {
      actions.push($t`forward to ${people(a.forwardTo)}`);
    }
    if (a.stopProcessing) {
      actions.push($t`stop processing more rules`);
    }

    let readOnly = isInboxRuleReadOnly(rule);
    let lines: string[] = [];
    if (conditions.length) {
      lines.push($t`If ${conditions.join(", ")}`);
    } else if (!readOnly) {
      // У правила из Outlook условия могут быть, просто мы их не понимаем
      lines.push($t`For every message`);
    }
    if (actions.length) {
      lines.push($t`Then ${actions.join(", ")}`);
    }
    if (readOnly) {
      lines.push($t`Has more conditions or actions, which only Outlook can show.`);
    }
    return lines;
  }
</script>

<style>
  .server-rules {
    max-width: 52em;
  }
  .difference {
    margin: 0 0 16px;
    max-width: 44em;
    line-height: 1.45;
    color: color-mix(in srgb, var(--main-fg) 72%, transparent);
  }
  .loading {
    align-items: center;
    gap: 8px;
    margin-block-start: 24px;
    color: color-mix(in srgb, var(--main-fg) 72%, transparent);
  }
  .toolbar {
    margin-block: 4px 12px;
  }
  .empty {
    padding: 24px 16px;
    border: 1px dashed var(--border);
    border-radius: var(--border-radius);
    color: color-mix(in srgb, var(--main-fg) 72%, transparent);
    align-items: center;
  }
  .rule-list {
    gap: 8px;
    margin-block-end: 24px;
  }
  .rule-list[aria-busy="true"] {
    opacity: 0.7;
  }
  .rule {
    gap: 4px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--border-radius);
    background: var(--main-bg);
  }
  .rule.disabled .name, .rule.disabled .summary {
    opacity: 0.55;
  }
  .rule-head {
    align-items: flex-start;
    gap: 8px;
    min-width: 0;
  }
  .rule-head > .enable, .rule-head > .rule-buttons {
    min-height: 26px;
    align-items: center;
  }
  .title {
    align-items: center;
    flex-wrap: wrap;
    gap: 4px 8px;
    min-width: 0;
    min-height: 26px;
  }
  .enable {
    display: flex;
    align-items: center;
  }
  .name {
    font-weight: 600;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .badge {
    padding: 1px 8px;
    border-radius: 10px;
    font-size: 11px;
    white-space: nowrap;
    background: color-mix(in srgb, var(--main-fg) 9%, transparent);
    color: color-mix(in srgb, var(--main-fg) 80%, transparent);
  }
  .badge.error {
    background: color-mix(in srgb, var(--danger-fg, #c62828) 14%, transparent);
    color: var(--danger-fg, #c62828);
  }
  .rule-buttons {
    gap: 2px;
    flex-shrink: 0;
  }
  .summary {
    gap: 2px;
    padding-inline-start: 24px;
    font-size: 12px;
    line-height: 1.45;
    color: color-mix(in srgb, var(--main-fg) 72%, transparent);
    overflow-wrap: anywhere;
  }
</style>
