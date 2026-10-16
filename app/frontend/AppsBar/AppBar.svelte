<hbox class="app-bar-shell" class:collapsed={collapsed} class:mac>
  <vbox class="app-bar" class:sidebar-collapsed={collapsed}>
    <vbox class="app-bar-main">
      {#each $showApps.each as app (app.id)}
        {#if app.id !== "settings"}
          <AppButton selected={selectedApp == app} classes={app.id} iconOnly={collapsed}
            ariaLabel={app.barLabel ?? app.name}
            badgeCount={app.id === "mail" && appbarBadgeEnabled ? mailUnreadTotal : 0}
            on:click={() => catchErrors(() => onSelectApp(app))} >
            <AppIcon slot="icon" icon={app.icon} size="22px" strokeWidth={1.75} />
            <hbox slot="label" class="label">
              {app.barLabel ?? app.name}
            </hbox>
          </AppButton>
          <SubAppsList mainApp={app} bind:selectedApp compact={collapsed} />
        {/if}
      {/each}
      <vbox flex class="middle" />
    </vbox>
    {#if settingsApp}
      <AppButton selected={selectedApp == settingsApp} classes="settings" iconOnly={collapsed}
        ariaLabel={settingsApp.barLabel ?? settingsApp.name}
        on:click={() => catchErrors(() => onSelectApp(settingsApp))} >
        <AppIcon slot="icon" icon={settingsApp.icon} size="22px" strokeWidth={1.75} />
        <hbox slot="label" class="label">
          {settingsApp.barLabel ?? settingsApp.name}
        </hbox>
      </AppButton>
    {/if}
  </vbox>
  <button
    type="button"
    class="toggle"
    data-no-button-motion
    class:collapsed={collapsed}
    title={collapsed ? $t`Expand sidebar` : $t`Collapse sidebar`}
    aria-label={collapsed ? $t`Expand sidebar` : $t`Collapse sidebar`}
    on:click={toggleCollapsed}>
    {#if collapsed}
      <PanelLeftOpenIcon size="16px" />
    {:else}
      <PanelLeftCloseIcon size="16px" />
    {/if}
  </button>
</hbox>

<script lang="ts">
  import type { JackdawApp } from "./JackdawApp";
  import { openApp } from "./selectedApp";
  import AppButton from "./AppButton.svelte";
  import AppIcon from "./AppIcon.svelte";
  import SubAppsList from "./SubAppsList.svelte";
  import { catchErrors } from "../Util/error";
  import { mailUnreadEpoch, totalMailUnreadCount } from "../Mail/mailUnreadCounts";
  import type { Collection } from "svelte-collections";
  import { getLocalStorage } from "../Util/LocalStorage";
  import { getOSName } from "../Util/util";
  import { webMail } from "../../logic/build";
  import PanelLeftCloseIcon from "lucide-svelte/icons/panel-left-close";
  import PanelLeftOpenIcon from "lucide-svelte/icons/panel-left-open";
  import { t } from "../../l10n/l10n";

  /* in/out */
  export let selectedApp: JackdawApp;
  /* Which apps to show on the app bar
   * readonly */
  export let showApps: Collection<JackdawApp>;

  $: _mailUnreadEpoch = $mailUnreadEpoch;
  $: mailUnreadTotal = totalMailUnreadCount();
  $: settingsApp = $showApps.find(app => app.id === "settings");

  function onSelectApp(app: JackdawApp) {
    openApp(app, app.windowParams);
  }

  const mac = !webMail && getOSName() == "macintosh";
  const collapsedSetting = getLocalStorage("appbar.collapsed", false);
  let mailNotificationsSetting = getLocalStorage<string[]>("notifications.mail", ["popup", "sound"]);
  $: collapsed = $collapsedSetting.value;
  $: appbarBadgeEnabled = ($mailNotificationsSetting.value ?? []).includes("appbar");

  function toggleCollapsed() {
    collapsedSetting.value = !collapsedSetting.value;
  }
</script>

<style>
  .app-bar-shell {
    position: relative;
    flex-shrink: 0;
    align-items: stretch;
    justify-content: center;
    width: var(--appbar-column-width, 104px);
    padding-block: var(--chrome-inset-block, 8px);
    padding-inline: 12px 10px;
    box-sizing: border-box;
    z-index: 4;
  }
  .app-bar-shell.collapsed {
    --appbar-column-width: 52px;
    width: var(--appbar-column-width);
    padding-inline: 10px 8px;
    padding-block: var(--chrome-inset-block, 8px);
  }
  .app-bar {
    position: relative;
    width: 80px;
    flex: 1 1 auto;
    min-height: 0;
    max-height: 100%;
    background: var(--glass-bg);
    border: 1px solid var(--glass-border-subtle);
    border-radius: var(--border-radius);
    color: var(--appbar-fg);
    padding-block: 10px 52px;
    padding-inline: 6px;
    gap: 2px;
    box-sizing: border-box;
    overflow: hidden;
    transition:
      width 0.18s ease,
      opacity 0.18s ease,
      box-shadow 0.18s ease,
      transform 0.18s ease;
  }
  .app-bar.sidebar-collapsed {
    width: 36px;
    padding-block: 10px 52px;
    padding-inline: 0;
  }
  .app-bar-main {
    flex: 1 1 auto;
    min-height: 0;
    gap: 2px;
    overflow: hidden;
    transition:
      width 0.18s ease,
      opacity 0.18s ease;
  }
  .toggle {
    position: absolute;
    inset-inline-start: 50%;
    inset-block-end: 16px;
    inset-block-start: auto;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 1px solid var(--glass-border-subtle);
    border-radius: var(--border-radius);
    background: var(--glass-bg);
    box-shadow: 0 2px 8px rgba(var(--shadow-color), 0.08);
    color: color-mix(in srgb, var(--appbar-fg) 72%, transparent);
    cursor: pointer;
    app-region: no-drag;
    z-index: 5;
    transform-origin: center;
    transition:
      transform var(--button-motion-duration) var(--button-motion-ease),
      background-color 0.18s ease,
      color 0.18s ease,
      box-shadow 0.18s ease;
  }
  .toggle:not(.collapsed) {
    width: 32px;
  }
  .toggle:hover {
    background: var(--glass-hover-bg);
    color: var(--appbar-fg);
    transform: translateX(-50%) translateY(var(--button-motion-lift));
  }
  .toggle:active {
    transform: translateX(-50%) translateY(var(--button-motion-press-shift)) scale(var(--button-motion-press-scale));
  }
  .toggle:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--appbar-fg) 40%, transparent);
    outline-offset: 1px;
  }
  .app-bar :global(.app-button.settings) {
    position: absolute;
    width: calc(100% - 12px);
    inset-inline: 6px;
    inset-block-end: 52px;
    margin: 0;
  }
  .app-bar :global(.app-button.settings:not(.selected) .label .label) {
    display: none;
  }
  .app-bar.sidebar-collapsed :global(.app-button.settings) {
    width: 100%;
    inset-inline: 0;
  }
  .app-bar.sidebar-collapsed :global(.app-button.settings .label .label) {
    display: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .toggle {
      transition: none;
    }
    .toggle:hover,
    .toggle:active {
      transform: translateX(-50%);
    }
  }
</style>
