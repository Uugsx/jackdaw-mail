<ButtonMenu bind:isMenuOpen placement="bottom-start">
  <button slot="control" class="my-status" type="button"
    aria-haspopup="menu" aria-expanded={isMenuOpen}
    title={statusHint(status)}
    on:click={() => isMenuOpen = !isMenuOpen}>
    <StatusDot {status} />
    <span class="label">{statusLabel(status)}</span>
    {#if untilLabel}
      <span class="until">{untilLabel}</span>
    {/if}
  </button>
  <MenuLabel label={$t`Your status in Jackdaw chat`} />
  <MenuItem label={statusLabel("available")} selected={status == "available"}
    onClick={() => callClient.setMyStatus("available")} />
  <MenuItem label={statusLabel("busy")} selected={status == "busy" && !$callClient.myStatusUntil}
    onClick={() => callClient.setMyStatus("busy")} />
  <MenuItem label={$t`Busy for 1 hour`}
    onClick={() => callClient.setMyStatus("busy", kHour)} />
  <MenuDivider />
  <MenuItem label={$t`Do not disturb for 1 hour`}
    onClick={() => callClient.setMyStatus("dnd", kHour)} />
  <MenuItem label={$t`Do not disturb until end of day`}
    onClick={() => callClient.setMyStatus("dnd", secondsUntilEndOfDay())} />
  <MenuItem label={$t`Do not disturb until I turn it off`} selected={status == "dnd" && !$callClient.myStatusUntil}
    onClick={() => callClient.setMyStatus("dnd")} />
</ButtonMenu>

<script lang="ts">
  /**
   * Свой статус в чате и звонках Jackdaw. Общий для всех устройств адреса:
   * «Не беспокоить» отклоняет звонки на сервере, «Занят» только предупреждает звонящего.
   */
  import { getJackdawCallClient } from "../../../logic/Meet/Jackdaw/JackdawCalls";
  import { secondsUntilEndOfDay, statusHint, statusLabel } from "./statusLabels";
  import StatusDot from "./StatusDot.svelte";
  import ButtonMenu from "../../Shared/Menu/ButtonMenu.svelte";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import MenuLabel from "../../Shared/Menu/MenuLabel.svelte";
  import MenuDivider from "../../Shared/Menu/MenuDivider.svelte";
  import { t } from "../../../l10n/l10n";

  const kHour = 60 * 60;
  const callClient = getJackdawCallClient();
  let isMenuOpen = false;

  $: status = $callClient.myStatus;
  $: untilLabel = $callClient.myStatusUntil
    ? $t`until ${new Date($callClient.myStatusUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : "";
</script>

<style>
  .my-status {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 32px;
    padding: 4px 12px;
    border: 1px solid var(--border);
    border-radius: 16px;
    background-color: transparent;
    color: var(--main-fg);
    font: inherit;
    cursor: pointer;
    transition: background-color 120ms ease-out, transform 120ms ease-out;
  }
  .my-status:hover {
    background-color: var(--hover-bg);
  }
  .my-status:active {
    transform: translateY(1px);
  }
  .my-status:focus-visible {
    outline: 2px solid var(--selected-border, currentColor);
    outline-offset: 2px;
  }
  .label {
    white-space: nowrap;
  }
  .until {
    opacity: 0.75;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
</style>
