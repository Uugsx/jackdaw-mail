<script lang="ts">
  import { Route } from "svelte-navigator";
  import ProFeatureGate from "../Shared/ProFeatureGate.svelte";
  import LiveSlaApp from "./LiveSlaApp.svelte";
</script>

<ProFeatureGate feature="live-sla">
  <Route path="/">
    <LiveSlaApp />
  </Route>
</ProFeatureGate>
