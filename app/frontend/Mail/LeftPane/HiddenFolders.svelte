{#if hiddenFolderCount}
  <details class="hidden-folders">
    <summary>
      <span class="summary-label" title={$t`Hidden folders`}>
        <EyeOffIcon size="14px" aria-hidden="true" />
        <span>{$t`Hidden folders`}</span>
      </span>
      <span class="count">{hiddenFolderCount}</span>
    </summary>
    <div class="hidden-folder-list">
      {#each hiddenWorkspaceGroups as workspaceGroup (workspaceGroup.key)}
        {#if showWorkspaceLabels}
          <div class="hidden-workspace-group" title={workspaceGroup.label}>
            <span
              class="workspace-dot"
              style="background-color: {workspaceGroup.color ?? 'var(--leftbar-fg)'}"
              aria-hidden="true"></span>
            <span>{workspaceGroup.label}</span>
          </div>
        {/if}
        {#each workspaceGroup.accountGroups as accountGroup (accountGroup.key)}
          <div class="hidden-account-group" title={accountGroup.label}>
            <MailIcon size="12px" aria-hidden="true" />
            <span>{accountGroup.label}</span>
          </div>
          {#each accountGroup.entries as entry (entry.ref.accountId + ":" + entry.ref.folderId + ":" + entry.ref.folderPath)}
            <div class="hidden-folder-row">
              <span class="hidden-folder-label" title={getFolderLabel(entry)}>{getFolderLabel(entry)}</span>
              <button
                type="button"
                class="restore-button"
                title={$t`Show folder`}
                aria-label={$t`Show folder`}
                on:click={() => restoreHiddenFolder(entry.ref)}>
                <EyeIcon size="14px" aria-hidden="true" />
              </button>
            </div>
          {/each}
        {/each}
      {/each}
    </div>
  </details>
{/if}

<script lang="ts">
  import type { MailAccount } from "../../../logic/Mail/MailAccount";
  import type { Folder } from "../../../logic/Mail/Folder";
  import type { Collection } from "svelte-collections";
  import EyeIcon from "lucide-svelte/icons/eye";
  import EyeOffIcon from "lucide-svelte/icons/eye-off";
  import MailIcon from "lucide-svelte/icons/mail";
  import { t } from "../../../l10n/l10n";
  import {
    findHiddenFolder,
    hiddenFoldersEpoch,
    hiddenFoldersSetting,
    hiddenRefLabel,
    restoreHiddenFolder,
    type HiddenFolderRef,
  } from "./hiddenFolders";
  import { enumerateMailAccounts } from "./favoriteFolders";

  export let accounts: Collection<MailAccount>;

  type HiddenFolderEntry = { ref: HiddenFolderRef; folder: Folder | null };
  type HiddenFolderAccountGroup = {
    key: string;
    label: string;
    entries: HiddenFolderEntry[];
  };
  type HiddenFolderWorkspaceGroup = {
    key: string;
    label: string;
    color: string | null;
    accountGroups: HiddenFolderAccountGroup[];
  };

  const noWorkspaceKey = "no-workspace";
  let hiddenWorkspaceGroups: HiddenFolderWorkspaceGroup[] = [];
  let hiddenFolderCount = 0;
  let showWorkspaceLabels = false;

  $: {
    $accounts;
    $hiddenFoldersEpoch;
    let visibleAccounts = enumerateMailAccounts(accounts);
    let accountsByID = new Map(visibleAccounts.map(account => [account.id, account]));
    let workspaceGroups = new Map<string, {
      key: string;
      label: string;
      color: string | null;
      accountGroups: Map<string, HiddenFolderAccountGroup>;
    }>();

    for (let ref of ($hiddenFoldersSetting.value ?? [])) {
      let account = accountsByID.get(ref.accountId);
      if (!account) {
        continue;
      }

      let workspaceKey = account.workspace?.id ?? noWorkspaceKey;
      let workspaceGroup = workspaceGroups.get(workspaceKey);
      if (!workspaceGroup) {
        workspaceGroup = {
          key: workspaceKey,
          label: account.workspace?.name?.trim() || $t`Other`,
          color: account.workspace?.color || null,
          accountGroups: new Map(),
        };
        workspaceGroups.set(workspaceKey, workspaceGroup);
      }

      let accountGroup = workspaceGroup.accountGroups.get(account.id);
      if (!accountGroup) {
        accountGroup = {
          key: account.id,
          label: getAccountLabel(account),
          entries: [],
        };
        workspaceGroup.accountGroups.set(account.id, accountGroup);
      }

      accountGroup.entries.push({
        ref,
        folder: findHiddenFolder(accounts, ref),
      });
    }

    hiddenWorkspaceGroups = [...workspaceGroups.values()].map(group => ({
      ...group,
      accountGroups: [...group.accountGroups.values()],
    }));
    hiddenFolderCount = hiddenWorkspaceGroups.reduce(
      (count, group) => count + group.accountGroups.reduce(
        (groupCount, accountGroup) => groupCount + accountGroup.entries.length,
        0,
      ),
      0,
    );
    showWorkspaceLabels = hiddenWorkspaceGroups.length > 1;
  }

  function getFolderLabel(entry: { ref: HiddenFolderRef; folder: Folder | null }): string {
    return entry.folder?.fullPath || hiddenRefLabel(entry.ref);
  }

  function getAccountLabel(account: MailAccount): string {
    let name = account.name?.trim();
    let emailAddress = account.emailAddress?.trim();
    if (name && emailAddress && name != emailAddress) {
      return `${name} (${emailAddress})`;
    }
    return name || emailAddress || account.id;
  }
</script>

<style>
  .hidden-folders {
    flex: 0 0 auto;
    margin: 0 8px 6px;
    border: 1px solid var(--glass-border-subtle);
    border-radius: var(--border-radius);
    color: var(--leftbar-fg);
    background: color-mix(in srgb, var(--leftbar-bg) 88%, var(--leftbar-fg));
  }

  .hidden-folders summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 30px;
    padding: 4px 8px;
    box-sizing: border-box;
    cursor: pointer;
    list-style: none;
    font-size: 12px;
    font-weight: 500;
  }

  .hidden-folders summary::-webkit-details-marker {
    display: none;
  }

  .hidden-folders summary::before {
    flex: 0 0 auto;
    color: color-mix(in srgb, var(--leftbar-fg) 60%, transparent);
    content: "›";
    font-size: 18px;
    line-height: 1;
    transform: rotate(0deg);
    transition: transform 120ms ease;
  }

  .hidden-folders[open] summary::before {
    transform: rotate(90deg);
  }

  .summary-label {
    display: flex;
    flex: 1 1 auto;
    align-items: center;
    min-width: 0;
    gap: 7px;
  }

  .summary-label span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .count {
    flex: 0 0 auto;
    color: color-mix(in srgb, var(--leftbar-fg) 58%, transparent);
    font-variant-numeric: tabular-nums;
  }

  .hidden-folder-list {
    display: grid;
    gap: 2px;
    padding: 4px 4px 6px;
  }

  .hidden-workspace-group,
  .hidden-account-group {
    display: flex;
    align-items: center;
    min-width: 0;
  }

  .hidden-workspace-group {
    gap: 6px;
    padding: 5px 4px 2px 8px;
    border-block-start: 1px solid var(--glass-border-subtle);
    color: color-mix(in srgb, var(--leftbar-fg) 62%, transparent);
    font-size: 10px;
    font-weight: 600;
  }

  .hidden-workspace-group:first-child {
    padding-block-start: 2px;
    border-block-start: 0;
  }

  .hidden-workspace-group > span:last-child,
  .hidden-account-group > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .workspace-dot {
    flex: 0 0 auto;
    width: 7px;
    height: 7px;
    border-radius: 999px;
  }

  .hidden-account-group {
    gap: 6px;
    padding: 4px 4px 1px 16px;
    color: var(--leftbar-fg);
    font-size: 11px;
    font-weight: 600;
  }

  .hidden-account-group :global(svg) {
    flex: 0 0 auto;
  }

  .hidden-folder-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 4px;
    min-width: 0;
    padding: 2px 4px 2px 38px;
    border-radius: calc(var(--border-radius) - 2px);
  }

  .hidden-folder-row:hover {
    background: var(--hover-bg);
  }

  .hidden-folder-label {
    min-width: 0;
    overflow: hidden;
    color: color-mix(in srgb, var(--leftbar-fg) 72%, transparent);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .restore-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 3px;
    border: 1px solid transparent;
    border-radius: 4px;
    color: var(--leftbar-fg);
    background: transparent;
    cursor: pointer;
  }

  .restore-button:hover {
    background: var(--hover-bg);
  }

  .restore-button:focus-visible,
  .hidden-folders summary:focus-visible {
    outline: 2px solid var(--input-focus);
    outline-offset: 1px;
  }

  @media (prefers-reduced-motion: reduce) {
    .hidden-folders summary::before {
      transition: none;
    }
  }
</style>
