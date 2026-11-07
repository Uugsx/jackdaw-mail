<!-- Заглушка панели, когда в списке ничего не выбрано: вместо пустого места — что здесь появится и что сделать.
  Оформление как у «Письмо не выбрано» (Mail/StartPage.svelte). -->
<vbox class="empty-selection" flex role="status">
  <vbox class="content">
    <hbox class="title">{title}</hbox>
    {#if subtitle}
      <hbox class="subtitle">{subtitle}</hbox>
    {/if}
    {#if $$slots.actions}
      <hbox class="actions">
        <slot name="actions" />
      </hbox>
    {/if}
  </vbox>
</vbox>

<script lang="ts">
  export let title: string;
  export let subtitle = "";
</script>

<style>
  .empty-selection {
    align-items: center;
    justify-content: center;
    padding: 2em;
    color: var(--main-fg);
  }
  .content {
    align-items: center;
    gap: 12px;
    max-width: 28em;
    text-align: center;
  }
  .title {
    font-size: 1.25em;
    font-weight: 600;
  }
  .subtitle {
    opacity: 0.7;
    line-height: 1.4;
  }
  .actions {
    gap: 8px;
    margin-block-start: 8px;
    justify-content: center;
  }
</style>
