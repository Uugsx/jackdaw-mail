<hbox flex class="status {status}"
  role={status == "error" ? "alert" : "status"}
  aria-live={status == "error" ? "assertive" : "polite"}>
  {#if status == "processing"}
    <hbox class="spinner">
      <Spinner size="24px" />
    </hbox>
  {/if}
  <hbox flex class="box">
    <hbox class="icon">
      <slot name="icon" />
    </hbox>
    {#if message}
      <hbox class="message value">
        {message}
      </hbox>
    {/if}
    <slot />
  </hbox>
</hbox>

<script lang="ts">
  import Spinner from "../../Shared/Spinner.svelte";

  export let message: string = null;
  export let status: "success" | "processing" | "error" | "warning" | "" = "";
</script>

<style>
  .status {
    margin-block-start: 8px;
    margin-block-end: 8px;
  }
  .box {
    --status-tone: var(--info-fg, #3C6E91);
    align-items: center;
    gap: 6px;
    border-radius: var(--border-radius, 6px);
    justify-content: start;
    margin-inline-start: 8px;
    margin-inline-end: 24px;
    padding: 6px 16px 6px 12px;
    border: 1px solid transparent;
    color: var(--main-fg, CanvasText);
    line-height: 1.45;
  }
  .spinner {
    margin: 4px;
  }
  .spinner :global(.loader::after) {
    margin: 8px;
  }
  .message {
    overflow-wrap: anywhere;
  }
  /* Плоская поверхность с тонкой рамкой в тоне состояния; текст — основной цвет,
   * поэтому контраст не зависит от тона (WCAG AA в светлой и тёмной теме). */
  .success .box {
    --status-tone: var(--success-fg, #2F7A3E);
  }
  .warning .box {
    --status-tone: var(--warning-fg, #8A5A00);
  }
  .error .box {
    --status-tone: var(--danger-fg, #B84E3B);
  }
  .success .box,
  .warning .box,
  .error .box {
    background-color: color-mix(in srgb, var(--status-tone) 7%, var(--main-bg, Canvas));
    border-color: color-mix(in srgb, var(--status-tone) 38%, var(--border));
  }
  .processing .box {
    background-color: var(--offset-bg);
    color: var(--main-fg);
    margin-inline-start: 16px;
  }
  .icon {
    display: flex;
    color: var(--status-tone);
  }
  .icon:empty {
    display: none;
  }
</style>
