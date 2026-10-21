<vbox flex class="message-body" style:zoom={plaintextZoom} style:width={plaintextZoomWidth}>
  {#if !$message.loadedBody}
    {#key loadAttempt}
      {#await loadMessageBody()}
        {#await sleep(1)}
          <hbox></hbox>
        {:then}
          {$t`Loading...`}
        {/await}
      {:catch ex}
        <ErrorMessage {ex} onRetry={retryLoad} />
      {/await}
    {/key}
  {:else if mode == DisplayMode.HTML}
    <HTMLDisplay html={$message.html} allowExternalImages={false} allowImageOpen {zoom} on:zoomwheel />
  {:else if mode == DisplayMode.HTMLWithExternal}
    <HTMLDisplay html={$message.html} allowExternalImages={true} allowImageOpen {zoom} on:zoomwheel />
  {:else if mode == DisplayMode.Plaintext}
    <PlaintextDisplay plaintext={$message.text} />
    <!--<HTMLDisplay html={convertTextToHTML($message.text)} />-->
  {:else if mode == DisplayMode.Source}
    {#await message.loadMIME()}
      {$t`Loading...`}
    {:then}
      <PlaintextDisplay plaintext={getSource($message)} />
    {/await}
  {:else if mode == DisplayMode.Thread}
    <!-- Thread view unfinished; show HTML until implemented -->
    <HTMLDisplay html={$message.html} allowExternalImages={false} allowImageOpen {zoom} on:zoomwheel />
  {:else}
    {$t`Unknown display mode`}
  {/if}
</vbox>

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import HTMLDisplay from "./HTMLDisplay.svelte";
  import PlaintextDisplay from "./PlaintextDisplay.svelte";
  import ErrorMessage from "../../Shared/ErrorMessageInline.svelte";
  import { sleep } from "../../../logic/util/util";
  import { t } from "../../../l10n/l10n";
  import {
    getMessageContentRenderingSetting,
    normalizeMessageContentRendering,
  } from "./messageViewerAppearance";

  export let message: EMail;
  export let zoom = 100;

  let messageAccount = message?.folder?.account;
  let modeSetting = getMessageContentRenderingSetting(messageAccount);
  $: messageAccount = $message?.folder?.account ?? message?.folder?.account;
  $: modeSetting = getMessageContentRenderingSetting(messageAccount);
  $: mode = normalizeMessageContentRendering($modeSetting.value) as DisplayMode;
  $: message.loadExternalImages = mode == DisplayMode.HTMLWithExternal;
  $: plaintextZoom = mode == DisplayMode.Plaintext || mode == DisplayMode.Source ? zoom / 100 : undefined;
  $: plaintextZoomWidth = plaintextZoom && plaintextZoom != 1 ? `calc(100% / ${plaintextZoom})` : undefined;

  /** Повтор после сбоя: `{#key}` запускает загрузку заново */
  let loadAttempt = 0;
  function retryLoad() {
    loadAttempt++;
  }

  async function loadMessageBody(): Promise<void> {
    // The account can become available between component creation and the
    // first body load. Resolve the mailbox mode immediately before loading so
    // sanitization and the first HTMLDisplay use the same setting.
    messageAccount = message?.folder?.account;
    modeSetting = getMessageContentRenderingSetting(messageAccount);
    mode = normalizeMessageContentRendering($modeSetting.value) as DisplayMode;
    message.loadExternalImages = mode == DisplayMode.HTMLWithExternal;
    await message.loadBody();
  }

  function getSource(message: EMail): string {
    if (!message.mime) {
      return $t`Source not available`;
    }
    return new TextDecoder().decode($message.mime);
  }
</script>

<script lang="ts" context="module">
  export enum DisplayMode {
    HTML = "html",
    HTMLWithExternal = "with-external",
    Plaintext = "plaintext",
    Source = "source",
    Thread = "thread",
  }
</script>

<style>
  .message-body {
    min-width: 0;
    box-sizing: border-box;
    overflow-x: hidden;
    overflow-wrap: anywhere;
    background-color: var(--message-viewer-bg, var(--main-bg));
    color: var(--message-viewer-fg, var(--main-fg));
  }
</style>
