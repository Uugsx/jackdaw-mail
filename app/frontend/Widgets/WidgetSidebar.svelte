<hbox flex class="widget-sidebar" class:expanded={$widgetsExpanded.value} bind:this={sidebarE}>
  <vbox flex class="widget-panel" class:collapsed={!$widgetsExpanded.value} bind:this={panelE} bind:clientHeight={panelHeight}>
    <vbox class="widget-part" style:flex-grow={bottomWidget ? splitRatio : 1}>
    {#if activeWidget && $widgetsExpanded.value}
      <hbox class="widget-header">
        <hbox flex class="widget-title font-smallest" title={activeWidget.name}>{activeWidget.name}</hbox>
        {#if activeWidget.kind === "web" && activeWidget.url}
          <ButtonMenu label={$t`Panel settings`} boundaryElSel="body" placement="bottom-end">
            <WidgetWebSettingsMenu widget={activeWidget} on:edit={() => openEditDialog(activeWidget)} />
          </ButtonMenu>
          <button type="button" class="header-btn" title={$t`Sign in`}
            on:click={() => catchErrors(async () => {
              await openWidgetSignIn("widget-" + activeWidget.id, activeWidget.url, activeWidget.name);
              reloadWebWidget(activeWidget.id);
            })}>
            <LogInIcon size="14px" />
          </button>
          <button type="button" class="header-btn" title={$t`Open in browser`}
            on:click={() => catchErrors(() => openExternalURL(activeWidget.url))}>
            <ExternalLinkIcon size="14px" />
          </button>
        {:else if activeWidget.kind === "calendar"}
          <button type="button" class="header-btn" title={$t`Open calendar`}
            on:click={openCalendarApp}>
            <CalendarIcon size="14px" />
          </button>
        {:else if activeWidget.kind === "chat"}
          <button type="button" class="header-btn" title={$chatWidgetRoom ? $t`Open in chat` : $t`Open chat`}
            on:click={() => openChatWidgetInMainWindow($chatWidgetRoom)}>
            <MessageIcon size="14px" />
          </button>
        {:else if activeWidget.kind === "live-sla"}
          <button type="button" class="header-btn" title={$t`Open reports`}
            on:click={openReportsApp}>
            <ChartIcon size="14px" />
          </button>
        {/if}
        {#if !bottomWidget && splitChoices.length}
          <!-- Вторая панель снизу: например, чат сверху и контроль ответа снизу -->
          <button type="button" class="header-btn" disabled={!canSplit}
            title={canSplit ? $t`Split panel` : $t`The window is too low to split the panel`}
            aria-label={$t`Split panel`}
            on:click={() => setWidgetSplitBottom(splitChoices[0].id)}>
            <RowsIcon size="14px" />
          </button>
        {/if}
        {#if !isBuiltInWidget(activeWidget)}
          <button type="button" class="header-btn danger" title={$t`Remove widget`}
            on:click={() => removeWidget(activeWidget.id)}>
            <Trash2Icon size="14px" />
          </button>
        {/if}
      </hbox>
    {/if}
    <vbox flex class="widget-body">
      {#each widgets as widget (widget.id)}
        {#if widget.kind === "web" && widget.url}
          <vbox flex class="widget-web-slot"
            class:active={activeWidget?.id === widget.id}
            aria-hidden={activeWidget?.id !== widget.id || !$widgetsExpanded.value}>
            <WidgetWebPanel
              widgetId={widget.id}
              url={widget.url}
              title={widget.name}
              sessionID={"widget-" + widget.id}
              suspended={!$widgetsExpanded.value || activeWidget?.id !== widget.id}
              refreshMinutes={getWidgetWebSettings(widget).refreshMinutes}
              mobileVersion={getWidgetWebSettings(widget).mobileVersion}
              freezeWhenHidden={getWidgetWebSettings(widget).freezeWhenHidden} />
          </vbox>
        {/if}
      {/each}
      {#if activeWidget?.kind === "calendar" && $widgetsExpanded.value}
        <CalendarWidgetPanel />
      {:else if activeWidget?.kind === "chat" && $widgetsExpanded.value}
        <ChatWidgetPanel />
      {:else if activeWidget?.kind === "live-sla" && $widgetsExpanded.value}
        <ProFeatureGate feature="live-sla" compact={true}>
          <LiveSlaApp embedded={true} />
        </ProFeatureGate>
      {/if}
    </vbox>
    </vbox>
    {#if bottomWidget && $widgetsExpanded.value}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex a11y_no_noninteractive_element_interactions -->
      <div class="split-divider" class:dragging
        role="separator"
        aria-orientation="horizontal"
        aria-label={$t`Resize panel parts`}
        aria-valuemin={Math.round(WIDGET_SPLIT_MIN_RATIO * 100)}
        aria-valuemax={Math.round(WIDGET_SPLIT_MAX_RATIO * 100)}
        aria-valuenow={Math.round(splitRatio * 100)}
        tabindex="0"
        on:pointerdown={onDividerPointerDown}
        on:pointermove={onDividerPointerMove}
        on:pointerup={onDividerPointerUp}
        on:pointercancel={onDividerPointerUp}
        on:dblclick={() => setWidgetSplitRatio(WIDGET_SPLIT_DEFAULT_RATIO)}
        on:keydown={onDividerKeydown}></div>
      <vbox class="widget-part bottom" style:flex-grow={1 - splitRatio}>
        <hbox class="widget-header bottom-header">
          <select class="split-select font-smallest" aria-label={$t`Lower part of the panel`}
            value={bottomWidget.id}
            on:change={event => setWidgetSplitBottom(event.currentTarget.value)}>
            {#each splitChoices as choice (choice.id)}
              <option value={choice.id}>{choice.name}</option>
            {/each}
          </select>
          <hbox flex />
          <button type="button" class="header-btn" title={$t`Close lower part`} aria-label={$t`Close lower part`}
            on:click={() => setWidgetSplitBottom(null)}>
            <XIcon size="14px" />
          </button>
        </hbox>
        <vbox flex class="widget-body">
          {#key bottomWidget.id}
            <BuiltInWidgetContent kind={bottomWidget.kind} />
          {/key}
        </vbox>
      </vbox>
    {/if}
  </vbox>

  <vbox class="widget-rail">
    {#each widgets as widget (widget.id)}
      <button type="button"
        class="rail-btn"
        class:active={activeWidget?.id === widget.id && $widgetsExpanded.value}
        class:active-below={bottomWidget?.id === widget.id && $widgetsExpanded.value}
        title={widget.kind === "live-sla"
          ? liveSlaRailTitle(widget.name, liveSlaSnapshot.pendingCount)
          : widget.name}
        aria-label={widget.kind === "live-sla"
          ? liveSlaRailTitle(widget.name, liveSlaSnapshot.pendingCount)
          : widget.name}
        on:click={() => onWidgetClick(widget.id)}
        on:contextmenu={(event) => onWidgetContextMenu(event, widget)}>
        {#if widget.kind === "calendar"}
          <CalendarIcon size="16px" />
        {:else if widget.kind === "chat"}
          <span class="chat-rail-indicator" aria-hidden="true">
            <MessageIcon size="16px" />
            {#if $chatUnreadTotal}
              <span class="live-sla-badge">{$chatUnreadTotal > 99 ? "99+" : $chatUnreadTotal}</span>
            {/if}
          </span>
        {:else if widget.kind === "live-sla"}
          <span
            class="live-sla-rail-indicator"
            class:tracking={liveSlaHasPending}
            class:overdue={liveSlaHasOverdue}
            class:waiting={liveSlaIsWaiting}
            aria-hidden="true">
            <svg class="live-sla-ring" viewBox="0 0 32 32">
              <circle class="live-sla-ring-track" cx="16" cy="16" r={LIVE_SLA_RING_RADIUS} />
              {#if liveSlaHasPending && liveSlaProgress}
                <circle
                  class="live-sla-ring-value"
                  class:overdue={liveSlaHasOverdue}
                  cx="16"
                  cy="16"
                  r={LIVE_SLA_RING_RADIUS}
                  stroke-dasharray={LIVE_SLA_RING_CIRCUMFERENCE}
                  stroke-dashoffset={liveSlaRingOffset} />
              {/if}
            </svg>
            <ClockIcon size="14px" />
            {#if liveSlaHasPending}
              <span class="live-sla-badge">
                {liveSlaSnapshot.pendingCount > 99
                  ? "99+"
                  : liveSlaSnapshot.pendingCount}
              </span>
            {/if}
          </span>
        {:else}
          <span class="rail-letter" aria-hidden="true">{widgetInitial(widget.name)}</span>
        {/if}
      </button>
    {/each}
    <vbox flex class="rail-spacer" />
    <button type="button" class="rail-btn" bind:this={addAnchor} title={$t`Add website widget`}
      on:click|stopPropagation={toggleAddWidget}>
      <PlusIcon size="16px" />
    </button>
    <button type="button" class="rail-btn" title={$widgetsExpanded.value ? $t`Hide panel` : $t`Show panel`}
      on:click={toggleWidgetPanel}>
      {#if $widgetsExpanded.value}
        <PanelRightCloseIcon size="16px" />
      {:else}
        <PanelRightOpenIcon size="16px" />
      {/if}
    </button>
  </vbox>
</hbox>

{#if addAnchor}
  <Popup bind:popupOpen={addOpen} popupAnchor={addAnchor} placement="left-end" boundaryElSel="body">
    <AddWidgetDialog
      on:add={(event) => {
        addWebWidget(event.detail.name, event.detail.url);
        addOpen = false;
      }}
      on:close={() => addOpen = false} />
  </Popup>
{/if}

<ContextMenu bind:this={widgetContextMenu}>
  {#if menuWidget?.kind === "web" && menuWidget.url}
    <WidgetWebSettingsMenu widget={menuWidget} on:edit={() => openEditDialog(menuWidget!)} />
  {/if}
</ContextMenu>

{#if editWidget && sidebarE}
  <Popup bind:popupOpen={editOpen} popupAnchor={sidebarE} placement="left-end" boundaryElSel="body">
    <EditWidgetDialog
      initialName={editWidget.name}
      initialUrl={editWidget.url ?? "https://"}
      on:save={(event) => {
        updateWebWidget(editWidget!.id, event.detail.name, event.detail.url);
        editOpen = false;
      }}
      on:close={() => editOpen = false} />
  </Popup>
{/if}

<script lang="ts">
  import WidgetWebPanel from "./WidgetWebPanel.svelte";
  import WidgetWebSettingsMenu from "./WidgetWebSettingsMenu.svelte";
  import EditWidgetDialog from "./EditWidgetDialog.svelte";
  import Popup from "../Shared/Popup.svelte";
  import AddWidgetDialog from "./AddWidgetDialog.svelte";
  import CalendarWidgetPanel from "./CalendarWidgetPanel.svelte";
  import ChatWidgetPanel from "./ChatWidgetPanel.svelte";
  import BuiltInWidgetContent from "./BuiltInWidgetContent.svelte";
  import RowsIcon from "lucide-svelte/icons/rows-2";
  import XIcon from "lucide-svelte/icons/x";
  import { chatUnreadTotal } from "../Chat/chatUnread";
  import { chatWidgetRoom, openChatWidgetInMainWindow } from "./chatWidgetState";
  import MessageIcon from "lucide-svelte/icons/message-square-text";
  import LiveSlaApp from "../Reports/LiveSlaApp.svelte";
  import ProFeatureGate from "../Shared/ProFeatureGate.svelte";
  import ButtonMenu from "../Shared/Menu/ButtonMenu.svelte";
  import ContextMenu from "../Shared/Menu/ContextMenu.svelte";
  import { onMount } from "svelte";
  import {
    activeWidgetIdSetting,
    addWebWidget,
    getWidgetWebSettings,
    isBuiltInWidget,
    migrateWidgetListIfNeeded,
    normalizeWidgetList,
    removeWidget,
    reloadWebWidget,
    selectWidget,
    toggleWidgetPanel,
    updateWebWidget,
    widgetsExpanded,
    widgetsListSetting,
    widgetSplitSetting,
    setWidgetSplitBottom,
    setWidgetSplitRatio,
    fitWidgetSplitRatio,
    splittableWidgets,
    WIDGET_SPLIT_DEFAULT_RATIO,
    WIDGET_SPLIT_MIN_RATIO,
    WIDGET_SPLIT_MAX_RATIO,
    WIDGET_SPLIT_MIN_PART_PX,
    type WidgetEntry,
  } from "./widgetState";
  import PlusIcon from "lucide-svelte/icons/plus";
  import PanelRightOpenIcon from "lucide-svelte/icons/panel-right-open";
  import PanelRightCloseIcon from "lucide-svelte/icons/panel-right-close";
  import ExternalLinkIcon from "lucide-svelte/icons/external-link";
  import LogInIcon from "lucide-svelte/icons/log-in";
  import Trash2Icon from "lucide-svelte/icons/trash-2";
  import CalendarIcon from "lucide-svelte/icons/calendar";
  import ChartIcon from "lucide-svelte/icons/chart-column";
  import ClockIcon from "lucide-svelte/icons/clock-3";
  import { openExternalURL } from "../../logic/util/os-integration";
  import { openWidgetSignIn } from "../../logic/util/widgetBrowser";
  import { openApp } from "../AppsBar/selectedApp";
  import { calendarApp } from "../Calendar/CalendarJackdawApp";
  import { reportsApp } from "../Reports/ReportsJackdawApp";
  import { catchErrors } from "../Util/error";
  import { t } from "../../l10n/l10n";
  import { getResponseSlaProgress } from "../../logic/Reports/ResponseReminder";
  import {
    responseReminderLiveState,
    startResponseReminderWatcher,
  } from "../Mail/ResponseReminderWatcher";

  const LIVE_SLA_RING_RADIUS = 12;
  const LIVE_SLA_RING_CIRCUMFERENCE = 2 * Math.PI * LIVE_SLA_RING_RADIUS;
  let liveIndicatorNow = new Date();

  onMount(() => {
    migrateWidgetListIfNeeded();
    // Правая панель владеет индикатором живого SLA. Запускаем watcher и здесь,
    // чтобы индикатор не зависел от порядка монтирования фоновых mail-компонентов.
    startResponseReminderWatcher();
    const timer = setInterval(() => {
      liveIndicatorNow = new Date();
    }, 1_000);
    return () => clearInterval(timer);
  });

  $: widgets = normalizeWidgetList($widgetsListSetting.value);
  $: activeWidget = widgets.find(w => w.id === $activeWidgetIdSetting.value) ?? widgets[0] ?? null;
  $: liveSlaSnapshot = $responseReminderLiveState;
  $: liveSlaProgress = liveSlaSnapshot.nextTimer
    ? getResponseSlaProgress(
        liveSlaSnapshot.nextTimer.request,
        liveSlaSnapshot.nextTimer.targetMinutes,
        liveIndicatorNow,
        liveSlaSnapshot.nextTimer.workingHours,
        liveSlaSnapshot.nextTimer.slaStartedAt,
      )
    : null;
  $: liveSlaHasPending = liveSlaSnapshot.pendingCount > 0;
  $: liveSlaHasOverdue = liveSlaSnapshot.overdueCount > 0;
  $: liveSlaIsWaiting =
    liveSlaHasPending &&
    !liveSlaHasOverdue &&
    liveSlaSnapshot.waitingForWorkingHoursCount > 0;
  $: liveSlaRingProgress = liveSlaProgress
    ? liveSlaProgress.status === "within-target"
      ? liveSlaProgress.remainingSeconds /
        Math.max(liveSlaProgress.targetSeconds, 1)
      : liveSlaProgress.status === "waiting-for-working-hours"
        ? 1
        : 0
    : 0;
  $: liveSlaRingOffset =
    LIVE_SLA_RING_CIRCUMFERENCE *
    (1 - Math.max(0, Math.min(1, liveSlaRingProgress)));
  /** Разделение панели: вторая встроенная панель снизу. В низком окне нижняя часть
   * прячется (раскладка запоминается) и вернётся, когда места станет достаточно. */
  let panelE: HTMLElement | null = null;
  let panelHeight = 0;
  /** Доля верхней части во время перетаскивания: сохраняем в настройку по отпусканию */
  let dragRatio: number | null = null;
  let dragging = false;
  const kSplitDividerPx = 6;
  const kSplitKeyStep = 0.05;
  $: splitChoices = splittableWidgets(widgets, activeWidget?.id);
  $: canSplit = panelHeight >= 2 * WIDGET_SPLIT_MIN_PART_PX + kSplitDividerPx;
  $: bottomWidget = canSplit && $widgetSplitSetting.value?.bottomId
    ? splitChoices.find(w => w.id === $widgetSplitSetting.value.bottomId) ?? null
    : null;
  $: splitRatio = fitWidgetSplitRatio(dragRatio ?? $widgetSplitSetting.value?.ratio ?? WIDGET_SPLIT_DEFAULT_RATIO, panelHeight);

  function ratioAt(clientY: number): number {
    let rect = panelE?.getBoundingClientRect();
    if (!rect || rect.height <= 0) {
      return splitRatio;
    }
    return fitWidgetSplitRatio((clientY - rect.top) / rect.height, rect.height);
  }

  function onDividerPointerDown(event: PointerEvent) {
    if (event.button !== 0) {
      return;
    }
    try {
      (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    } catch (ex) {
      // Без захвата перетаскивание всё равно работает, пока указатель над разделителем
    }
    dragging = true;
    dragRatio = splitRatio;
    event.preventDefault();
  }

  function onDividerPointerMove(event: PointerEvent) {
    if (dragging) {
      dragRatio = ratioAt(event.clientY);
    }
  }

  function onDividerPointerUp(event: PointerEvent) {
    if (!dragging) {
      return;
    }
    try {
      (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
    } catch (ex) {
      // Захвата не было
    }
    dragging = false;
    if (dragRatio != null) {
      setWidgetSplitRatio(dragRatio);
    }
    dragRatio = null;
  }

  function onDividerKeydown(event: KeyboardEvent) {
    let next: number | null = null;
    if (event.key === "ArrowUp") {
      next = splitRatio - kSplitKeyStep;
    } else if (event.key === "ArrowDown") {
      next = splitRatio + kSplitKeyStep;
    } else if (event.key === "Home") {
      next = WIDGET_SPLIT_MIN_RATIO;
    } else if (event.key === "End") {
      next = WIDGET_SPLIT_MAX_RATIO;
    }
    if (next != null) {
      event.preventDefault();
      setWidgetSplitRatio(next);
    }
  }

  let addOpen = false;
  let addAnchor: HTMLButtonElement;
  let widgetContextMenu: ContextMenu;
  let menuWidget: WidgetEntry | null = null;
  let editOpen = false;
  let editWidget: WidgetEntry | null = null;
  let sidebarE: HTMLElement | null = null;

  function onWidgetContextMenu(event: MouseEvent, widget: WidgetEntry) {
    if (widget.kind !== "web" || !widget.url) {
      return;
    }
    menuWidget = widget;
    widgetContextMenu.onContextMenu(event);
  }

  function openEditDialog(widget: WidgetEntry) {
    editWidget = widget;
    selectWidget(widget.id);
    editOpen = true;
  }

  function onWidgetClick(id: string) {
    if (bottomWidget?.id === id && $widgetsExpanded.value) {
      // Панель уже открыта внизу: меняем части местами, а не показываем её дважды
      let previousTop = activeWidget;
      setWidgetSplitBottom(previousTop && isBuiltInWidget(previousTop) ? previousTop.id : null);
      selectWidget(id);
      return;
    }
    if (activeWidget?.id === id && $widgetsExpanded.value) {
      toggleWidgetPanel();
      return;
    }
    selectWidget(id);
  }

  function toggleAddWidget() {
    addOpen = !addOpen;
  }

  function widgetInitial(name: string): string {
    let trimmed = name.trim();
    return trimmed ? trimmed.charAt(0).toUpperCase() : "?";
  }

  function liveSlaRailTitle(name: string, count: number): string {
    return count > 0 ? `${name} · ${count}` : name;
  }

  function openCalendarApp() {
    openApp(calendarApp, {});
  }

  function openReportsApp() {
    openApp(reportsApp, {});
  }
</script>

<style>
  .widget-sidebar {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    min-inline-size: 0;
    min-height: 0;
    height: 100%;
    overflow: hidden;
    gap: 4px;
    /* Верх и низ островов совпадают с остальными панелями окна. */
    padding: 0 4px;
    background: transparent;
    color: var(--leftbar-fg);
  }
  .widget-sidebar:not(.expanded) {
    gap: 0;
    padding-inline: 0 4px;
  }
  .widget-panel {
    box-sizing: border-box;
    width: 0;
    min-width: 0;
    min-inline-size: 0;
    min-height: 0;
    flex: 1 1 auto;
    max-width: calc(100% - 48px);
    max-inline-size: calc(100% - 48px);
    overflow: hidden;
    border: 1px solid var(--glass-border-subtle);
    border-radius: var(--border-radius);
    background: var(--main-bg);
    box-shadow: none;
  }
  .widget-panel.collapsed {
    flex: 0 0 0;
    width: 0;
    min-width: 0;
    max-width: 0;
    max-inline-size: 0;
    overflow: hidden;
    pointer-events: none;
    border: 0;
    border-radius: 0;
    box-shadow: none;
  }
  .widget-panel.collapsed .widget-body {
    display: none;
  }
  .widget-panel.collapsed :global(webview),
  .widget-panel.collapsed :global(iframe) {
    display: none !important;
    visibility: hidden !important;
    width: 0 !important;
    height: 0 !important;
  }
  .widget-part {
    flex: 1 1 0;
    min-height: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .widget-part > .widget-body {
    flex: 1 1 0;
  }
  .split-divider {
    flex: 0 0 6px;
    margin-block: -1px;
    position: relative;
    z-index: 2;
    cursor: row-resize;
    touch-action: none;
    background: transparent;
    border-block: 1px solid var(--glass-border-subtle);
    transition: background-color 0.16s ease;
  }
  .split-divider::after {
    content: "";
    position: absolute;
    inset-inline: calc(50% - 16px);
    top: calc(50% - 1px);
    height: 2px;
    border-radius: 1px;
    background: color-mix(in srgb, var(--leftbar-fg) 35%, transparent);
  }
  .split-divider:hover,
  .split-divider.dragging {
    background: var(--hover-bg);
  }
  .split-divider:focus-visible {
    outline: 2px solid var(--selected-border);
    outline-offset: -2px;
  }
  .widget-header.bottom-header {
    height: 40px;
    min-height: 40px;
    padding: 6px 8px 6px 10px;
  }
  :global(.main-window.ui-density-large) .widget-header.bottom-header {
    height: 48px;
    min-height: 48px;
  }
  .split-select {
    min-width: 0;
    max-width: 100%;
    padding: 2px 4px;
    border: 1px solid transparent;
    border-radius: var(--border-radius);
    box-shadow: none;
    background: transparent;
    color: inherit;
    font-weight: 600;
  }
  .split-select:hover {
    border-color: var(--border);
  }
  .split-select:focus-visible {
    outline: 2px solid var(--selected-border);
    outline-offset: 1px;
  }
  .header-btn:disabled {
    opacity: 0.45;
  }
  .header-btn:disabled:hover {
    background: transparent;
    border-color: transparent;
  }
  .rail-btn.active-below {
    background: color-mix(in srgb, var(--selected-bg) 55%, transparent);
    color: var(--icon-primary);
  }
  .widget-header {
    box-sizing: border-box;
    align-items: center;
    gap: 4px;
    height: 56px;
    min-height: 56px;
    padding: 10px 8px 8px 16px;
    border-block-end: 1px solid var(--glass-border-subtle);
    background: var(--main-bg);
  }
  :global(.main-window.ui-density-large) .widget-header {
    height: 74px;
    min-height: 74px;
  }
  .widget-title {
    display: block;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }
  .header-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: var(--border-radius);
    background: transparent;
    color: color-mix(in srgb, var(--leftbar-fg) 78%, transparent);
    cursor: default;
  }
  .header-btn:hover {
    background: var(--hover-bg);
    color: var(--hover-fg);
    border-color: var(--border);
  }
  .header-btn.danger:hover {
    color: var(--danger-fg);
  }
  .widget-body {
    position: relative;
    width: 100%;
    min-width: 0;
    min-inline-size: 0;
    max-width: 100%;
    max-inline-size: 100%;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .widget-web-slot {
    position: absolute;
    inset: 0;
    display: none;
    flex-direction: column;
    z-index: 0;
  }
  .widget-web-slot.active {
    display: flex;
    z-index: 1;
  }
  .widget-panel:not(.collapsed) .widget-web-slot.active :global(webview),
  .widget-panel:not(.collapsed) .widget-web-slot.active :global(iframe) {
    display: flex !important;
    visibility: visible !important;
    width: 100% !important;
    height: 100% !important;
  }
  .widget-body :global(webview),
  .widget-body :global(iframe) {
    width: 100%;
    height: 100%;
    border: none;
  }
  .widget-rail {
    box-sizing: border-box;
    width: 44px;
    min-width: 44px;
    align-items: center;
    gap: 4px;
    padding-block: 8px 10px;
    border: 1px solid var(--glass-border-subtle);
    border-radius: var(--border-radius);
    background: var(--main-bg);
  }
  .rail-spacer {
    min-height: 8px;
  }
  .rail-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: var(--border-radius);
    background: transparent;
    color: color-mix(in srgb, var(--appbar-fg) 78%, transparent);
    cursor: default;
    transition:
      background-color 0.16s ease,
      border-color 0.16s ease,
      color 0.16s ease,
      transform 0.16s ease-out;
  }
  .rail-btn:hover {
    background: var(--glass-hover-bg);
    color: var(--appbar-fg);
  }
  .rail-btn:active {
    transform: translateY(0) scale(0.96);
  }
  @media (prefers-reduced-motion: reduce) {
    .rail-btn {
      transition: background-color 0.16s ease, border-color 0.16s ease, color 0.16s ease;
    }
    .rail-btn:hover,
    .rail-btn:active {
      transform: none;
    }
  }
  .rail-btn.active {
    background: var(--selected-bg);
    color: var(--icon-primary);
  }
  .rail-letter {
    font-size: 12px;
    font-weight: 700;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }
  .chat-rail-indicator {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
  }
  .live-sla-rail-indicator {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
  }
  .live-sla-ring {
    position: absolute;
    inset: 0;
    width: 26px;
    height: 26px;
    overflow: visible;
    transform: rotate(-90deg);
  }
  .live-sla-ring-track,
  .live-sla-ring-value {
    fill: none;
    stroke-width: 2;
  }
  .live-sla-ring-track {
    stroke: color-mix(in srgb, var(--appbar-fg) 24%, transparent);
  }
  .live-sla-ring-value {
    stroke: var(--icon-primary);
    stroke-linecap: round;
    transition: stroke-dashoffset 1s linear, stroke 0.16s ease;
  }
  .live-sla-ring-value.overdue {
    stroke: var(--danger-fg);
  }
  .live-sla-badge {
    position: absolute;
    top: -4px;
    right: -7px;
    min-width: 15px;
    height: 15px;
    padding: 0 3px;
    box-sizing: border-box;
    border-radius: var(--border-radius);
    background: var(--icon-primary);
    color: var(--appbar-bg);
    font-size: 10px;
    font-weight: 600;
    line-height: 15px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .live-sla-rail-indicator.overdue .live-sla-badge {
    background: var(--danger-fg);
  }
  @media (prefers-reduced-motion: reduce) {
    .live-sla-ring-value {
      transition: stroke 0.16s ease;
    }
  }
</style>
