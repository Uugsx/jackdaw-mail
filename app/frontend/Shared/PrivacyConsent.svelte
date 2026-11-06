<!--
  Явное согласие на обработку персональных данных перед отправкой их
  на серверы Jackdaw. Снятая галочка — отзыв согласия.
-->
<hbox class="privacy-consent">
  <Checkbox
    checked={accepted}
    allowIndetermined={false}
    label={$t`I agree to the processing of my personal data`}
    {disabled}
    on:change={ev => setPrivacyConsent(!!ev.detail)}
    />
  <a href={kPrivacyPolicyURL} class="policy-link" on:click|preventDefault={openPolicy}>{$t`Privacy Policy`}</a>
</hbox>

<script lang="ts">
  import { t } from "../../l10n/l10n";
  import { openExternalURL } from "../../logic/util/os-integration";
  import Checkbox from "./Checkbox.svelte";
  import { getPrivacyConsentSetting, hasPrivacyConsent, kPrivacyPolicyURL, setPrivacyConsent } from "./privacyConsent";

  export let disabled = false;
  /** Только для чтения: дано ли согласие на текущую редакцию политики */
  export let accepted = false;

  const consent = getPrivacyConsentSetting();
  $: accepted = hasPrivacyConsent($consent.value);

  async function openPolicy() {
    await openExternalURL(kPrivacyPolicyURL);
  }
</script>

<style>
  .privacy-consent {
    align-items: center;
    flex-wrap: wrap;
    gap: 4px 12px;
  }
  .policy-link {
    color: var(--link-fg);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .policy-link:focus-visible {
    outline: 2px solid var(--link-fg);
    outline-offset: 2px;
    border-radius: 2px;
  }
</style>
