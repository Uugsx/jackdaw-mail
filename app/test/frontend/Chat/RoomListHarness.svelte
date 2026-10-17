<RoomList {rooms} bind:selectedRoom bind:selectedContact />

<script lang="ts">
  import RoomList from "../../../frontend/Chat/RoomList.svelte";

  export let rooms;
  export let onSelected: (room: unknown) => void;
  export let onContact: (contact: unknown) => void = () => {};
  let selectedRoom = undefined;
  let selectedContact = null;
  $: onSelected(selectedRoom);
  $: onContact(selectedContact);
</script>
