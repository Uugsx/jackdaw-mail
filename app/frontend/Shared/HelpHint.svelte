<!-- Small "?" icon with an explanation of a complex field. Shown on hover and on keyboard focus. -->
<span class="help-hint" {title} aria-label={title} role="note" tabindex="0">
  <HelpIcon size={14} />
</span>

<script lang="ts">
  import HelpIcon from "lucide-svelte/icons/circle-help";

  /** Plain-language explanation, already translated */
  export let title: string;
</script>

<style>
  .help-hint {
    display: inline-flex;
    align-items: center;
    margin-inline-start: 6px;
    opacity: 0.55;
    cursor: help;
    flex-shrink: 0;
  }
  .help-hint:hover,
  .help-hint:focus-visible {
    opacity: 1;
  }
</style>
