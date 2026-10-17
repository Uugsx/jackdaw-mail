<svelte:window on:keydown={onKeydown} />
<form class="dialog group-dialog" on:submit|preventDefault={() => catchErrors(save)}
  aria-labelledby="group-dialog-title">
  <hbox class="title-line">
    <h2 id="group-dialog-title" class="dialog-title">{$room.isAdmin ? $t`Edit group` : $t`Group members`}</h2>
    <hbox flex />
    <RoundButton
      label={$t`Close`}
      onClick={close}
      icon={XIcon}
      iconSize="16px"
      padding="2px"
      />
  </hbox>
  {#if $room.isAdmin && $room.isMember}
    <label for="group-dialog-name">{$t`Group name`}</label>
    <!-- svelte-ignore a11y-autofocus -->
    <input id="group-dialog-name" type="text" bind:value={name} maxlength="120" placeholder={$t`Team`} autofocus />
    <span class="field-label">{$t`Members`}</span>
    <GroupMembersInput account={room.account} {members} bind:withoutChat bind:isChecking />
    {#if notAdded.length}
      <p class="notice warning" role="status">
        {$t`Not added, because they do not use Jackdaw chat: ${notAdded.join(", ")}`}
      </p>
    {/if}
    <hbox class="buttons">
      <RoundButton
        label={$t`Save`}
        icon={SaveIcon}
        classes="create"
        disabled={!$members.length || isChecking || $members.length <= withoutChat.length}
        onClick={save}
        />
    </hbox>
  {:else}
    {#if !$room.isMember}
      <p class="notice">{$t`You are no longer a member of this group.`}</p>
    {/if}
    <ul class="member-list">
      {#each $room.memberEmails as email (email)}
        <li>
          <span class="member-name">{room.account.isOwnEmail(email) ? $t`You` : displayName(email)}</span>
          <span class="member-email">{email}</span>
          {#if email == $room.admin}
            <span class="badge">{$t`Admin`}</span>
          {/if}
        </li>
      {/each}
    </ul>
    <p class="hint">{$t`Only the group admin can change the name and members.`}</p>
  {/if}
</form>

<script lang="ts">
  /** Состав и название группы чата Jackdaw. Администратор меняет их, остальные видят. */
  import type { JackdawChatRoom } from "../../logic/Chat/Jackdaw/JackdawChatRoom";
  import type { PersonUID } from "../../logic/Abstract/PersonUID";
  import GroupMembersInput from "./GroupMembersInput.svelte";
  import RoundButton from "../Shared/RoundButton.svelte";
  import XIcon from "lucide-svelte/icons/x";
  import SaveIcon from "lucide-svelte/icons/check";
  import { ArrayColl } from "svelte-collections";
  import { catchErrors } from "../Util/error";
  import { t } from "../../l10n/l10n";

  export let room: JackdawChatRoom;
  /** in/out: диалог открыт */
  export let open = true;

  let name = room.name;
  /** Текущие участники без нас: администратор в группе всегда */
  const members = new ArrayColl<PersonUID>(room.members.contents);
  let withoutChat: string[] = [];
  let isChecking = false;
  /** После сохранения: кого не добавили, потому что у них нет чата Jackdaw */
  let notAdded: string[] = [];

  function displayName(email: string): string {
    let person = room.account.getPersonUID(email);
    return person.findPerson()?.name || person.name || email;
  }

  async function save() {
    notAdded = await room.updateGroup(name, members.contents.map(member => member.emailAddress));
    if (!notAdded.length) {
      close();
    } else {
      members.replaceAll(room.members.contents);
      withoutChat = [];
    }
  }

  function close() {
    open = false;
  }

  function onKeydown(event: KeyboardEvent) {
    // Escape, который уже обработал другой диалог (подтверждение), не закрывает этот
    if (event.key == "Escape" && !event.defaultPrevented) {
      event.preventDefault();
      close();
    }
  }
</script>

<style>
  .dialog {
    margin: 32px 32px;
    max-width: 480px;
  }
  .group-dialog {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .title-line {
    margin-block-end: 12px;
    align-items: center;
  }
  .dialog-title {
    margin: 0;
    font-size: 16px;
  }
  .group-dialog label, .field-label {
    font-size: 13px;
    font-weight: 600;
    margin-block-start: 4px;
  }
  .group-dialog input {
    box-sizing: border-box;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 10px;
    background: var(--main-bg);
    color: var(--main-fg);
  }
  .group-dialog input:focus-visible {
    outline: 2px solid var(--icon-primary);
    outline-offset: 1px;
  }
  .member-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .member-list li {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }
  .member-name {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .member-email {
    flex: 1;
    font-size: 12px;
    color: color-mix(in srgb, var(--main-fg) 65%, transparent);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .badge {
    font-size: 11px;
    padding: 1px 6px;
    border: 1px solid var(--border);
    border-radius: 4px;
  }
  .notice {
    margin: 0;
    font-size: 13px;
  }
  .hint {
    margin: 0;
    font-size: 12px;
    color: color-mix(in srgb, var(--main-fg) 65%, transparent);
  }
  .warning {
    color: var(--error-fg, #b00020);
  }
  .buttons {
    justify-content: end;
  }
</style>
