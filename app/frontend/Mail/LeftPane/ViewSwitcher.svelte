<hbox class="switcher">
  <IslandSwitcher {large}>
    <Button
      label={$t`Mail as conversations by person`}
      icon={ChatIcon}
      iconOnly={!large}
      iconSize="16px"
      onClick={() => switchTo('chat')}
      selected={view == "chat"}
      />
    <Button
      label={$t`Wide table view`}
      icon={WideTableIcon}
      iconOnly={!large}
      iconSize="16px"
      onClick={() => switchTo('widetable')}
      selected={view == "widetable"}
      />
    <Button
      label={$t`Classic 3-pane view`}
      icon={ThreePaneIcon}
      iconOnly={!large}
      iconSize="16px"
      onClick={() => switchTo('3pane')}
      selected={view == "3pane"}
      />
  </IslandSwitcher>
</hbox>

<script lang="ts">
  import { getLocalStorage } from "../../Util/LocalStorage";
  import IslandSwitcher from "../../Shared/IslandSwitcher.svelte";
  import Button from "../../Shared/Button.svelte";
  // Иконка конверта, а не «облачко» чата Jackdaw Pro — чтобы режимы не путали
  import ChatIcon from "lucide-svelte/icons/mail-open";
  import ThreePaneIcon from "lucide-svelte/icons/layout-panel-left";
  import WideTableIcon from "lucide-svelte/icons/columns-4";
  import { t } from "../../../l10n/l10n";
  import { get } from "svelte/store";
  import { mailChatEntryMessage, selectedMessage } from "../Selected";

  export let large = false;

  let viewSetting = getLocalStorage("mail.view", "widetable");
  const viewLayoutVersion = getLocalStorage<number>("mail.view.layoutVersion", 0);
  if ((viewLayoutVersion.value ?? 0) < 3) {
    if (viewSetting.value == "vertical") {
      viewSetting.value = "widetable";
    }
    localStorage.removeItem("ui.splitter.mail.3pane.folders");
    localStorage.removeItem("ui.splitter.mail.widetable.msgs");
    localStorage.removeItem("ui.splitter.mail.3pane.msgs");
    viewLayoutVersion.value = 3;
  }
  $: view = $viewSetting.value;

  function switchTo(newView: string) {
    if (newView == "chat" && view != "chat") {
      mailChatEntryMessage.set(get(selectedMessage) ?? null);
    }
    viewSetting.value = newView;
  }
</script>

<style>
  .switcher {
    margin: 6px 8px;
  }
</style>
