<script lang="ts">
  import { onMount } from "svelte";
  import LockKeyholeIcon from "lucide-svelte/icons/lock-keyhole";
  import RefreshIcon from "lucide-svelte/icons/refresh-cw";
  import ExternalLinkIcon from "lucide-svelte/icons/external-link";
  import { t } from "../../l10n/l10n";
  import { BILLING_PLANS_URL, type ProFeatureKey } from "../../logic/Billing/Billing";
  import {
    hasProFeature,
    getProEntitlementErrorMessage,
    proEntitlement,
    refreshProEntitlement,
    startProTrial,
  } from "../../logic/Billing/ProEntitlement";
  import { openExternalURL } from "../../logic/util/os-integration";
  import Button from "./Button.svelte";

  export let feature: ProFeatureKey;
  export let compact = false;

  let retrying = false;
  let startingTrial = false;
  let trialMessage: string | null = null;
  $: state = $proEntitlement.value;
  // hasProFeature читает хранилище внутри функции, поэтому зависимость от
  // state нужна явно: иначе доступ не откроется после проверки лицензии.
  $: enabled = !!state && hasProFeature(feature);
  $: featureName = feature == "reports"
    ? $t`Interactive reports`
    : feature == "live-sla"
      ? $t`Live SLA control`
      : feature == "working-hours"
        ? $t`Working calendar`
        : feature == "reminders"
          ? $t`Response reminders`
          : feature == "html-export"
            ? $t`HTML report export`
            : feature == "signatures"
              ? $t`HTML email signatures`
              : feature == "multiple-accounts"
                ? $t`Multiple mail accounts`
                : $t`Jackdaw Pro feature`;

  onMount(() => {
    void refreshProEntitlement();
  });

  async function retry(): Promise<void> {
    retrying = true;
    try {
      await refreshProEntitlement();
    } finally {
      retrying = false;
    }
  }

  async function openPlans(): Promise<void> {
    await openExternalURL(BILLING_PLANS_URL);
  }

  async function startTrial(): Promise<void> {
    if (startingTrial) return;
    trialMessage = null;
    startingTrial = true;
    try {
      await startProTrial();
    } catch (error) {
      trialMessage = getProEntitlementErrorMessage(error);
    } finally {
      startingTrial = false;
    }
  }
</script>

{#if enabled}
  <slot />
{:else if state.status == "checking"}
  <svelte:element this={compact ? "section" : "main"} class="pro-gate loading" class:compact aria-busy="true" aria-live="polite">
    <div class="gate-icon" aria-hidden="true"><RefreshIcon size="22px" /></div>
    <h1>{$t`Checking Pro access`}</h1>
    <p>{$t`The license server is checking the entitlement for this device.`}</p>
  </svelte:element>
{:else}
  <svelte:element this={compact ? "section" : "main"} class="pro-gate" class:compact aria-labelledby="pro-gate-title">
    <div class="gate-icon" aria-hidden="true"><LockKeyholeIcon size="22px" /></div>
    <h1 id="pro-gate-title">{featureName}</h1>
    <p class="lead">
      {$t`This module is included in Jackdaw Pro. Buy a license key or enter one that was issued by your administrator.`}
    </p>
    {#if state.message || trialMessage}
      <p class="state-message" role="status">{trialMessage ?? state.message}</p>
    {/if}
    <div class="gate-actions">
      {#if state.status == "not-activated"}
        <Button
          label={startingTrial ? $t`Starting 7-day trial…` : $t`Try Pro free for 7 days`}
          classes="filled large"
          disabled={startingTrial}
          onClick={startTrial}
          />
      {/if}
      <Button
        label={$t`View Pro plans`}
        icon={ExternalLinkIcon}
        classes="large"
        onClick={openPlans}
        />
      <Button
        label={retrying ? $t`Checking…` : $t`Check license again`}
        icon={RefreshIcon}
        classes="large"
        disabled={retrying}
        onClick={retry}
        />
    </div>
    <p class="hint">{$t`After purchase, paste the key in Settings → Jackdaw Pro. No mail password or mailbox data is sent to the license server.`}</p>
  </svelte:element>
{/if}

<style>
  .pro-gate {
    box-sizing: border-box;
    min-height: min(68vh, 720px);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 48px 24px;
    text-align: center;
  }

  .pro-gate.compact {
    min-height: 220px;
    padding: 28px 16px;
  }

  .pro-gate.compact h1 {
    font-size: clamp(22px, 3vw, 30px);
  }

  .pro-gate.loading {
    color: var(--main-fg);
  }

  .gate-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    color: var(--icon-primary);
  }

  h1 {
    max-width: 620px;
    margin: 0;
    font-size: clamp(26px, 4vw, 40px);
    line-height: 1.05;
    letter-spacing: -0.035em;
  }

  .lead {
    max-width: 620px;
    margin: 0;
    color: color-mix(in srgb, var(--main-fg) 74%, transparent);
    line-height: 1.55;
  }

  .state-message,
  .hint {
    max-width: 600px;
    margin: 0;
    color: color-mix(in srgb, var(--main-fg) 60%, transparent);
    font-size: 13px;
    line-height: 1.5;
  }

  .gate-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 10px;
    margin: 10px 0 2px;
  }
</style>
