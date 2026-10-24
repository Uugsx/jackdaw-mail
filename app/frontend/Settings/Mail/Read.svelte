<hbox class="groups">
  <!--
  <HeaderGroupBox>
    <hbox slot="header">
      Display
    </hbox>
    <vbox class="formatting">
    </vbox>
  </HeaderGroupBox>
  -->

  <HeaderGroupBox>
    <hbox slot="header">
      {$t`Mark mails as read`}
    </hbox>
    <vbox class="read">
      <label class="radio">
        <input type="radio" value={0} bind:group={readAfter.value} />
        {$t`Immediately`}
      </label>

      <label class="radio">
        <input type="radio" value={readSeconds} bind:group={readAfter.value} />
        <T msg={$t`After displaying for # seconds`}>
          <input type="number" bind:value={readSeconds} min={kMinReadSeconds} max={kMaxReadSeconds} maxlength={2} on:change={onReadSecondsChanged} />
        </T>
      </label>

      <label class="radio">
        <input type="radio" value={-1} bind:group={readAfter.value} />
        {$t`Manually`}
      </label>
    </vbox>
  </HeaderGroupBox>

  <HeaderGroupBox>
    <hbox slot="header">
      {$t`Read receipts`}
    </hbox>
    <vbox class="read">
      <hbox class="description font-small">{$t`When a sender asks to be told that you read the message:`}</hbox>
      <label class="radio">
        <input type="radio" value="ask" bind:group={$readReceiptPolicy.value} />
        {$t`Ask each time`}
      </label>
      <label class="radio">
        <input type="radio" value="always" bind:group={$readReceiptPolicy.value} />
        {$t`Always send a read receipt`}
      </label>
      <label class="radio">
        <input type="radio" value="never" bind:group={$readReceiptPolicy.value} />
        {$t`Never send a read receipt`}
      </label>
    </vbox>
  </HeaderGroupBox>

  <Translation />
</hbox>

<script lang="ts">
  import HeaderGroupBox from "../../Shared/HeaderGroupBox.svelte";
  import Translation from "./Translation.svelte";
  import { getLocalStorage } from "../../Util/LocalStorage";
  import T from '../../../l10n/T.svelte';
  import { readReceiptPolicySetting } from "../../../logic/Mail/ReadReceipt/ReadReceipt";
  import { t } from "../../../l10n/l10n";

  let readAfter = getLocalStorage("mail.read.after", 0);
  const readReceiptPolicy = readReceiptPolicySetting();
  let readSeconds = readAfter.value > 0 ? readAfter.value : 5;

  const kMinReadSeconds = 1;
  const kMaxReadSeconds = 20;
  const kDefaultReadSeconds = 5;
  function onReadSecondsChanged() {
    // min/max браузер при вводе не применяет: 0 означал бы «Сразу», а -3 — «Вручную»
    readSeconds = Math.min(kMaxReadSeconds, Math.max(kMinReadSeconds,
      Math.round(Number(readSeconds) || kDefaultReadSeconds)));
    // Ввод числа не должен сам переключать режим «Вручную» / «Сразу»
    if (readAfter.value > 0) {
      readAfter.value = readSeconds;
    }
  }
</script>

<style>
  .groups {
    flex-wrap: wrap;
  }
  .groups :global(> *) {
    margin-inline-end: 32px;
  }
  .groups :global(.group .content) {
    padding-inline-end: 48px;
  }
  .radio {
    align-items: center;
  }
  label {
    margin-inline-start: 8px;
  }
  .description {
    margin-block-end: 4px;
    opacity: 0.75;
  }
  input[type="number"] {
    width: 2.5em;
    text-align: end;
  }
</style>
