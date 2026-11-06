{#if on}
  <hbox>
    <HTMLDisplay html={message.html} {webviewE} on:webview={onWebView} />
  </hbox>
{/if}

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import HTMLDisplay from "./HTMLDisplay.svelte";
  import { sleep } from "../../../logic/util/util";
  import { tick } from "svelte";

  export let message: EMail;

  let webviewE: HTMLIFrameElement;
  let on = false;

  export async function print() {
    let webview = await loadWebView();
    await webview.print(options());
    await sleep(200); // If we close the webview, the Print dialog stays open, but then doesn't actually print
    on = false;
  }

  export async function pdf() {
    // PDF export is not supported yet; fall back to the system print dialog.
    await print();
  }

  function options() {
    return {
      header: message.subject,
    };
  }

  let gotWebView: (webview: any) => void;
  async function loadWebView(): Promise<any> {
    if (on) {
      on = false;
      await tick();
    }
    on = true;
    return new Promise((resolve, reject) => {
      gotWebView = resolve;
    });
  }

  function onWebView(event: CustomEvent) {
    let webviewE = event.detail;
    gotWebView(webviewE);
  }
</script>

<style>
  hbox {
    height: 1px;
    width: 1px;
  }
</style>
