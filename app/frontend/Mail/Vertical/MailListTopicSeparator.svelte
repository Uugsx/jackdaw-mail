<button type="button" class="mail-list-topic-separator"
  aria-expanded={!collapsed}
  aria-label={`${prefix}: ${displayLabel} (${countLabel})`}
  on:click|stopPropagation={() => dispatch("toggle")}
  >
  <span class="chevron" class:collapsed>
    <ChevronDownIcon size="15px" strokeWidth={2} aria-hidden="true" />
  </span>
  <span class="label">
    <span class="prefix">{prefix}:</span> {displayLabel}
  </span>
  <span class="count">({countLabel})</span>
</button>

<script lang="ts">
  import ChevronDownIcon from "lucide-svelte/icons/chevron-down";
  import { createEventDispatcher } from "svelte";
  import { t } from "../../../l10n/l10n";

  export let prefix: string;
  export let label: string;
  export let count: number;
  export let collapsed = false;

  const dispatch = createEventDispatcher<{ toggle: void }>();
  $: displayLabel = label || $t`No subject`;
  $: countLabel = $t`${count} entries`;
</script>

<style>
  .mail-list-topic-separator {
    display: flex;
    width: 100%;
    min-width: 0;
    height: var(--fast-list-row-height, 2.75rem);
    min-height: var(--fast-list-row-height, 2.75rem);
    box-sizing: border-box;
    align-items: center;
    gap: 4px;
    padding: 4px 12px 4px 10px !important;
    border: none;
    border-block: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
    background-color: color-mix(in srgb, var(--main-fg) 6%, var(--main-bg));
    color: color-mix(in srgb, var(--main-fg) 68%, transparent);
    font: inherit;
    text-align: start;
    cursor: pointer;
    user-select: none;
    overflow: hidden;
  }
  .mail-list-topic-separator:hover,
  .mail-list-topic-separator:focus-visible {
    background-color: color-mix(in srgb, var(--main-fg) 12%, var(--main-bg));
    color: var(--main-fg);
    outline: none;
  }
  .chevron {
    display: inline-flex;
    flex: 0 0 20px;
    width: 20px;
    min-width: 20px;
    height: 20px;
    align-items: center;
    justify-content: center;
    transition: transform 0.16s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .chevron :global(svg) {
    flex: 0 0 15px;
  }
  .chevron.collapsed {
    transform: rotate(-90deg);
  }
  .label {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--msg-list-fs, 13px);
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .prefix {
    font-weight: 500;
  }
  .count {
    flex: 0 0 auto;
    font-size: var(--msg-list-fs-sm, 12px);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
</style>
