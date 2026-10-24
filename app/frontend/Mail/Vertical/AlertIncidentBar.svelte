<!-- Над списком папки алертов: фильтр «только активные» и выключение группировки.
  В обычной папке — только предложение сгруппировать, если письма похожи на алерты. -->
{#if incidentMode}
  <hbox class="alert-incident-bar font-small" role="toolbar" aria-label={$t`Alert incidents`}>
    <SirenIcon size="15px" strokeWidth={2} aria-hidden="true" />
    <hbox class="summary" title={summaryText}>{summaryText}</hbox>
    <hbox flex />
    <hbox class="segmented" role="group" aria-label={$t`Show incidents`}>
      <button type="button" class:active={!activeOnly} aria-pressed={!activeOnly}
        on:click={() => setActiveOnly(false)}>{$t`All`}</button>
      <button type="button" class:active={activeOnly} aria-pressed={activeOnly}
        on:click={() => setActiveOnly(true)}>{$t`Active only`}</button>
    </hbox>
    <button type="button" class="text-button" title={$t`Show alerts as a plain list`}
      on:click={disableGrouping}>
      <ListIcon size="15px" strokeWidth={2} aria-hidden="true" />
      <span>{$t`Plain list`}</span>
    </button>
  </hbox>
{:else if suggestion}
  <hbox class="alert-incident-bar suggestion font-small" role="status">
    <SirenIcon size="15px" strokeWidth={2} aria-hidden="true" />
    <hbox class="summary" title={suggestionText}>{suggestionText}</hbox>
    <hbox flex />
    <button type="button" class="primary" on:click={enableGrouping}>{$t`Group into incidents`}</button>
    <button type="button" class="icon-button" title={$t`Do not suggest for this folder`}
      aria-label={$t`Do not suggest for this folder`}
      on:click={dismissSuggestion}>
      <XIcon size="15px" strokeWidth={2} aria-hidden="true" />
    </button>
  </hbox>
{/if}

<script lang="ts">
  import type { Folder } from "../../../logic/Mail/Folder";
  import type { EMail } from "../../../logic/Mail/EMail";
  import type { MailListIncidentSummary } from "../mailListRows";
  import { suggestAlertFolder, type AlertFolderSuggestion } from "../../../logic/Mail/AlertIncident";
  import {
    alertIncidentFolderSetting,
    alertPatterns,
    alertPatternsSetting,
    readAlertIncidentFolderSettings,
    updateAlertIncidentFolderSettings,
  } from "../alertIncidentSettings";
  import SirenIcon from "lucide-svelte/icons/siren";
  import ListIcon from "lucide-svelte/icons/list";
  import XIcon from "lucide-svelte/icons/x";
  import type { Collection } from "svelte-collections";
  import { onDestroy } from "svelte";
  import { t, plural } from "../../../l10n/l10n";

  export let folder: Folder;
  export let incidentMode = false;
  export let summary: MailListIncidentSummary | null = null;
  export let messages: Collection<EMail>;

  /** Папка дописывается из базы кусками: проверяем, когда загрузка успокоится */
  const kSuggestionDelayMs = 1500;
  let suggestion: AlertFolderSuggestion | null = null;
  let suggestionTimer: ReturnType<typeof setTimeout> | null = null;

  $: folderSetting = alertIncidentFolderSetting(folder);
  $: settings = readAlertIncidentFolderSettings($folderSetting.value);
  $: activeOnly = !!settings.activeOnly;
  $: canSuggest = !incidentMode && settings.enabled !== false && !settings.suggestionDismissed;
  $: scheduleSuggestion(canSuggest, $messages?.length ?? 0);
  $: summaryText = summary
    ? $t`${$plural(summary.total, { one: "# incident", other: "# incidents" })}, ${summary.active} active`
    : "";
  $: suggestionText = suggestion
    ? $t`Looks like an alert folder: ${$plural(suggestion.count, { one: "# message", other: "# messages" })} like “${suggestion.label}”`
    : "";

  onDestroy(clearSuggestionTimer);

  function clearSuggestionTimer() {
    if (suggestionTimer) {
      clearTimeout(suggestionTimer);
      suggestionTimer = null;
    }
  }

  function scheduleSuggestion(enabled: boolean, _length: number) {
    clearSuggestionTimer();
    if (!enabled) {
      suggestion = null;
      return;
    }
    suggestionTimer = setTimeout(() => {
      suggestionTimer = null;
      suggestion = suggestAlertFolder(messages.contents, { patterns: alertPatterns($alertPatternsSetting.value) });
    }, kSuggestionDelayMs);
  }

  function setActiveOnly(value: boolean) {
    updateAlertIncidentFolderSettings(folder, { activeOnly: value });
  }

  function enableGrouping() {
    updateAlertIncidentFolderSettings(folder, { enabled: true });
  }

  function disableGrouping() {
    updateAlertIncidentFolderSettings(folder, { enabled: false });
  }

  function dismissSuggestion() {
    suggestion = null;
    updateAlertIncidentFolderSettings(folder, { suggestionDismissed: true });
  }
</script>

<style>
  .alert-incident-bar {
    flex: 0 0 auto;
    align-items: center;
    gap: 8px;
    min-height: 36px;
    padding: 4px 8px 4px 14px;
    box-sizing: border-box;
    border-block-end: 1px solid var(--border);
    background-color: color-mix(in srgb, var(--main-fg) 4%, var(--main-bg));
    color: var(--main-fg);
  }
  .alert-incident-bar.suggestion {
    background-color: color-mix(in srgb, var(--icon-primary) 10%, var(--main-bg));
  }
  .alert-incident-bar > :global(svg) {
    flex: 0 0 auto;
    color: var(--icon-primary);
  }
  .summary {
    display: block;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  button {
    flex: 0 0 auto;
    font: inherit;
    color: inherit;
    cursor: pointer;
    white-space: nowrap;
  }
  button:focus-visible {
    outline: 2px solid var(--icon-primary);
    outline-offset: 1px;
  }
  .segmented {
    flex: 0 0 auto;
    padding: 2px;
    border-radius: 6px;
    background-color: color-mix(in srgb, var(--main-fg) 8%, transparent);
  }
  .segmented button {
    padding: 2px 10px;
    border: none;
    border-radius: 4px;
    background: none;
    color: color-mix(in srgb, var(--main-fg) 72%, transparent);
  }
  .segmented button.active {
    background-color: var(--main-bg);
    color: var(--main-fg);
    font-weight: 600;
    box-shadow: 0 1px 2px rgba(var(--shadow-color), 0.16);
  }
  .icon-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: none;
    border-radius: 4px;
    background: none;
  }
  .text-button {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 26px;
    padding: 0 8px;
    border: none;
    border-radius: 4px;
    background: none;
  }
  .icon-button:hover,
  .text-button:hover,
  .segmented button:not(.active):hover {
    background-color: color-mix(in srgb, var(--main-fg) 10%, transparent);
  }
  .primary {
    padding: 3px 10px;
    border: 1px solid color-mix(in srgb, var(--icon-primary) 60%, transparent);
    border-radius: 6px;
    background-color: var(--main-bg);
    font-weight: 600;
  }
  .primary:hover {
    background-color: color-mix(in srgb, var(--icon-primary) 16%, var(--main-bg));
  }
  @container mail-message-list (max-width: 420px) {
    .summary {
      display: none;
    }
  }
</style>
