<hbox class="password">
  <input type="password"
    {id}
    placeholder={$t`Your password`}
    bind:value={password}
    bind:this={inputEl}
    required
    name="password"
    {autofocus}
    aria-describedby={appPasswordHint ? `${id}-hint` : undefined}
    on:keydown={(event) => onKeyEnter(event, onEnter)}
    />
  <hbox class="buttons">
    <Button classes="cleartext"
      label={cleartext ? $t`Hide password` : $t`Show password`}
      onClick={() => cleartext = !cleartext}
      icon={cleartext ? EyeIcon : EyeOffIcon}
      iconOnly
      plain
      />
  </hbox>
</hbox>
{#if appPasswordHint}
  <p class="password-hint" id="{id}-hint">
    {$t`Gmail, Yandex, Mail.ru, iCloud and Outlook.com with two-step verification need an app password. Create it in the security settings of your mail account and enter it here instead of your regular password.`}
  </p>
{/if}

<script lang="ts">
  import Button from "../../Shared/Button.svelte";
  import { onKeyEnter } from "../../Util/util";
  import EyeIcon from "lucide-svelte/icons/eye";
  import EyeOffIcon from "lucide-svelte/icons/eye-off";
  import { createEventDispatcher } from 'svelte';
  import { t } from "../../../l10n/l10n";
  const dispatchEvent = createEventDispatcher();

  /** in/out */
  export let password: string;
  export let id = "password";
  export let autofocus = false;
  /** Подсказка под полем: что такое пароль приложения и где его взять. */
  export let appPasswordHint = false;

  let cleartext = false;
  let inputEl: HTMLInputElement;
  $: if (inputEl) inputEl.type = cleartext ? "text" : "password";

  function onEnter() {
    if (password) {
      dispatchEvent("continue");
    }
  }

  export function focus() {
    inputEl.focus();
  }
</script>

<style>
  .password {
    margin: 8px 0 8px 0;
  }
  input {
    height: 24px;
  }
  .buttons {
    min-width: 32px;
  }
  .password-hint {
    max-width: 32em;
    margin: 0 0 8px;
    color: color-mix(in srgb, var(--main-fg, CanvasText) 72%, transparent);
    font-size: 12px;
    line-height: 1.45;
  }
</style>
