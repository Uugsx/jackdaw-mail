<HeaderGroupBox>
  <hbox slot="header">
    {$t`Notifications`}
  </hbox>
  <NotificationKinds bind:list={$notificationsSetting.value} />
</HeaderGroupBox>

<HeaderGroupBox>
  <hbox slot="header">
    {$t`Notification sounds`}
  </hbox>
  <hbox class="subtitle">{$t`Choose a sound for chat messages.`}</hbox>
  <NotificationSounds events={["chat"]} />
</HeaderGroupBox>

<script lang="ts">
  import NotificationKinds from "../Mail/NotificationKinds.svelte";
  import NotificationSounds from "../Mail/NotificationSounds.svelte";
  import HeaderGroupBox from "../../Shared/HeaderGroupBox.svelte";
  import { t } from "../../../l10n/l10n";

  import { chatNotificationsSetting } from "../../Chat/chatNotificationPrefs";

  let notificationsSetting = chatNotificationsSetting;
</script>

<style>
</style>
