<ButtonMenu bind:isMenuOpen label={$t`Chat actions`}>
  {#if $room.isGroup}
    <MenuItem
      label={$room.isAdmin ? $t`Edit group` : $t`Group members`}
      icon={$room.isAdmin ? EditIcon : MembersIcon}
      onClick={() => showGroup = true}
      />
    {#if $room.isMember}
      <MenuItem
        label={$t`Leave group`}
        icon={LeaveIcon}
        onClick={() => confirmLeave = true}
        />
    {/if}
  {/if}
  <MenuItem
    label={muted ? $t`Turn on notifications` : $t`Mute notifications`}
    icon={muted ? BellIcon : BellOffIcon}
    onClick={() => setChatRoomMuted(room.id, !muted)}
    />
  <MenuItem
    label={$t`Delete chat`}
    icon={DeleteIcon}
    onClick={() => confirmDelete = true}
    />
</ButtonMenu>

<ConfirmDialog
  bind:open={confirmLeave}
  title={$t`Leave the group "${$room.name}"?`}
  message={leaveMessage}
  confirmLabel={$t`Leave group`}
  on:confirm={() => catchErrors(leave)}
  />
<ConfirmDialog
  bind:open={confirmDelete}
  title={$room.isGroup ? $t`Delete the group "${$room.name}"?` : $t`Delete the chat with ${$room.name}?`}
  message={deleteMessage}
  confirmLabel={$t`Delete chat`}
  on:confirm={() => catchErrors(deleteChat)}
  />

<script lang="ts">
  /** Действия с открытым чатом Jackdaw: состав группы, выход, удаление у себя */
  import type { JackdawChatRoom } from "../../logic/Chat/Jackdaw/JackdawChatRoom";
  import ButtonMenu from "../Shared/Menu/ButtonMenu.svelte";
  import MenuItem from "../Shared/Menu/MenuItem.svelte";
  import ConfirmDialog from "../Shared/ConfirmDialog.svelte";
  import EditIcon from "lucide-svelte/icons/pencil";
  import MembersIcon from "lucide-svelte/icons/users";
  import LeaveIcon from "lucide-svelte/icons/log-out";
  import DeleteIcon from "lucide-svelte/icons/trash-2";
  import BellIcon from "lucide-svelte/icons/bell";
  import BellOffIcon from "lucide-svelte/icons/bell-off";
  import { mutedChatRoomsSetting, setChatRoomMuted } from "./chatNotificationPrefs";
  import { catchErrors } from "../Util/error";
  import { t } from "../../l10n/l10n";

  export let room: JackdawChatRoom;
  /** in/out: показан диалог группы */
  export let showGroup = false;
  /** in/out: спросить об удалении. Его открывает и плашка «Вы больше не в группе». */
  export let confirmDelete = false;

  let isMenuOpen = false;
  let confirmLeave = false;
  const mutedRooms = mutedChatRoomsSetting;
  $: muted = Array.isArray($mutedRooms.value) && $mutedRooms.value.includes(room.id);

  /** Администратор передаёт группу следующему участнику: говорим, кому */
  $: nextAdmin = $room.isAdmin ? $room.memberEmails.find(email => !room.account.isOwnEmail(email)) : null;
  $: leaveMessage = nextAdmin
    ? $t`You will stop receiving messages from this group. ${nextAdmin} will become the group admin. The chat history stays on this device.`
    : $t`You will stop receiving messages from this group. The chat history stays on this device.`;
  $: deleteMessage = $room.isGroup
    ? $room.isMember
      ? $t`You will leave the group. The chat history and files are deleted on this device only.`
      : $t`The chat history and files are deleted on this device only.`
    : $t`The chat history and files are deleted on this device only. ${$room.name} keeps their copy.`;

  async function leave() {
    await room.leaveGroup();
    showGroup = false;
  }

  async function deleteChat() {
    showGroup = false;
    await room.account.deleteRoom(room);
  }
</script>
