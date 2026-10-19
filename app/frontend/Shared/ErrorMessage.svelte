{#if errorMessage || ex}
  <vbox class="error">
    <Notice {ex} message={errorMessage} tone={noticeTone(errorGravity)} onClose={onClose} />
  </vbox>
{/if}

<script lang="ts" context="module">
  export enum ErrorGravity {
    Error = "error",
    Warning = "warning",
    OK = "ok",
  }
</script>

<script lang="ts">
  import Notice, { type NoticeTone } from "./Notice.svelte";
  import { createEventDispatcher } from 'svelte';
  const dispatchEvent = createEventDispatcher();

  /** in/out */
  export let errorMessage: string;
  /** in/out */
  export let errorGravity: ErrorGravity;
  /** Исходная ошибка: даёт подсказку и свёрнутые подробности для поддержки.
   * Если `errorMessage` пуст, текст тоже берётся из неё. */
  export let ex: unknown = null;

  function onClose() {
    errorMessage = null;
    ex = null;
    dispatchEvent("continue");
  }

  function noticeTone(errorGravity: ErrorGravity): NoticeTone {
    if (errorGravity == ErrorGravity.Error) {
      return "error";
    } else if (errorGravity == ErrorGravity.Warning) {
      return "warning";
    }
    return "success";
  }
</script>

<style>
  .error {
    max-width: 50em;
  }
</style>
