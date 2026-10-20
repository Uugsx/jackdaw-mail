<vbox class="billing page">
  <PageHeader
    title={$t`Jackdaw Pro`}
    subtitle={$t`Advanced mail workflows, team accounts and SLA control for teams that need a clear response deadline.`}
    >
    <Button
      slot="buttons-top-right"
      label={$t`Open plans`}
      icon={ExternalLinkIcon}
      classes="large filled"
      onClick={openPlans}
      />
  </PageHeader>

  <HeaderGroupBox>
    <hbox slot="header">{$t`Your Pro access`}</hbox>
    <div class="access-layout">
      <div class="access-summary" class:enabled={hasAccess}>
        <div class="status-mark" aria-hidden="true">
          {#if hasAccess}
            <CheckIcon size="22px" />
          {:else}
            <LockKeyholeIcon size="22px" />
          {/if}
        </div>
        <div>
          <strong>{statusLabel}</strong>
          <p>
            {#if state.plan}
              {$t`Plan: ${planLabel(state.plan)}`}
              {#if state.validUntil}
                · {$t`valid until ${formatDate(state.validUntil)}`}
              {/if}
            {:else}
              {$t`No Pro license is active on this device.`}
            {/if}
          </p>
          {#if state.keyLast4}
            <p class="key-preview">{$t`License ending in ••••${state.keyLast4}`}</p>
          {/if}
          {#if state.lastValidatedAt}
            <p class="validation-time">{$t`Last checked: ${formatDate(state.lastValidatedAt)}`}</p>
          {/if}
        </div>
      </div>

      <div class="activation-panel">
        <label for="pro-license-key">{$t`License key`}</label>
        <div class="activation-row">
          <input
            id="pro-license-key"
            bind:value={licenseKey}
            type="text"
            autocomplete="off"
            autocapitalize="characters"
            spellcheck="false"
            placeholder="JACKDAW-PRO-XXXX-XXXX-XXXX-XXXX"
            aria-describedby="license-help"
            on:keydown={onLicenseKeyKeydown}
            />
          <Button
            label={activating ? $t`Activating…` : $t`Activate`}
            icon={KeyRoundIcon}
            classes="filled activation-button"
            disabled={!licenseKey.trim() || activating}
            onClick={activate}
            />
        </div>
        <p id="license-help" class="help-text">
          {$t`Paste the key from your purchase email or from your administrator. The app sends only the key and device ID to the license service; mail data stays local.`}
        </p>
        <div class="access-actions">
          <Button
            label={refreshing ? $t`Checking…` : $t`Check access`}
            icon={RefreshIcon}
            disabled={refreshing || activating}
            onClick={refresh}
            />
          {#if state.keyLast4}
            <Button
              label={$t`Deactivate this device`}
              icon={LogOutIcon}
              classes="secondary"
              disabled={refreshing || activating}
              onClick={deactivate}
              />
          {/if}
        </div>
        {#if feedbackMessage}
          <p class:error={feedbackKind == "error"} class:success={feedbackKind == "success"} class="feedback" role="status">
            {feedbackMessage}
          </p>
        {/if}
      </div>
    </div>
  </HeaderGroupBox>

  <HeaderGroupBox>
    <hbox slot="header">{$t`What is included in Pro`}</hbox>
    <ul class="feature-list">
      {#each proFeatures as feature}
        <li>
          <h2>{feature.title()}</h2>
          <p>{feature.description()}</p>
        </li>
      {/each}
    </ul>
  </HeaderGroupBox>

  <HeaderGroupBox>
    <hbox slot="header">{$t`Plans`}</hbox>
    <div class="plans">
      <article class="plan-card">
        <div class="plan-heading">
          <h2>{$t`Monthly Pro`}</h2>
        </div>
        <div class="plan-price">{$t`${formatPrice(BILLING_PRICE_AMOUNTS_USD.monthly)} per month`}</div>
        <p>{$t`Pay month by month. After checkout, activate the license key on every device you use.`}</p>
        <Button
          label={getCheckoutLabel("monthly", checkoutChecking, checkoutAvailability)}
          icon={ExternalLinkIcon}
          classes="plan-action"
          disabled={checkoutChecking || !isCheckoutAvailable("monthly")}
          onClick={() => openCheckout("monthly")}
          />
      </article>
      <article class="plan-card featured">
        <div class="plan-heading">
          <h2>{$t`Yearly Pro`}</h2>
        </div>
        <div class="plan-price">{$t`${formatPrice(BILLING_PRICE_AMOUNTS_USD.yearly)} per year`}</div>
        <p>{$t`One annual payment. The checkout shows the final price and renewal terms before payment.`}</p>
        <Button
          label={getCheckoutLabel("yearly", checkoutChecking, checkoutAvailability)}
          icon={ExternalLinkIcon}
          classes="filled plan-action"
          disabled={checkoutChecking || !isCheckoutAvailable("yearly")}
          onClick={() => openCheckout("yearly")}
          />
      </article>
    </div>
    {#if !hasAccess && state.status == "not-activated"}
      <div class="trial-panel">
        <div>
          <strong>{$t`Try Jackdaw Pro free for 7 days`}</strong>
          <p>{$t`No card is required. The trial is tied to this device, checked online and cannot be restarted by changing the computer date.`}</p>
        </div>
        <Button
          label={startingTrial ? $t`Starting trial…` : trialChecking ? $t`Checking trial…` : trialAvailable ? $t`Start 7-day trial` : $t`Trial unavailable`}
          classes="filled trial-action"
          disabled={startingTrial || trialChecking || !trialAvailable}
          onClick={startTrial}
          />
      </div>
    {/if}
    <p class="purchase-note">{$t`The purchase page issues a license key. No email account sign-in is required; the key is the entitlement for this app.`}</p>
    {#if !checkoutChecking && (!isCheckoutAvailable("monthly") || !isCheckoutAvailable("yearly"))}
      <p class="purchase-note unavailable" role="status">{$t`The payment store is not connected yet. Administrator-issued license keys can still be activated above.`}</p>
    {/if}
  </HeaderGroupBox>
</vbox>

<script lang="ts">
  import { onMount } from "svelte";
  import CheckIcon from "lucide-svelte/icons/check";
  import ExternalLinkIcon from "lucide-svelte/icons/external-link";
  import KeyRoundIcon from "lucide-svelte/icons/key-round";
  import LockKeyholeIcon from "lucide-svelte/icons/lock-keyhole";
  import LogOutIcon from "lucide-svelte/icons/log-out";
  import RefreshIcon from "lucide-svelte/icons/refresh-cw";
  import { t, getDateTimeLocale } from "../../../l10n/l10n";
  import {
    BILLING_CHECKOUT_URLS,
    BILLING_PRICE_AMOUNTS_USD,
    BILLING_PLANS_URL,
    fetchBillingCheckoutAvailability,
    fetchBillingTrialAvailability,
    type BillingPlan,
  } from "../../../logic/Billing/Billing";
  import {
    activateProLicense,
    deactivateProLicense,
    getProEntitlementErrorMessage,
    hasProFeature,
    proEntitlement,
    refreshProEntitlement,
    startProTrial,
    type ProEntitlementStatus,
  } from "../../../logic/Billing/ProEntitlement";
  import Button from "../../Shared/Button.svelte";
  import HeaderGroupBox from "../../Shared/HeaderGroupBox.svelte";
  import PageHeader from "../Shared/PageHeader.svelte";
  import { openExternalURL } from "../../../logic/util/os-integration";

  const checkoutURLs = BILLING_CHECKOUT_URLS;
  let licenseKey = "";
  let activating = false;
  let refreshing = false;
  let feedbackMessage: string | null = null;
  let feedbackKind: "error" | "success" | null = null;
  let checkoutAvailability: Readonly<Record<BillingPlan, boolean>> = { monthly: false, yearly: false };
  let checkoutChecking = true;
  let trialAvailable = false;
  let trialChecking = true;
  let startingTrial = false;

  $: state = $proEntitlement.value;
  $: hasAccess = !!state && (hasProFeature("reports") || hasProFeature("live-sla"));
  $: statusLabel = getStatusLabel(state.status);

  const proFeatures = [
    {
      title: () => $t`Interactive reports`,
      description: () => $t`Charts, dashboard widgets, filters, sorting and a full report view inside Jackdaw.`,
    },
    {
      title: () => $t`Live SLA control`,
      description: () => $t`A right-side queue with a working-time timer, deadline and overdue state for every open request.`,
    },
    {
      title: () => $t`Working calendar`,
      description: () => $t`Different working hours for each weekday, with weekends and out-of-hours time excluded from SLA.`,
    },
    {
      title: () => $t`Reminders`,
      description: () => $t`Configurable checkpoints such as 10, 20 and 25 working minutes before a reply.`,
    },
    {
      title: () => $t`HTML export`,
      description: () => $t`Save a checked, detailed report as an HTML copy after reviewing it inside the app.`,
    },
    {
      title: () => $t`HTML email signatures`,
      description: () => $t`Create rich signatures with formatting, links and images, then insert them into new mail and replies.`,
    },
    {
      title: () => $t`Multiple mail accounts`,
      description: () => $t`Connect more than one mailbox, including shared mailboxes, in the same Jackdaw workspace.`,
    },
  ];

  onMount(() => {
    void refreshProEntitlement();
    void loadCheckoutAvailability();
  });

  async function loadCheckoutAvailability(): Promise<void> {
    checkoutChecking = true;
    trialChecking = true;
    try {
      let [checkout, trial] = await Promise.all([
        fetchBillingCheckoutAvailability(),
        fetchBillingTrialAvailability(),
      ]);
      checkoutAvailability = checkout;
      trialAvailable = trial;
    } finally {
      checkoutChecking = false;
      trialChecking = false;
    }
  }

  function isCheckoutAvailable(plan: BillingPlan): boolean {
    return checkoutAvailability[plan] === true;
  }

  /** Состояние передаётся аргументами: иначе Svelte не перерисует метку после загрузки конфигурации. */
  function getCheckoutLabel(plan: BillingPlan, checking: boolean, availability: Readonly<Record<BillingPlan, boolean>>): string {
    if (checking) return $t`Checking…`;
    if (availability[plan] !== true) return $t`Store unavailable`;
    return plan == "monthly" ? $t`Buy monthly` : $t`Buy yearly`;
  }

  function getStatusLabel(status: ProEntitlementStatus): string {
    switch (status) {
      case "active": return $t`Pro is active`;
      case "trial": return $t`Pro trial is active`;
      case "past_due": return $t`Payment needs attention`;
      case "offline": return $t`Pro is active offline`;
      case "trial-offline": return $t`Trial needs an internet check`;
      case "expired": return $t`Pro license expired`;
      case "revoked": return $t`Pro license revoked`;
      case "checking": return $t`Checking Pro access…`;
      case "not-configured": return $t`License service is not configured`;
      case "not-activated": return $t`Pro is not activated`;
      case "error": return $t`Could not check Pro access`;
    }
  }

  function formatDate(value: string): string {
    let date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString(getDateTimeLocale());
  }

  function formatPrice(amount: number): string {
    return new Intl.NumberFormat(getDateTimeLocale(), { style: "currency", currency: "USD" }).format(amount);
  }

  /** Название тарифа вместо внутреннего кода (`monthly`, `trial`, `admin`). */
  function planLabel(plan: string): string {
    switch (plan) {
      case "monthly": return $t`Monthly`;
      case "yearly": return $t`Yearly`;
      case "trial": return $t`Trial`;
      case "admin": return $t`Issued by administrator`;
      default: return plan;
    }
  }

  function onLicenseKeyKeydown(event: KeyboardEvent): void {
    if (event.key == "Enter" && licenseKey.trim() && !activating) {
      event.preventDefault();
      void activate();
    }
  }

  async function activate(): Promise<void> {
    if (!licenseKey.trim() || activating) return;
    activating = true;
    feedbackMessage = null;
    feedbackKind = null;
    try {
      let nextState = await activateProLicense(licenseKey);
      licenseKey = "";
      feedbackKind = "success";
      feedbackMessage = nextState.status == "active" || nextState.status == "trial"
        ? $t`Pro access activated on this device.`
        : $t`The license was accepted, but its current status needs attention.`;
    } catch (error) {
      feedbackKind = "error";
      feedbackMessage = getProEntitlementErrorMessage(error);
    } finally {
      activating = false;
    }
  }

  async function refresh(): Promise<void> {
    if (refreshing || activating) return;
    refreshing = true;
    feedbackMessage = null;
    feedbackKind = null;
    try {
      let nextState = await refreshProEntitlement();
      feedbackKind = nextState.status == "error" || nextState.status == "revoked" || nextState.status == "expired" ? "error" : "success";
      feedbackMessage = nextState.message ?? $t`Pro access is up to date.`;
    } finally {
      refreshing = false;
    }
  }

  async function startTrial(): Promise<void> {
    if (startingTrial || trialChecking || !trialAvailable) return;
    startingTrial = true;
    feedbackMessage = null;
    feedbackKind = null;
    try {
      let nextState = await startProTrial();
      feedbackKind = nextState.status == "trial" ? "success" : "error";
      feedbackMessage = nextState.status == "trial"
        ? $t`Your 7-day Pro trial is active on this device.`
        : nextState.message ?? $t`The trial could not be started.`;
    } catch (error) {
      feedbackKind = "error";
      feedbackMessage = getProEntitlementErrorMessage(error);
    } finally {
      startingTrial = false;
    }
  }

  async function deactivate(): Promise<void> {
    if (!state.keyLast4 || !confirm($t`Deactivate Pro on this device?`)) return;
    refreshing = true;
    feedbackMessage = null;
    feedbackKind = null;
    try {
      await deactivateProLicense();
      feedbackKind = "success";
      feedbackMessage = $t`Pro was deactivated on this device.`;
    } finally {
      refreshing = false;
    }
  }

  async function openPlans(): Promise<void> {
    await openExternalURL(BILLING_PLANS_URL);
  }

  async function openCheckout(plan: BillingPlan): Promise<void> {
    if (!isCheckoutAvailable(plan)) {
      await openPlans();
      return;
    }
    let checkoutURL = checkoutURLs[plan];
    await openExternalURL(checkoutURL ?? BILLING_PLANS_URL);
  }
</script>

<style>
  .page {
    max-width: 68em;
    padding-block-end: 48px;
  }

  .access-layout {
    display: grid;
    grid-template-columns: minmax(220px, 0.8fr) minmax(320px, 1.2fr);
    gap: 20px;
    align-items: start;
  }

  .access-summary {
    display: flex;
    align-items: flex-start;
    gap: 14px;
    min-width: 0;
  }

  .status-mark {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    width: 24px;
    height: 24px;
    color: var(--icon-primary);
  }

  strong {
    display: block;
    line-height: 1.35;
  }

  p {
    margin: 6px 0 0;
    line-height: 1.45;
    color: color-mix(in srgb, var(--main-fg) 72%, transparent);
  }

  .key-preview,
  .validation-time,
  .help-text,
  .purchase-note {
    font-size: 12px;
  }

  .key-preview {
    font-family: var(--font-monospace, monospace);
  }

  .activation-panel {
    min-width: 0;
  }

  label {
    display: block;
    margin-block-end: 7px;
    font-size: 13px;
    font-weight: 600;
  }

  .activation-row {
    display: flex;
    gap: 8px;
    align-items: stretch;
  }

  input {
    min-width: 0;
    flex: 1 1 auto;
    box-sizing: border-box;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 10px;
    background: var(--main-bg);
    color: var(--main-fg);
    font: 13px var(--font-monospace, monospace);
  }

  input:focus-visible {
    outline: 2px solid var(--icon-primary);
    outline-offset: 2px;
  }

  :global(.activation-button) {
    flex: 0 0 auto;
  }

  .access-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-block-start: 12px;
  }

  .feedback {
    padding: 8px 10px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--main-fg) 6%, var(--main-bg));
  }

  .feedback.error {
    color: var(--danger-fg, #b84e3b);
    background: color-mix(in srgb, #a52f2f 10%, var(--main-bg));
  }

  .feedback.success {
    color: var(--fg);
    background: color-mix(in srgb, var(--icon-primary) 10%, var(--main-bg));
  }

  .feature-list {
    margin: 0;
    padding: 0;
    list-style: none;
    border-block-start: 1px solid var(--border);
  }

  .feature-list li {
    display: grid;
    grid-template-columns: minmax(10em, 15em) minmax(0, 1fr);
    gap: 4px 24px;
    padding-block: 12px;
    border-block-end: 1px solid var(--border);
  }

  .feature-list p {
    margin: 0;
    font-size: 14px;
  }

  h2 {
    margin: 0;
    font-size: 16px;
    line-height: 1.3;
  }

  .plans {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .plan-card {
    min-width: 0;
    padding: 14px 0 0;
    border-block-start: 1px solid var(--border);
  }

  .plan-card.featured {
    border-block-start: 2px solid var(--main-fg);
  }

  .plan-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  .plan-price {
    margin-block-start: 16px;
    color: var(--fg);
    font-size: 22px;
    font-variant-numeric: tabular-nums;
    font-weight: 700;
    letter-spacing: -0.02em;
  }

  .plan-card p {
    font-size: 14px;
  }

  :global(.plan-action) {
    margin-block-start: 16px;
  }

  .purchase-note {
    margin-block-start: 14px;
  }

  .trial-panel {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-block-start: 16px;
    padding-block: 14px 0;
    border-block-start: 1px solid var(--border);
  }

  .trial-panel p {
    max-width: 58em;
    font-size: 13px;
  }

  :global(.trial-action) {
    flex: 0 0 auto;
  }

  .purchase-note.unavailable {
    color: var(--danger-fg, #b84e3b);
  }

  @media (max-width: 720px) {
    .access-layout,
    .plans,
    .feature-list li {
      grid-template-columns: 1fr;
    }

    .activation-row {
      flex-direction: column;
    }

    :global(.activation-button) {
      align-self: flex-start;
    }

    .trial-panel {
      align-items: flex-start;
      flex-direction: column;
    }
  }

  /* Справа от списка разделов настроек места меньше, чем ширина окна. */
  @container settings-page (max-width: 720px) {
    .access-layout,
    .plans,
    .feature-list li {
      grid-template-columns: 1fr;
    }

    .activation-row {
      flex-direction: column;
    }

    :global(.activation-button) {
      align-self: flex-start;
    }

    .trial-panel {
      align-items: flex-start;
      flex-direction: column;
    }
  }
</style>
