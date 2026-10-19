{#if account?.oAuth2 && showManualSetupHint && isGoogleAccount}
  <vbox class="google-login-help">
    <hbox class="title">
      <InfoIcon size="16px" />
      <span>{$t`Alternative for Gmail`}</span>
    </hbox>
    <div class="text">
      {$t`If Google sign-in fails, choose Manual setup and enter a Google app password instead of your regular password.`}
    </div>
    <div class="note">
      {$t`App passwords are available in your Google Account after you enable 2-Step Verification.`}
    </div>
  </vbox>
{/if}

{#if account?.oAuth2}
  <OAuth2Login {account}
    onContinue={onContinue}
    onCancel={onCancel}
    onError={showError}
    />
{:else}
  <Header title={account.name} subtitle={account.emailAddress} />

  <hbox class="password-row">
    <label for="password">{$t`Password`}</label>
    <Password bind:password={account.password}
      autofocus={true}
      on:continue={() => catchErrors(onContinue, showError)} />
  </hbox>
  <p class="password-hint">
    {$t`Gmail, Yandex, Mail.ru, iCloud and Outlook.com with two-step verification need an app password. Create it in the security settings of your mail account and enter it here instead of your regular password.`}
  </p>
{/if}

{#if errorMessage}
  <ErrorMessage {errorMessage} errorGravity={ErrorGravity.Error} ex={errorEx}
    on:continue={() => errorMessage = null} />
{/if}

<script lang="ts">
  import type { MailAccount } from "../../../logic/Mail/MailAccount";
  import Password from "../Shared/Password.svelte";
  import OAuth2Login from "../Shared/OAuth2Login.svelte";
  import { Provider } from "../../../logic/Auth/OAuth2URLs";
  import { getProvider } from "../../../logic/Auth/OAuth2Util";
  import Header from "../Shared/Header.svelte";
  import ErrorMessage, { ErrorGravity } from "../../Shared/ErrorMessage.svelte";
  import { friendlyErrorMessage } from "../../../logic/util/friendlyError";
  import InfoIcon from "lucide-svelte/icons/info";
  import { Cancelled } from "../../../logic/util/flow/Abortable";
  import { catchErrors, logError } from "../../Util/error";
  import { t } from "../../../l10n/l10n";

  export let account: MailAccount;
  export let onContinue = () => undefined;
  export let onCancel = () => undefined;
  export let showManualSetupHint = false;

  let errorMessage: string = null;
  let errorEx: Error = null;
  $: isGoogleAccount = !!account && getProvider(account) == Provider.Google;

  function showError(ex: Error | string) {
    if (typeof (ex) == "string") {
      ex = new Error(ex);
    }
    if (ex instanceof Cancelled) {
      return;
    }
    console.error(ex);
    logError(ex);
    errorMessage = friendlyErrorMessage(ex);
    errorEx = ex;
  }

  // TODO Copy password to SMTP
</script>

<style>
  .password-row {
    align-items: center;
  }
  .password-row label {
    margin-inline-end: 24px;
  }
  .password-row :global(input) {
    min-width: 20em;
  }
  .password-hint {
    max-width: 36em;
    margin: 0 0 8px;
    color: color-mix(in srgb, var(--main-fg, CanvasText) 72%, transparent);
    font-size: 12px;
    line-height: 1.45;
  }
  .spacer1,
  .spacer2 {
    min-height: 5vh;
  }
  .google-login-help {
    background-color: var(--offset-bg);
    border: 1px solid var(--border);
    border-radius: var(--border-radius);
    margin-block-end: 16px;
    padding: 12px 16px;
  }
  .google-login-help .title {
    align-items: center;
    font-weight: 600;
    margin-block-end: 6px;
  }
  .google-login-help .title :global(svg) {
    margin-inline-end: 6px;
  }
  .google-login-help .text {
    line-height: 1.4;
  }
  .google-login-help .note {
    font-size: 13px;
    line-height: 1.4;
    margin-block-start: 6px;
    opacity: 70%;
  }
</style>
