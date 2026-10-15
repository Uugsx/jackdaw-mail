<FinalizeConfig config={account} />

<ButtonsBottom
  canContinue={true}
  onContinue={onOK}
  >
  <Button label="Back" classes="secondary"
    onClick={onBack}
    />
  <Button label="Skip" classes="secondary"
    onClick={onSkip}
    />
</ButtonsBottom>

<script lang="ts">
  import type { MailAccount } from "../../../logic/Mail/MailAccount";
  import FinalizeConfig from "../Mail/FinalizeConfig.svelte";
  import ButtonsBottom from "../Shared/ButtonsBottom.svelte";
  import Button from "../../Shared/Button.svelte";
  import { appGlobal } from "../../../logic/app";
  import { assertCanAddMailAccount } from "../../../logic/Billing/ProPolicy";

  export let account: MailAccount;
  export let onContinue = () => undefined;
  export let onSkip = () => undefined;
  export let onBack = () => undefined;
  export let mailAccountCount = appGlobal.emailAccounts.length;

  async function onOK() {
    assertCanAddMailAccount(mailAccountCount);
    await account.save();
    onContinue();
  }
</script>

<style>
</style>
