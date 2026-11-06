<!--
  Уведомление об обработке данных рядом с действием, которое отправляет их
  на серверы Jackdaw (GDPR ст. 13). Основание — договор, отдельное согласие не нужно.
-->
<p class="privacy-notice font-small" class:disabled>
  {$t`Data is processed under the`}
  <a href={kPrivacyPolicyURL} on:click|preventDefault={openPolicy}>{$t`Privacy Policy`}</a>
</p>

<script lang="ts">
  import { t } from "../../l10n/l10n";
  import { openExternalURL } from "../../logic/util/os-integration";
  import { kPrivacyPolicyURL } from "./privacyConsent";

  export let disabled = false;
  /** Для совместимости с формами: отправка не зависит от отдельного согласия */
  export let accepted = true;

  async function openPolicy() {
    await openExternalURL(kPrivacyPolicyURL);
  }
</script>

<style>
  .privacy-notice {
    margin: 4px 0;
    opacity: 0.8;
  }
  .disabled {
    opacity: 0.5;
  }
  a {
    color: var(--link-fg);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
</style>
