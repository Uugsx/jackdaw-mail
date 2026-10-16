<button
  type="button"
  class="sub-app-button"
  class:selected
  class:minimized
  class:compact
  aria-label={$title}
  aria-pressed={selected}
  on:click
  title={$title}>
  <hbox class="icon">
    <slot name="icon" />
  </hbox>
</button>

<script lang="ts">
  import type { JackdawApp } from "./JackdawApp";

  export let selected = false;
  export let minimized = false;
  export let compact = false;
  export let app: JackdawApp;

  $: title = app.title;
</script>

<style>
  .sub-app-button {
    display: flex;
    justify-content: center;
    align-items: center;
    background: transparent;
    color: inherit;
    cursor: pointer;
    padding: 2px;
    border-radius: var(--border-radius);
    border: 1px solid transparent;
    transition:
      background-color 0.18s ease,
      border-color 0.18s ease,
      box-shadow 0.18s ease,
      transform var(--button-motion-duration) var(--button-motion-ease);
  }
  .sub-app-button:hover {
    transform: translateY(var(--button-motion-lift));
  }
  .sub-app-button:hover:not(.selected) {
    background: var(--glass-hover-bg);
    border-color: var(--glass-border-subtle);
    box-shadow:
      var(--glass-highlight),
      0 5px 14px rgba(var(--shadow-color), 0.1);
  }
  .sub-app-button.selected {
    background: var(--glass-selected-bg);
    border-color: var(--glass-selected-border);
    box-shadow:
      var(--glass-highlight),
      0 1px 4px rgba(var(--shadow-color), 0.08);
  }
  .sub-app-button:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--appbar-fg) 55%, transparent);
    outline-offset: 1px;
  }
  .sub-app-button:active {
    transform: translateY(var(--button-motion-press-shift)) scale(var(--button-motion-press-scale));
  }
  .icon {
    padding: 2px;
    color: color-mix(in srgb, var(--appbar-fg) 84%, transparent);
    align-items: center;
    justify-content: center;
    transition: transform var(--button-motion-duration) var(--button-motion-ease);
  }
  .sub-app-button:hover .icon {
    transform: translateY(-1px);
  }
  .sub-app-button:active .icon {
    transform: none;
  }
  .icon :global(svg) {
    stroke: currentColor;
    fill: none;
  }
  .icon :global(.cls-1),
  .icon :global(.cls-2),
  .icon :global(.cls-3) {
    stroke: currentColor;
  }
  .sub-app-button.selected .icon {
    color: var(--icon-primary);
  }
  .sub-app-button.minimized:not(.selected) {
    opacity: 0.58;
  }
  .sub-app-button.minimized:not(.selected) .icon {
    transform: scale(0.92);
  }
  .sub-app-button.compact {
    padding: 1px;
  }
  .sub-app-button.compact .icon {
    padding: 1px;
  }
  .sub-app-button.selected .icon :global(.date-calendar-icon) {
    fill: currentColor;
  }

  :global(.sub-app-bar[app="webapps"]) .icon {
    filter: grayscale(0.7);
  }
  @media (prefers-reduced-motion: reduce) {
    .sub-app-button,
    .icon {
      transition: none;
    }
    .sub-app-button:hover,
    .sub-app-button:active,
    .sub-app-button:hover .icon,
    .sub-app-button:active .icon {
      transform: none;
    }
  }
</style>
