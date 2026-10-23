<!-- Над списком писем, как в Outlook: пока автоответ отправляется, его видно и можно выключить. -->
{#if active}
  <hbox class="out-of-office-bar font-small" role="status">
    <PlaneIcon size="15px" strokeWidth={2} aria-hidden="true" />
    <hbox class="summary" title={summaryText}>
      <span class="title">{$t`Automatic replies are on`}</span>
      {#if untilText}
        <span class="until">{untilText}</span>
      {/if}
    </hbox>
    <hbox flex />
    <button type="button" class="text-button" on:click={openSettings}>{$t`Settings`}</button>
    <button type="button" class="primary" disabled={turningOff} aria-busy={turningOff}
      on:click={turnOff}>{$t`Turn off`}</button>
  </hbox>
{/if}

<script lang="ts">
  import type { MailAccount } from "../../logic/Mail/MailAccount";
  import { ExchangeMailAccount } from "../../logic/Mail/EWS/ExchangeMailAccount";
  import { isOutOfOfficeActive } from "../../logic/Mail/EWS/OutOfOffice";
  import { openSettingsCategoryForAccount } from "../Settings/Window/CategoriesUtils";
  import { getDateTimeString } from "../Util/date";
  import { showError } from "../Util/error";
  import PlaneIcon from "lucide-svelte/icons/plane";
  import { onDestroy } from "svelte";
  import { t } from "../../l10n/l10n";

  export let account: MailAccount | null;

  /** Расписание начинается и кончается само: перепроверяем раз в минуту */
  const kRecheckMs = 60 * 1000;
  let now = new Date();
  let timer = setInterval(() => now = new Date(), kRecheckMs);
  onDestroy(() => clearInterval(timer));

  let turningOff = false;

  $: exchangeAccount = account instanceof ExchangeMailAccount && account.canOutOfOffice ? account : null;
  $: settings = $exchangeAccount?.outOfOffice ?? null;
  $: active = isOutOfOfficeActive(settings, now);
  $: untilText = active && settings.state == "Scheduled" && settings.end
    ? $t`until ${getDateTimeString(settings.end)}`
    : "";
  $: summaryText = untilText ? $t`Automatic replies are on` + " " + untilText : $t`Automatic replies are on`;

  async function turnOff() {
    turningOff = true;
    try {
      await exchangeAccount.turnOffOutOfOffice();
    } catch (ex) {
      showError(ex);
    } finally {
      turningOff = false;
    }
  }

  function openSettings() {
    openSettingsCategoryForAccount(exchangeAccount, "mail-out-of-office");
  }
</script>

<style>
  .out-of-office-bar {
    --oof-tone: var(--warning-fg, #8A5A00);
    flex: 0 0 auto;
    align-items: center;
    gap: 8px;
    min-height: 36px;
    padding: 4px 8px 4px 14px;
    box-sizing: border-box;
    border-block-end: 1px solid color-mix(in srgb, var(--oof-tone) 30%, var(--border));
    background-color: color-mix(in srgb, var(--oof-tone) 12%, var(--main-bg));
    color: var(--main-fg);
  }
  .out-of-office-bar > :global(svg) {
    flex: 0 0 auto;
    color: var(--oof-tone);
  }
  .summary {
    display: block;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .title {
    font-weight: 600;
  }
  .until {
    margin-inline-start: 6px;
    color: color-mix(in srgb, var(--main-fg) 72%, transparent);
  }
  button {
    flex: 0 0 auto;
    font: inherit;
    color: inherit;
    cursor: pointer;
    white-space: nowrap;
  }
  button:focus-visible {
    outline: 2px solid var(--icon-primary);
    outline-offset: 1px;
  }
  button:disabled {
    cursor: default;
    opacity: 0.6;
  }
  .text-button {
    height: 26px;
    padding: 0 8px;
    border: none;
    border-radius: 4px;
    background: none;
  }
  .text-button:hover {
    background-color: color-mix(in srgb, var(--main-fg) 10%, transparent);
  }
  .primary {
    padding: 3px 10px;
    border: 1px solid color-mix(in srgb, var(--oof-tone) 60%, transparent);
    border-radius: 6px;
    background-color: var(--main-bg);
    font-weight: 600;
  }
  .primary:not(:disabled):hover {
    background-color: color-mix(in srgb, var(--oof-tone) 16%, var(--main-bg));
  }
</style>
