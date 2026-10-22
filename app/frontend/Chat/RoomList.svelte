<vbox class="chat-rooms" flex>
  <PersonsList persons={rooms} bind:selected={selectedItem} {doSearch} {search}
    bind:searchTerm sortBy={sortKey} pictureSize={32} picturePlaceholder="initials"
    directoryHint={!startChatEmail}>
    <svelte:fragment slot="below-search">
      {#if startChatEmail}
        <!-- Чата с этим адресом ещё нет: открыть его прямо из поиска -->
        <Button classes="start-chat secondary" icon={ChatIcon}
          label={$t`Write to ${startChatEmail}`}
          onClick={startChatFromSearch} />
      {/if}
    </svelte:fragment>
    <svelte:fragment slot="picture-badge" let:person={room}>
      {#if presenceVersion >= 0 && roomPresence(room)}
        <span class="presence"><StatusDot status={roomPresence(room)} size="10px" /></span>
      {/if}
    </svelte:fragment>
    <hbox slot="top-right" class="last-time" let:person={room}>
      {#if room instanceof ChatRoom && room.lastMessage}
        {getDateTimeString(room.lastMessage.sent)}
      {/if}
      {#if room instanceof ChatRoom && room.unreadCount > 0}
        <span class="unread" aria-label={$t`${room.unreadCount} unread`}>{room.unreadCount}</span>
      {/if}
    </hbox>
    <hbox slot="second-row" flex class="last-msg font-smallest" let:person={room}>
      {#if room instanceof ChatRoom && room.lastMessage}
        {room.lastMessage.text?.substring(0, 50)}
      {:else if room instanceof Person}
        {$t`Contact`}
      {/if}
    </hbox>
  </PersonsList>
</vbox>

<script lang="ts">
  import { ChatRoom } from "../../logic/Chat/ChatRoom";
  import { ChatPersonUID } from "../../logic/Chat/ChatPersonUID";
  import { Person } from "../../logic/Abstract/Person";
  import type { PersonOrGroup } from "../Contacts/Person/PersonOrGroup";
  import PersonsList from "../Contacts/Person/PersonsList.svelte";
  import { getDateTimeString } from "../Util/date";
  import { appGlobal } from "../../logic/app";
  import { ArrayColl, mergeColls, type Collection } from "svelte-collections";
  import { t } from "../../l10n/l10n";
  import Button from "../Shared/Button.svelte";
  import StatusDot from "./Status/StatusDot.svelte";
  import ChatIcon from "lucide-svelte/icons/message-square-text";
  import { presenceOf, type PresenceState } from "./Status/statusLabels";
  import { getJackdawCallClient } from "../../logic/Meet/Jackdaw/JackdawCalls";
  import { JackdawChatAccount, JACKDAW_CHAT_PROTOCOL } from "../../logic/Chat/Jackdaw/JackdawChatAccount";
  import type { ChatAccount } from "../../logic/Chat/ChatAccount";
  import { looksLikeEmail, openJackdawChat } from "./openJackdawChat";

  export let rooms: Collection<ChatRoom>;
  /** Учётная запись чата, чьи комнаты показаны — in. Для чата Jackdaw: статусы и чат по адресу из поиска. */
  export let account: ChatAccount | null = null;
  /** null по умолчанию: при undefined PersonsList подставил бы своего человека */
  export let selectedRoom: ChatRoom = null;
  /** Контакт из адресной книги, выбранный в результатах поиска: с ним ещё нет чата — out */
  export let selectedContact: Person | null = null;
  export let doSearch = false;

  /* PersonsList общий с «Контактами» и по умолчанию выбирает текущего человека
   * ($selectedPerson). Здесь выбор — комната чата или, при поиске, контакт без чата. */
  let selectedItem: PersonOrGroup = selectedRoom ?? null;
  $: syncFromRoom(selectedRoom);
  function syncFromRoom(room: ChatRoom) {
    if (room && selectedItem != room) {
      selectedItem = room;
    }
  }
  $: syncFromItem(selectedItem);
  function syncFromItem(item: PersonOrGroup) {
    if (item instanceof ChatRoom) {
      selectedRoom = item;
      selectedContact = null;
    } else if (item instanceof Person) {
      selectedRoom = null;
      selectedContact = item;
    } else {
      selectedContact = null;
      if (item != null) {
        selectedRoom = null;
      }
    }
  }

  /** Сначала чаты по свежести, затем контакты по имени */
  function sortKey(item: PersonOrGroup): string {
    if (item instanceof ChatRoom) {
      let sent = item.lastMessage?.sent?.getTime() ?? 0;
      return "0" + String(Number.MAX_SAFE_INTEGER - sent).padStart(16, "0");
    }
    return "1" + (item.name ?? "").toLowerCase();
  }

  let searchTerm: string | null = null;
  /** Адрес из поиска, с которым ещё нет чата Jackdaw */
  $: startChatEmail = account instanceof JackdawChatAccount && looksLikeEmail(searchTerm) &&
    !$rooms.contents.some(room => roomMatches(room, searchTerm.trim().toLowerCase()))
    ? searchTerm.trim()
    : null;
  async function startChatFromSearch() {
    if (!(account instanceof JackdawChatAccount) || !startChatEmail) {
      return;
    }
    let room = await openJackdawChat(account, startChatEmail);
    if (room) {
      searchTerm = null;
      selectedItem = room;
    }
  }

  /** Статус собеседника в личных чатах Jackdaw; присутствие обновляется через `presenceVersion` */
  const callClient = getJackdawCallClient();
  $: presenceVersion = $callClient?.presenceVersion ?? 0;
  function roomPresence(item: PersonOrGroup): PresenceState | null {
    if (!(item instanceof ChatRoom) || !(item.contact instanceof ChatPersonUID) ||
        item.contact.protocol != JACKDAW_CHAT_PROTOCOL || !item.contact.emailAddress) {
      return null;
    }
    return presenceOf(callClient, [item.contact.emailAddress]);
  }

  let searchAddressbooks = appGlobal.addressbooks.merge(appGlobal.searchOnlyAddressbooks);
  /** Поиск в чате: свои чаты по имени и адресу, плюс контакты с email, с которыми чата ещё нет */
  function search(term: string): Collection<PersonOrGroup> {
    let query = term.trim().toLowerCase();
    let matchingRooms = rooms.filterObservable(room => roomMatches(room, query));
    let contacts = mergeColls(searchAddressbooks.map(ab => ab.quickSearch(query, false)))
      .filterObservable(person => person.emailAddresses.hasItems && !rooms.find(room => roomIsWith(room, person)));
    return mergeColls(new ArrayColl<Collection<PersonOrGroup>>([matchingRooms, contacts]));
  }
  function roomMatches(room: ChatRoom, query: string): boolean {
    let contact = room.contact;
    return !!(room.name?.toLowerCase().includes(query) ||
      contact?.name?.toLowerCase().includes(query) ||
      (contact instanceof ChatPersonUID && contact.emailAddress?.toLowerCase().includes(query)));
  }
  function roomIsWith(room: ChatRoom, person: Person): boolean {
    return room.contact instanceof ChatPersonUID && room.contact.matchesPerson(person);
  }
</script>

<style>
  .chat-rooms :global(.start-chat) {
    margin: 4px 12px 8px;
    max-width: calc(100% - 24px);
  }
  .chat-rooms :global(.start-chat .label) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Метка в правом нижнем углу аватара 32 px (отступ аватара в строке — 14 px) */
  .presence {
    position: absolute;
    inset-inline-end: 12px;
    bottom: 2px;
    display: flex;
  }
  .chat-rooms :global(.first-row) {
    margin-block-start: 3px;
  }
  .chat-rooms :global(.person .name) {
    font-size: medium;
  }
  .last-time {
    /* Полупрозрачен только текст времени: значок непрочитанных рядом должен быть ярким */
    color: color-mix(in srgb, currentColor 50%, transparent);
    align-items: center;
    font-size: x-small;
    margin-block-start: 3px;
    margin-inline-start: 8px;
  }
  .unread {
    margin-inline-start: 6px;
    min-width: 18px;
    padding: 0 5px;
    border-radius: 9px;
    background: var(--icon-primary);
    color: var(--main-bg, white);
    font-size: 11px;
    font-weight: 600;
    line-height: 18px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  /* Одна строка с многоточием: вторая строка срезалась по высоте наполовину. */
  .last-msg {
    display: block;
    min-width: 0;
    opacity: 50%;
    margin-inline-start: 1px;
    margin-block-end: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
