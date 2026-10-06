<hbox class="groups">
  <HeaderGroupBox>
    <hbox slot="header">
      {$t`Notifications`}
    </hbox>
    <hbox class="subtitle">{$t`When a new mail arrives, show with:`}</hbox>
    <NotificationKinds bind:list={kindsList} />
  </HeaderGroupBox>

  <HeaderGroupBox>
    <hbox slot="header">
      {$t`Notify only for`}
    </hbox>
    <hbox class="subtitle">{$t`Show notifications only for mails:`}</hbox>
    <label>
      <input type="checkbox" bind:checked={onlyFromAddressBook} />
      {$t`From people in my address book`}
    </label>
  </HeaderGroupBox>

  {#if !appGlobal.isMobile && !webMail}
    <HeaderGroupBox>
      <hbox slot="header">
        {$t`System menu bar`}
      </hbox>
      <label class="checkbox-row">
        <input type="checkbox" bind:checked={showStatusBarWidget} />
        {$t`Show unread mail in the system menu bar`}
      </label>
    </HeaderGroupBox>
  {/if}

  <HeaderGroupBox>
    <hbox slot="header">
      {$t`Notification sounds`}
    </hbox>
    <hbox class="subtitle">{$t`Choose a sound for each type of event.`}</hbox>
    <NotificationSounds events={["mail-incoming", "mail-outgoing", "other"]} />
  </HeaderGroupBox>
</hbox>

<script lang="ts">
  import { getLocalStorage } from "../../Util/LocalStorage";
  import NotificationKinds from "./NotificationKinds.svelte";
  import NotificationSounds from "./NotificationSounds.svelte";
  import HeaderGroupBox from "../../Shared/HeaderGroupBox.svelte";
  import { t } from "../../../l10n/l10n";
  import { appGlobal } from "../../../logic/app";
  import { webMail } from "../../../logic/build";

  let notificationsSetting = getLocalStorage<string[]>("notifications.mail", ["popup", "sound"]);
  let onlyABSetting = getLocalStorage("notifications.mail.only.addressbook", false);
  let statusBarSetting = getLocalStorage<boolean>("notifications.mail.statusbar", true);

  // Local copies so checkbox toggles assign a new value and hit LocalStorage setters
  let kindsList: string[] = Array.isArray(notificationsSetting.value)
    ? [...notificationsSetting.value]
    : ["popup", "sound"];
  let onlyFromAddressBook = !!onlyABSetting.value;
  let showStatusBarWidget = statusBarSetting.value !== false;

  $: notificationsSetting.value = kindsList;
  $: onlyABSetting.value = onlyFromAddressBook;
  $: statusBarSetting.value = showStatusBarWidget;
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
  .subtitle {
    margin-block-end: 16px;
  }
  .checkbox-row {
    align-items: center;
    gap: 8px;
  }
</style>
