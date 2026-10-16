<vbox flex class="setup-contacts-window">
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
  import { Addressbook } from "../../../logic/Contacts/Addressbook";
  import { selectedApp } from "../../AppsBar/selectedApp";
  import { openSettingsCategoryForApp } from "../../Settings/Window/CategoriesUtils";
  import { contactsApp } from "../../Contacts/ContactsJackdawApp";
  import { SetupJackdawApp } from "../SetupJackdawApp";
  import SelectProtocol from "./SelectProtocol.svelte";
  import BackgroundVideo from "../Shared/BackgroundVideo.svelte";

  let config: Addressbook;
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
      openSettingsCategoryForApp(contactsApp);
    }
  }
</script>

<style>
  .setup-contacts-window {
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
  .setup-contacts-window :global(input) {
    font-size: 16px;
  }
  .setup-contacts-window :global(input::placeholder) {
    font-weight: 300;
  }
</style>
