<hbox flex class="widget-sidebar" class:expanded={$widgetsExpanded.value} bind:this={sidebarE}>
  <vbox flex class="widget-panel" class:collapsed={!$widgetsExpanded.value}>
    {#if activeWidget && $widgetsExpanded.value}
      <hbox class="widget-header">
        <hbox flex class="widget-title font-smallest">{activeWidget.name}</hbox>
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
        {:else if activeWidget.kind === "live-sla"}
          <button type="button" class="header-btn" title={$t`Open reports`}
            on:click={openReportsApp}>
            <ChartIcon size="14px" />
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
      {:else if activeWidget?.kind === "live-sla" && $widgetsExpanded.value}
        <LiveSlaApp embedded={true} />
      {/if}
    </vbox>
  </vbox>

  <vbox class="widget-rail">
    {#each widgets as widget (widget.id)}
      <button type="button"
        class="rail-btn"
        class:active={activeWidget?.id === widget.id && $widgetsExpanded.value}
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
  import LiveSlaApp from "../Reports/LiveSlaApp.svelte";
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
    gap: 8px;
    padding: 8px;
    background: var(--leftbar-bg);
    color: var(--leftbar-fg);
  }
  .widget-sidebar:not(.expanded) {
    gap: 0;
    padding-inline: 0;
  }
  .widget-panel {
    box-sizing: border-box;
    width: 0;
    min-width: 0;
    min-inline-size: 0;
    min-height: 0;
    flex: 1 1 auto;
    max-width: calc(100% - 52px);
    max-inline-size: calc(100% - 52px);
    overflow: hidden;
    border-inline: 0;
    border-block: 0;
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
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 650;
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
  .widget-empty {
    align-items: center;
    justify-content: center;
    padding: 20px 16px;
    text-align: center;
    color: color-mix(in srgb, var(--leftbar-fg) 68%, transparent);
  }
  .widget-rail {
    box-sizing: border-box;
    width: 44px;
    min-width: 44px;
    align-items: center;
    gap: 4px;
    padding-block: 8px 10px;
    border: 0;
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
      transform 0.18s cubic-bezier(0.34, 1.35, 0.64, 1);
  }
  .rail-btn:hover {
    background: var(--glass-hover-bg);
    color: var(--appbar-fg);
    border-color: var(--glass-border-subtle);
    transform: translateY(-1px);
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
    background: color-mix(in srgb, var(--icon-primary) 14%, transparent);
    color: var(--icon-primary);
    border-color: color-mix(in srgb, var(--icon-primary) 28%, transparent);
  }
  .rail-letter {
    font-size: 12px;
    font-weight: 700;
    line-height: 1;
    font-variant-numeric: tabular-nums;
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
  .live-sla-rail-indicator.tracking::after {
    content: "";
    position: absolute;
    inset: -2px;
    border: 1px solid color-mix(in srgb, var(--icon-primary) 36%, transparent);
    border-radius: 50%;
    animation: live-sla-pulse 1.8s ease-in-out infinite;
    pointer-events: none;
  }
  .live-sla-rail-indicator.overdue::after {
    border-color: color-mix(in srgb, var(--danger-fg) 48%, transparent);
  }
  .live-sla-badge {
    position: absolute;
    top: -4px;
    right: -7px;
    min-width: 13px;
    height: 13px;
    padding: 0 2px;
    box-sizing: border-box;
    border-radius: 7px;
    background: var(--icon-primary);
    color: var(--appbar-bg);
    font-size: 8px;
    font-weight: 800;
    line-height: 13px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .live-sla-rail-indicator.overdue .live-sla-badge {
    background: var(--danger-fg);
  }
  @keyframes live-sla-pulse {
    0%,
    100% {
      opacity: 0.55;
      transform: scale(0.94);
    }
    50% {
      opacity: 1;
      transform: scale(1);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .live-sla-ring-value {
      transition: stroke 0.16s ease;
    }
    .live-sla-rail-indicator.tracking::after {
      animation: none;
      opacity: 0.8;
    }
  }
</style>
