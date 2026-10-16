<hbox class="buttons">
  <slot name="buttons-bottom-right" />
</hbox>

<style>
  .buttons {
    justify-content: end;
  }
  .buttons :global(button) {
    margin-inline-start: 8px;
  }
  .buttons :global(button.delete) {
    border-color: var(--danger-fg, #b84e3b);
    background-color: transparent;
    color: var(--danger-fg, #b84e3b);
  }
</style>
