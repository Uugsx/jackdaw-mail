<hbox class="row" class:selected class:done role="listitem">
  <button type="button" class="check"
    class:checked={done}
    disabled={busy}
    aria-label={checkLabel}
    title={checkLabel}
    on:click={() => catchErrors(toggleDone)}>
    {#if busy}
      <Spinner size="14px" />
    {:else if done}
      <CheckIcon size="12px" />
    {/if}
  </button>
  <button type="button" class="main"
    aria-pressed={selected}
    on:click={() => dispatch("select")}
    on:dblclick={() => dispatch("open")}>
    {#if item.kind == "mail"}
      <MailIcon size="14px" class="kind" aria-label={$t`Flagged message`} />
    {/if}
    <vbox class="text">
      <span class="title">{title || $t`(no subject)`}</span>
      <span class="meta">
        {#if dueText}
          <span class="due" class:overdue={isOverdue}>{dueText}</span>
        {/if}
        {#if secondary}
          <span class="secondary">{secondary}</span>
        {/if}
      </span>
    </vbox>
    {#if item.kind == "task" && item.task.importance == "High"}
      <span class="important" title={$t`High importance`} aria-label={$t`High importance`}>!</span>
    {/if}
    {#if item.kind == "mail"}
      <FlagIcon size="14px" class="flag" />
    {/if}
  </button>
</hbox>

<script lang="ts">
  import { completeFlagged, itemTitle, toggleTaskCompleted, type TaskListItem } from "./tasksStore";
  import { isTaskCompleted, taskDueGroup } from "../../../logic/Mail/Tasks/ExchangeTask";
  import { formatTaskDay } from "./formatTaskDay";
  import Spinner from "../../Shared/Spinner.svelte";
  import CheckIcon from "lucide-svelte/icons/check";
  import MailIcon from "lucide-svelte/icons/mail";
  import FlagIcon from "lucide-svelte/icons/flag";
  import { catchErrors } from "../../Util/error";
  import { createEventDispatcher } from "svelte";
  import { t } from "../../../l10n/l10n";

  export let item: TaskListItem;
  export let selected = false;
  export let now = new Date();

  const dispatch = createEventDispatcher<{ select: void, open: void }>();
  let busy = false;

  $: done = item.kind == "task" && isTaskCompleted(item.task);
  $: title = itemTitle(item);
  $: isOverdue = !done && taskDueGroup(item.dueDay, now) == "overdue";
  $: dueText = done && item.kind == "task" && item.task.completedAt
    ? $t`Completed ${formatTaskDay(item.task.completedAt, now)}`
    : item.dueDay ? $t`Due ${formatTaskDay(item.dueDay, now)}` : "";
  $: secondary = item.kind == "mail"
    ? item.mail.contactName || item.mail.contactEmail || ""
    : item.task.notes.split("\n")[0];
  $: checkLabel = item.kind == "mail"
    ? $t`Mark as complete`
    : done ? $t`Mark as not complete` : $t`Mark as complete`;

  async function toggleDone() {
    if (busy) {
      return;
    }
    busy = true;
    try {
      if (item.kind == "task") {
        await toggleTaskCompleted(item.account, item.task);
      } else {
        await completeFlagged(item.mail);
      }
    } finally {
      busy = false;
    }
  }
</script>

<style>
  .row {
    align-items: center;
    gap: 4px;
    min-height: 44px;
    padding-inline-start: 8px;
    border-radius: var(--border-radius);
  }
  .row:hover {
    background: var(--hover-bg);
    color: var(--hover-fg);
  }
  .row.selected {
    background: var(--selected-bg);
    color: var(--selected-fg);
  }
  .check {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 18px;
    height: 18px;
    padding: 0;
    border: 1.5px solid color-mix(in srgb, currentColor 55%, transparent);
    border-radius: 50%;
    background: transparent;
    color: inherit;
    cursor: default;
    transition: background-color 120ms ease, border-color 120ms ease;
  }
  .check:hover:not(:disabled) {
    border-color: var(--icon-primary);
    background: color-mix(in srgb, var(--icon-primary) 14%, transparent);
  }
  .check.checked {
    border-color: var(--icon-primary);
    background: var(--icon-primary);
    color: var(--main-bg);
  }
  .check:focus-visible,
  .main:focus-visible {
    outline: 2px solid var(--icon-primary);
    outline-offset: 1px;
  }
  .main {
    display: flex;
    align-items: center;
    flex: 1 1 auto;
    gap: 8px;
    min-width: 0;
    min-height: 40px;
    padding: 4px 10px 4px 6px;
    border: none;
    border-radius: var(--border-radius);
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: start;
    cursor: default;
  }
  .main :global(.kind),
  .main :global(.flag) {
    flex: none;
    opacity: 0.7;
  }
  .main :global(.flag) {
    color: var(--danger-fg);
    opacity: 1;
  }
  .text {
    flex: 1 1 auto;
    min-width: 0;
  }
  .title {
    overflow: hidden;
    font-size: 13px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .done .title {
    text-decoration: line-through;
    opacity: 0.6;
  }
  .meta {
    display: flex;
    gap: 8px;
    min-width: 0;
    color: color-mix(in srgb, currentColor 62%, transparent);
    font-size: 11px;
    line-height: 16px;
  }
  .due {
    flex: none;
    font-variant-numeric: tabular-nums;
  }
  .due.overdue {
    color: var(--danger-fg);
    font-weight: 600;
  }
  .secondary {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .important {
    flex: none;
    color: var(--danger-fg);
    font-weight: 700;
  }
</style>
