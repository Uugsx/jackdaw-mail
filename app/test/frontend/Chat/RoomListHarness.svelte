<RoomList {rooms} bind:selectedRoom />

<script lang="ts">
  import RoomList from "../../../frontend/Chat/RoomList.svelte";

  export let rooms;
  export let onSelected: (room: unknown) => void;
  let selectedRoom = undefined;
  $: onSelected(selectedRoom);
</script>
