<button
  type="button"
  class="app-button {classes}"
  class:selected
  class:icon-only={iconOnly}
  aria-label={iconOnly ? ariaLabel : undefined}
  data-tooltip={iconOnly ? ariaLabel : undefined}
  title={iconOnly ? ariaLabel : undefined}
  class:padding
  aria-pressed={selected}
  on:click>
  <hbox class="icon-wrap">
    <hbox class="icon">
      <slot name="icon" />
    </hbox>
    {#if badgeCount > 0}
      <hbox class="badge">{badgeCount < 100 ? badgeCount : "99+"}</hbox>
    {/if}
  </hbox>
  <hbox class="label font-smallest">
    <slot name="label" />
  </hbox>
</button>

<script lang="ts">
  export let selected = false;
  export let classes: string = "";
  export let iconOnly = false;
  export let ariaLabel: string | undefined = undefined;
  export let padding = true;
  /** Unread / notification count on the app icon. */
  export let badgeCount = 0;
</script>

<style>
  .app-button {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
    text-align: center;
    border-radius: var(--border-radius);
    width: 100%;
    box-sizing: border-box;
    border: 1px solid transparent;
    transition:
      background-color 0.18s ease,
      border-color 0.18s ease,
      box-shadow 0.18s ease,
      transform var(--button-motion-duration) var(--button-motion-ease),
      color 0.18s ease;
  }
  .app-button.padding {
    padding: 6px 0 4px;
  }
  .app-button.icon-only {
    padding: 3px 1px;
  }
  .app-button.icon-only .label {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
  }
  .app-button.icon-only .icon-wrap {
    width: 30px;
    height: 30px;
  }
  .app-button:hover {
    transform: translateY(var(--button-motion-lift));
  }
  .app-button:hover:not(.selected) {
    background: var(--glass-hover-bg);
    border-color: var(--glass-border-subtle);
    box-shadow:
      var(--glass-highlight),
      0 5px 14px rgba(var(--shadow-color), 0.1);
  }
  .app-button.selected {
    background: var(--glass-selected-bg);
    border-color: var(--glass-selected-border);
    box-shadow:
      var(--glass-highlight),
      0 2px 8px rgba(var(--shadow-color), 0.08);
  }
  .app-button:active {
    transform: translateY(0) scale(var(--button-motion-press-scale));
  }
  .app-button:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--appbar-fg) 55%, transparent);
    outline-offset: 1px;
  }
  .label :global(.label) {
    color: color-mix(in srgb, var(--appbar-fg) 78%, transparent);
  }
  .app-button.selected .label :global(> .label) {
    color: var(--appbar-fg);
    font-weight: 600;
  }
  .icon-wrap {
    position: relative;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: var(--border-radius);
    transition: transform var(--button-motion-duration) var(--button-motion-ease);
  }
  .app-button:hover .icon-wrap {
    transform: translateY(-1px);
  }
  .app-button:active .icon-wrap {
    transform: none;
  }
  .badge {
    position: absolute;
    top: -2px;
    inset-inline-end: -4px;
    min-width: 16px;
    min-height: 16px;
    padding: 0 4px;
    border-radius: 999px;
    background-color: #dd3322;
    color: white;
    font-size: 9px;
    font-weight: 700;
    line-height: 16px;
    justify-content: center;
    align-items: center;
    box-sizing: border-box;
    pointer-events: none;
    font-feature-settings: "tnum";
  }
  .icon {
    color: color-mix(in srgb, var(--appbar-fg) 84%, transparent);
    align-items: center;
    justify-content: center;
  }
  .icon :global(svg) {
    stroke: currentColor;
    fill: none;
  }
  /* Legacy thick SVG icons */
  .icon :global(.cls-1),
  .icon :global(.cls-2),
  .icon :global(.cls-3) {
    stroke: currentColor;
  }
  .app-button.selected .icon {
    color: var(--icon-primary);
  }
  .app-button.selected .icon-wrap {
    background: color-mix(in srgb, var(--icon-primary) 12%, transparent);
  }
  .label {
    overflow: hidden;
    text-overflow: clip;
    white-space: nowrap;
    max-width: 100%;
    margin-block-start: 2px;
    margin-inline: 1px;
    font-size: 9px;
    font-weight: 500;
    letter-spacing: -0.03em;
    line-height: 1.15;
    justify-content: center;
  }
  @media (prefers-reduced-motion: reduce) {
    .app-button,
    .icon-wrap {
      transition: none;
    }
    .app-button:hover,
    .app-button:active,
    .app-button:hover .icon-wrap,
    .app-button:active .icon-wrap {
      transform: none;
    }
  }
</style>
