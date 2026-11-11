<vbox flex>
  <input type="password"
    bind:this={inputEl}
    bind:value={newPassword}
    on:change={onPasswordChanged}
    placeholder="••••••••"
    {tabindex}
    />
  {#if showHint}
    <div class="password-hint">{$t`Password changed? Enter the new one here`}</div>
  {/if}
</vbox>

<script lang="ts">
  /** Does not populate the existing password into the text field,
   * to avoid copying it by malicious users,
   * but allows to change it. */

  import { onMount, onDestroy } from "svelte";
  import { passwordFocusRequest, newPasswordEntered } from "./passwordFocus";
  import { t } from "../../../l10n/l10n";

  /** out only */
  export let password: string;
  export let tabindex: number | undefined = undefined;
  /** Подпись под полем. Выключается там, где поле уже подписано */
  export let showHint = true;

  let inputEl: HTMLInputElement;
  let unsubscribe: (() => void) | undefined;
  onMount(() => {
    unsubscribe = passwordFocusRequest.subscribe(requested => {
      if (requested && inputEl) {
        passwordFocusRequest.set(false);
        inputEl.scrollIntoView?.({ block: "center" });
        inputEl.focus();
      }
    });
  });
  onDestroy(() => unsubscribe?.());

  let newPassword = "";
  function onPasswordChanged() {
    if (newPassword) {
      password = newPassword;
      newPasswordEntered.update(n => n + 1);
    }
  }
</script>

<style>
  .password-hint {
    font-size: 12px;
    opacity: 0.7;
    margin-block-start: 4px;
  }
</style>
