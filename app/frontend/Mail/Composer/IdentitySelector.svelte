<hbox class="identity-selector">
  {#if selectedIdentity.isCatchAll}
    <label for="customFrom">{$t`From`}</label>
    <hbox class="before-custom">{beforeCustom}</hbox>
    <input type="email" bind:value={editableCustom}
      name="customFrom" spellcheck="false"
      on:change={() => catchErrors(onCustomEdited)}
      size={editableCustom?.length}
      />
    <hbox class="after-custom">{afterCustom}</hbox>
    {#if !compact}
      <hbox class="account">
        {selectedIdentity.account?.name}
      </hbox>
    {/if}
  {/if}
  {#if $visibleIdentities.length > 1 || showOtherAddress}
    <select value={selectedIdentity} on:change={event => catchErrors(() => onSelectChange(event))} class:catch-all={selectedIdentity.isCatchAll}>
      {#each $visibleIdentities.each as identity }
        <option value={identity}>
          {identity.isCatchAll && identity.isEMailAddress(fromAddress) && identity.emailAddress != fromAddress
            ? fromAddress
            : identity.name}
          -
          {identity.account?.name}
        </option>
      {/each}
      {#if showOtherAddress}
        <option value={kOtherAddress}>{$t`Other address…`}</option>
      {/if}
    </select>
  {/if}
</hbox>

<script lang="ts">
  import { findAllIdentities, type MailIdentity } from "../../../logic/Mail/MailIdentity";
  import type { Workspace } from "../../../logic/Abstract/Workspace";
  import { catchErrors } from "../../Util/error";
  import { askOtherFromAddress } from "../SendAs/sendAs";
  import { addDelegateIdentity, canSendFromOtherAddress } from "../../../logic/Mail/SendAs/SendAs";
  import { ArrayColl, type Collection } from "svelte-collections";
  import { t } from "../../../l10n/l10n";

  export let selectedIdentity: MailIdentity; /* in/out */
   /** Which identities to select from.
    * Default: all identities of all accounts
    * in */
  export let identities: Collection<MailIdentity> = findAllIdentities();
  /** Allows the user to override the From address with a custom email address.
   * This allows for catch-all email addresses to be used as From: */
  export let fromAddress: string;
  export let fromName: string;
  /** Hide secondary account label in compact compose header */
  export let compact = false;
  /** Если задано, показывать только адреса аккаунтов этого пространства. */
  export let workspace: Workspace | null | undefined = undefined;
  /** Пункт «Другой адрес…» для ящиков с правами «Отправить как / от имени» (Exchange) */
  export let allowOtherAddress = false;

  const kOtherAddress = "other-address";
  $: showOtherAddress = allowOtherAddress && canSendFromOtherAddress(selectedIdentity?.account);

  let beforeCustom: string;
  let afterCustom: string;
  let editableCustom: string;
  $: visibleIdentities = workspace
    ? identities.filterObservable(identity => identity.account?.workspace == workspace)
    : identities;

  // При смене пространства оставляем выбранного отправителя в видимом списке.
  $: $visibleIdentities, selectedIdentity, keepSelectedIdentityInWorkspace();
  function keepSelectedIdentityInWorkspace() {
    if ($visibleIdentities.hasItems && !$visibleIdentities.includes(selectedIdentity)) {
      selectedIdentity = $visibleIdentities.first;
    }
  }

  $: $selectedIdentity && setIdentity($selectedIdentity)
  function setIdentity(identity: MailIdentity) {
    fromName = identity.realname;
    if (!identity?.isCatchAll) {
      fromAddress = identity.emailAddress;
      return;
    }
    if (!identity.isEMailAddress(fromAddress)) {
      fromAddress = identity.emailAddress;
    }

    let parts = identity.emailAddress.split("*");
    beforeCustom = parts[0];
    afterCustom = parts[1];
    editableCustom = fromAddress.substring(beforeCustom.length, fromAddress.length - afterCustom.length);
  }

  async function onSelectChange(event: Event) {
    let select = event.target as HTMLSelectElement;
    let index = select.selectedIndex;
    let chosen = $visibleIdentities.contents[index];
    if (chosen) {
      selectedIdentity = chosen;
      return;
    }
    // «Другой адрес…»: пока вводят адрес, в списке остаётся прежний отправитель
    select.selectedIndex = $visibleIdentities.contents.indexOf(selectedIdentity);
    let account = selectedIdentity.account;
    let address = await askOtherFromAddress(account);
    if (!address) {
      return;
    }
    let identity = await addDelegateIdentity(account, address);
    // `findAllIdentities()` — снимок: без этого выбор сбросился бы на первый адрес
    if (!identities.includes(identity) && identities instanceof ArrayColl) {
      identities.add(identity);
    }
    selectedIdentity = identity;
  }

  function onCustomEdited() {
    fromAddress = beforeCustom + editableCustom + afterCustom;
  }
</script>

<style>
  .identity-selector {
    align-items: center;
  }
  .identity-selector select {
    border: none;
    color: inherit;
    background-color: transparent;
    font-size: 12px;
    max-width: 100%;
  }
  label {
    margin-inline-end: 12px;
  }
  input[type=email] {
    min-width: 20vw;
    width: 20%;
  }
  .before-custom,
  .after-custom,
  .account {
    overflow-x: hidden; /* TODO not working. Problem: Mobile, with long domains. */
  }
  select.catch-all {
    width: 20px;
    height: 100%;
  }
  .account {
    margin-inline-start: 16px;
    font-style: italic;
    opacity: 75%;
  }
</style>
