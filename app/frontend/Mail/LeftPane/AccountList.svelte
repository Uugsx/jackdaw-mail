<vbox class="account-list">
  <FastList items={accounts} bind:selectedItem={selectedAccount} columns="1fr" {autoHeight}
    on:selected={event => dispatch("select", event.detail)}>
    <svelte:fragment slot="header">
      <hbox class="header">
        <hbox class="header-label font-smallest">{$t`Accounts`}</hbox>
        <hbox flex />
        <slot name="top-right" />
      </hbox>
    </svelte:fragment>
    <svelte:fragment slot="row" let:item={account}>
      <AccountListItem {account} showExpand={false} />
    </svelte:fragment>
  </FastList>
</vbox>

<script lang="ts">
  import type { MailAccount } from "../../../logic/Mail/MailAccount";
  import AccountListItem from "./AccountListItem.svelte";
  import FastList from "../../Shared/FastList.svelte";
  import type { Collection } from 'svelte-collections';
  import { t } from "../../../l10n/l10n";
  import { createEventDispatcher } from "svelte";

  export let accounts: Collection<MailAccount>;
  export let selectedAccount: MailAccount; /* in/out */
  export let autoHeight = false;

  const dispatch = createEventDispatcher<{ select: MailAccount }>();
</script>

<style>
  .account-list :global(.fast-list) {
    overflow: inherit;
  }
  .header {
    align-items: end;
    margin-inline-start: 4px;
  }
  .header-label {
    color: grey;
  }
  .header :global(button) {
    margin-inline-start: 4px;
  }
</style>
