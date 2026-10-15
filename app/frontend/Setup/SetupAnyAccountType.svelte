<Header title={appGlobal.emailAccounts.hasItems ?  $t`Set up another account` : $t`Set up your first account`} />

<hbox class="add-buttons">
  <ExpanderButton
    on:expand={() => catchErrors(() => startSetup("mail"))}
    label={$t`Add email address`}
    disabled={!mailAccountAvailable ? $t`A second email account requires Jackdaw Pro. Start the 7-day trial or activate a license.` : false} />
  <ExpanderButton
    on:expand={() => catchErrors(() => startSetup("chat"))}
    label={$t`Add chat account`} />
  <ExpanderButton
    on:expand={() => catchErrors(() => startSetup("contacts"))}
    label={$t`Add address book`} />
  <ExpanderButton
    on:expand={() => catchErrors(() => startSetup("calendar"))}
    label={$t`Add calendar`} />
  <ExpanderButton
    on:expand={() => catchErrors(() => startSetup("meet"))}
    label={$t`Add video conference account`} />
  <!--
  <ExpanderButton
    on:expand={() => catchErrors(() => startSetup("file"))}
    label={$t`Add file sharing`} />
  -->
</hbox>

<hbox class="buttons-bottom">
  <hbox flex />
  <Button label={$t`Close`} classes="secondary"
    onClick={onClose}
    />
</hbox>

<script lang="ts">
  import { SetupJackdawApp } from "./SetupJackdawApp";
  import { mailApp } from "../Mail/MailJackdawApp";
  import { goTo, openApp } from "../AppsBar/selectedApp";
  import { appGlobal } from "../../logic/app";
  import ExpanderButton from "../Shared/ExpanderButton.svelte";
  import Header from "./Shared/Header.svelte";
  import Button from "../Shared/Button.svelte";
  import { catchErrors } from "../Util/error";
  import { t } from "../../l10n/l10n";
  import { canAddMailAccount } from "../../logic/Billing/ProPolicy";
  import { proEntitlement } from "../../logic/Billing/ProEntitlement";

  export let onContinue: () => void = null;

  $: billingState = $proEntitlement.value;
  $: mailAccountAvailable = !!billingState && canAddMailAccount(appGlobal.emailAccounts.length);

  async function startSetup(urlSuffix: string) {
    let setupApp = new SetupJackdawApp();
    let url = setupApp.appURL = "/setup/" + urlSuffix;
    setupApp.onBack = () => startSetup("");
    goTo(url, {});
  }

  function onClose() {
    if (onContinue) {
      onContinue();
    } else {
      openApp(mailApp, {});
    }
  }
</script>

<style>
  .add-buttons {
    display: grid;
    grid-template-columns: auto auto;
    flex-wrap: wrap;
  }
  .add-buttons :global(.expander-button) {
    margin-inline-end: 12px;
    margin-block-end: 8px;
    width: 100%;
    max-width: unset;
  }
  .add-buttons :global(.expander-button .button) {
    flex: 1 0 0;
  }
  .add-buttons :global(.expander-button .button .content) {
    flex: 1 0 0;
    min-height: 32px;
  }
  .add-buttons :global(.expander-button .button .content #text) {
    flex: 1 0 0;
  }

  .buttons-bottom {
    align-items: end;
    justify-content: end;
    margin-block-start: 32px;
  }
  .buttons-bottom :global(> *) {
    margin-inline-end: 8px;
  }
  .buttons-bottom :global(button.secondary) {
    background-color: inherit;
    font-weight: 300;
    color: var(--main-fg);
    opacity: 0.7;
  }
</style>
