<!-- Карточка инцидента в папке алертов. Высота как у строки письма: FastList
  требует одинаковой высоты строк, а карточка может оказаться первой измеряемой. -->
<vbox class="message incident-card status-{incident.status}"
  class:unread={incident.unreadCount > 0}
  class:expanded
  title={tooltip}
  >
  <hbox class="top-row">
    <button type="button" class="expand plain-button"
      aria-expanded={expanded}
      aria-label={expanded ? $t`Hide alert messages` : $t`Show alert messages`}
      title={expanded ? $t`Hide alert messages` : $t`Show alert messages`}
      on:click|stopPropagation={() => dispatch("toggle")}
      on:dblclick|stopPropagation
      >
      <span class="chevron" class:collapsed={!expanded}>
        <ChevronDownIcon size="14px" strokeWidth={2} aria-hidden="true" />
      </span>
    </button>
    <hbox class="status font-smallest" title={statusHint}>
      <span class="status-dot" aria-hidden="true"></span>
      <span class="status-label">{statusLabel}</span>
    </hbox>
    <hbox class="label font-small">{incident.label || $t`No subject`}</hbox>
    <hbox flex />
    <hbox class="count font-smallest" title={countHint}>×{incident.firingCount}</hbox>
    <hbox class="date font-smallest">{lastLabel}</hbox>
  </hbox>
  <hbox class="bottom-row">
    <hbox class="sender font-smallest">{incident.senderLabel}</hbox>
    {#if firstLabel}
      <hbox class="range font-smallest">{$t`first ${firstLabel}`}</hbox>
    {/if}
    {#if incident.unreadCount > 0}
      <hbox class="unread-count font-smallest">{$plural(incident.unreadCount, { one: "# unread", other: "# unread" })}</hbox>
    {/if}
    <hbox flex />
    {#if canClose}
      <button type="button" class="close plain-button font-smallest"
        title={closeHint}
        aria-label={closeHint}
        disabled={closing}
        on:click|stopPropagation={() => dispatch("close")}
        on:dblclick|stopPropagation
        >
        <CheckCheckIcon size="14px" strokeWidth={2} aria-hidden="true" />
        <span class="close-label">{$t`Close incident`}</span>
      </button>
    {/if}
  </hbox>
</vbox>

<script lang="ts">
  import type { AlertIncident } from "../../../logic/Mail/AlertIncident";
  import ChevronDownIcon from "lucide-svelte/icons/chevron-down";
  import CheckCheckIcon from "lucide-svelte/icons/check-check";
  import { createEventDispatcher } from "svelte";
  import { getDateTimeString } from "../../Util/date";
  import { t, plural } from "../../../l10n/l10n";

  export let incident: AlertIncident;
  export let expanded = false;
  export let closeAction: "read" | "archive" = "read";
  export let closing = false;

  const dispatch = createEventDispatcher<{ toggle: void; close: void }>();

  $: statusLabel = {
    active: $t`Ongoing`,
    resumed: $t`Started again`,
    quiet: $t`Quiet`,
    resolved: $t`Resolved`,
    closed: $t`Closed`,
  }[incident.status];
  $: statusHint = {
    active: $t`Alerts keep arriving`,
    resumed: $t`Alerts started again after a quiet period, resolution or closing`,
    quiet: $t`No new alerts for a while`,
    resolved: $t`A resolved or OK message arrived after the last alert`,
    closed: $t`You closed this incident, no new alerts since`,
  }[incident.status];
  $: lastLabel = incident.lastAt ? getDateTimeString(incident.lastAt) : "";
  $: firstLabel = incident.firstAt && incident.firingCount > 1 ? getDateTimeString(incident.firstAt) : "";
  $: countHint = $plural(incident.firingCount, { one: "# alert", other: "# alerts" });
  $: canClose = closeAction == "archive"
    ? incident.messages.length > 0
    : incident.unreadCount > 0 || incident.status == "active" || incident.status == "resumed";
  $: closeHint = closeAction == "archive"
    ? $t`Close incident: archive all its messages`
    : $t`Close incident: mark all its messages as read`;
  $: tooltip = [
    incident.label,
    `${statusLabel} · ${countHint}`,
    incident.firstAt ? $t`First: ${getDateTimeString(incident.firstAt)}` : "",
    incident.lastAt ? $t`Last: ${getDateTimeString(incident.lastAt)}` : "",
  ].filter(Boolean).join("\n");
</script>

<style>
  /* Отступы и высоты рядов совпадают с VerticalMessageListItem */
  .incident-card {
    --incident-status: color-mix(in srgb, var(--main-fg) 55%, transparent);
    padding: 4px 12px 4px 8px !important;
    justify-content: baseline;
    align-items: baseline;
    position: relative;
  }
  :global(.mobile) .incident-card {
    padding: 8px 12px 8px 12px !important;
  }
  .incident-card::before {
    position: absolute;
    inset-block: 18%;
    inset-inline-start: 0;
    content: "";
    border-inline-start: 3px solid var(--incident-status);
    border-radius: 2px;
  }
  .status-active,
  .status-resumed {
    --incident-status: var(--danger-fg);
  }
  .status-quiet {
    --incident-status: var(--warning-fg);
  }
  .status-resolved {
    --incident-status: var(--success-fg);
  }
  .status-closed {
    --incident-status: var(--info-fg);
  }
  .top-row,
  .bottom-row {
    width: 100%;
    box-sizing: border-box;
    min-width: 0;
    overflow: hidden;
    align-items: center;
    gap: 6px;
  }
  .top-row {
    height: 1.5em;
  }
  .bottom-row {
    height: 1.3em;
    padding-inline-start: 22px;
    color: color-mix(in srgb, var(--main-fg) 68%, transparent);
  }
  .plain-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
    border-radius: 4px;
  }
  .plain-button:focus-visible {
    outline: 2px solid var(--icon-primary);
    outline-offset: 1px;
  }
  .expand {
    flex: 0 0 16px;
    width: 16px;
    height: 16px;
  }
  .chevron {
    display: inline-flex;
    transition: transform 0.16s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .chevron.collapsed {
    transform: rotate(-90deg);
  }
  .status {
    flex: 0 0 auto;
    align-items: center;
    gap: 4px;
    color: var(--incident-status);
    font-weight: 600;
    white-space: nowrap;
  }
  .status-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background-color: var(--incident-status);
  }
  .status-active .status-dot,
  .status-resumed .status-dot {
    animation: incident-pulse 1.8s ease-in-out infinite;
  }
  @keyframes incident-pulse {
    50% { opacity: 0.35; }
  }
  @media (prefers-reduced-motion: reduce) {
    .status-dot {
      animation: none !important;
    }
    .chevron {
      transition: none;
    }
  }
  .label {
    display: block;
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
    font-size: var(--msg-list-fs, inherit);
  }
  .unread .label {
    font-weight: 700;
  }
  .count {
    flex: 0 0 auto;
    padding: 0 6px;
    border-radius: 999px;
    background-color: color-mix(in srgb, var(--incident-status) 14%, transparent);
    color: var(--incident-status);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .date {
    flex: 0 0 auto;
    font-size: var(--msg-list-fs-sm, 12px);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .sender,
  .range,
  .unread-count {
    display: block;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sender {
    flex: 0 1 auto;
  }
  .range,
  .unread-count {
    flex: 0 1 auto;
    font-variant-numeric: tabular-nums;
  }
  .range::before,
  .unread-count::before {
    content: "·";
    margin-inline-end: 6px;
    opacity: 0.6;
  }
  .unread-count {
    color: var(--main-fg);
    font-weight: 600;
  }
  .close {
    flex: 0 0 auto;
    padding: 0 6px;
    height: 100%;
    color: color-mix(in srgb, var(--main-fg) 72%, transparent);
    white-space: nowrap;
  }
  .close:hover:not(:disabled),
  .close:focus-visible {
    color: var(--main-fg);
    background-color: color-mix(in srgb, var(--main-fg) 10%, transparent);
  }
  .close:disabled {
    opacity: 0.5;
    cursor: progress;
  }
  :global(.row.selected) .incident-card .bottom-row,
  :global(.row.selected) .incident-card .close,
  :global(.row.selected) .incident-card .status,
  :global(.row.selected) .incident-card .count {
    color: inherit;
  }
  :global(.row.selected) .incident-card .status-dot {
    background-color: currentColor;
  }
  /* Узкий список: подпись кнопки прячем, остаётся значок с подсказкой */
  @container mail-message-list (max-width: 420px) {
    .close-label,
    .range {
      display: none;
    }
  }
</style>
