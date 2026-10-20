<hbox class="island specific" class:large class:border class:faint>
  <slot />
</hbox>

<script lang="ts">
  /**
   * Shows a number of buttons, which switch between multiple different views or modes.
   * Displays a rounded border around them, and each button is round as well.
   * Technically, these are radio buttons, because only 1 of them is active at any time.
   */

  export let large = false;
  export let border = true;
  /** Show the selected button not in a strong color */
  export let faint = true;
</script>

<style>
  /* Сегменты внутри общей рамки: рамка скругляет края, сами кнопки прямые,
   * поэтому выбранный сегмент не вылезает за скругление. */
  .island.border {
    border: 1px solid var(--border);
    border-radius: var(--border-radius);
    overflow: hidden;
  }
  /* В узкой колонке крупный переключатель переносится, а не обрезается. */
  .island.large {
    flex-wrap: wrap;
  }
  .island.island :global(button) {
    border-radius: 0;
  }
  .island.island :global(button:not(:last-of-type)) {
    margin-inline-end: 0;
  }
  .island.faint :global(button.selected:not(.hover)) {
    background-color: var(--offset-bg);
    color: var(--offset-fg);
    border: none;
  }
  .island.specific :global(button:not(.selected)) {
    background-color: transparent;
    border: none;
  }
  .island :global(button:hover) {
    z-index: 1;
  }
  .island {
    max-width: 100%;
    min-width: 0;
  }
  /* В узкой панели сжимается только кнопка с подписью: подпись получает
     многоточие (и подсказку), а кнопки-иконки сохраняют размер. */
  .island :global(button:has(.label)) {
    min-width: 0;
  }
  .island :global(button .label) {
    display: block;
    min-width: 0;
    margin-inline-end: 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .island :global(svg) {
    fill: transparent;
    stroke-width: 1.2px;
  }
  @media (max-width: 800px)  {
    .island.large {
      flex-direction: column;
      align-items: start;
      justify-content: stretch;
    }
  }
  </style>
