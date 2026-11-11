<hbox class="about">
  <img class="app-icon" src={appIcon} width="96" height="96" alt="" />
  <vbox class="copy">
    <h1>{appName} {displayVersion}</h1>

    <div>
      <T msg={$t`Copyright 2026 # and other contributors`}>
        <a href="{siteRoot}" target="_blank">{appName}</a>
      </T>
    </div>

    {#if !otaCapable}
      <p class="ota-hint">
        {$t`OTA updates require a GitHub release build. Download the installer from GitHub Releases — local dev builds (version ending in -dev) do not update.`}
      </p>
    {/if}

    <vbox class="update">
      <Update />
    </vbox>

    {#if otaCapable && pilotChannel !== null}
      <vbox class="channel">
        <Checkbox toggle
          checked={pilotChannel}
          allowIndetermined={false}
          disabled={savingChannel}
          label={$t`Early access`}
          on:change={event => void onPilotChange(event.detail === true)} />
        <p class="ota-hint">
          {$t`Get new versions a day before everyone else. They may be less stable. Turn off to stay on the stable channel.`}
        </p>
        {#if channelError}
          <ErrorMessageInline ex={channelError} />
        {/if}
      </vbox>
    {/if}
  </vbox>
</hbox>

<script lang="ts">
  import { onMount } from "svelte";
  import { appGlobal } from "../../../logic/app";
  import { appName, appVersion, siteRoot } from '../../../logic/build';
  import Update from './Update.svelte';
  import Checkbox from '../../Shared/Checkbox.svelte';
  import ErrorMessageInline from '../../Shared/ErrorMessageInline.svelte';
  import T from '../../../l10n/T.svelte';
  import appIcon from '../../asset/icon/general/app-icon.png';
  import { t } from '../../../l10n/l10n';

  // Сборки CI: 0.10.<номер> (с 0.10) или 0.9.x-dev.<14 цифр> (старые). Локальные сборки (0.10.0-dev) — нет.
  function isOtaVersion(v: string): boolean {
    return /^\d+\.\d+\.\d+$/.test(v) || /-dev\.\d{14}$/.test(v);
  }

  let displayVersion = appVersion;
  let otaCapable = isOtaVersion(appVersion);
  /** Пробный канал обновлений; null — backend ещё не ответил или старый backend без каналов */
  let pilotChannel: boolean | null = null;
  let savingChannel = false;
  let channelError: Error | undefined;

  async function onPilotChange(pilot: boolean) {
    let remoteApp = appGlobal.remoteApp;
    if (typeof remoteApp?.setUpdateChannel != "function") {
      return;
    }
    savingChannel = true;
    channelError = undefined;
    try {
      let channel = await remoteApp.setUpdateChannel(pilot ? "pilot" : "stable");
      pilotChannel = channel === "pilot";
      // Новый канал — новая проверка, если обновление не скачивается и не ждёт установки
      let status = await remoteApp.getUpdateStatus?.();
      if (!status || ["idle", "uptodate", "unsupported"].includes(status.phase)) {
        await remoteApp.checkForUpdate?.(true);
      }
    } catch (ex) {
      channelError = ex as Error;
      pilotChannel = !pilot;
    } finally {
      savingChannel = false;
    }
  }

  onMount(() => {
    let loadedRemoteApp: any;

    async function loadRuntimeVersion() {
      let remoteApp = appGlobal.remoteApp;
      if (!remoteApp || remoteApp === loadedRemoteApp) {
        return;
      }
      loadedRemoteApp = remoteApp;
      try {
        let status = await remoteApp.getUpdateStatus?.();
        if (status?.appVersion) {
          displayVersion = status.appVersion;
          otaCapable = isOtaVersion(status.appVersion);
        } else {
          let runtimeVersion = await remoteApp.getAppVersion?.();
          if (runtimeVersion) {
            displayVersion = runtimeVersion;
            otaCapable = isOtaVersion(runtimeVersion);
          }
        }
      } catch {
        // keep compile-time fallback
      }
      try {
        if (typeof remoteApp.getUpdateChannel == "function") {
          pilotChannel = await remoteApp.getUpdateChannel() === "pilot";
        }
      } catch {
        pilotChannel = null;
      }
    }

    let unsubscribe = appGlobal.subscribe(() => void loadRuntimeVersion());
    return unsubscribe;
  });
</script>

<style>
  .about {
    align-items: start;
    gap: 20px;
    max-width: 40em;
  }
  .app-icon {
    width: 96px;
    height: 96px;
    flex-shrink: 0;
    border-radius: 22px;
  }
  .copy {
    min-width: 0;
    padding-block-start: 4px;
  }
  h1 {
    margin: 0 0 12px;
    font-size: 28px;
    line-height: 1.2;
    letter-spacing: -0.03em;
  }
  .ota-hint {
    margin: 12px 0 0;
    max-width: 36em;
    line-height: 1.45;
    color: color-mix(in srgb, var(--fg) 72%, transparent);
    font-size: 14px;
  }
  .update {
    margin-block-start: 24px;
  }
  .channel {
    margin-block-start: 20px;
  }
</style>
