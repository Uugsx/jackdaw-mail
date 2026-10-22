<span class="status-dot {status}" role="img" aria-label={statusLabel(status)} title={statusHint(status)} style:--size={size}></span>

<script lang="ts">
  /** Цветная метка статуса: «в сети» — зелёная, «занят» — жёлтая, «не беспокоить» — красная с чертой */
  import type { JackdawUserStatus } from "../../../logic/Meet/Jackdaw/JackdawCallProtocol";
  import { statusHint, statusLabel } from "./statusLabels";

  export let status: JackdawUserStatus;
  export let size = "10px";
</script>

<style>
  .status-dot {
    display: inline-block;
    flex: none;
    position: relative;
    width: var(--size);
    height: var(--size);
    border-radius: 50%;
    box-shadow: 0 0 0 2px var(--main-bg);
  }
  .available {
    background-color: #2f9e5b;
  }
  .busy {
    background-color: #d99a1e;
  }
  .dnd {
    background-color: #d23f31;
  }
  .dnd::after {
    content: "";
    position: absolute;
    inset-inline: 22%;
    top: calc(50% - 1px);
    height: 2px;
    border-radius: 1px;
    background-color: #fff;
  }
</style>
