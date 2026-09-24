<svelte:head>
  <title>{ appName }</title>
</svelte:head>
<svelte:window
  bind:outerWidth={windowWidth}
  on:resize={saveWindowSettingsDebounced}
  on:blur={onMainWindowBlur}
  on:visibilitychange={onMainWindowVisibilityChange}
  on:beforeunload={() => catchErrors(saveWindowSettings)}
  on:click|capture={(event) => catchErrors(() => onClickTopLevel(event))}
  on:keydown|capture={(event) => catchErrors(() => onCategoryShortcutKeydown(event))}
  on:keyup|capture={onCategoryShortcutKeyup}
  on:mousedown|capture={(event) => catchErrors(() => onCategoryShortcutMouseDown(event))} />

<vbox flex class="main-window"
  lang={getUILocale()}
  dir={rtl}
  class:mobile={$appGlobal.isMobile}
  class:desktop={!$appGlobal.isMobile}
  class:mail-mode={mailMode}
  class:widgets-enabled={$widgetsEnabled.value}
  class:widgets-expanded={$widgetsEnabled.value && $widgetsExpanded.value}
  class:ui-density-compact={uiDensity == "compact"}
  class:ui-density-normal={uiDensity == "normal"}
  class:ui-density-large={uiDensity == "large"}
  on:pointerdown={onMainWindowPointerDown}>
  {#if !appGlobal.isMobile}
    <WindowHeader selectedApp={$selectedApp} />
  {/if}
  <hbox flex class="body-row">
    {#if !appGlobal.isMobile}
      <AppBar bind:selectedApp={$selectedApp} showApps={apps} />
    {/if}
    <vbox flex class="content-shell" on:pointerdown|capture={onContentPointerDown}>
      <NotificationBar notifications={$notifications} />
      {#if appGlobal.isMobile}
        <Router primary={false} {history}>
          <SplitterHorizontal name="sidebar" initialBottomRatio={0.7} hasTop={!!sidebar}>
            <vbox flex class="sidebar" slot="top">
              <svelte:component this={sidebar} />
            </vbox>
            <AppContentRoutes slot="bottom" />
          </SplitterHorizontal>
          <NavigationM />
        </Router>
      {:else if $selectedApp}
        <Router primary={false} {history}>
          {#key $widgetSplitterResetKey}
          <Splitter name="widgets"
            initialRightRatio={0.24}
            rightMinWidth={WIDGET_RAIL_WIDTH_PX + 200}
            hasRight={$widgetsEnabled.value}
            rightFixedWidth={$widgetsEnabled.value && !$widgetsExpanded.value ? WIDGET_COLLAPSED_WIDTH_PX : null}
            hideBar={true}
            onResize={onWidgetSplitterDragEnd}>
            <Splitter name="sidebar" initialRightRatio={0.25} hasRight={!!sidebar} slot="left">
              <AppContentRoutes slot="left"/>
              <vbox flex class="sidebar" slot="right">
                <svelte:component this={sidebar} />
              </vbox>
            </Splitter>
            <WidgetSidebar slot="right" />
          </Splitter>
          {/key}
        </Router>
      {/if}
    </vbox>
  </hbox>
  <ComposeFloatingLayer />
</vbox>
<MeetBackground />
<MailInBackground />
<CalendarInBackground />
<WebAppsInBackground />

<script lang="ts">
  import { selectedApp, sidebarApp, apps, goTo, openApp, history } from "../AppsBar/selectedApp";
  import { appGlobal } from "../../logic/app";
  import { normalizeUIDensity, uiDensitySetting } from "../Settings/Global/uiDensity";
  // #if [!WEBMAIL]
  import { getStartObjects, loginOnStartup } from "../../logic/startup";
  import { predefinedConfig } from "../../logic/Mail/AutoConfig/predefinedConfig";
  // #else
  import { getStartObjects as getWebMailStartObjects, loginOnStartup as loginWebMailOnStartup } from "../../logic/WebMail/startup";
  const getStartObjects = getWebMailStartObjects;
  const loginOnStartup = loginWebMailOnStartup;
  // #endif
  import { notifications } from "./Notification";
  import { selectedAccount } from "../Mail/Selected";
  import { restoreSelectedWorkspace } from "./Selected";
  import {
    applyCategoryShortcut,
    type CategoryShortcutTarget,
    findCategoryShortcut,
    keyboardCategoryShortcutFromEvent,
    KeyboardCategoryShortcutPressGuard,
    mouseCategoryShortcutFromEvent,
  } from "../Mail/CategoryShortcuts";
  import { getLocalStorage } from "../Util/LocalStorage";
  import { loadApps, disableAppsBasedOnFeaturesXML } from "../AppsBar/loadApps";
  import { handleNativeComposeWindowClosed, mailApp, sendNativeComposeWindow } from "../Mail/MailJackdawApp";
  import { meetApp } from "../Meet/MeetJackdawApp";
  import { categoriesLoaded } from "../Settings/SettingsCategories";
  import { applyColors } from "../Settings/Global/AppThemeColors";
  import AppBar from "../AppsBar/AppBar.svelte";
  import AppContentRoutes from "../AppsBar/AppContentRoutes.svelte";
  import NotificationBar from "./NotificationBar.svelte";
  import WindowHeader from "./WindowHeader.svelte";
  import NavigationM from "./NavigationM.svelte";
  import Splitter from "../Shared/Splitter.svelte";
  import SplitterHorizontal from "../Shared/SplitterHorizontal.svelte";
  import MailInBackground from "../Mail/MailInBackground.svelte";
  import ComposeFloatingLayer from "../Mail/Composer/ComposeFloatingLayer.svelte";
  import CalendarInBackground from "../Calendar/CalendarInBackground.svelte";
  import MeetBackground from "../Meet/MeetBackground.svelte";
  import WebAppsInBackground from "../WebApps/Runner/WebAppsInBackground.svelte";
  import WidgetSidebar from "../Widgets/WidgetSidebar.svelte";
  import {
    activeWidgetIdSetting,
    getWidgetWebSettings,
    normalizeWidgetList,
    updateWidgetSettings,
    widgetsEnabled,
    widgetsExpanded,
    widgetsListSetting,
    WIDGET_COLLAPSED_WIDTH_PX,
    WIDGET_RAIL_WIDTH_PX,
    widgetSplitterResetKey,
  } from "../Widgets/widgetState";
  import { catchErrors, backgroundError } from "../Util/error";
import { updatePaneFocusFromPointer } from "./paneFocus";
  import { startUpdateNotificationWatcher } from "./UpdateNotification";
  import { assert } from "../../logic/util/util";
  import { searchContacts } from "../../logic/Contacts/Search";
  import type { ComposeWindowPerson } from "../../logic/Mail/Composer/ComposeWindowProtocol";
  import { getUILocale, locale, t } from "../../l10n/l10n";
  import { rtlLocales } from "../../l10n/list";
  import { appName } from "../../logic/build";
  import { onDestroy, onMount } from "svelte";
  import debounce from "lodash/debounce";
  import { Router } from "svelte-navigator";
  import { handleNativeMenuActionWithErrors, subscribeToNativeMenuActions, syncNativeMenuLabels } from "./NativeMenu";
  // #if [MOBILE]
  import { SplashScreen } from '@capacitor/splash-screen';
  // #endif

  // $: sidebarApp = $apps.filter(app => app.showSidebar).first; // TODO watch `app` property changes
  $: $sidebarApp = $meetApp.showSidebar ? meetApp : null;
  $: sidebar = $sidebarApp?.sidebar;
  $: mailMode = $selectedApp?.id == "mail" || $selectedApp?.id == "mail-write" || $selectedApp?.id == "settings";
  $: uiDensity = normalizeUIDensity($uiDensitySetting.value);
  $: rtl = rtlLocales.includes(getUILocale()) ? 'rtl' : null;
  categoriesLoaded; /* make sure to import the file, so that that categories load */

  function onWidgetSplitterDragEnd() {
    let id = activeWidgetIdSetting.value;
    if (!id) {
      return;
    }
    let entry = normalizeWidgetList(widgetsListSetting.value).find(w => w.id === id);
    if (entry && getWidgetWebSettings(entry).customWidthPx != null) {
      updateWidgetSettings(id, { customWidthPx: null });
    }
  }

  onMount(() => {
    // На момент создания подписки `.main-window` ещё не существует в DOM.
    // Повторно применяем сохранённые цвета после монтирования оболочки.
    applyColors(colorsSetting.value);
    return catchErrors(onLoad);
  });

  onMount(() => {
    syncNativeMenuLabels();
    const unsubscribeLocale = locale.subscribe(syncNativeMenuLabels);
    const unsubscribeNativeMenu = subscribeToNativeMenuActions(handleNativeMenuActionWithErrors);
    const nativeAPI = (window as any).api;
    const unsubscribeComposeWindow = typeof nativeAPI?.onComposeWindowClosed === "function"
      ? nativeAPI.onComposeWindowClosed(handleNativeComposeWindowClosed)
      : () => {};
    const unsubscribeComposeWindowSend = typeof nativeAPI?.onComposeWindowSendRequest === "function"
      ? nativeAPI.onComposeWindowSendRequest((requestID, windowID, payload) => {
          void (async () => {
            let result: { ok: true } | { ok: false; errorMessage: string } = { ok: true };
            try {
              await sendNativeComposeWindow(windowID, payload);
            } catch (ex) {
              result = {
                ok: false,
                errorMessage: ex instanceof Error ? ex.message : "Could not send the message",
              };
            }
            nativeAPI.respondToComposeWindowSend(requestID, result);
          })();
        })
      : () => {};
    const unsubscribeComposeWindowSearch = typeof nativeAPI?.onComposeWindowSearchContactsRequest === "function"
      ? nativeAPI.onComposeWindowSearchContactsRequest((requestID, _windowID, searchText) => {
          void (async () => {
            let result: ComposeWindowPerson[] = [];
            try {
              let matches = await searchContacts(searchText, () => false);
              result = matches.map(person => ({
                emailAddress: person.emailAddress,
                name: person.name ?? null,
              }));
            } catch (_ex) {
              // The detached window can continue with local results.
            }
            nativeAPI.respondToComposeWindowSearchContacts(requestID, result);
          })();
        })
      : () => {};
    return () => {
      unsubscribeLocale();
      unsubscribeNativeMenu();
      unsubscribeComposeWindow();
      unsubscribeComposeWindowSend();
      unsubscribeComposeWindowSearch();
    };
  });

  async function onLoad() {
    loadApps();
    openApp(mailApp, {});
    // #if [MOBILE]
    SplashScreen.hide();
    // #endif
    await startup();
    restoreSelectedWorkspace(appGlobal.workspaces);
    changeTheme($themeSetting.value);
    await disableAppsBasedOnFeaturesXML();
  }

  async function startup() {
    await getStartObjects();
    startUpdateNotificationWatcher();
    if (appGlobal.emailAccounts.isEmpty && appGlobal.chatAccounts.isEmpty) {
      await setup();
    } else {
      await loginOnStartup(console.error);
      // Setting $selectedApp late would overwrite commandline/URL handlers
      $selectedAccount = appGlobal.emailAccounts.first;
      // `MailApp` selects the inbox, once we read the folders
    }
  }

  async function setup() {
    // #if [!WEBMAIL]
    let account = await predefinedConfig();
    if (account) {
      goTo("/setup/predefined", { account });
    } else {
      goTo("/setup/initial", {});
    }
    // #endif
  }

  let themeSetting = getLocalStorage("appearance.theme", "system");
  $: changeTheme($themeSetting.value);
  function changeTheme(theme: string) {
    if (!appGlobal?.remoteApp) {
      return;
    }
    assert(["system", "light", "dark"].includes(theme), $t`Bad theme name ` + theme);
    appGlobal.remoteApp.setTheme(theme);
  }
  let colorsSetting = getLocalStorage("appearance.colors", {});
  // Читаем актуальное значение при каждом уведомлении. Реактивная запись
  // `$colorsSetting.value` могла повторно применить старый набор цветов после
  // изменения его в настройках.
  let unsubscribeColors = colorsSetting.subscribe(setting => applyColors(setting.value));
  onDestroy(unsubscribeColors);

  let windowWidth: number;
  $: windowWidth, setSmall()
  function setSmall() {
    appGlobal.isSmall = windowWidth < 600;
  }

  function saveWindowSettings() {
    if (appGlobal.isMobile || document.hidden) {
      return;
    }
    let windowSizeSetting = getLocalStorage("window.size", []);
    let windowPositionSetting = getLocalStorage("window.position", []);
    windowSizeSetting.value = [ window.outerWidth, window.outerHeight ];
    windowPositionSetting.value = [ window.screenX, window.screenY ];
  }
  const saveWindowSettingsDebounced = debounce(() => catchErrors(saveWindowSettings), 1000);
  const pressedCategoryShortcutCodes = new KeyboardCategoryShortcutPressGuard();
  let categoryShortcutApplicationInProgress = false;

  function clearPressedCategoryShortcutCodes(): void {
    pressedCategoryShortcutCodes.clear();
  }

  function onMainWindowBlur(): void {
    clearPressedCategoryShortcutCodes();
    catchErrors(saveWindowSettings);
  }

  function onMainWindowVisibilityChange(): void {
    clearPressedCategoryShortcutCodes();
    catchErrors(saveWindowSettings);
  }

  function onMainWindowPointerDown() {
    if (appGlobal.isMobile) {
      return;
    }
    (appGlobal.remoteApp.focusMainWindow ?? appGlobal.remoteApp.unminimizeMainWindow)?.()
      .catch(backgroundError);
  }

  function onContentPointerDown(event: PointerEvent) {
    updatePaneFocusFromPointer(event);
  }

  async function onCategoryShortcutKeydown(event: KeyboardEvent): Promise<void> {
    if (!canHandleCategoryShortcut(event) || event.repeat || event.isComposing) {
      return;
    }
    let shortcut = keyboardCategoryShortcutFromEvent(event);
    if (!shortcut) {
      return;
    }
    let target = findCategoryShortcut(shortcut);
    if (!target) {
      return;
    }
    if (!pressedCategoryShortcutCodes.claim(shortcut.code)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    await applyCategoryShortcutOnce(target);
  }

  async function applyCategoryShortcutOnce(target: CategoryShortcutTarget): Promise<void> {
    if (categoryShortcutApplicationInProgress) {
      return;
    }
    categoryShortcutApplicationInProgress = true;
    try {
      await applyCategoryShortcut(target);
    } finally {
      categoryShortcutApplicationInProgress = false;
    }
  }

  function onCategoryShortcutKeyup(event: KeyboardEvent): void {
    let code = event.code || event.key;
    if (code) {
      pressedCategoryShortcutCodes.release(code);
    }
  }

  async function onCategoryShortcutMouseDown(event: MouseEvent): Promise<void> {
    if (!canHandleCategoryShortcut(event)) {
      return;
    }
    let shortcut = mouseCategoryShortcutFromEvent(event);
    if (!shortcut) {
      return;
    }
    let target = findCategoryShortcut(shortcut);
    if (!target) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    await applyCategoryShortcutOnce(target);
  }

  function canHandleCategoryShortcut(event: Event): boolean {
    if ($selectedApp?.id != "mail" || event.defaultPrevented) {
      return false;
    }
    let target = event.target;
    if (!(target instanceof Element)) {
      return false;
    }
    return !target.closest(
      ".mail-composer-window, input, textarea, select, [contenteditable=true], [role=textbox]",
    );
  }

  async function onClickTopLevel(event: MouseEvent) {
    let targetE = event.target as HTMLElement;
    let linkE = targetE.closest && targetE.closest("a[href]");
    let url = linkE?.getAttribute("href");
    if (!url) {
      return;
    }
    // _blank should open in external browser
    if (linkE.getAttribute("target") == "_blank") {
      // Let default handler open in external browser
      return;
      /* // ... unless it's a link in an email that we can handle internally
      if (linkE.getAttribute("source") == "convert-html" &&
          appGlobal.meetAccounts.some(acc => acc.isMeetingURL(new URL(url)))) {
        // open internally, continue below
      } else {
        // Let default handler open in external browser
        return;
      }*/
    }
    // open internally
    let urlObj = new URL(url); // throws, if invalid
    let protocol = urlObj.protocol.replace(":", "");
    let urlEvent = new Event("url-" + protocol); // e.g. "url-mailto"
    (urlEvent as any).url = url;
    targetE.dispatchEvent(urlEvent);
    event.stopPropagation();
    event.preventDefault();
  }
</script>

<style>
  .main-window:not(.mobile) {
    min-width: 640px;
    --chrome-inset-block: 8px;
    --appbar-column-width: 104px;
  }
  .main-window:not(.mobile) .body-row {
    background: transparent;
    min-height: 0;
  }
  .main-window:not(.mobile) .content-shell {
    position: relative;
    z-index: 1;
    color: var(--fg);
    margin-block: var(--chrome-inset-block);
    border-radius: var(--border-radius) 0 0 var(--border-radius);
    border: 1px solid var(--glass-border-subtle);
    border-block-start-color: transparent;
    box-shadow: none;
    overflow: hidden;
    min-width: 0;
  }
  .sidebar {
    box-shadow: inset 1px 0px 5px 0px rgba(0, 0, 0, 10%);
    z-index: 2;
  }
</style>
