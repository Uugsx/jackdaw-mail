<hbox class="window-header" class:os-rtl={osRTL} class:mac
  style="--workspace-color: {$selectedWorkspace?.color ?? "var(--windowheader-bg)"}">
  <vbox class="traffic-spacer" />
  <hbox class="workspace">
    <WorkspaceHeader {selectedApp} />
  </hbox>
  <hbox class="app-title value">
    {$titleStore ?? selectedApp?.name ?? appName}
  </hbox>
  <vbox flex class="free" />
  {#if !hideHeaderSearch}
    <hbox class="search-box">
      <SearchField bind:searchTerm={$globalSearchTerm} />
    </hbox>
  {/if}
  {#if !webMail}
    <hbox class="right">
      <Button label={$t`Minimize`}
        icon={MinimizeIcon} iconSize="16px" plain iconOnly classes="minimize"
        onClick={onMinimize}
        />
      <Button label={$t`Maximize`} tooltip={canMaximize ? $t`Maximize` : $t`Restore window`}
        icon={canMaximize ? MaximizeIcon : UnmaximizeIcon}
        iconSize="12px" plain iconOnly classes="restore-window"
        onClick={onMaximizeOrRestore}
        />
      <Button label={$t`Close entire app`}
        icon={XIcon} iconSize="16px" plain iconOnly classes="close"
        onClick={onCloseApp}
        />
    </hbox>
  {/if}
</hbox>

<script lang="ts">
  import type { JackdawApp } from "../AppsBar/JackdawApp";
  import { globalSearchTerm } from "../AppsBar/selectedApp";
  import { appGlobal } from "../../logic/app";
  import { appName, webMail } from "../../logic/build";
  import WorkspaceHeader from "./WorkspaceHeader.svelte";
  import SearchField from "../Shared/SearchField.svelte";
  import Button from "../Shared/Button.svelte";
  import MinimizeIcon from 'lucide-svelte/icons/minus';
  import MaximizeIcon from 'lucide-svelte/icons/square';
  import UnmaximizeIcon from 'lucide-svelte/icons/copy';
  import XIcon from 'lucide-svelte/icons/x';
  import { getOSName } from "../Util/util";
  import { t } from "../../l10n/l10n";
  import { rtlLocales } from "../../l10n/list";
  import { selectedWorkspace } from "./Selected";

  export let selectedApp: JackdawApp;

  // Enable Mac Styles
  const mac = (!webMail && getOSName() == "macintosh") ? true : false;
  // Check mac system text direction
  const osRTL = (rtlLocales.includes(navigator.language) && mac) ? true : false;

  function onMinimize() {
    appGlobal.remoteApp.minimizeMainWindow();
  }

  let canMaximize = true;
  function onMaximizeOrRestore() {
    if (canMaximize) {
      appGlobal.remoteApp.maximizeMainWindow();
    } else {
      appGlobal.remoteApp.restoreMainWindow();
    }
    canMaximize = !canMaximize;
  }

  function onCloseApp() {
    window.close();
  }

  $: titleStore = selectedApp?.title;
  $: hideHeaderSearch = selectedApp?.id == "mail" || selectedApp?.id == "mail-write";
</script>

<style>
  .window-header {
    position: relative;
    z-index: 10;
    align-items: center;
    min-height: 36px;
    height: 36px;
    box-sizing: border-box;
    app-region: drag;
    background-color: var(--windowheader-bg);
    backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
    -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
    border-block-end: 1px solid var(--glass-border-subtle);
    box-shadow: var(--glass-highlight);
    color: var(--windowheader-fg);
  }
  .traffic-spacer {
    width: 12px;
    flex-shrink: 0;
  }
  .workspace,
  .search-box,
  .right,
  .window-header :global(.workspace),
  .window-header :global(.search),
  .window-header :global(button),
  .window-header :global(input),
  .window-header :global(a) {
    app-region: no-drag;
  }
  .app-title {
    font-size: 14px;
    line-height: 16px;
    align-items: center;
    margin-inline-start: 4px;
  }
  .window-header :global(.workspace) {
    font-size: 13px;
    line-height: 16px;
    padding-block: 2px;
    padding-inline: 8px;
  }
  .window-header :global(.workspace .dot) {
    min-width: 8px;
    min-height: 8px;
    margin-inline-end: 8px;
  }
  .right {
    padding-inline-end: 6px;
  }
  .right :global(button) {
    color: var(--windowheader-fg);
    padding-inline-start: 6px;
    padding-inline-end: 6px;
  }
  .right :global(.maximize) {
    padding-inline-start: 8px;
    padding-inline-end: 8px;
  }
  .right :global(.minimize svg) {
    margin-block-start: 4px; /* Keep the icon visually centered in the compact bar. */
  }
  .free {
    min-width: 0;
  }

  /* Поле поиска в тон заголовку: без градиента цвета пространства, который давал красные и прочие пятна.
     Цвет пространства и так виден у его названия слева. */
  .window-header :global(.search) {
    margin: 4px 8px;
    border: 1px solid color-mix(in srgb, var(--windowheader-fg) 14%, transparent);
    border-radius: 8px;
    outline: none;
    transition: border-color 120ms ease, background-color 120ms ease;
  }
  .window-header :global(.search:not(.has-search)) {
    background-color: color-mix(in srgb, var(--windowheader-fg) 5%, var(--windowheader-bg));
  }
  .window-header :global(.search:hover) {
    border-color: color-mix(in srgb, var(--windowheader-fg) 24%, transparent);
  }
  .window-header :global(.search:has(input:focus)) {
    background-color: var(--main-bg);
    border-color: var(--input-focus, var(--selected-border));
  }
  .window-header :global(.search:not(.has-search) input) {
    background-color: transparent;
    color: var(--windowheader-fg);
  }
  .window-header :global(.search:has(input:focus) input) {
    color: var(--main-fg);
  }

  /* Styles for Mac */
  .mac .right {
    display: none;
  }
  .mac .traffic-spacer,
  :global([dir="rtl"]) .mac.os-rtl .traffic-spacer {
    margin-inline-start: var(--appbar-column-width, 104px);
    width: 0;
  }
  :global([dir="rtl"]) .mac:not(.os-rtl) .traffic-spacer,
  .mac.os-rtl .traffic-spacer {
    margin-inline-start: 0px;
  }
  :global([dir="rtl"]) .mac:not(.os-rtl) .search-box,
  .mac.os-rtl .search-box {
    padding-inline-end: var(--appbar-column-width, 104px);
  }
  :global([dir="rtl"]) .mac .search-box {
    padding-inline-end: 0px;
  }
</style>
