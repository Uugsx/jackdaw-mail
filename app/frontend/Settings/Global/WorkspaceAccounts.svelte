<vbox class="account-type">
  <hbox class="header">
    <hbox class="title font-normal">{title}</hbox>
    <hbox class="spacer" flex />
    <hbox class="buttons">
      <RoundButton
        label={$t`Add a new account.\nTo move an account to this workspace, find it its current workspace and click the [Move] button next to the account.`}
        icon={AddIcon}
        iconSize="10px"
        padding="3px"
        classes="small"
        disabled={!canCreateAccount ? $t`A second email account requires Jackdaw Pro. Start the 7-day trial or activate a license.` : false}
        onClick={onNewAccount}
        />
    </hbox>
  </hbox>
  <vbox class="accounts-list">
    {#each $accounts.each as account}
      <hbox class="account">
        <Clickable onClick={() => onOpenAccount(account)}>
          <hbox class="name page-link">
            {account.name}
          </hbox>
        </Clickable>
        <hbox class="spacer" flex />
        <hbox class="buttons">
          <WorkspaceAccountMenu {account} {workspace} />
        </hbox>
      </hbox>
    {/each}
  </vbox>
</vbox>

<script lang="ts">
  import { Workspace } from "../../../logic/Abstract/Workspace";
  import { Account } from "../../../logic/Abstract/Account";
  import { settingsCategories } from "../SettingsCategory";
  import { openSettingsCategory, openSettingsCategoryByID, openSettingsCategoryForAccount } from "../Window/CategoriesUtils";
  import { SetupJackdawApp } from "../../Setup/SetupJackdawApp";
  import { openApp } from "../../AppsBar/selectedApp";
  import { changedWorkspace } from "../../MainWindow/Selected";
  import WorkspaceAccountMenu from "./WorkspaceAccountMenu.svelte";
  import RoundButton from "../../Shared/RoundButton.svelte";
  import Clickable from "../../Shared/Clickable.svelte";
  import AddIcon from "lucide-svelte/icons/plus";
  import { assert } from "../../../logic/util/util";
  import { Collection } from "svelte-collections";
  import { t } from "../../../l10n/l10n";
  import { appGlobal } from "../../../logic/app";
  import { canAddMailAccount } from "../../../logic/Billing/ProPolicy";
  import { proEntitlement } from "../../../logic/Billing/ProEntitlement";

  export let title: string;
  export let workspace: Workspace;
  export let allAccounts: Collection<Account>;
  /** ID of settings category with `.newAccountUI`, see SettingsCategories.ts */
  export let accountSettingsID: string;

  $: accounts = $changedWorkspace && allAccounts.filter(acc => acc.workspace == workspace);
  $: billingState = $proEntitlement.value;
  $: canCreateAccount = accountSettingsID != "mail" || (!!billingState && canAddMailAccount(appGlobal.emailAccounts.length));

  function onOpenAccount(account: Account) {
    openSettingsCategoryForAccount(account);
  }

  function onNewAccount() {
    let newAccountURL = settingsCategories.find(cat => cat.id == accountSettingsID).newAccountURL;
    assert(newAccountURL, "newAccountUI for " + accountSettingsID + " not found");
    let setupApp = new SetupJackdawApp();
    setupApp.appURL = newAccountURL;
    setupApp.onBack = () => onReOpenThis();
    openApp(setupApp, {});
  }

  function onReOpenThis() {
    openSettingsCategoryByID("global-workspaces");
  }
</script>

<style>
  .account-type {
    margin: 8px 48px 8px 0px;
  }
  .header .title {
    opacity: 70%;
    font-style: italic;
    min-width: max-content;
  }
  .spacer {
    min-width: 12px;
  }
  .account .name {
    min-width: max-content;
  }
  .account .name {
    min-width: max-content;
    color: var(--link-fg);
  }
  .buttons {
    align-items: center;
  }
</style>
