<vbox flex class="import-window">
  <hbox flex />
  <vbox class="page-box">
    <SetupAnyAccountType />
  </vbox>
  <hbox flex />
  <BackgroundVideo />
</vbox>

<script lang="ts">
  import BackgroundVideo from "./Shared/BackgroundVideo.svelte";
  import SetupAnyAccountType from "./SetupAnyAccountType.svelte";
</script>

<style>
  .import-window {
    justify-content: center;
    align-items: center;
  }
  .page-box {
    max-width: 32em;
    padding: 28px 48px 24px 48px;
    background-color: var(--main-bg);
    color: var(--main-fg);
    border: 1px solid var(--border);
    border-radius: var(--border-radius);
  }
  :global(.mobile) .page-box {
    padding: 16px 24px;
    border-radius: 16px;
  }
</style>
