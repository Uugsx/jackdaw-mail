<vbox flex class="message-list"
  class:table-layout={!!tableColumns}
  class:dividers
  style="--mail-list-grid: {gridTemplate};"
  bind:clientWidth={listWidth}
  on:keydown={event => catchErrors(() => onKeyOnList(event))}
  tabindex={0}
  >
  {#if alertBarFolder}
    <AlertIncidentBar folder={alertBarFolder} incidentMode={!!incidentMode} summary={$incidentSummary} {messages} />
  {/if}
  {#if tableColumns}
    <MailListHeader columns={tableColumns} sort={$mailListSort} {folder} onSort={sortByColumn} />
  {/if}
  {#if $folderSyncing && $listRows.isEmpty}
    <vbox class="empty-list">
      <Spinner size="36px" />
      <hbox class="subtitle">{$t`Loading messages`}</hbox>
    </vbox>
  {:else if $listRows.isEmpty}
    <vbox class="empty-list">
      {#if incidentMode?.activeOnly && $incidentSummary?.total}
        <hbox class="title">{$t`No active incidents`}</hbox>
        <hbox class="subtitle">{$t`All alerts in this folder are quiet, resolved or closed.`}</hbox>
        <Button label={$t`Show all incidents`} onClick={showAllIncidents} />
      {:else if emptyDueToFilter}
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
    selectionKey={mailListRowSelectionKey}
    focusOnSelect={true}
    bind:isAtTop
    on:selected={onRowSelected}
    on:init={onListInit}
    columns="auto">
    <svelte:fragment slot="header">
    </svelte:fragment>
    <svelte:fragment slot="row" let:item>
      {#if item.kind == "day"}
        <MailListTopicSeparator prefix={item.id == kPinnedGroupID ? null : $t`Received`} label={item.label} count={item.count} collapsed={item.collapsed}
          on:toggle={() => toggleListGroup(item.id)} />
      {:else if item.kind == "topic"}
        <MailListTopicSeparator prefix={$t`Subject`} label={item.label} count={item.count} collapsed={item.collapsed}
          on:toggle={() => toggleListGroup(item.id)} />
      {:else if item.kind == "sender"}
        <MailListTopicSeparator prefix={$t`From`} label={item.label} count={item.count} collapsed={item.collapsed}
          on:toggle={() => toggleListGroup(item.id)} />
      {:else if item.kind == "incident"}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="incident-row" on:dblclick={() => rowsModel.toggleGroup(item.id)}>
          <MailListIncidentCard incident={item.incident} expanded={item.expanded}
            closeAction={$alertCloseActionSetting.value == "archive" ? "archive" : "read"}
            closing={closingIncidents.has(item.id)}
            on:toggle={() => rowsModel.toggleGroup(item.id)}
            on:close={() => catchErrors(() => closeIncident(item))} />
        </div>
      {:else if item.kind == "message" && item.incidentID}
        <div class="incident-member">
          <VerticalMessageListItem message={item.message} on:click />
        </div>
      {:else if item.kind == "message"}
        <VerticalMessageListItem message={item.message} columns={tableColumns} on:click />
      {/if}
    </svelte:fragment>
  </FastList>
  {/if}
</vbox>

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import type { Folder } from "../../../logic/Mail/Folder";
  import { onKeyOnList } from "../Message/MessageKeyboard";
  import { activateMailListSort, mailListSort, setMailListSort, type MailListSort } from "../LeftPane/quickFilters";
  import FastList from "../../Shared/FastList.svelte";
  import VerticalMessageListItem from "./VerticalMessageListItem.svelte";
  import MailListTopicSeparator from "./MailListTopicSeparator.svelte";
  import MailListIncidentCard from "./MailListIncidentCard.svelte";
  import AlertIncidentBar from "./AlertIncidentBar.svelte";
  import MailListHeader from "./MailListHeader.svelte";
  import {
    mailListColumnsSetting,
    mailListDividersSetting,
    mailListGridTemplate,
    mailListLayoutSetting,
    nextMailListSort,
    normalizeMailListColumnPrefs,
    normalizeMailListDividers,
    normalizeMailListLayout,
    resolveMailListLayout,
    visibleMailListColumns,
    type MailListSortColumn,
  } from "../mailListColumns";
  import { isMobile } from "../../../logic/build";
  import Button from "../../Shared/Button.svelte";
  import {
    MailListRows, findMailListRowShowingMessage, findMailListRowsShowingMessages, kPinnedGroupID, mailListRowSelectable,
    mailListRowSelectionKey, mailListRowMessages,
    type MailListIncidentMode, type MailListIncidentRow, type MailListRow,
  } from "../mailListRows";
  import {
    alertCloseActionSetting,
    alertFolderNameRulesSetting,
    alertIncidentFolderSetting,
    alertIncidentsEnabledSetting,
    alertPatterns,
    alertPatternsSetting,
    alertQuietMinutesSetting,
    alertQuietMs,
    canGroupAlertFolder,
    isAlertIncidentFolder,
    markAlertIncidentClosed,
    readAlertIncidentFolderSettings,
    updateAlertIncidentFolderSettings,
  } from "../alertIncidentSettings";
  import { markMessagesRead } from "../mailReadActions";
  import { moveMessagesToArchive } from "../mailArchiveActions";
  import { withMailTransferProgress } from "../mailTransferProgress";
  import { gt } from "../../../l10n/l10n";
  import { listVisibleMessages, listRowsInView, folderSyncing } from "../Selected";
  import Spinner from "../../Shared/Spinner.svelte";
  import { catchErrors } from "../../Util/error";
  import { ArrayColl, CollectionObserver, type Collection } from "svelte-collections";
  import { onDestroy, tick } from "svelte";
  import { get } from "svelte/store";
  import { t } from "../../../l10n/l10n";

  export let messages: Collection<EMail>;
  export let folder: Folder | null = null;
  export let selectedMessage: EMail | null;
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
  /** Ширина списка: в режиме «Авто» узкий список показывается карточками */
  let listWidth = 0;

  const rowsModel = new MailListRows();
  const listRows = rowsModel.rows;
  const incidentSummary = rowsModel.incidentSummary;
  let observedSelectedMessages: ArrayColl<EMail> | null = null;
  /** Большой выбор (карточка инцидента) заменяется без наблюдателя, см. replaceSelectedMessages */
  let replacingSelectedMessages = false;
  let closingIncidents = new Set<string>();
  let incidentRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  /** Выбор больше этого заменяем очисткой и добавлением: replaceAll сравнивает каждый с каждым */
  const kLinearReplaceThreshold = 500;
  const kIncidentRefreshDelayMs = 400;

  class SelectedMessagesObserver extends CollectionObserver<EMail> {
    added() {
      if (!replacingSelectedMessages) {
        syncRowsFromMessages(selectedMessages, listRows);
      }
    }
    removed() {
      if (!replacingSelectedMessages) {
        syncRowsFromMessages(selectedMessages, listRows);
      }
    }
  }

  const selectedMessagesObserver = new SelectedMessagesObserver();

  onDestroy(() => {
    observedSelectedMessages?.unregisterObserver(selectedMessagesObserver);
    rowsModel.dispose();
    if (incidentRefreshTimer) {
      clearTimeout(incidentRefreshTimer);
    }
  });

  /* Папка алертов: карточки инцидентов только для собственных писем папки,
   * не для результатов поиска или фильтра — иначе статусы считались бы по части писем. */
  $: alertBarFolder = folder && messages === folder.messages &&
    canGroupAlertFolder(folder, $alertIncidentsEnabledSetting.value) ? folder : null;
  $: alertFolderSetting = alertIncidentFolderSetting(folder);
  $: incidentMode = alertBarFolder && isAlertIncidentFolder(alertBarFolder, $alertFolderSetting.value,
    $alertFolderNameRulesSetting.value, $alertIncidentsEnabledSetting.value)
    ? incidentModeFor($alertFolderSetting.value, $alertQuietMinutesSetting.value, $alertPatternsSetting.value)
    : null;
  // До setSource: папка алертов сразу строится карточками, без лишней сборки обычного списка
  $: rowsModel.setIncidentMode(incidentMode);
  $: activateMailListSort(folder);
  $: rowsModel.setSource(messages, $mailListSort);
  // Прочитанность писем меняет счётчики карточек, а не состав папки
  $: scheduleIncidentRefresh(!!incidentMode, $folder?.countUnread);
  $: listVisibleMessages.set(messages);
  listRowsInView.set(listRows);
  onDestroy(() => {
    if (get(listRowsInView) === listRows) {
      listRowsInView.set(null);
    }
  });
  $: syncSelectedRow(selectedMessage, $listRows);
  $: syncSelectedMessages($selectedRows, $listRows);
  $: syncRowsFromMessages(selectedMessages, $listRows);
  $: observeSelectedMessages(selectedMessages);
  $: scrollSelectedMessageIntoView($listRows, selectedMessage, $mailListSort);
  $: columnPrefs = normalizeMailListColumnPrefs($mailListColumnsSetting.value);
  $: gridTemplate = mailListGridTemplate(columnPrefs, listWidth);
  $: dividers = normalizeMailListDividers($mailListDividersSetting.value);
  $: listLayout = resolveMailListLayout(normalizeMailListLayout($mailListLayoutSetting.value), listWidth,
    { mobile: isMobile, incidents: !!incidentMode, prefs: columnPrefs });
  $: tableColumns = listLayout == "table" ? visibleMailListColumns(columnPrefs) : null;

  function sortByColumn(column: MailListSortColumn) {
    setMailListSort(folder, nextMailListSort($mailListSort, column));
  }

  function incidentModeFor(settingsValue: unknown, quietMinutes: unknown, patterns: unknown): MailListIncidentMode {
    let settings = readAlertIncidentFolderSettings(settingsValue);
    let closed = settings.closed ?? {};
    return {
      quietMs: alertQuietMs(quietMinutes),
      activeOnly: !!settings.activeOnly,
      patterns: alertPatterns(patterns),
      closedAt: key => closed[key] ?? null,
    };
  }

  function scheduleIncidentRefresh(enabled: boolean, _unreadCount: number | undefined) {
    if (!enabled || incidentRefreshTimer) {
      return;
    }
    incidentRefreshTimer = setTimeout(() => {
      incidentRefreshTimer = null;
      rowsModel.refreshIncidents();
    }, kIncidentRefreshDelayMs);
  }

  /** Письма выбранных строк; у карточки инцидента — все письма группы. */
  function selectedMessageRows(rows: ArrayColl<MailListRow>): EMail[] {
    let result: EMail[] = [];
    let seen = new Set<EMail>();
    for (let row of rows.contents) {
      for (let message of mailListRowMessages(row)) {
        if (!seen.has(message)) {
          seen.add(message);
          result.push(message);
        }
      }
    }
    return result;
  }

  function syncRowsFromMessages(msgs: ArrayColl<EMail>, rows: Collection<MailListRow>) {
    let current = selectedMessageRows(selectedRows);
    if (arraysEqual(msgs.contents, current)) {
      return;
    }
    let emailRows = findMailListRowsShowingMessages(msgs, rows);
    selectedRows.replaceAll(emailRows);
    selectedRow = emailRows[0] ?? null;
  }

  function replaceSelectedMessages(emails: EMail[]) {
    if (emails.length + selectedMessages.length <= kLinearReplaceThreshold) {
      selectedMessages.replaceAll(emails);
      return;
    }
    // Выбранные строки уже соответствуют этим письмам: наблюдатель не нужен
    replacingSelectedMessages = true;
    try {
      selectedMessages.clear();
      selectedMessages.addAll(emails);
    } finally {
      replacingSelectedMessages = false;
    }
  }

  function showAllIncidents() {
    updateAlertIncidentFolderSettings(folder, { activeOnly: false });
  }

  async function closeIncident(row: MailListIncidentRow) {
    if (closingIncidents.has(row.id) || !folder) {
      return;
    }
    let incident = row.incident;
    let closeFolder = folder;
    closingIncidents.add(row.id);
    closingIncidents = closingIncidents;
    try {
      if ($alertCloseActionSetting.value == "archive") {
        await withMailTransferProgress(closeFolder, "move", incident.messages.length, gt`Archive`,
          update => moveMessagesToArchive(incident.messages, update));
      } else {
        await markMessagesRead(incident.messages.filter(message => !message.isRead), true);
      }
      markAlertIncidentClosed(closeFolder, incident.key);
    } finally {
      closingIncidents.delete(row.id);
      closingIncidents = closingIncidents;
    }
  }

  function observeSelectedMessages(messages: ArrayColl<EMail>) {
    if (messages === observedSelectedMessages) {
      return;
    }
    observedSelectedMessages?.unregisterObserver(selectedMessagesObserver);
    observedSelectedMessages = messages;
    messages?.registerObserver(selectedMessagesObserver);
  }
  function syncSelectedRow(message: EMail | null, rows: Collection<MailListRow>) {
    let row = findMailListRowShowingMessage(rows, message);
    if (row && row !== selectedRow) {
      selectedRow = row;
      if (!selectedRows.contains(row)) {
        selectedRows.replaceAll([row]);
      }
    }
  }

  /** Свёрнута группа с выбранным письмом: FastList перенёс бы выделение на
   * соседнюю строку, и в области чтения открылось бы письмо, которое
   * пользователь не выбирал, да ещё помечалось прочитанным. Снимаем выбор. */
  function toggleListGroup(groupID: string) {
    rowsModel.toggleGroup(groupID);
    if (selectedRows.isEmpty) {
      return;
    }
    let visible = new Set(listRows.contents.flatMap(row => mailListRowMessages(row)));
    let stillVisible = selectedRows.contents.some(row =>
      mailListRowMessages(row).some(message => visible.has(message)));
    if (!stillVisible) {
      selectedRows.clear();
    }
  }

  function syncSelectedMessages(rows: ArrayColl<MailListRow>, visibleRows: Collection<MailListRow>) {
    let emails = selectedMessageRows(rows);
    if (!arraysEqual(emails, selectedMessages.contents)) {
      replaceSelectedMessages(emails);
    }
    if (emails[0] && emails[0] !== selectedMessage) {
      selectedMessage = emails[0];
    } else if (!emails.length && selectedMessage && !findMailListRowShowingMessage(visibleRows, selectedMessage)) {
      // После удаления или смены фильтра выбранное письмо уже не входит в
      // список. Не оставляем его в нижней панели как будто оно всё ещё
      // существует в текущей папке.
      selectedMessage = null;
      selectedRow = null;
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
    let row = findMailListRowShowingMessage(rows, message);
    if (!row) {
      return;
    }
    lastScrolledMessage = message;
    lastScrolledSort = sort;
    let requestVersion = ++scrollRequestVersion;
    void tick().then(() => {
      if (requestVersion == scrollRequestVersion) {
        let currentRow = findMailListRowShowingMessage(rows, message);
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
    } else if (row?.kind == "incident" && row.incident.messages[0]) {
      // Карточка показывает последнее письмо инцидента
      selectedMessage = row.incident.messages[0];
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
    /* От цвета текста, а не рамки: в тёмной теме рамка почти сливается с фоном */
    --mail-list-divider: color-mix(in srgb, var(--main-fg) 13%, transparent);
    --mail-list-column-gap: 8px;
    --mail-list-row-padding-start: 8px;
    --mail-list-row-padding-end: 8px;
    --mail-list-table-row-height: 26px;
  }
  :global(.ui-density-extra-compact) .message-list {
    --mail-list-table-row-height: 22px;
  }
  :global(.ui-density-compact) .message-list {
    --mail-list-table-row-height: 24px;
  }
  :global(.ui-density-large) .message-list {
    --mail-list-table-row-height: 30px;
  }
  /* Тонкая полоса между письмами, как в Outlook. Тень, а не рамка:
   * высота строки не меняется, а FastList требует одинаковых строк. */
  .message-list.dividers :global(.row > *:not(.incident-member)) {
    box-shadow: inset 0 -1px 0 var(--mail-list-divider);
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
  .message-list :global(.row:not(.selected):not(:hover) .message.starred) {
    background-color: color-mix(in srgb, var(--icon-primary) 12%, var(--main-bg));
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
  .incident-member {
    box-shadow: inset 3px 0 0 color-mix(in srgb, var(--main-fg) 14%, transparent);
  }
  /* Фон вложенной строки письма закрывает тень обёртки: полоса — на самой строке */
  .message-list.dividers .incident-member :global(.message) {
    box-shadow: inset 0 -1px 0 var(--mail-list-divider);
  }
  .message-list .incident-member :global(.message) {
    padding-inline-start: 20px !important;
  }
</style>
