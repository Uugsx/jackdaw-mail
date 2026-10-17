<PersonAutocomplete skipPersonFunc={skipPerson} onAddPerson={addMember} />
{#if $members.length}
  <ul class="group-members">
    {#each $members.contents as member (member.emailAddress)}
      <li>
        <vbox class="member-text">
          <hbox class="member-line">
            <span class="member-name">{member.name || member.emailAddress}</span>
            <span class="member-email">{member.emailAddress}</span>
          </hbox>
          {#if checking.includes(member.emailAddress.toLowerCase())}
            <span class="member-status" role="status">{$t`Checking Jackdaw chat…`}</span>
          {:else if withoutChat.includes(member.emailAddress.toLowerCase())}
            <span class="member-status warning">
              <WarningIcon size="12px" aria-hidden="true" />
              {$t`Does not use Jackdaw chat. Will not be added.`}
            </span>
          {/if}
        </vbox>
        <RoundButton
          label={$t`Remove`}
          icon={XIcon}
          iconSize="12px"
          padding="2px"
          onClick={() => removeMember(member)}
          />
      </li>
    {/each}
  </ul>
{/if}
{#if withoutChat.length}
  <p class="hint warning" role="status">
    {$t`Members without Jackdaw chat are not added to the group: messages would not reach them. They can be added after they set up Jackdaw Mail.`}
  </p>
{:else if !$members.length}
  <p class="hint">{$t`Add the Jackdaw Mail users who should be in the group.`}</p>
{/if}

<script lang="ts">
  /** Выбор участников группы чата Jackdaw. Новых участников сразу проверяет:
   * у кого нет чата Jackdaw, тот помечен предупреждением и в группу не попадёт. */
  import type { PersonUID } from "../../logic/Abstract/PersonUID";
  import type { JackdawChatAccount } from "../../logic/Chat/Jackdaw/JackdawChatAccount";
  import PersonAutocomplete from "../Contacts/PersonAutocomplete/PersonAutocomplete.svelte";
  import RoundButton from "../Shared/RoundButton.svelte";
  import XIcon from "lucide-svelte/icons/x";
  import WarningIcon from "lucide-svelte/icons/triangle-alert";
  import { ArrayColl } from "svelte-collections";
  import { t } from "../../l10n/l10n";

  export let account: JackdawChatAccount;
  /** in/out: выбранные участники */
  export let members: ArrayColl<PersonUID>;
  /** out: адреса (в нижнем регистре) выбранных участников без чата Jackdaw */
  export let withoutChat: string[] = [];
  /** out: проверка ещё идёт */
  export let isChecking = false;

  let checking: string[] = [];
  $: isChecking = checking.length > 0;

  /** Чат Jackdaw адресуется по email: без адреса писать некуда. Уже добавленных не предлагаем. */
  function skipPerson(person: PersonUID): boolean {
    let email = person.emailAddress?.toLowerCase();
    return !email?.includes("@") || members.some(member => member.emailAddress?.toLowerCase() == email);
  }

  function addMember(person: PersonUID) {
    let email = person.emailAddress?.toLowerCase();
    if (!email || members.some(member => member.emailAddress?.toLowerCase() == email)) {
      return;
    }
    members.add(person);
    void check(email);
  }

  async function check(email: string) {
    checking = [...checking, email];
    try {
      let missing = await account.emailsWithoutChat([email]);
      if (missing.length && members.some(member => member.emailAddress?.toLowerCase() == email)) {
        withoutChat = [...new Set([...withoutChat, ...missing])];
      }
    } catch (ex) {
      // Нет связи: не помечаем. Создание группы проверит адреса ещё раз и скажет, если что-то не так.
    } finally {
      checking = checking.filter(e => e != email);
    }
  }

  function removeMember(member: PersonUID) {
    members.remove(member);
    let email = member.emailAddress?.toLowerCase();
    withoutChat = withoutChat.filter(e => e != email);
  }
</script>

<style>
  .group-members {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .group-members li {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .member-text {
    flex: 1;
    min-width: 0;
  }
  .member-line {
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
  .member-status {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: color-mix(in srgb, var(--main-fg) 65%, transparent);
  }
  .warning {
    color: var(--error-fg, #b00020);
  }
  .hint {
    margin: 0;
    font-size: 12px;
    color: color-mix(in srgb, var(--main-fg) 65%, transparent);
  }
  .hint.warning {
    color: var(--error-fg, #b00020);
  }
</style>
