<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import ArrowDownIcon from "lucide-svelte/icons/arrow-down";
  import ArrowUpDownIcon from "lucide-svelte/icons/arrow-up-down";
  import ArrowUpIcon from "lucide-svelte/icons/arrow-up";
  import { t } from "../../l10n/l10n";

  export let label: string;
  export let direction: "asc" | "desc" | null = null;
  export let align: "left" | "right" = "left";
  /** Вне таблицы (нет aria-sort у заголовка) направление озвучивается в имени кнопки. */
  export let announceDirection = false;

  const dispatch = createEventDispatcher<{ sort: void }>();

  // Подпись может обрезаться в узкой панели, поэтому полное название
  // и направление сортировки всегда доступны в подсказке.
  $: directionLabel =
    direction == "asc"
      ? $t`sorted ascending`
      : direction == "desc"
        ? $t`sorted descending`
        : $t`not sorted`;
  $: fullLabel = `${label} — ${directionLabel}`;
</script>

<button
  type="button"
  class="table-sort-button"
  class:is-active={direction != null}
  class:align-right={align == "right"}
  title={fullLabel}
  aria-label={announceDirection ? fullLabel : undefined}
  on:click={() => dispatch("sort")}
>
  <span>{label}</span>
  <span class="sort-indicator" aria-hidden="true">
    {#if direction == "asc"}
      <ArrowUpIcon size="12px" strokeWidth={2.4} />
    {:else if direction == "desc"}
      <ArrowDownIcon size="12px" strokeWidth={2.4} />
    {:else}
      <ArrowUpDownIcon size="12px" strokeWidth={2.1} />
    {/if}
  </span>
</button>

<style>
  .table-sort-button {
    display: inline-flex;
    width: 100%;
    box-sizing: border-box;
    min-width: 0;
    min-height: 28px;
    align-items: center;
    justify-content: flex-start;
    gap: 5px;
    margin: -4px 0;
    padding: 4px 6px;
    border: 1px solid transparent;
    border-radius: 5px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font: inherit;
    letter-spacing: inherit;
    line-height: 1.2;
    text-align: inherit;
    text-transform: inherit;
    white-space: normal;
    text-wrap: balance;
  }

  .table-sort-button > span:first-child {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    overflow-wrap: normal;
    word-break: keep-all;
    hyphens: none;
    text-wrap: balance;
  }

  .table-sort-button.align-right {
    justify-content: flex-end;
  }

  .table-sort-button:hover,
  .table-sort-button:focus-visible {
    border-color: color-mix(in srgb, var(--reports-accent) 42%, var(--border));
    background: color-mix(in srgb, var(--reports-accent) 9%, transparent);
    color: var(--main-fg);
  }

  .table-sort-button:focus-visible {
    outline: 2px solid var(--reports-accent);
    outline-offset: 1px;
  }

  .sort-indicator {
    display: inline-flex;
    flex: 0 0 auto;
    color: color-mix(in srgb, currentColor 70%, transparent);
  }

  .table-sort-button.is-active .sort-indicator {
    color: var(--reports-accent);
  }
</style>
