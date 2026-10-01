<Button
  icon={backgroundIcon}
  iconSize="16px"
  iconOnly
  label={backgroundLabel(background)}
  tooltip={backgroundLabel(nextBackground)}
  onClick={cycleBackground}
  plain
  classes="message-background-switcher"
  />

<script lang="ts">
  import Button from "../../Shared/Button.svelte";
  import MoonIcon from "lucide-svelte/icons/moon";
  import SunIcon from "lucide-svelte/icons/sun";
  import SunMoonIcon from "lucide-svelte/icons/sun-moon";
  import { getLocalStorage } from "../../Util/LocalStorage";
  import { t } from "../../../l10n/l10n";
  import {
    cycleMessageViewerBackground,
    getMessageViewerBackgroundSetting,
    normalizeMessageViewerBackground,
    type MessageViewerBackground,
  } from "./messageViewerAppearance";

  let backgroundSetting = getMessageViewerBackgroundSetting();
  let appThemeSetting = getLocalStorage("appearance.theme", "system");
  $: appThemeIsDark = resolveDarkTheme($appThemeSetting.value);
  $: storedBackground = normalizeMessageViewerBackground($backgroundSetting.value);
  $: background = appThemeIsDark && storedBackground == "theme" ? "dark" : storedBackground;
  $: nextBackground = cycleMessageViewerBackground(background, !appThemeIsDark);
  // Иконка и подсказка показывают режим, который будет включён по нажатию.
  $: backgroundIcon = nextBackground == "white"
    ? SunIcon
    : nextBackground == "dark" ? MoonIcon : SunMoonIcon;

  function backgroundLabel(mode: MessageViewerBackground): string {
    if (mode == "white") {
      return $t`White background`;
    }
    if (mode == "dark") {
      return $t`Dark mode`;
    }
    return $t`Theme background`;
  }

  function cycleBackground(): void {
    backgroundSetting.value = nextBackground;
  }

  function resolveDarkTheme(theme: string): boolean {
    if (theme == "dark") {
      return true;
    }
    if (theme == "light") {
      return false;
    }
    return typeof window != "undefined"
      && window.matchMedia("(prefers-color-scheme: dark)").matches;
  }
</script>

<style>
  :global(.message-background-switcher) {
    color: var(--message-viewer-fg, var(--main-fg));
  }
</style>
