<!-- Событие комнаты (звонок, изменение состава) — по центру ленты, как служебная строка, а не сообщение -->
<hbox flex class="chatroomevent" role="note">
  <hbox class="text selectable font-smallest">
    <span>{@html message.html }</span>
    {#if message.sent}
      <span class="time">{getTimeString(message.sent)}</span>
    {/if}
  </hbox>
</hbox>

<script lang="ts">
  import type { ChatRoomEvent } from "../../../logic/Chat/RoomEvent";
  import { getTimeString } from "../../Util/date";

  export let message: ChatRoomEvent;
</script>

<style>
  .chatroomevent {
    justify-content: center;
    margin: 12px 32px 4px;
  }
  .text {
    align-items: center;
    gap: 8px;
    padding: 4px 12px;
    border-radius: 12px;
    color: var(--main-fg);
    background-color: color-mix(in srgb, var(--main-fg) 7%, transparent);
  }
  .time {
    font-variant-numeric: tabular-nums;
    opacity: 0.6;
  }
  .text :global(.person) {
    color: var(--link-fg);
  }
</style>
