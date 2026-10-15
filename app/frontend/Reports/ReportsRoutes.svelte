<script lang="ts">
  import { Route } from "svelte-navigator";
  import ProFeatureGate from "../Shared/ProFeatureGate.svelte";
  import ReportsApp from "./ReportsApp.svelte";
</script>

<ProFeatureGate feature="reports">
  <Route path="/">
    <ReportsApp />
  </Route>
</ProFeatureGate>
