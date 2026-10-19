{#if ex}
  <Notice {ex} tone="error" {onRetry} {onClose} />
{/if}

<script lang="ts">
  import Notice from "./Notice.svelte";
  import { logError } from "../Util/error";

  export let ex: Error = null;
  /** Если задано — кнопка «Повторить». */
  export let onRetry: (() => void | Promise<void>) | null = null;
  /** Если задано — кнопка закрытия. */
  export let onClose: (() => void) | null = null;

  // Пользователь видит понятный текст, а в лог и Sentry уходит исходная ошибка
  let loggedEx: Error = null;
  $: if (ex && ex !== loggedEx) {
    loggedEx = ex;
    logError(ex);
  }

  export function showError(error: Error) {
    ex = error;
  }
  export function clearError() {
    ex = null;
  }
</script>
