<vbox class="view-switcher">
  <HeaderGroupBox>
    <hbox slot="header">{$t`Mail app view`}</hbox>
    <ViewSwitcher large={true} />
  </HeaderGroupBox>

  <HeaderGroupBox>
    <hbox slot="header">{$t`Message list`}</hbox>
    <MessageListAppearance />
  </HeaderGroupBox>

  <HeaderGroupBox>
    <hbox slot="header">{$t`Message viewer`}</hbox>
    <hbox class="subtitle">
      {$t`Choose the default way to display messages. You can override it for each mailbox in that account's settings.`}
    </hbox>
    <MessageContentRenderingOptions setting={messageContentRenderingSetting} />
  </HeaderGroupBox>

  <HeaderGroupBox>
    <hbox slot="header">{$t`Message viewer background`}</hbox>
    <vbox class="background-options">
      <label class="radio">
        <input type="radio" value="white" bind:group={messageViewerBackgroundSetting.value} />
        {$t`White background`}
      </label>
      <label class="radio">
        <input type="radio" value="theme" bind:group={messageViewerBackgroundSetting.value} />
        {$t`Theme background`}
      </label>
      <label class="radio">
        <input type="radio" value="dark" bind:group={messageViewerBackgroundSetting.value} />
        {$t`Dark mode`}
      </label>
    </vbox>
  </HeaderGroupBox>
</vbox>

<script lang="ts">
  import { t } from "../../../l10n/l10n";
  import ViewSwitcher from "../../Mail/LeftPane/ViewSwitcher.svelte";
  import HeaderGroupBox from "../../Shared/HeaderGroupBox.svelte";
  import MessageContentRenderingOptions from "./MessageContentRenderingOptions.svelte";
  import MessageListAppearance from "./MessageListAppearance.svelte";
  import {
    getMessageContentRenderingSetting,
    getMessageViewerBackgroundSetting,
  } from "../../Mail/Message/messageViewerAppearance";

  let messageContentRenderingSetting = getMessageContentRenderingSetting();
  let messageViewerBackgroundSetting = getMessageViewerBackgroundSetting();
</script>

<style>
  .view-switcher :global(svg) {
    width: 32px;
    height: 32px;
  }
  .background-options {
    gap: 8px;
  }
  .subtitle {
    margin-block-end: 16px;
  }
  .radio {
    align-items: center;
    gap: 8px;
  }
</style>
