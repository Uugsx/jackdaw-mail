<vbox class="privacy">
  <HeaderGroupBox>
    <hbox slot="header">{$t`Anonymous statistics`}</hbox>
    <vbox class="setting">
      <label class="checkbox-row">
        <Checkbox bind:checked={usageStatsSetting.value} />
        {$t`Send anonymous usage statistics`}
      </label>
      <hbox class="hint font-small">{$t`Once a day, the app sends a random installation ID, the app version, the operating system and the processor type. No email, names, addresses or message content are sent. This helps us count how many people use the app and which versions are in use`}</hbox>
    </vbox>
  </HeaderGroupBox>
</vbox>

<script lang="ts">
  import HeaderGroupBox from "../../Shared/HeaderGroupBox.svelte";
  import Checkbox from "../../Shared/Checkbox.svelte";
  import { usageStatsSetting } from "../../MainWindow/usageStats";
  import { t } from "../../../l10n/l10n";
</script>

<style>
  .setting {
    gap: 8px;
  }
  .checkbox-row {
    align-items: center;
    gap: 8px;
    cursor: default;
  }
  .hint {
    color: color-mix(in srgb, var(--main-fg) 62%, transparent);
    max-width: 60ch;
  }
</style>
