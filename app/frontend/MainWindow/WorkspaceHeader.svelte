<hbox class="workspace-container">
  <button
    type="button"
    class="workspace"
    bind:this={workspaceE}
    class:in-settings={$selectedApp == settingsApp}
    class:in-settings-workspaces={$selectedApp == settingsApp && $selectedCategory?.id == "global-workspaces"}
    style="--workspace-color: {$selectedWorkspace?.color ?? "inherit" }"
    class:is-workspace-selected={$selectedWorkspace}
    aria-label={$selectedWorkspace?.name ?? $t`Workspace`}
    title={$selectedWorkspace?.name ?? $t`Workspace`}
    aria-haspopup="menu"
    aria-expanded={showWorkspaceDropdown}
    on:click={onWorkspaceToggle}>
    {#if $selectedWorkspace}
      <span class="dot" aria-hidden="true" />
      <span class="label">{$selectedWorkspace.name}</span>
      {#if selectedUnread}
        <span class="count" aria-label={$t`${selectedUnread} unread`}>{selectedUnread}</span>
      {/if}
    {:else}
      <WorkspaceIcon size="12px" aria-hidden="true" />
    {/if}
  </button>
  <Popup bind:popupOpen={showWorkspaceDropdown} popupAnchor={workspaceE} placement="bottom-start" boundaryElSel="body">
    <WorkspaceDropDown
      bind:open={showWorkspaceDropdown}
      bind:this={workspaceDropdown}
      on:selected={focusWorkspaceTrigger}
      on:close={focusWorkspaceTrigger}
      />
  </Popup>
</hbox>

<script lang="ts">
  import { selectedWorkspace } from "./Selected";
  import type { JackdawApp } from "../AppsBar/JackdawApp";
  import { settingsApp } from "../Settings/Window/SettingsJackdawApp";
  import { selectedCategory } from "../Settings/Window/selected";
  import WorkspaceDropDown from "./WorkspaceDropDown.svelte";
  import Popup from "../Shared/Popup.svelte";
  import WorkspaceIcon from 'lucide-svelte/icons/circle';
  import { t } from "../../l10n/l10n";
  import { tick } from "svelte";
  import { appGlobal } from "../../logic/app";
  import { mailUnreadEpoch } from "../Mail/mailUnreadCounts";
  import { workspaceUnreadCount } from "../../logic/Mail/MailUnreadBadge";

  export let selectedApp: JackdawApp;

  let workspaceE: HTMLButtonElement;
  $: selectedUnread = unreadAtEpoch($mailUnreadEpoch, $selectedWorkspace);
  function unreadAtEpoch(_epoch: number, workspace: typeof $selectedWorkspace): number {
    return workspace ? workspaceUnreadCount(appGlobal.emailAccounts.contents, workspace) : 0;
  }
  let workspaceDropdown;
  let showWorkspaceDropdown: boolean = false;
  async function onWorkspaceToggle(event: Event) {
    event.stopPropagation();
    showWorkspaceDropdown = !showWorkspaceDropdown;
    if (showWorkspaceDropdown) {
      await tick();
      workspaceDropdown?.focusFirst();
    }
  }
  function focusWorkspaceTrigger() {
    workspaceE?.focus();
  }
</script>

<style>
  .workspace-container {
    align-items: center;
  }
  .workspace {
    display: flex;
    flex-direction: row;
    font-size: 13px;
    font-weight: 500;
    line-height: 16px;
    letter-spacing: -0.02em;
    align-items: center;
    padding: 2px 8px;
    border-radius: var(--border-radius);
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
  .workspace:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
  .workspace:hover {
    background-color: var(--hover-bg);
    color: var(--hover-fg);
  }

  .count {
    margin-inline-start: 8px;
    min-width: 16px;
    padding: 0 5px;
    border-radius: 999px;
    background-color: color-mix(in srgb, currentColor 12%, transparent);
    font-size: 11px;
    font-weight: 600;
    line-height: 16px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  .dot {
    background-color: var(--workspace-color);
    margin-inline-end: 8px;
    min-width: 8px;
    min-height: 8px;
    border-radius: 11px;
    align-self: center;
  }

  .workspace.in-settings:not(.in-settings-workspaces) {
    display: none;
  }
  .workspace.in-settings.in-settings-workspaces {
    animation: flashColor 1s linear infinite alternate;
  }
  @keyframes flashColor {
    0% {
      background-color: var(--hover-bg);
    }
    100% {
      background-color: var(--windowheader-bg);
    }
  }
</style>
