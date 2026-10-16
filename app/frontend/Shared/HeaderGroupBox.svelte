<vbox class="group {classes}">
  <hbox class="header font-normal">
    <slot name="header" />
    <hbox flex />
    <hbox class="buttons">
      <slot name="buttons-top-right" />
    </hbox>
  </hbox>
  <vbox class="content" flex>
    <slot />
  </vbox>
</vbox>

<script lang="ts">
  export let classes = "";
</script>

<style>
  /* Группа настроек: заголовок и линия сверху, без рамки и серой плашки. */
  .group {
    margin-block-start: 28px;
    border-block-start: 1px solid var(--border);
  }
  .header {
    color: var(--main-fg);
    padding: 14px 0 4px;
    font-size: 14px;
    font-weight: 650;
    align-items: center;
  }
  .content {
    color: var(--main-fg);
    padding: 12px 0 8px;
  }
</style>
