<hbox class="mail-list-topic-separator" role="heading" aria-level="3">
  <ChevronDownIcon size="15px" strokeWidth={2} aria-hidden="true" />
  <hbox class="label">{label || $t`No subject`}</hbox>
</hbox>

<script lang="ts">
  import ChevronDownIcon from "lucide-svelte/icons/chevron-down";
  import { t } from "../../../l10n/l10n";

  export let label: string;
</script>

<style>
  .mail-list-topic-separator {
    min-height: var(--fast-list-row-height, 2.75rem);
    box-sizing: border-box;
    align-items: center;
    gap: 4px;
    padding: 4px 12px 4px 10px;
    border-block: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
    background-color: color-mix(in srgb, var(--main-fg) 6%, var(--main-bg));
    color: color-mix(in srgb, var(--main-fg) 68%, transparent);
    pointer-events: none;
    user-select: none;
  }
  .label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--msg-list-fs, 13px);
    font-weight: 600;
    letter-spacing: -0.01em;
  }
</style>
