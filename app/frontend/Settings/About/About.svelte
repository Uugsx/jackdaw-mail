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
  </vbox>
</hbox>

<script lang="ts">
  import { onMount } from "svelte";
  import { appGlobal } from "../../../logic/app";
  import { appName, appVersion, siteRoot } from '../../../logic/build';
  import Update from './Update.svelte';
  import T from '../../../l10n/T.svelte';
  import appIcon from '../../asset/icon/general/app-icon.png';
  import { t } from '../../../l10n/l10n';

  // Сборки CI: 0.10.<номер> (с 0.10) или 0.9.x-dev.<14 цифр> (старые). Локальные сборки (0.10.0-dev) — нет.
  function isOtaVersion(v: string): boolean {
    return /^\d+\.\d+\.\d+$/.test(v) || /-dev\.\d{14}$/.test(v);
  }

  let displayVersion = appVersion;
  let otaCapable = isOtaVersion(appVersion);

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
</style>
