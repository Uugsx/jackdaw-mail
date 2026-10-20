<HeaderGroupBox>
  <hbox slot="header">{$t`Shared mailboxes`}</hbox>
  <p class="intro">
    {$t`Colleagues who confirmed the same shared mailbox see when you read or reply to its message, and you see them. The server gets only the mailbox address and a code of the message, not its subject or text.`}
  </p>
  <hbox class="option">
    <input type="checkbox" id="collision-enabled" bind:checked={$collisionEnabledSetting.value} />
    <label for="collision-enabled">{$t`Show who is reading or replying to shared mailbox messages`}</label>
  </hbox>
  {#if $collisionEnabledSetting.value && accounts.length}
    <ul class="mailboxes">
      {#each accounts as account (account.id)}
        {@const address = normalizeCallEmail(account.emailAddress)}
        {@const enabled = ($collisionMailboxesSetting.value, isCollisionEnabledFor(account))}
        <li>
          <hbox class="option">
            <input
              type="checkbox"
              id="collision-{account.id}"
              checked={enabled}
              on:change={event => setCollisionEnabledFor(account, event.currentTarget.checked)}
              />
            <label for="collision-{account.id}">
              {address}
              <span class="kind">{isSharedMailboxAccount(account) ? $t`shared mailbox` : $t`personal mailbox`}</span>
            </label>
          </hbox>
          {#if enabled && !$client.verifiedEmails.includes(address)}
            <p class="hint">{$t`Confirm this address above to see colleagues.`}</p>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</HeaderGroupBox>

<script lang="ts">
  /** Настройки предупреждения о коллизии: по умолчанию включено только для общих ящиков */
  import { appGlobal } from "../../../logic/app";
  import { getJackdawCallClient } from "../../../logic/Meet/Jackdaw/JackdawCalls";
  import { normalizeCallEmail } from "../../../logic/Meet/Jackdaw/JackdawCallProtocol";
  import {
    collisionEnabledSetting,
    collisionMailboxesSetting,
    isCollisionEnabledFor,
    isSharedMailboxAccount,
    setCollisionEnabledFor,
  } from "./collisionPresence";
  import HeaderGroupBox from "../../Shared/HeaderGroupBox.svelte";
  import { t } from "../../../l10n/l10n";

  const client = getJackdawCallClient();
  const emailAccounts = appGlobal.emailAccounts;

  /** Общие ящики первыми: для них функция и задумана */
  $: accounts = $emailAccounts.contents
    .filter(account => !!normalizeCallEmail(account.emailAddress))
    .sort((a, b) => Number(isSharedMailboxAccount(b)) - Number(isSharedMailboxAccount(a)));
</script>

<style>
  p {
    margin: 6px 0 0;
    line-height: 1.45;
    color: color-mix(in srgb, var(--main-fg) 72%, transparent);
  }
  .intro {
    margin-block-end: 12px;
  }
  .option {
    align-items: center;
    gap: 8px;
  }
  .mailboxes {
    margin: 12px 0 0;
    padding: 0 0 0 24px;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  label {
    overflow-wrap: anywhere;
  }
  .kind {
    margin-inline-start: 6px;
    font-size: 12px;
    color: color-mix(in srgb, var(--main-fg) 60%, transparent);
  }
  .hint {
    margin-inline-start: 24px;
    font-size: 12px;
  }
</style>
