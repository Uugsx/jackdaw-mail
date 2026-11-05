<vbox class="workspace-selector" role="menu" on:keydown={onKeyDown} bind:this={selectorEl}>
  {#each [null, ...appGlobal.workspaces.each] as workspace}
    <button
      type="button"
      class="workspace"
      style="--workspace-color: {workspace?.color ?? "var(--fg)"}"
      class:selected={workspace == $selectedWorkspace}
      aria-current={workspace == $selectedWorkspace ? "true" : undefined}
      title={workspace?.name ?? $t`All`}
      role="menuitem"
      on:click={event => onWorkspaceSelected(workspace, event)}>
      <span class="dot" aria-hidden="true" />
      <span class="name">{workspace?.name ?? $t`All`}</span>
      {#if unread.get(workspace)}
        <span class="count" aria-label={$t`${unread.get(workspace)} unread`}>{unread.get(workspace)}</span>
      {/if}
      <span class="check" aria-hidden="true">
        {#if workspace == $selectedWorkspace}
          <CheckIcon size="14" />
        {/if}
      </span>
    </button>
  {/each}
</vbox>

<script lang="ts">
  import type { Workspace } from "../../logic/Abstract/Workspace";
  import { selectedWorkspace, selectWorkspace } from "./Selected";
  import { appGlobal } from "../../logic/app";
  import { t } from "../../l10n/l10n";
  import { createEventDispatcher } from "svelte";
  import CheckIcon from "lucide-svelte/icons/check";
  import { mailUnreadEpoch } from "../Mail/mailUnreadCounts";
  import { workspaceUnreadCount } from "../../logic/Mail/MailUnreadBadge";

  export let open: boolean;
  const dispatch = createEventDispatcher<{ selected: void; close: void }>();
  let selectorEl: HTMLElement;

  /* Эпоха — аргумент, чтобы числа пересчитывались при каждом изменении счётчиков */
  $: unread = unreadAtEpoch($mailUnreadEpoch);
  function unreadAtEpoch(_epoch: number): Map<Workspace | null, number> {
    let accounts = appGlobal.emailAccounts.contents;
    let counts = new Map<Workspace | null, number>([[null, workspaceUnreadCount(accounts, null)]]);
    for (let workspace of appGlobal.workspaces.contents) {
      counts.set(workspace, workspaceUnreadCount(accounts, workspace));
    }
    return counts;
  }

  export function focusFirst() {
    selectorEl?.querySelector<HTMLButtonElement>("button")?.focus();
  }

  function onWorkspaceSelected(workspace: Workspace | null, event: Event) {
    event.stopPropagation();
    open = false;
    selectWorkspace(workspace);
    dispatch("selected");
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key == "Escape") {
      event.preventDefault();
      event.stopPropagation();
      open = false;
      dispatch("close");
    }
  }
</script>

<style>
  .workspace-selector {
    min-width: 15em;
    padding: 4px;
    gap: 1px;
    background-color: var(--main-bg);
    color: var(--main-fg);
  }
  .workspace {
    width: 100%;
    border: 0;
    display: flex;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: start;
    cursor: pointer;
    align-items: center;
    gap: 10px;
    padding: 6px 8px 6px 10px;
    border-radius: var(--border-radius);
    min-height: 32px;
    box-sizing: border-box;
    transition: background-color 0.12s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .workspace .name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    line-height: 1.3;
  }
  .workspace .dot {
    background-color: var(--workspace-color);
    width: 8px;
    height: 8px;
    border-radius: 999px;
    flex-shrink: 0;
  }
  .workspace .count {
    flex-shrink: 0;
    min-width: 18px;
    padding: 0 6px;
    border-radius: 999px;
    background-color: color-mix(in srgb, currentColor 10%, transparent);
    font-size: 11px;
    font-weight: 600;
    line-height: 18px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .workspace .check {
    display: flex;
    flex-shrink: 0;
    width: 14px;
    color: var(--icon-primary, currentColor);
  }
  .workspace:hover {
    background-color: var(--hover-bg);
  }
  /* Выбранный пункт — спокойный фон и галочка, без акцентной заливки */
  .workspace.selected {
    background-color: color-mix(in srgb, currentColor 7%, transparent);
    font-weight: 600;
  }
  .workspace:active {
    transform: translateY(1px);
  }
  .workspace:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }
</style>
