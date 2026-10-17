<vbox class="jackdaw-calls page">
  <PageHeader
    title={$t`Calls and chat`}
    subtitle={$t`Calls and end-to-end encrypted chat between Jackdaw Mail users, by email address. They go through the Jackdaw server, not through your mail provider.`}
    />

  <HeaderGroupBox>
    <hbox slot="header">{$t`Connection`}</hbox>
    <div class="status-row" role="status" aria-live="polite">
      <span class="status-dot {$client.status}" aria-hidden="true"></span>
      <div>
        <strong>{statusLabel($client.status)}</strong>
        {#if $client.lastError}
          <p class="error">{$client.lastError}</p>
        {:else if $client.status == "disabled"}
          <p>{$t`Calls need an active Jackdaw Pro license or trial on this device.`}</p>
        {:else if $client.status == "offline"}
          <p>{$t`The call server cannot be reached. Jackdaw keeps trying to reconnect.`}</p>
        {/if}
      </div>
      <hbox flex />
      {#if $client.status == "offline" || $client.status == "rejected"}
        <Button
          label={$t`Reconnect`}
          icon={RefreshIcon}
          classes="secondary"
          onClick={() => client.restart()}
          />
      {/if}
    </div>
  </HeaderGroupBox>

  <HeaderGroupBox>
    <hbox slot="header">{$t`Your addresses for calls`}</hbox>
    <p class="intro">
      {$t`Other Jackdaw Mail users can call you and write to you in Jackdaw chat on a confirmed address. We send a code to the address to make sure it is yours.`}
    </p>
    {#if !$emailAccounts.length}
      <p class="empty">{$t`Add a mail account first. Its address can then be confirmed for calls.`}</p>
    {:else}
      <ul class="addresses">
        {#each myAddresses as address (address)}
          {@const confirmed = $client.verifiedEmails.includes(address)}
          <li class:confirmed>
            <div class="address-row">
              <span class="address">{address}</span>
              {#if confirmed}
                <span class="badge confirmed-badge">
                  <CheckIcon size="14px" aria-hidden="true" />
                  {$t`Confirmed`}
                </span>
                <hbox flex />
                <Button
                  label={$t`Disconnect`}
                  classes="secondary"
                  onClick={() => disconnect(address)}
                  />
              {:else}
                <hbox flex />
                {#if mailAccountForAddress(address)}
                  <Button
                    label={reverse?.address == address ? $t`Waiting for the email…` : $t`Confirm by email`}
                    tooltip={$t`Jackdaw sends a short email from this address to the Jackdaw server. Use this if the code does not arrive, for example with company mail.`}
                    classes="secondary"
                    disabled={!$client.isOnline || busyAddress == address || reverse?.address == address}
                    onClick={() => confirmByMail(address)}
                    />
                {/if}
                <Button
                  label={codeSentTo == address ? $t`Send again` : $t`Confirm`}
                  classes={codeSentTo == address ? "secondary" : "filled"}
                  disabled={!$client.isOnline || busyAddress == address}
                  onClick={() => sendCode(address)}
                  />
              {/if}
            </div>
            {#if codeSentTo == address && !confirmed}
              <form class="code-row" on:submit|preventDefault={() => confirmCode(address)}>
                <label for="call-code-{address}">{$t`Code from the email`}</label>
                <div class="code-inputs">
                  <input
                    id="call-code-{address}"
                    bind:value={code}
                    inputmode="numeric"
                    autocomplete="one-time-code"
                    maxlength="12"
                    placeholder="000000"
                    aria-describedby="call-code-help"
                    />
                  <Button
                    label={$t`Confirm code`}
                    classes="filled"
                    disabled={!code.trim() || busyAddress == address}
                    onClick={() => confirmCode(address)}
                    />
                </div>
                <p id="call-code-help" class="help">{$t`The code is valid for 10 minutes.`}</p>
              </form>
            {/if}
            {#if feedbackFor == address && feedback}
              <p class="feedback {feedbackKind}" role={feedbackKind == "error" ? "alert" : "status"}>{feedback}</p>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </HeaderGroupBox>
</vbox>

<script context="module" lang="ts">
  /** Код из письма действует 10 минут (как на сервере). Пока он действует,
   * поле для кода остаётся открытым, даже если пользователь ушёл в почту
   * и вернулся или перезапустил приложение. Сам код здесь не хранится. */
  const kCodeTTLMS = 10 * 60 * 1000;
  const kPendingKey = "jackdaw.calls.pendingVerification";

  function loadPending(): { address: string, sentAt: number } | null {
    try {
      let pending = JSON.parse(localStorage.getItem(kPendingKey) ?? "null");
      if (typeof pending?.address == "string" && typeof pending?.sentAt == "number" &&
          Date.now() - pending.sentAt < kCodeTTLMS) {
        return pending;
      }
    } catch {
      // Нет доступа к хранилищу — поле просто не восстановится.
    }
    return null;
  }

  const kReversePendingKey = "jackdaw.calls.pendingReverseVerification";
  type ReversePending = { address: string, token: string, until: number };

  function loadReverse(): ReversePending | null {
    try {
      let pending = JSON.parse(localStorage.getItem(kReversePendingKey) ?? "null");
      if (typeof pending?.address == "string" && typeof pending?.token == "string" &&
          typeof pending?.until == "number" && Date.now() < pending.until) {
        return pending;
      }
    } catch {
      // Нет доступа к хранилищу — ожидание не восстановится после ухода со страницы.
    }
    return null;
  }

  function saveReverse(pending: ReversePending | null) {
    try {
      if (pending) {
        localStorage.setItem(kReversePendingKey, JSON.stringify(pending));
      } else {
        localStorage.removeItem(kReversePendingKey);
      }
    } catch {
      // Нет доступа к хранилищу — ожидание живёт только до ухода со страницы.
    }
  }

  function savePending(address: string | null) {
    try {
      if (address) {
        localStorage.setItem(kPendingKey, JSON.stringify({ address, sentAt: Date.now() }));
      } else {
        localStorage.removeItem(kPendingKey);
      }
    } catch {
      // Нет доступа к хранилищу — состояние живёт только до ухода со страницы.
    }
  }
</script>

<script lang="ts">
  import { getJackdawCallClient } from "../../../logic/Meet/Jackdaw/JackdawCalls";
  import type { JackdawCallStatus } from "../../../logic/Meet/Jackdaw/JackdawCallClient";
  import { normalizeCallEmail } from "../../../logic/Meet/Jackdaw/JackdawCallProtocol";
  import { appGlobal } from "../../../logic/app";
  import { mailAccountForAddress, sendReverseVerificationMail } from "../../../logic/Meet/Jackdaw/ReverseVerification";
  import { onDestroy } from "svelte";
  import Button from "../../Shared/Button.svelte";
  import HeaderGroupBox from "../../Shared/HeaderGroupBox.svelte";
  import PageHeader from "../Shared/PageHeader.svelte";
  import CheckIcon from "lucide-svelte/icons/check";
  import RefreshIcon from "lucide-svelte/icons/refresh-cw";
  import { t } from "../../../l10n/l10n";

  const client = getJackdawCallClient();
  const emailAccounts = appGlobal.emailAccounts;

  let codeSentTo: string | null = loadPending()?.address ?? null;
  let code = "";
  let busyAddress: string | null = null;
  let feedback: string | null = null;
  let feedbackKind: "error" | "success" = "success";
  let feedbackFor: string | null = null;
  /** Обратное подтверждение в ожидании письма */
  let reverse: ReversePending | null = loadReverse();
  /** Проверка, дошло ли письмо: сервер присылает `verified` сам, это — страховка после переподключения */
  const kReverseCheckMS = 15_000;
  let reverseTimer: ReturnType<typeof setInterval> | null = null;
  $: reverse ? startReverseChecks() : stopReverseChecks();
  $: if (reverse && $client.verifiedEmails.includes(reverse.address)) {
    reverseConfirmed(reverse.address);
  }
  onDestroy(stopReverseChecks);

  $: myAddresses = [...new Set($emailAccounts.contents
    .map(account => normalizeCallEmail(account.emailAddress))
    .filter((email): email is string => !!email))];

  function statusLabel(status: JackdawCallStatus): string {
    switch (status) {
      case "online": return $t`Connected to the call server`;
      case "connecting": return $t`Connecting…`;
      case "offline": return $t`Not connected`;
      case "rejected": return $t`Calls are not available for this license`;
      case "disabled": return $t`Calls are off`;
    }
  }

  function showFeedback(address: string, message: string, kind: "error" | "success") {
    feedbackFor = address;
    feedback = message;
    feedbackKind = kind;
  }

  async function sendCode(address: string) {
    busyAddress = address;
    feedback = null;
    try {
      await client.startVerification(address);
      codeSentTo = address;
      savePending(address);
      code = "";
      showFeedback(address, $t`We sent a code to ${address}. Check the inbox in Jackdaw.`, "success");
    } catch (ex) {
      showFeedback(address, ex.message, "error");
    } finally {
      busyAddress = null;
    }
  }

  async function confirmCode(address: string) {
    if (!code.trim() || busyAddress) return;
    busyAddress = address;
    feedback = null;
    try {
      await client.finishVerification(address, code);
      codeSentTo = null;
      savePending(null);
      code = "";
      showFeedback(address, $t`The address is confirmed. Other Jackdaw users can now call you.`, "success");
    } catch (ex) {
      showFeedback(address, ex.message, "error");
    } finally {
      busyAddress = null;
    }
  }

  async function confirmByMail(address: string) {
    let account = mailAccountForAddress(address);
    if (!account || busyAddress) return;
    busyAddress = address;
    feedback = null;
    try {
      let request = await client.startReverseVerification(address);
      await sendReverseVerificationMail(account, address, request);
      reverse = { address, token: request.token, until: Date.now() + request.expiresIn * 1000 };
      saveReverse(reverse);
      showFeedback(address, $t`We sent a short confirmation email from ${address}. The address will be confirmed automatically within a few minutes.`, "success");
    } catch (ex) {
      showFeedback(address, ex.message, "error");
    } finally {
      busyAddress = null;
    }
  }

  function startReverseChecks() {
    if (reverseTimer) return;
    reverseTimer = setInterval(checkReverse, kReverseCheckMS);
  }

  function stopReverseChecks() {
    if (reverseTimer) {
      clearInterval(reverseTimer);
      reverseTimer = null;
    }
  }

  async function checkReverse() {
    let pending = reverse;
    if (!pending) return;
    if (Date.now() >= pending.until) {
      reverse = null;
      saveReverse(null);
      showFeedback(pending.address, $t`The confirmation email did not arrive in time. Please try again.`, "error");
      return;
    }
    if (!client.isOnline) return;
    try {
      if (await client.checkReverseVerification(pending.token)) {
        reverseConfirmed(pending.address);
      }
    } catch {
      // Сеть или сервер недоступны — попробуем при следующей проверке.
    }
  }

  function reverseConfirmed(address: string) {
    reverse = null;
    saveReverse(null);
    showFeedback(address, $t`The address is confirmed. Other Jackdaw users can now call you.`, "success");
  }

  function disconnect(address: string) {
    if (!confirm($t`Stop receiving calls on ${address} on this device?`)) return;
    client.forgetEmail(address);
    showFeedback(address, $t`Calls on this address are turned off on this device.`, "success");
  }
</script>

<style>
  .page {
    max-width: 68em;
    padding-block-end: 48px;
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
  .status-row {
    display: flex;
    align-items: flex-start;
    gap: 12px;
  }
  .status-dot {
    flex: 0 0 auto;
    width: 10px;
    height: 10px;
    margin-block-start: 5px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--main-fg) 35%, transparent);
  }
  .status-dot.online {
    background: var(--icon-primary);
  }
  .status-dot.connecting {
    background: color-mix(in srgb, var(--icon-primary) 45%, transparent);
  }
  .status-dot.rejected,
  .status-dot.offline {
    background: var(--danger-fg, #b84e3b);
  }
  .intro {
    margin-block-end: 12px;
  }
  .addresses {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .addresses li {
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 10px 12px;
  }
  .address-row {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .address {
    font-family: var(--font-monospace, monospace);
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    font-weight: 600;
  }
  .confirmed-badge {
    color: var(--icon-primary);
  }
  .code-row {
    margin-block-start: 10px;
  }
  label {
    display: block;
    margin-block-end: 6px;
    font-size: 13px;
    font-weight: 600;
  }
  .code-inputs {
    display: flex;
    gap: 8px;
    align-items: stretch;
  }
  input {
    width: 10em;
    box-sizing: border-box;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 10px;
    background: var(--main-bg);
    color: var(--main-fg);
    font: 15px var(--font-monospace, monospace);
    letter-spacing: 0.2em;
    font-variant-numeric: tabular-nums;
  }
  input:focus-visible {
    outline: 2px solid var(--selected-border, var(--icon-primary));
    outline-offset: 1px;
  }
  .help {
    font-size: 12px;
  }
  .feedback {
    font-size: 13px;
    padding: 8px 10px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--icon-primary) 10%, var(--main-bg));
    color: var(--main-fg);
  }
  .feedback.error {
    background: color-mix(in srgb, #a52f2f 10%, var(--main-bg));
  }
  .feedback.error,
  .error {
    color: var(--danger-fg, #b84e3b);
  }
  .empty {
    font-style: italic;
  }
</style>
