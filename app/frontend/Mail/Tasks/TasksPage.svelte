<vbox flex class="tasks-page">
  <hbox class="header">
    <ListChecksIcon size="18px" />
    <h2>{$t`Tasks`}</h2>
    {#if openCount}
      <span class="count" title={$t`Open tasks and flagged messages`}>{openCount}</span>
    {/if}
    <hbox flex />
    <RoundButton
      label={$t`Refresh`}
      icon={RefreshIcon}
      iconSize="16px"
      border={false}
      disabled={$tasksState.refreshing}
      onClick={() => refreshTasks()} />
    <RoundButton
      label={$t`Close`}
      icon={CloseIcon}
      iconSize="16px"
      border={false}
      onClick={() => $tasksViewOpen = false} />
  </hbox>

  {#if accounts.length}
    <form class="quick-add" on:submit|preventDefault={() => catchErrors(addQuickTask)}>
      <hbox class="subject">
        <PlusIcon size="16px" />
        <input
          type="text"
          bind:value={newSubject}
          bind:this={newSubjectInput}
          placeholder={$t`Add a task`}
          aria-label={$t`Add a task`}
          maxlength={kMaxSubjectLength}
          disabled={adding} />
      </hbox>
      <select bind:value={newDue} aria-label={$t`Due date`} disabled={adding}>
        <option value="no-date">{$t`No date`}</option>
        <option value="today">{$t`Today`}</option>
        <option value="tomorrow">{$t`Tomorrow`}</option>
        <option value="this-week">{$t`This week`}</option>
        <option value="next-week">{$t`Next week`}</option>
      </select>
      {#if accounts.length > 1}
        <select bind:value={newAccount} aria-label={$t`Account`} disabled={adding}>
          {#each accounts as account (account.id)}
            <option value={account}>{account.name || account.emailAddress}</option>
          {/each}
        </select>
      {/if}
      <Button
        label={$t`Add`}
        icon={adding ? Spinner : null}
        classes="filled"
        disabled={!newSubject.trim() || adding} />
    </form>
  {:else}
    <p class="hint no-exchange">{$t`To create tasks, add an Exchange or Outlook on the web account. Flagged messages from all accounts appear here.`}</p>
  {/if}

  {#each $tasksState.errors as failure (failure.account.id)}
    <hbox class="notice">
      <ErrorMessageInline
        ex={new Error($t`Could not load tasks of ${failure.account.name || failure.account.emailAddress}: ${failure.error.message}`)}
        onRetry={() => refreshTasks()} />
    </hbox>
  {/each}

  <hbox flex class="body">
    <vbox flex class="list" role="list" aria-busy={$tasksState.loading}>
      {#if $tasksState.loading}
        {#each [0, 1, 2, 3] as index (index)}
          <hbox class="row skeleton" aria-hidden="true">
            <span class="dot" />
            <span class="bar" style="width: {70 - index * 12}%" />
          </hbox>
        {/each}
        <span class="sr-only" role="status">{$t`Loading tasks…`}</span>
      {:else if !groups.length && !completed.length}
        <vbox class="empty">
          <CircleCheckIcon size="32px" />
          <span class="empty-title">{$t`Nothing to do`}</span>
          <span class="hint">{$t`Add a task above, or flag a message with a due date from its menu.`}</span>
        </vbox>
      {:else}
        {#each groups as section (section.group)}
          <hbox class="section-title" class:overdue={section.group == "overdue"}>
            {groupLabel(section.group)}
            <span class="section-count">{section.items.length}</span>
          </hbox>
          {#each section.items as item (item.key)}
            <TaskRow {item} {now} selected={selectedKey == item.key}
              on:select={() => select(item)}
              on:open={() => openItem(item)} />
          {/each}
        {/each}
        {#if completed.length}
          <button type="button" class="section-title toggle"
            aria-expanded={showCompleted}
            on:click={() => showCompleted = !showCompleted}>
            <svelte:component this={showCompleted ? ChevronDownIcon : ChevronRightIcon} size="14px" />
            {$t`Completed`}
            <span class="section-count">{completed.length}</span>
          </button>
          {#if showCompleted}
            {#each completed as item (item.key)}
              <TaskRow {item} {now} selected={selectedKey == item.key}
                on:select={() => select(item)}
                on:open={() => openItem(item)} />
            {/each}
          {/if}
        {/if}
      {/if}
    </vbox>

    {#if selectedItem}
      <vbox class="details">
        {#key selectedItem.key}
          {#if selectedItem.kind == "task"}
            <TaskEditor account={selectedItem.account} task={selectedItem.task}
              on:close={() => selectedKey = null} />
          {:else}
            <FlaggedMailDetails row={selectedItem.mail}
              on:close={() => selectedKey = null} />
          {/if}
        {/key}
      </vbox>
    {/if}
  </hbox>
</vbox>

<script lang="ts">
  import {
    addTask, completedItems, groupOpenItems, openFlaggedEMail, refreshTasks, taskAccounts, tasksState, tasksViewOpen,
    type TaskListItem,
  } from "./tasksStore";
  import { flagDaysForChoice, newTaskInput, type FlagDueChoice, type TaskDueGroup } from "../../../logic/Mail/Tasks/ExchangeTask";
  import type { MailAccount } from "../../../logic/Mail/MailAccount";
  import TaskRow from "./TaskRow.svelte";
  import TaskEditor from "./TaskEditor.svelte";
  import FlaggedMailDetails from "./FlaggedMailDetails.svelte";
  import Button from "../../Shared/Button.svelte";
  import Spinner from "../../Shared/Spinner.svelte";
  import RoundButton from "../../Shared/RoundButton.svelte";
  import ErrorMessageInline from "../../Shared/ErrorMessageInline.svelte";
  import ListChecksIcon from "lucide-svelte/icons/list-checks";
  import RefreshIcon from "lucide-svelte/icons/refresh-cw";
  import CloseIcon from "lucide-svelte/icons/x";
  import PlusIcon from "lucide-svelte/icons/plus";
  import CircleCheckIcon from "lucide-svelte/icons/circle-check";
  import ChevronDownIcon from "lucide-svelte/icons/chevron-down";
  import ChevronRightIcon from "lucide-svelte/icons/chevron-right";
  import { catchErrors } from "../../Util/error";
  import { onMount } from "svelte";
  import { t } from "../../../l10n/l10n";

  const kMaxSubjectLength = 255;

  let accounts: MailAccount[] = taskAccounts();
  let newAccount: MailAccount = accounts[0];
  let newSubject = "";
  let newDue: Exclude<FlagDueChoice, { dueDay: string }> = "no-date";
  let newSubjectInput: HTMLInputElement;
  let adding = false;
  let selectedKey: string | null = null;
  let showCompleted = false;
  let now = new Date();

  onMount(() => {
    catchErrors(() => refreshTasks());
    // Смена дня переносит задачи из «Завтра» в «Сегодня»
    let interval = setInterval(() => now = new Date(), 60_000);
    return () => clearInterval(interval);
  });

  $: groups = groupOpenItems($tasksState.items, now);
  $: completed = completedItems($tasksState.items);
  $: openCount = groups.reduce((sum, section) => sum + section.items.length, 0);
  $: selectedItem = $tasksState.items.find(item => item.key == selectedKey) ?? null;

  function groupLabel(group: TaskDueGroup): string {
    switch (group) {
      case "overdue": return $t`Overdue`;
      case "today": return $t`Today`;
      case "tomorrow": return $t`Tomorrow`;
      case "later": return $t`Later`;
      default: return $t`No date`;
    }
  }

  function select(item: TaskListItem) {
    selectedKey = selectedKey == item.key ? null : item.key;
  }

  async function openItem(item: TaskListItem) {
    if (item.kind == "mail") {
      await openFlaggedEMail(item.mail);
    } else {
      selectedKey = item.key;
    }
  }

  async function addQuickTask() {
    let subject = newSubject.trim();
    if (!subject || !newAccount || adding) {
      return;
    }
    adding = true;
    try {
      let { startDay, dueDay } = flagDaysForChoice(newDue);
      let task = await addTask(newAccount, { ...newTaskInput(), subject, startDay, dueDay });
      newSubject = "";
      newDue = "no-date";
      selectedKey = `t:${newAccount.id}:${task.itemID}`;
    } finally {
      adding = false;
      newSubjectInput?.focus();
    }
  }
</script>

<style>
  .tasks-page {
    min-width: 0;
    min-height: 0;
    background-color: var(--main-bg);
    color: var(--main-fg);
    container-type: inline-size;
    container-name: tasks-page;
  }
  .header {
    align-items: center;
    gap: 8px;
    min-height: 44px;
    padding: 4px 8px 4px 16px;
    border-block-end: 1px solid var(--border);
  }
  h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
  }
  .count,
  .section-count {
    min-width: 18px;
    padding: 0 6px;
    box-sizing: border-box;
    border-radius: 9px;
    background: color-mix(in srgb, var(--main-fg) 10%, transparent);
    font-size: 11px;
    font-weight: 500;
    line-height: 18px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .quick-add {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 12px 16px 4px;
    padding: 4px 4px 4px 12px;
    border: 1px solid var(--border);
    border-radius: var(--border-radius);
    color: color-mix(in srgb, var(--main-fg) 60%, transparent);
  }
  .quick-add:focus-within {
    border-color: var(--icon-primary);
  }
  .quick-add .subject {
    align-items: center;
    flex: 1 1 auto;
    gap: 8px;
    min-width: 0;
  }
  /* Неактивная залитая кнопка не должна выглядеть нажимаемой */
  .quick-add :global(.button.filled.disabled) {
    opacity: 0.45;
  }
  .quick-add input {
    flex: 1 1 auto;
    min-width: 6em;
    min-height: 30px;
    border: none;
    outline: none;
    background: transparent;
    color: var(--main-fg);
    font: inherit;
    font-size: 13px;
  }
  .quick-add select {
    flex: 0 1 auto;
    min-width: 0;
    max-width: 12em;
  }
  .quick-add :global(button) {
    flex: none;
  }
  .hint {
    margin: 0;
    color: color-mix(in srgb, var(--main-fg) 60%, transparent);
    font-size: 12px;
    line-height: 1.45;
  }
  .no-exchange {
    margin: 12px 16px 4px;
  }
  .notice {
    margin: 8px 16px 0;
  }
  .body {
    min-height: 0;
    align-items: stretch;
  }
  .list {
    min-width: 0;
    padding: 8px 8px 16px;
    overflow-y: auto;
  }
  .details {
    flex: 0 0 340px;
    min-width: 0;
    border-inline-start: 1px solid var(--border);
    overflow-y: auto;
  }
  .section-title {
    align-items: center;
    gap: 6px;
    margin: 12px 8px 4px;
    color: color-mix(in srgb, var(--main-fg) 64%, transparent);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }
  .section-title.overdue {
    color: var(--danger-fg);
  }
  .section-title.toggle {
    display: flex;
    padding: 2px 4px;
    margin-inline-start: 4px;
    border: none;
    border-radius: var(--border-radius);
    background: transparent;
    font-family: inherit;
    cursor: default;
  }
  .section-title.toggle:hover {
    background: var(--hover-bg);
    color: var(--hover-fg);
  }
  .section-title.toggle:focus-visible {
    outline: 2px solid var(--icon-primary);
    outline-offset: 1px;
  }
  .empty {
    align-items: center;
    gap: 8px;
    margin: 48px auto 0;
    max-width: 26em;
    padding: 0 16px;
    color: color-mix(in srgb, var(--main-fg) 45%, transparent);
    text-align: center;
  }
  .empty-title {
    color: var(--main-fg);
    font-size: 14px;
    font-weight: 600;
  }
  .row.skeleton {
    align-items: center;
    gap: 12px;
    min-height: 40px;
    padding: 0 12px;
  }
  .skeleton .dot,
  .skeleton .bar {
    background: color-mix(in srgb, var(--main-fg) 9%, transparent);
    animation: pulse 1.4s ease-in-out infinite;
  }
  .skeleton .dot {
    flex: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
  }
  .skeleton .bar {
    height: 10px;
    border-radius: 5px;
  }
  @keyframes pulse {
    50% {
      opacity: 0.45;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .skeleton .dot,
    .skeleton .bar {
      animation: none;
    }
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  /* Узкое окно: подробности под списком, а не сбоку */
  @container tasks-page (max-width: 620px) {
    .body {
      flex-direction: column;
    }
    .details {
      flex: 0 0 auto;
      max-height: 55%;
      border-inline-start: none;
      border-block-start: 1px solid var(--border);
    }
    .quick-add {
      flex-wrap: wrap;
    }
    /* «+» и поле — одной строкой, срок и кнопка переносятся вместе */
    .quick-add .subject {
      flex-basis: 100%;
    }
    .quick-add select {
      flex: 1 1 0;
      min-width: 0;
      max-width: none;
    }
  }
</style>
