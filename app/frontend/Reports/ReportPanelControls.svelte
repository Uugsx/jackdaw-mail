<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import ChevronDownIcon from "lucide-svelte/icons/chevron-down";
  import ChevronUpIcon from "lucide-svelte/icons/chevron-up";
  import GripIcon from "lucide-svelte/icons/grip-vertical";
  import MaximizeIcon from "lucide-svelte/icons/maximize-2";
  import { t } from "../../l10n/l10n";
  import type {
    ReportDashboardSectionId,
    ReportDashboardWidth,
  } from "../../logic/Reports/ReportsPresentation";

  export let sectionId: ReportDashboardSectionId;
  export let sectionLabel: string;
  export let width: ReportDashboardWidth;
  export let tall: boolean;

  const dispatch = createEventDispatcher<{
    move: "up" | "down";
    width: ReportDashboardWidth;
    height: boolean;
  }>();

  function onWidthChange(event: Event): void {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (
      value === "third" ||
      value === "half" ||
      value === "two-thirds" ||
      value === "full"
    ) {
      dispatch("width", value);
    }
  }
</script>

<div
  class="panel-layout-toolbar"
  data-section={sectionId}
  aria-label={$t`Block layout controls`}
>
  <span class="drag-handle" title={$t`Drag to move the block`} aria-hidden="true">
    <GripIcon size="14px" />
  </span>
  <span class="layout-label">{sectionLabel}</span>
  <button
    type="button"
    class="layout-button"
    title={$t`Move block up`}
    aria-label={`${$t`Move block up`}: ${sectionLabel}`}
    on:click={() => dispatch("move", "up")}
  >
    <ChevronUpIcon size="14px" />
  </button>
  <button
    type="button"
    class="layout-button"
    title={$t`Move block down`}
    aria-label={`${$t`Move block down`}: ${sectionLabel}`}
    on:click={() => dispatch("move", "down")}
  >
    <ChevronDownIcon size="14px" />
  </button>
  <label class="width-control">
    <span>{$t`Width`}</span>
    <select value={width} aria-label={$t`Block width`} on:change={onWidthChange}>
      <option value="third">1/3</option>
      <option value="half">1/2</option>
      <option value="two-thirds">2/3</option>
      <option value="full">100%</option>
    </select>
  </label>
  <button
    type="button"
    class="layout-button height-button"
    class:active={tall}
    title={$t`Toggle block height`}
    aria-label={`${$t`Toggle block height`}: ${sectionLabel}`}
    aria-pressed={tall}
    on:click={() => dispatch("height", !tall)}
  >
    <MaximizeIcon size="14px" />
    <span>{tall ? $t`Tall` : $t`Normal`}</span>
  </button>
</div>

<style>
  .panel-layout-toolbar {
    display: flex;
    align-items: center;
    gap: 5px;
    min-height: 30px;
    margin-bottom: 6px;
    padding: 0 5px;
    border: 1px dashed color-mix(in srgb, var(--reports-accent) 38%, var(--border));
    border-radius: var(--border-radius);
    background: color-mix(in srgb, var(--reports-accent) 6%, var(--main-bg));
    color: color-mix(in srgb, var(--main-fg) 64%, transparent);
    font-size: 12px;
  }

  .drag-handle {
    display: inline-flex;
    align-items: center;
    color: var(--reports-accent);
    cursor: grab;
  }

  .drag-handle:active {
    cursor: grabbing;
  }

  .layout-label {
    min-width: 0;
    margin-right: auto;
    overflow: hidden;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .layout-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    min-width: 26px;
    min-height: 25px;
    border: 1px solid transparent;
    border-radius: 6px;
    padding: 3px 5px;
    background: transparent;
    color: inherit;
  }

  .layout-button:hover:not(:disabled),
  .layout-button.active {
    border-color: color-mix(in srgb, var(--reports-accent) 48%, var(--border));
    background: color-mix(in srgb, var(--reports-accent) 12%, transparent);
    color: var(--main-fg);
  }

  .layout-button:focus-visible,
  .width-control select:focus-visible {
    outline: 2px solid var(--reports-accent);
    outline-offset: 1px;
  }

  .width-control {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: color-mix(in srgb, var(--main-fg) 64%, transparent);
    font-size: 12px;
    font-weight: 600;
  }

  .width-control select {
    min-height: 25px;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 2px 4px;
    background: var(--input-bg);
    color: var(--input-fg);
    font: inherit;
  }

  @media (max-width: 560px) {
    .layout-label,
    .width-control > span,
    .height-button span {
      display: none;
    }

    .height-button {
      min-width: 26px;
    }
  }
</style>
