<script lang="ts">
  /** Звук звонка: мелодия входящего или гудки исходящего, по настройкам «Звонки и чат» */
  import { onDestroy } from "svelte";
  import { playIncomingRingtone, playRingback, type CallSoundHandle } from "../callSounds";

  export let incoming: boolean;

  let sound: CallSoundHandle | null = null;
  $: start(incoming);
  function start(isIncoming: boolean) {
    sound?.stop();
    sound = isIncoming ? playIncomingRingtone() : playRingback();
  }
  onDestroy(() => sound?.stop());
</script>
