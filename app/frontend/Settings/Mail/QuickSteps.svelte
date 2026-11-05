<!-- Настройки → Почта → Быстрые действия: список цепочек и редактор шагов, как Quick Steps в Outlook -->
<vbox class="groups">
  <HeaderGroupBox>
    <hbox slot="header">{$t`Quick steps`}</hbox>
    <vbox class="quick-steps">
      <hbox class="description font-small">
        {$t`A quick step runs several actions on the selected messages at once. Find them in the message menu under “Quick steps”.`}
      </hbox>
      <vbox class="step-list">
        {#each steps as step (step.id)}
          <hbox class="step font-small" class:selected={editing?.id == step.id}>
            <QuickStepIcon size="14px" />
            <span flex>{step.name}</span>
            <Button plain iconOnly icon={EditIcon} iconSize="14px"
              label={$t`Edit`}
              onClick={() => edit(step)} />
            <Button plain iconOnly icon={RemoveIcon} iconSize="14px"
              label={$t`Remove`}
              onClick={() => remove(step)} />
          </hbox>
        {:else}
          <hbox class="description font-small">{$t`No quick steps yet`}</hbox>
        {/each}
      </vbox>
      {#if !editing}
        <hbox>
          <Button icon={AddIcon} label={$t`New quick step`} onClick={create} />
        </hbox>
      {/if}
    </vbox>
  </HeaderGroupBox>

  {#if editing}
    <HeaderGroupBox>
      <hbox slot="header">{isNew ? $t`New quick step` : $t`Edit quick step`}</hbox>
      <vbox class="quick-steps">
        <hbox class="row">
          <label for="quick-step-name">{$t`Name`}</label>
          <input id="quick-step-name" type="text" bind:value={editing.name} />
        </hbox>
        {#each editing.actions as action, index}
          <hbox class="row action">
            <span class="number font-small">{index + 1}.</span>
            <select bind:value={action.type} on:change={() => action.value = ""}>
              {#each kQuickStepActionTypes as type}
                <option value={type}>{actionLabel(type)}</option>
              {/each}
            </select>
            {#if action.type == "move"}
              <select bind:value={action.value} flex>
                <option value="">{$t`Choose a folder…`}</option>
                {#each folderChoices as choice (choice.key)}
                  <option value={choice.key}>{choice.label}</option>
                {/each}
              </select>
            {:else if action.type == "reply-template"}
              <select bind:value={action.value} flex>
                <option value="">{$t`Choose a template…`}</option>
                {#each templates as template (template.id)}
                  <option value={String(template.id)}>{template.name}</option>
                {/each}
              </select>
            {:else if action.type == "forward"}
              <input type="text" flex bind:value={action.value} placeholder={$t`Addresses, separated by commas`} />
            {:else if action.type == "category"}
              <input type="text" flex bind:value={action.value} placeholder={$t`Category name`} list="quick-step-categories" />
            {/if}
            <Button plain iconOnly icon={RemoveIcon} iconSize="14px"
              label={$t`Remove action`}
              disabled={editing.actions.length < 2}
              onClick={() => removeAction(index)} />
          </hbox>
        {/each}
        <datalist id="quick-step-categories">
          {#each $availableTags.each as tag (tag.name)}
            <option value={tag.name} />
          {/each}
        </datalist>
        <hbox>
          <Button plain icon={AddIcon} label={$t`Add action`} onClick={addAction} />
        </hbox>
        {#if problem}
          <hbox class="error font-small">{problem}</hbox>
        {/if}
        <hbox class="buttons">
          <Button label={$t`Cancel`} onClick={cancel} />
          <Button classes="filled" label={$t`Save`} disabled={!!problem} onClick={save} />
        </hbox>
      </vbox>
    </HeaderGroupBox>
  {/if}
</vbox>

<script lang="ts">
  import {
    folderKey, getQuickSteps, kQuickStepActionTypes, newQuickStepID, quickStepProblem, saveQuickSteps,
    type QuickStep, type QuickStepActionType,
  } from "../../../logic/Mail/QuickSteps/QuickSteps";
  import { listMailTemplates } from "../../../logic/Mail/Templates/MailTemplateData";
  import type { MailTemplateSummary } from "../../../logic/Mail/Templates/MailTemplate";
  import { availableTags } from "../../../logic/Abstract/Tag";
  import { appGlobal } from "../../../logic/app";
  import HeaderGroupBox from "../../Shared/HeaderGroupBox.svelte";
  import Button from "../../Shared/Button.svelte";
  import QuickStepIcon from "lucide-svelte/icons/zap";
  import AddIcon from "lucide-svelte/icons/plus";
  import EditIcon from "lucide-svelte/icons/pencil";
  import RemoveIcon from "lucide-svelte/icons/x";
  import { backgroundError } from "../../Util/error";
  import { gt, t } from "../../../l10n/l10n";
  import { onMount } from "svelte";

  let steps: QuickStep[] = getQuickSteps();
  let editing: QuickStep | null = null;
  let isNew = false;
  let templates: MailTemplateSummary[] = [];

  $: problem = editing ? quickStepProblem(editing) : null;
  $: folderChoices = appGlobal.emailAccounts.contents.flatMap(account =>
    account.getAllFolders().contents.map(folder => ({
      key: folderKey(folder),
      label: account.name + " › " + folderPath(folder),
    })));

  onMount(() => {
    listMailTemplates().then(list => templates = list).catch(backgroundError);
  });

  function folderPath(folder: { name: string, parent?: any }): string {
    return folder.parent ? folderPath(folder.parent) + " › " + folder.name : folder.name;
  }

  function actionLabel(type: QuickStepActionType): string {
    switch (type) {
      case "move": return gt`Move to folder`;
      case "mark-read": return gt`Mark as read`;
      case "mark-unread": return gt`Mark as unread`;
      case "flag": return gt`Flag`;
      case "unflag": return gt`Clear flag`;
      case "important": return gt`Mark as important`;
      case "category": return gt`Categorize`;
      case "delete": return gt`Delete`;
      case "forward": return gt`Forward to`;
      case "reply-template": return gt`Reply with template`;
    }
  }

  function create() {
    isNew = true;
    editing = { id: newQuickStepID(), name: "", actions: [{ type: "move", value: "" }] };
  }

  function edit(step: QuickStep) {
    isNew = false;
    editing = structuredClone(step);
  }

  function cancel() {
    editing = null;
  }

  function addAction() {
    editing.actions = [...editing.actions, { type: "mark-read", value: "" }];
  }

  function removeAction(index: number) {
    editing.actions = editing.actions.filter((_, i) => i != index);
  }

  function save() {
    if (!editing || quickStepProblem(editing)) {
      return;
    }
    let saved = { ...editing, actions: editing.actions.map(action => ({ ...action })) };
    steps = isNew ? [...steps, saved] : steps.map(step => step.id == saved.id ? saved : step);
    saveQuickSteps(steps);
    steps = getQuickSteps();
    editing = null;
  }

  function remove(step: QuickStep) {
    steps = steps.filter(other => other.id != step.id);
    saveQuickSteps(steps);
    if (editing?.id == step.id) {
      editing = null;
    }
  }
</script>

<style>
  .groups {
    gap: 16px;
  }
  .quick-steps {
    gap: 8px;
    max-width: 44em;
    min-width: 24em;
  }
  .description {
    opacity: 0.7;
  }
  .error {
    color: var(--error-fg, #c62828);
  }
  .step {
    align-items: center;
    gap: 8px;
    min-height: 28px;
    border-bottom: 1px solid var(--border);
  }
  .step.selected {
    font-weight: 600;
  }
  .row {
    align-items: center;
    gap: 8px;
  }
  .row label {
    flex-shrink: 0;
  }
  .row input, .row select[flex] {
    flex: 1 1 auto;
    min-width: 0;
  }
  .number {
    min-width: 1.5em;
    opacity: 0.7;
  }
  .buttons {
    justify-content: flex-end;
    gap: 8px;
  }
</style>
