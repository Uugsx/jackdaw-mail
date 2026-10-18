<vbox class="chat-rooms" flex>
  <PersonsList persons={rooms} bind:selected={selectedItem} {doSearch} {search}
    sortBy={sortKey}>
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

  export let rooms: Collection<ChatRoom>;
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
