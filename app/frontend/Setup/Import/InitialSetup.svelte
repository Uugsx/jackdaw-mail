<vbox flex class="import-window">
  <hbox flex />
  <vbox class="page-box">
    {#if step == Step.SelectAccounts}
      <SelectAccounts bind:accounts={accountCandidates} onContinue={onSelectAccountsContinue} />
    {:else if step == Step.Login}
      <LoginPage {account} onContinue={onPasswordContinue} onBack={onPasswordBack} onSkip={onAccountSkip} />
    {:else if step == Step.FinalizeAccount}
      <FinalizeAccount
        {account}
        mailAccountCount={appGlobal.emailAccounts.length + importedAccountIDs.size}
        onContinue={onFinalizeContinue}
        onBack={onFinalizeBack} />
    {:else if step == Step.SelectAddressBooks}
      <SelectAddressbooks onContinue={onAddressbooksContinue} />
    {:else if step == Step.Done}
      <SetupAnyAccountType onContinue={onClose} />
    {/if}
  </vbox>
  <hbox flex />
  <BackgroundVideo />
</vbox>

<script lang="ts">
  import type { MailAccount } from "../../../logic/Mail/MailAccount";
  import { openApp } from "../../AppsBar/selectedApp";
  import { mailApp } from "../../Mail/MailJackdawApp";
  import SelectAccounts from "./SelectAccounts.svelte";
  import LoginPage from "./LoginPage.svelte";
  import FinalizeAccount from "./FinalizeAccount.svelte";
  import BackgroundVideo from "../Shared/BackgroundVideo.svelte";
  import SelectAddressbooks from "./SelectAddressbooks.svelte";
  import SetupAnyAccountType from "../SetupAnyAccountType.svelte";
  import { appGlobal } from "../../../logic/app";

  let accountCandidates: MailAccount[];
  let accounts: MailAccount[];
  let account: MailAccount;
  let currentAccountIndex = 0;
  let importedAccountIDs = new Set<string>();

  enum Step {
    SelectAccounts = 1,
    Login = 2,
    FinalizeAccount = 3,
    SelectAddressBooks = 4,
    Done = 5,
  }
  let step: Step = Step.SelectAccounts;

  function onSelectAccountsContinue() {
    importedAccountIDs = new Set();
    accounts = accountCandidates.filter(acc => (acc as any).import);
    if (accounts.length) {
      currentAccountIndex = 0;
      account = accounts[currentAccountIndex];
      step = Step.Login;
    } else {
      step = Step.SelectAddressBooks;
    }
  }

  function onBackToAccountsList() {
    accountCandidates = [];
    importedAccountIDs = new Set();
    step = Step.SelectAccounts;
  }

  function onAccountSkip() {
    nextAccount();
  }

  function onPasswordBack() {
    previousAccount();
  }

  function onPasswordContinue() {
    step = Step.FinalizeAccount;
  }

  function onFinalizeBack() {
    step = Step.Login;
  }

  function onFinalizeContinue() {
    let finalized = new Set(importedAccountIDs);
    finalized.add(account.id);
    importedAccountIDs = finalized;
    nextAccount();
  }

  function onAddressbooksContinue() {
    step = Step.Done;
  }

  function onClose() {
    openApp(mailApp, {});
  }

  function nextAccount() {
    if (++currentAccountIndex >= accounts.length) {
      step = Step.SelectAddressBooks;
      return;
    }
    account = accounts[currentAccountIndex];
    step = Step.Login;
  }

  function previousAccount() {
    if (--currentAccountIndex < 0) {
      onBackToAccountsList();
      return;
    }
    account = accounts[currentAccountIndex];
    step = Step.Login;
  }
</script>

<style>
  .import-window {
    justify-content: center;
    align-items: center;
  }
  .page-box {
    max-width: 32em;
    padding: 28px 48px 24px 48px;
    background-color: var(--main-bg);
    color: var(--main-fg);
    border: 1px solid var(--border);
    border-radius: var(--border-radius);
  }
  :global(.mobile) .page-box {
    padding: 16px 24px;
    border-radius: 16px;
  }
</style>
