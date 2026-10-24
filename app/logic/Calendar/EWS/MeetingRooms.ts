/**
 * Переговорные комнаты Exchange: списки комнат (`GetRoomLists`), комнаты в списке
 * (`GetRooms`) и их занятость на время встречи через уже существующий free/busy
 * (`Calendar.arePersonsFree()`, внутри — `GetUserAvailability`).
 *
 * Комната попадает во встречу как ресурс (Exchange `Resources`) и в поле «Место».
 */
import type { Calendar } from "../Calendar";
import type { Event } from "../Event";
import { Participant } from "../Participant";
import { InvitationResponse } from "../Invitation/InvitationStatus";
import { OWARequest } from "../../Mail/OWA/Request/OWARequest";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { ensureArray } from "../../util/util";

/** Список комнат (на сервере — рассылка с типом «список комнат») или сама комната */
export interface MeetingRoom {
  name: string;
  emailAddress: string;
}

/** `true` — свободна, `false` — занята, `undefined` — сервер не знает */
export type RoomAvailability = boolean | undefined;

/** Сколько ящиков спрашиваем за один `GetUserAvailability`. Предел Exchange — 100. */
export const kRoomsPerAvailabilityRequest = 50;

const kLocationSeparator = "; ";

// EWS

export function ewsGetRoomListsRequest() {
  return {
    m$GetRoomLists: {},
  };
}

export function ewsGetRoomsRequest(roomListEmailAddress: string) {
  return {
    m$GetRooms: {
      m$RoomList: {
        t$EmailAddress: roomListEmailAddress,
      },
    },
  };
}

/** Разбирает `GetRoomListsResponse`: `RoomLists/Address` */
export function parseEWSRoomLists(response: any): MeetingRoom[] {
  return parseAddresses(ensureArray(response?.RoomLists?.Address));
}

/** Разбирает `GetRoomsResponse`: `Rooms/Room/Id` */
export function parseEWSRooms(response: any): MeetingRoom[] {
  return parseAddresses(ensureArray(response?.Rooms?.Room).map(room => room?.Id));
}

// OWA

/** OWA принимает те же операции, что и EWS, в виде JSON в `service.svc` */
export function owaGetRoomListsRequest(): OWARequest {
  return new OWARequest("GetRoomLists", {
    __type: "GetRoomListsRequest:#Exchange",
  });
}

export function owaGetRoomsRequest(roomListEmailAddress: string): OWARequest {
  return new OWARequest("GetRooms", {
    __type: "GetRoomsRequest:#Exchange",
    RoomList: {
      __type: "EmailAddress:#Exchange",
      EmailAddress: roomListEmailAddress,
    },
  });
}

/** Разбирает ответ `GetRoomLists` из OWA. Разные версии Exchange отдают
 * либо массив адресов, либо, как в XML, объект с `Address`. */
export function parseOWARoomLists(response: any): MeetingRoom[] {
  let lists = response?.RoomLists;
  return parseAddresses(Array.isArray(lists) ? lists : ensureArray(lists?.Address));
}

/** Разбирает ответ `GetRooms` из OWA: комната — `{ Id: адрес }`, иногда сам адрес */
export function parseOWARooms(response: any): MeetingRoom[] {
  let rooms = response?.Rooms;
  rooms = Array.isArray(rooms) ? rooms : ensureArray(rooms?.Room);
  return parseAddresses(rooms.map(room => room?.Id ?? room));
}

function parseAddresses(addresses: any[]): MeetingRoom[] {
  let rooms: MeetingRoom[] = [];
  for (let address of addresses) {
    let emailAddress = sanitize.emailAddress(address?.EmailAddress, null);
    if (!emailAddress || rooms.some(room => sameAddress(room.emailAddress, emailAddress))) {
      continue;
    }
    rooms.push({
      emailAddress,
      name: sanitize.nonemptystring(address.Name, null)?.trim() || emailAddress,
    });
  }
  return rooms.sort((a, b) => a.name.localeCompare(b.name));
}

// Занятость

/**
 * Свободны ли комнаты с `from` до `to`.
 * Комната свободна, только если сервер прислал её расписание и в нём нет
 * пересекающейся занятости. Нет данных — `undefined`, не «свободна».
 */
export async function getRoomsAvailability(calendar: Calendar, rooms: MeetingRoom[], from: Date, to: Date): Promise<Map<string, RoomAvailability>> {
  let result = new Map<string, RoomAvailability>();
  for (let i = 0; i < rooms.length; i += kRoomsPerAvailabilityRequest) {
    let chunk = rooms.slice(i, i + kRoomsPerAvailabilityRequest);
    let participants = chunk.map(room => new Participant(room.emailAddress, room.name, InvitationResponse.Unknown));
    let availabilities = await calendar.arePersonsFree(participants, from, to);
    for (let [j, room] of chunk.entries()) {
      result.set(room.emailAddress.toLowerCase(), isFree(availabilities[j]?.availability, from, to));
    }
  }
  return result;
}

export function isFree(availability: { from: Date, to: Date, free: boolean }[] | undefined, from: Date, to: Date): RoomAvailability {
  if (!availability) {
    return undefined;
  }
  return availability.every(slot => slot.free || slot.to <= from || to <= slot.from);
}

// Комната во встрече

export function getRoomsOfEvent(event: Event): Participant[] {
  return event.participants.contents.filter(participant => participant.isResource);
}

export function eventHasRoom(event: Event, room: MeetingRoom): boolean {
  return event.participants.some(participant => sameAddress(participant.emailAddress, room.emailAddress));
}

/** Добавляет комнату ресурсом встречи и дописывает её в «Место».
 * Организатора встречи вызывающий создаёт сам (`event.createMeeting()`). */
export function addRoomToEvent(event: Event, room: MeetingRoom): void {
  let existing = event.participants.find(participant => sameAddress(participant.emailAddress, room.emailAddress));
  if (existing) {
    // Уже приглашена как человек — переводим в ресурсы
    existing.isResource = true;
    existing.isOptional = false;
  } else {
    event.participants.add(new Participant(room.emailAddress, room.name, InvitationResponse.Unknown, false, true));
  }
  let parts = splitLocation(event.location);
  if (!parts.includes(room.name)) {
    event.location = [...parts, room.name].join(kLocationSeparator);
  }
}

/** Убирает комнату из встречи и из «Места» */
export function removeRoomFromEvent(event: Event, room: MeetingRoom): void {
  let participant = event.participants.find(participant => participant.isResource && sameAddress(participant.emailAddress, room.emailAddress));
  if (participant) {
    event.participants.remove(participant);
  }
  let parts = splitLocation(event.location);
  let names = [room.name, participant?.name].filter(Boolean);
  if (parts.some(part => names.includes(part))) {
    event.location = parts.filter(part => !names.includes(part)).join(kLocationSeparator);
  }
}

function splitLocation(location: string | null | undefined): string[] {
  return (location ?? "").split(";").map(part => part.trim()).filter(Boolean);
}

function sameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.toLowerCase() == b.toLowerCase();
}
