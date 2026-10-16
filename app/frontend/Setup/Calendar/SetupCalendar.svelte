<vbox flex class="setup-calendar-window">
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
  import type { Calendar } from "../../../logic/Calendar/Calendar";
  import { selectedApp } from "../../AppsBar/selectedApp";
  import { openSettingsCategoryForApp } from "../../Settings/Window/CategoriesUtils";
  import { calendarApp } from "../../Calendar/CalendarJackdawApp";
  import { SetupJackdawApp } from "../SetupJackdawApp";
  import SelectProtocol from "./SelectProtocol.svelte";
  import BackgroundVideo from "../Shared/BackgroundVideo.svelte";

  let config: Calendar;
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
      openSettingsCategoryForApp(calendarApp);
    }
  }
</script>

<style>
  .setup-calendar-window {
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
  .setup-calendar-window :global(input) {
    font-size: 16px;
  }
  .setup-calendar-window :global(input::placeholder) {
    font-weight: 300;
  }
</style>
