<vbox flex class="setup-meet-window">
  <hbox flex />
  <vbox class="page-box">
    <svelte:component this={showPage} bind:showPage bind:config
      onCancel={onClose}
      />
  </vbox>
  <hbox flex />
  <BackgroundVideo />
</vbox>

<script lang="ts">
  import type { MeetAccount } from "../../../logic/Meet/MeetAccount";
  import { selectedApp } from "../../AppsBar/selectedApp";
  import { openSettingsCategoryForApp } from "../../Settings/Window/CategoriesUtils";
  import { meetApp } from "../../Meet/MeetJackdawApp";
  import { SetupJackdawApp } from "../SetupJackdawApp";
  import SelectProtocol from "./SelectProtocol.svelte";
  import BackgroundVideo from "../Shared/BackgroundVideo.svelte";

  let config: MeetAccount;
  let showPage: ConstructorOfATypedSvelteComponent | null = SelectProtocol;

  $: checkClose(showPage);
  function checkClose(_dummy: any) {
    if (showPage) {
      return;
    }
    onClose();
  }

  function onClose() {
    if ($selectedApp instanceof SetupJackdawApp && typeof($selectedApp.onBack) == "function") {
      $selectedApp.onBack();
    } else {
      openSettingsCategoryForApp(meetApp);
    }
  }
</script>

<style>
  .setup-meet-window {
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
  .setup-meet-window :global(input) {
    font-size: 16px;
  }
  .setup-meet-window :global(input::placeholder) {
    font-weight: 300;
  }
</style>
