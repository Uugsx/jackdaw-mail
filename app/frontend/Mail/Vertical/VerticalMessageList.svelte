<vbox flex class="message-list"
  on:keydown={event => catchErrors(() => onKeyOnList(event))}
  tabindex={0}
  >
  {#if $folderSyncing && $listRows.isEmpty}
    <vbox class="empty-list">
      <Spinner size="36px" />
      <hbox class="subtitle">{$t`Loading messages`}</hbox>
    </vbox>
  {:else if $listRows.isEmpty}
    <vbox class="empty-list">
      {#if emptyDueToFilter}
        <hbox class="title">{$t`No messages match these filters`}</hbox>
        <hbox class="subtitle">{$t`Clear filters to see all messages in this folder.`}</hbox>
      {:else}
        <hbox class="title">{$t`This folder is empty`}</hbox>
        <hbox class="subtitle">{$t`Write a new email or get mail from the server.`}</hbox>
      {/if}
    </vbox>
  {:else}
  <FastList items={listRows}
    bind:selectedItem={selectedRow}
    bind:selectedItems={selectedRows}
    isSelectable={mailListRowSelectable}
    bind:isAtTop
    on:selected={onRowSelected}
    on:init={onListInit}
    columns="auto">
    <svelte:fragment slot="header">
    </svelte:fragment>
    <svelte:fragment slot="row" let:item>
      {#if item.kind == "day"}
        <MailListTopicSeparator prefix={$t`Received`} label={item.label} count={item.count} collapsed={item.collapsed}
          on:toggle={() => rowsModel.toggleGroup(item.id)} />
      {:else if item.kind == "topic"}
        <MailListTopicSeparator prefix={$t`Subject`} label={item.label} count={item.count} collapsed={item.collapsed}
          on:toggle={() => rowsModel.toggleGroup(item.id)} />
      {:else if item.kind == "sender"}
        <MailListTopicSeparator prefix={$t`From`} label={item.label} count={item.count} collapsed={item.collapsed}
          on:toggle={() => rowsModel.toggleGroup(item.id)} />
      {:else if item.kind == "message"}
        <VerticalMessageListItem message={item.message} on:click />
      {/if}
    </svelte:fragment>
  </FastList>
  {/if}
</vbox>

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import type { Folder } from "../../../logic/Mail/Folder";
  import { onKeyOnList } from "../Message/MessageKeyboard";
  import { activateMailListSort, mailListSort, type MailListSort } from "../LeftPane/quickFilters";
  import FastList from "../../Shared/FastList.svelte";
  import VerticalMessageListItem from "./VerticalMessageListItem.svelte";
  import MailListTopicSeparator from "./MailListTopicSeparator.svelte";
  import {
    MailListRows, findMailListRowForMessage, mailListRowSelectable,
    type MailListMessageRow, type MailListRow,
  } from "../mailListRows";
  import { listVisibleMessages, folderSyncing } from "../Selected";
  import Spinner from "../../Shared/Spinner.svelte";
  import { catchErrors } from "../../Util/error";
  import { ArrayColl, type Collection } from "svelte-collections";
  import { onDestroy, tick } from "svelte";
  import { t } from "../../../l10n/l10n";

  export let messages: Collection<EMail>;
  export let folder: Folder | null = null;
  export let selectedMessage: EMail;
  export let selectedMessages: ArrayColl<EMail>;
  /** From FastList. out only */
  export let isAtTop: boolean = false;
  export let emptyDueToFilter = false;

  let selectedRow: MailListRow | null = null;
  let selectedRows = new ArrayColl<MailListRow>();
  let scrollToMailListItem: ((item: MailListRow) => void) | null = null;
  let scrollRequestVersion = 0;
  let lastScrolledMessage: EMail | null = null;
  let lastScrolledSort: MailListSort | null = null;

  const rowsModel = new MailListRows();
  const listRows = rowsModel.rows;
  onDestroy(() => rowsModel.dispose());

  $: activateMailListSort(folder);
  $: rowsModel.setSource(messages, $mailListSort);
  $: listVisibleMessages.set(messages);
  $: syncSelectedRow(selectedMessage, $listRows);
  $: syncSelectedMessages($selectedRows);
  $: syncRowsFromMessages(selectedMessages, $listRows);
  $: scrollSelectedMessageIntoView($listRows, selectedMessage, $mailListSort);

  function selectedMessageRows(rows: ArrayColl<MailListRow>): EMail[] {
    return rows.contents
      .filter((row): row is MailListMessageRow => !!row && row.kind == "message")
      .map(row => row.message);
  }

  function syncRowsFromMessages(msgs: ArrayColl<EMail>, rows: Collection<MailListRow>) {
    let current = selectedMessageRows(selectedRows);
    if (arraysEqual(msgs.contents, current)) {
      return;
    }
    let emailRows = msgs.contents
      .map(message => findMailListRowForMessage(rows, message))
      .filter((row): row is MailListMessageRow => !!row && row.kind == "message");
    selectedRows.replaceAll(emailRows);
    selectedRow = emailRows[0] ?? null;
  }
  function syncSelectedRow(message: EMail, rows: Collection<MailListRow>) {
    let row = findMailListRowForMessage(rows, message);
    if (row && row !== selectedRow) {
      selectedRow = row;
      if (!selectedRows.contains(row)) {
        selectedRows.replaceAll([row]);
      }
    }
  }

  function syncSelectedMessages(rows: ArrayColl<MailListRow>) {
    let emails = selectedMessageRows(rows);
    if (!arraysEqual(emails, selectedMessages.contents)) {
      selectedMessages.replaceAll(emails);
    }
    if (emails[0] && emails[0] !== selectedMessage) {
      selectedMessage = emails[0];
    }
  }

  /**
   * FastList scrolls to the selected row during initialisation. A message
   * opened from another panel, or a sort change that moves the row, happens
   * after the list is already mounted, so explicitly reveal that row as well.
   */
  function scrollSelectedMessageIntoView(
    rows: Collection<MailListRow>,
    message: EMail | null,
    sort: MailListSort,
  ): void {
    if (!message) {
      lastScrolledMessage = null;
      lastScrolledSort = null;
      return;
    }
    if (!scrollToMailListItem || (message == lastScrolledMessage && sort == lastScrolledSort)) {
      return;
    }
    let row = findMailListRowForMessage(rows, message);
    if (!row) {
      return;
    }
    lastScrolledMessage = message;
    lastScrolledSort = sort;
    let requestVersion = ++scrollRequestVersion;
    void tick().then(() => {
      if (requestVersion == scrollRequestVersion) {
        let currentRow = findMailListRowForMessage(rows, message);
        if (currentRow) {
          scrollToMailListItem?.(currentRow);
        }
      }
    });
  }

  function arraysEqual<T>(a: T[], b: T[]): boolean {
    return a.length == b.length && a.every((item, i) => item == b[i]);
  }

  function onRowSelected(ev: CustomEvent<MailListRow>) {
    let row = ev.detail;
    if (row?.kind == "message") {
      selectedMessage = row.message;
    }
  }

  function onListInit(ev: CustomEvent<{ scrollToIndex: (index: number) => void, scrollToItem: (item: MailListRow) => void }>) {
    scrollToMailListItem = ev.detail.scrollToItem;
    scrollSelectedMessageIntoView(listRows, selectedMessage, $mailListSort);
  }
</script>

<style>
  .message-list {
    position: relative;
  }
  .message-list :global(.fast-list) {
    padding-inline-start: 0;
  }
  .message-list :global(.header) {
    display: none;
  }
  .message-list :global(.header hbox) {
    vertical-align: middle;
    border: none;
    color: grey;
  }
  .message-list :global(.header) {
    height: 32px;
  }
  .message-list :global(.row:not(.selected):not(:hover) .message) {
    background-color: var(--main-bg);
    color: var(--main-fg);
  }
  .message-list :global(.row:has(.mail-list-day-separator)) {
    cursor: default;
  }
  .message-list :global(.row:has(.mail-list-topic-separator)) {
    cursor: default;
  }
  .message-list :global(.row:has(.mail-list-day-separator).odd .mail-list-day-separator),
  .message-list :global(.row:has(.mail-list-day-separator):hover .mail-list-day-separator) {
    background-color: transparent;
  }
  .message-list :global(.row:has(.mail-list-topic-separator).odd .mail-list-topic-separator),
  .message-list :global(.row:has(.mail-list-topic-separator):hover .mail-list-topic-separator) {
    background-color: color-mix(in srgb, var(--main-fg) 6%, var(--main-bg));
  }
  .empty-list {
    flex: 1;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 2em;
    text-align: center;
    opacity: 0.75;
  }
  .empty-list .title {
    font-weight: 600;
  }
</style>
