<!-- Настройки → Почта → Нежелательная почта: надёжные и заблокированные отправители по ящикам,
  адрес для «Сообщить о фишинге» -->
<hbox class="groups">
  <HeaderGroupBox>
    <hbox slot="header">{$t`Safe and blocked senders`}</hbox>
    <vbox class="junk">
      {#if $accounts.isEmpty}
        <hbox class="description font-small">{$t`No mail accounts`}</hbox>
      {:else}
        <hbox class="account-row">
          <label for="junk-account">{$t`Account`}</label>
          <select id="junk-account" bind:value={accountID}>
            {#each $accounts.each as account (account.id)}
              <option value={account.id}>{account.name}</option>
            {/each}
          </select>
        </hbox>
        <hbox class="description font-small">
          {#if account && hasServerSenderLists(account)}
            {$t`These lists are stored on the Exchange server and also apply in Outlook.`}
          {:else if account?.protocol == "ews"}
            {$t`Exchange filters the mail itself. When you block or trust a sender from a message, Exchange adds the sender to its own lists too.`}
          {:else}
            {$t`New mail from blocked senders is moved to Spam, and mail from safe senders is moved back to the Inbox.`}
          {/if}
        </hbox>
        {#if loading}
          <hbox class="description font-small">{$t`Loading…`}</hbox>
        {:else}
          {#if errorText}
            <hbox class="error font-small">{errorText}</hbox>
          {/if}
          <hbox class="lists">
            {#each kLists as list (list.id)}
              <vbox class="list" flex>
                <h4 class="font-small">{list.id == "trusted" ? $t`Safe senders` : $t`Blocked senders`}</h4>
                <hbox class="add-row">
                  <input type="text" class="font-small"
                    placeholder={$t`Address or domain`}
                    bind:value={newEntries[list.id]}
                    on:keydown={event => event.key == "Enter" && add(list.id)} />
                  <Button plain iconOnly icon={AddIcon} iconSize="16px"
                    label={$t`Add`}
                    disabled={!newEntries[list.id]?.trim()}
                    onClick={() => add(list.id)} />
                </hbox>
                <vbox class="entries">
                  {#each lists[list.id] as entry (entry)}
                    <hbox class="entry font-small">
                      <span flex>{entry}</span>
                      <Button plain iconOnly icon={RemoveIcon} iconSize="14px"
                        label={$t`Remove`}
                        onClick={() => remove(list.id, entry)} />
                    </hbox>
                  {:else}
                    <hbox class="description font-small">{$t`The list is empty`}</hbox>
                  {/each}
                </vbox>
              </vbox>
            {/each}
          </hbox>
        {/if}
      {/if}
    </vbox>
  </HeaderGroupBox>

  <HeaderGroupBox>
    <hbox slot="header">{$t`Report phishing`}</hbox>
    <vbox class="junk">
      <hbox class="description font-small">
        {$t`“Report phishing” forwards the message as an attachment to this address, usually your security team, and moves it to Spam.`}
      </hbox>
      <input type="email" class="phishing-address"
        placeholder="security@example.com"
        bind:value={$phishingAddress.value} />
      {#if $phishingAddress.value?.trim() && !getPhishingReportAddress()}
        <hbox class="error font-small">{$t`This is not an email address`}</hbox>
      {/if}
    </vbox>
  </HeaderGroupBox>
</hbox>

<script lang="ts">
  import type { MailAccount } from "../../../logic/Mail/MailAccount";
  import {
    addSenderEntry, getLocalSenderLists, getPhishingReportAddress, hasServerSenderLists, kPhishingAddressKey,
    loadSenderLists, removeSenderEntry, saveSenderLists, type SenderLists,
  } from "../../../logic/Mail/Junk/SenderLists";
  import { appGlobal } from "../../../logic/app";
  import { getLocalStorage } from "../../Util/LocalStorage";
  import HeaderGroupBox from "../../Shared/HeaderGroupBox.svelte";
  import Button from "../../Shared/Button.svelte";
  import AddIcon from "lucide-svelte/icons/plus";
  import RemoveIcon from "lucide-svelte/icons/x";
  import { t } from "../../../l10n/l10n";

  const kLists: { id: keyof SenderLists }[] = [{ id: "trusted" }, { id: "blocked" }];
  const accounts = appGlobal.emailAccounts;
  const phishingAddress = getLocalStorage<string>(kPhishingAddressKey, "");

  let accountID: string = accounts.first?.id;
  let lists: SenderLists = { trusted: [], blocked: [] };
  let newEntries: Record<keyof SenderLists, string> = { trusted: "", blocked: "" };
  let loading = false;
  let errorText: string | null = null;

  $: account = accounts.find(candidate => candidate.id == accountID) as MailAccount;
  $: load(account);

  async function load(account: MailAccount) {
    errorText = null;
    if (!account) {
      return;
    }
    lists = getLocalSenderLists(account);
    if (!hasServerSenderLists(account)) {
      return;
    }
    loading = true;
    try {
      let loaded = await loadSenderLists(account);
      if (account == accounts.find(candidate => candidate.id == accountID)) {
        lists = loaded;
      }
    } catch (ex) {
      errorText = ex?.message ?? String(ex);
    } finally {
      loading = false;
    }
  }

  async function save(changed: SenderLists) {
    errorText = null;
    try {
      await saveSenderLists(account, changed);
      lists = changed;
    } catch (ex) {
      errorText = ex?.message ?? String(ex);
    }
  }

  async function add(list: keyof SenderLists) {
    let entry = newEntries[list]?.trim();
    if (!entry) {
      return;
    }
    try {
      await save(addSenderEntry(lists, list, entry));
      newEntries[list] = "";
    } catch (ex) {
      errorText = ex?.message ?? String(ex);
    }
  }

  async function remove(list: keyof SenderLists, entry: string) {
    await save(removeSenderEntry(lists, list, entry));
  }
</script>

<style>
  .groups {
    flex-wrap: wrap;
  }
  .junk {
    gap: 8px;
    max-width: 44em;
  }
  .account-row {
    align-items: center;
    gap: 8px;
  }
  .description {
    opacity: 0.7;
  }
  .error {
    color: var(--error-fg, #c62828);
  }
  .lists {
    gap: 24px;
    flex-wrap: wrap;
  }
  .list {
    min-width: 16em;
    gap: 4px;
  }
  h4 {
    margin: 4px 0px;
    font-weight: 600;
  }
  .add-row {
    align-items: center;
    gap: 4px;
  }
  .add-row input {
    flex: 1 1 auto;
    min-width: 0;
  }
  .entries {
    max-height: 16em;
    overflow-y: auto;
  }
  .entry {
    align-items: center;
    justify-content: space-between;
    min-height: 26px;
    border-bottom: 1px solid var(--border);
  }
  .entry span {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .phishing-address {
    max-width: 24em;
  }
</style>
