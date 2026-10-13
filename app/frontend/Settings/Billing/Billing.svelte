<vbox class="billing page">
  <PageHeader
    title={$t`Jackdaw Pro`}
    subtitle={$t`Reports and live SLA control for teams that need a clear response deadline.`}
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
    <hbox slot="header">{$t`What is included in Pro`}</hbox>
    <div class="feature-grid">
      {#each proFeatures as feature}
        <article class="feature">
          <div class="feature-icon" aria-hidden="true">
            <svelte:component this={feature.icon} size="18px" />
          </div>
          <div>
            <h2>{feature.title()}</h2>
            <p>{feature.description()}</p>
          </div>
        </article>
      {/each}
    </div>
  </HeaderGroupBox>

  <HeaderGroupBox>
    <hbox slot="header">{$t`Plans`}</hbox>
    <div class="plans">
      <article class="plan-card">
        <div class="plan-heading">
          <div>
            <span class="eyebrow">{$t`Flexible`}</span>
            <h2>{$t`Monthly Pro`}</h2>
          </div>
          <CalendarIcon size="22px" aria-hidden="true" />
        </div>
        <p>{$t`Pay month by month. The current price is shown on the secure checkout page.`}</p>
        {#if checkoutURLs.monthly}
          <Button
            label={$t`Open plans`}
            icon={ExternalLinkIcon}
            classes="plan-action"
            onClick={() => openCheckout("monthly")}
            />
        {/if}
      </article>
      <article class="plan-card featured">
        <div class="plan-heading">
          <div>
            <span class="eyebrow">{$t`Best value`}</span>
            <h2>{$t`Yearly Pro`}</h2>
          </div>
          <SparklesIcon size="22px" aria-hidden="true" />
        </div>
        <p>{$t`One annual payment. The current price and renewal terms are shown before payment.`}</p>
        {#if checkoutURLs.yearly}
          <Button
            label={$t`Open plans`}
            icon={ExternalLinkIcon}
            classes="plan-action"
            onClick={() => openCheckout("yearly")}
            />
        {/if}
      </article>
    </div>
  </HeaderGroupBox>
</vbox>

<script lang="ts">
  import CalendarIcon from "lucide-svelte/icons/calendar-days";
  import ChartIcon from "lucide-svelte/icons/chart-column";
  import ExternalLinkIcon from "lucide-svelte/icons/external-link";
  import SparklesIcon from "lucide-svelte/icons/sparkles";
  import { t } from "../../../l10n/l10n";
  import {
    BILLING_CHECKOUT_URLS,
    BILLING_PLANS_URL,
    type BillingPlan,
  } from "../../../logic/Billing/Billing";
  import ClockIcon from "lucide-svelte/icons/clock-3";
  import BellIcon from "lucide-svelte/icons/bell-ring";
  import Button from "../../Shared/Button.svelte";
  import HeaderGroupBox from "../../Shared/HeaderGroupBox.svelte";
  import PageHeader from "../Shared/PageHeader.svelte";
  import { openExternalURL } from "../../../logic/util/os-integration";

  const checkoutURLs = BILLING_CHECKOUT_URLS;

  const proFeatures = [
    {
      icon: ChartIcon,
      title: () => $t`Interactive reports`,
      description: () => $t`Charts, dashboard widgets, filters, sorting and a full report view inside Jackdaw.`,
    },
    {
      icon: ClockIcon,
      title: () => $t`Live SLA control`,
      description: () => $t`A right-side queue with a working-time timer, deadline and overdue state for every open request.`,
    },
    {
      icon: CalendarIcon,
      title: () => $t`Working calendar`,
      description: () => $t`Different working hours for each weekday, with weekends and out-of-hours time excluded from SLA.`,
    },
    {
      icon: BellIcon,
      title: () => $t`Reminders`,
      description: () => $t`Configurable checkpoints such as 10, 20 and 25 working minutes before a reply.`,
    },
    {
      icon: ExternalLinkIcon,
      title: () => $t`HTML export`,
      description: () => $t`Save a checked, detailed report as an HTML copy after reviewing it inside the app.`,
    },
  ];

  async function openPlans(): Promise<void> {
    await openExternalURL(BILLING_PLANS_URL);
  }

  async function openCheckout(plan: BillingPlan): Promise<void> {
    let checkoutURL = checkoutURLs[plan];
    if (checkoutURL) {
      await openExternalURL(checkoutURL);
      return;
    }
    await openPlans();
  }
</script>

<style>
  .page {
    max-width: 68em;
    padding-block-end: 48px;
  }

  .feature-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    color: var(--selected-bg);
  }

  p {
    margin: 6px 0 0;
    line-height: 1.45;
    color: color-mix(in srgb, var(--main-fg) 72%, transparent);
  }

  .eyebrow {
    color: color-mix(in srgb, var(--main-fg) 64%, transparent);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }

  .feature-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .feature {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    min-width: 0;
    padding: 14px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: color-mix(in srgb, var(--main-bg) 84%, var(--headerbar-bg));
  }

  h2 {
    margin: 0;
    font-size: 16px;
    line-height: 1.3;
  }

  .feature p {
    font-size: 14px;
  }

  .plans {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .plan-card {
    min-width: 0;
    padding: 16px;
    border: 1px solid var(--border);
    border-radius: 8px;
  }

  .plan-card.featured {
    border-color: color-mix(in srgb, var(--selected-bg) 48%, var(--border));
    background: color-mix(in srgb, var(--selected-bg) 7%, var(--main-bg));
  }

  .plan-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  .plan-heading :global(svg) {
    flex: 0 0 auto;
    color: var(--selected-bg);
  }

  .plan-card p {
    font-size: 14px;
  }

  :global(.plan-action) {
    margin-block-start: 16px;
  }

  @media (max-width: 720px) {
    .feature-grid,
    .plans {
      grid-template-columns: 1fr;
    }

  }
</style>
