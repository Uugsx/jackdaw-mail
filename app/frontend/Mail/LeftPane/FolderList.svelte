<vbox flex={!embedded} class="folder-list" class:embedded={embedded}>
  {#if embedded}
    <FastTree
      items={foldersSorted}
      columns="auto"
      autoHeight
      syncSelection={false}
      useExternalHighlight
      highlightItem={selectedFolder}
      selectedItems={embeddedSelection}
      on:selected={onEmbeddedSelect}
      >
      <TreeItemLine slot="row" let:item={folder} item={folder}>
        <FolderLine folder={folder as Folder} selected={selectedFolder === folder} slot="row" on:click>
          <slot name="buttons" slot="buttons" let:folder {folder} />
        </FolderLine>
      </TreeItemLine>
    </FastTree>
  {:else}
    <FastTree items={foldersSorted} bind:selectedItem={selectedFolder} bind:selectedItems={selectedFolders}
      columns="auto" on:selected={onFolderSelect}>
      <svelte:fragment slot="header">
        <slot name="header">
          <hbox class="header font-smallest">{$t`Folders`}</hbox>
        </slot>
      </svelte:fragment>
      <TreeItemLine slot="row" let:item={folder} item={folder}>
        <FolderLine folder={folder as Folder} selected={selectedFolder === folder} slot="row" on:click>
          <slot name="buttons" slot="buttons" let:folder {folder} />
        </FolderLine>
      </TreeItemLine>
    </FastTree>
  {/if}
</vbox>

<script lang="ts">
  import type { Folder } from '../../../logic/Mail/Folder';
  import FastTree from '../../Shared/FastTree.svelte';
  import { ArrayColl, type Collection } from 'svelte-collections';
  import FolderLine from './FolderLine.svelte';
  import TreeItemLine from '../../Shared/FastTreeItem.svelte';
  import { t } from '../../../l10n/l10n';
  import { createEventDispatcher } from 'svelte';
  import { hiddenFoldersEpoch, isHiddenFolder } from './hiddenFolders';

  export let folders: Collection<Folder>;
  export let selectedFolder: Folder; /* in/out */
  export let selectedFolders: ArrayColl<Folder>;
  /** Inside account sidebar: no header, natural height, subfolders via FastTree. */
  export let embedded = false;

  const dispatch = createEventDispatcher<{ selectFolder: Folder }>();
  const embeddedSelection = new ArrayColl<Folder>();
  let foldersSorted = new ArrayColl<Folder>();

  $: {
    $hiddenFoldersEpoch;
    foldersSorted = new ArrayColl($folders.each.filter(folder => !isHiddenFolder(folder))).sortBy(f => f.orderPos);
  }

  function onEmbeddedSelect(event: CustomEvent<Folder>) {
    dispatch("selectFolder", event.detail);
  }

  function onFolderSelect(event: CustomEvent<Folder>) {
    dispatch("selectFolder", event.detail);
  }
</script>

<style>
  .folder-list.embedded {
    min-width: 0;
  }
  .folder-list.embedded :global(.fast-list) {
    overflow: visible;
  }
  .header {
    padding-inline-start: 10px !important;
    color: grey;
  }
</style>
