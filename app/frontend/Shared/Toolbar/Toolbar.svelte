<hbox class="toolbar" class:border>
  <slot />
</hbox>

<script lang="ts">
  export let border = false;
</script>

<style>
  .toolbar {
    padding: 0px 4px;
    flex-wrap: wrap;
  }
  .toolbar.border {
    box-shadow: 1px 0px 3px 0px rgba(0, 0, 0, 30%);
    border-radius: var(--border-radius);
  }
  .toolbar :global(button.button) {
    border: none;
    border-radius: 0px;
    background-color: transparent;
    padding: 6px 6px;
    color: #595065;
    transition:
      transform var(--button-motion-duration) var(--button-motion-ease),
      background-color 160ms ease,
      color 160ms ease,
      box-shadow 180ms ease;
  }
  .toolbar :global(button.button:hover:not(.disabled)) {
    transform: translateY(var(--button-motion-lift));
  }
  .toolbar :global(button.button:active:not(.disabled)) {
    transform: translateY(var(--button-motion-press-shift)) scale(var(--button-motion-press-scale));
  }
  .toolbar :global(button.button.disabled) {
    opacity: 20%;
  }
  @media (prefers-reduced-motion: reduce) {
    .toolbar :global(button.button),
    .toolbar :global(button.button:hover:not(.disabled)),
    .toolbar :global(button.button:active:not(.disabled)) {
      transition: none;
      transform: none;
    }
  }
</style>
