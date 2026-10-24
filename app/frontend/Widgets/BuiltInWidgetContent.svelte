<!-- Содержимое встроенной панели для нижней части разделённой боковой панели -->
{#if kind === "calendar"}
  <CalendarWidgetPanel />
{:else if kind === "chat"}
  <ChatWidgetPanel />
{:else if kind === "live-sla"}
  <ProFeatureGate feature="live-sla" compact={true}>
    <LiveSlaApp embedded={true} />
  </ProFeatureGate>
{/if}

<script lang="ts">
  import CalendarWidgetPanel from "./CalendarWidgetPanel.svelte";
  import ChatWidgetPanel from "./ChatWidgetPanel.svelte";
  import LiveSlaApp from "../Reports/LiveSlaApp.svelte";
  import ProFeatureGate from "../Shared/ProFeatureGate.svelte";
  import type { WidgetKind } from "./widgetState";

  export let kind: WidgetKind;
</script>
