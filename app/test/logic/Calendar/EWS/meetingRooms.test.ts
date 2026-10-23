// @vitest-environment happy-dom

// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import { Calendar } from "../../../../logic/Calendar/Calendar";
import { Event } from "../../../../logic/Calendar/Event";
import { EWSEvent } from "../../../../logic/Calendar/EWS/EWSEvent";
import { OWAEvent } from "../../../../logic/Calendar/OWA/OWAEvent";
import { Participant } from "../../../../logic/Calendar/Participant";
import { InvitationResponse } from "../../../../logic/Calendar/Invitation/InvitationStatus";
import { EWSAccount } from "../../../../logic/Mail/EWS/EWSAccount";
import { EWSItemError } from "../../../../logic/Mail/EWS/EWSError";
import {
  addRoomToEvent, eventHasRoom, ewsGetRoomListsRequest, ewsGetRoomsRequest, getRoomsAvailability, getRoomsOfEvent,
  isFree, kRoomsPerAvailabilityRequest, owaGetRoomListsRequest, owaGetRoomsRequest, parseEWSRoomLists, parseEWSRooms,
  parseOWARoomLists, parseOWARooms, removeRoomFromEvent, type MeetingRoom,
} from "../../../../logic/Calendar/EWS/MeetingRooms";
import { describe, expect, test, vi } from "vitest";

const kRoom: MeetingRoom = { name: "Переговорная 1", emailAddress: "room1@example.com" };
const kRoom2: MeetingRoom = { name: "Переговорная 2", emailAddress: "room2@example.com" };

/** happy-dom теряет пространства имён у `createDocument()`, поэтому ищем по префиксам `m:` и `t:` */
function requestXML(request: any): Document {
  return new DOMParser().parseFromString(new EWSAccount().request2XML(request), "text/xml");
}

function ewsResponse(body: string): any {
  let account = new EWSAccount();
  let text = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Body xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${body}</s:Body>
</s:Envelope>`;
  return account.checkResponse({ responseXML: account.parseXML(text) }, {} as any);
}

const kNS = `xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages" xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types"`;

describe("EWS: запросы", () => {
  test("GetRoomLists без параметров", () => {
    let doc = requestXML(ewsGetRoomListsRequest());
    let request = doc.getElementsByTagName("m:GetRoomLists")[0];
    expect(request).toBeTruthy();
    expect(request.children.length).toBe(0);
  });

  test("GetRooms: адрес списка в RoomList/EmailAddress", () => {
    let doc = requestXML(ewsGetRoomsRequest("building1@example.com"));
    let list = doc.getElementsByTagName("m:RoomList")[0];
    expect(list.parentElement.tagName).toBe("m:GetRooms");
    expect(list.getElementsByTagName("t:EmailAddress")[0].textContent).toBe("building1@example.com");
  });
});

describe("EWS: ответы", () => {
  test("GetRoomLists: несколько списков, сортировка по имени", () => {
    let response = ewsResponse(`<GetRoomListsResponse ResponseClass="Success" xmlns="http://schemas.microsoft.com/exchange/services/2006/messages">
      <ResponseCode>NoError</ResponseCode>
      <m:RoomLists ${kNS}>
        <t:Address><t:Name>Здание Б</t:Name><t:EmailAddress>b@example.com</t:EmailAddress><t:RoutingType>SMTP</t:RoutingType><t:MailboxType>PublicDL</t:MailboxType></t:Address>
        <t:Address><t:Name>Здание А</t:Name><t:EmailAddress>a@example.com</t:EmailAddress><t:RoutingType>SMTP</t:RoutingType><t:MailboxType>PublicDL</t:MailboxType></t:Address>
      </m:RoomLists>
    </GetRoomListsResponse>`);
    expect(parseEWSRoomLists(response)).toEqual([
      { name: "Здание А", emailAddress: "a@example.com" },
      { name: "Здание Б", emailAddress: "b@example.com" },
    ]);
  });

  test("GetRoomLists: один список и пустой ответ", () => {
    let one = ewsResponse(`<GetRoomListsResponse ResponseClass="Success" xmlns="http://schemas.microsoft.com/exchange/services/2006/messages">
      <ResponseCode>NoError</ResponseCode>
      <m:RoomLists ${kNS}><t:Address><t:Name>Офис</t:Name><t:EmailAddress>office@example.com</t:EmailAddress></t:Address></m:RoomLists>
    </GetRoomListsResponse>`);
    expect(parseEWSRoomLists(one)).toEqual([{ name: "Офис", emailAddress: "office@example.com" }]);
    let empty = ewsResponse(`<GetRoomListsResponse ResponseClass="Success" xmlns="http://schemas.microsoft.com/exchange/services/2006/messages">
      <ResponseCode>NoError</ResponseCode>
      <m:RoomLists ${kNS} />
    </GetRoomListsResponse>`);
    expect(parseEWSRoomLists(empty)).toEqual([]);
  });

  test("GetRooms: комнаты из Room/Id, без имени — адрес, без адреса — пропуск", () => {
    let response = ewsResponse(`<GetRoomsResponse ResponseClass="Success" xmlns="http://schemas.microsoft.com/exchange/services/2006/messages">
      <ResponseCode>NoError</ResponseCode>
      <m:Rooms ${kNS}>
        <t:Room><t:Id><t:Name>Переговорная 1</t:Name><t:EmailAddress>room1@example.com</t:EmailAddress><t:RoutingType>SMTP</t:RoutingType><t:MailboxType>Mailbox</t:MailboxType></t:Id></t:Room>
        <t:Room><t:Id><t:EmailAddress>room3@example.com</t:EmailAddress></t:Id></t:Room>
        <t:Room><t:Id><t:Name>Сломанная</t:Name></t:Id></t:Room>
        <t:Room><t:Id><t:Name>Дубль</t:Name><t:EmailAddress>ROOM1@example.com</t:EmailAddress></t:Id></t:Room>
      </m:Rooms>
    </GetRoomsResponse>`);
    expect(parseEWSRooms(response)).toEqual([
      { name: "room3@example.com", emailAddress: "room3@example.com" },
      { name: "Переговорная 1", emailAddress: "room1@example.com" },
    ]);
  });

  test("ошибка GetRooms бросает EWSItemError с кодом", () => {
    let call = () => ewsResponse(`<GetRoomsResponse ResponseClass="Error" xmlns="http://schemas.microsoft.com/exchange/services/2006/messages">
      <MessageText>No results</MessageText>
      <ResponseCode>ErrorNameResolutionNoResults</ResponseCode>
    </GetRoomsResponse>`);
    expect(call).toThrow(EWSItemError);
    try {
      call();
    } catch (ex) {
      expect(ex.type).toBe("ErrorNameResolutionNoResults");
    }
  });
});

describe("OWA: запросы и ответы", () => {
  test("GetRoomLists и GetRooms в JSON", () => {
    let lists = owaGetRoomListsRequest();
    expect(lists.action).toBe("GetRoomLists");
    expect(lists.__type).toBe("GetRoomListsJsonRequest:#Exchange");
    expect(lists.Body.__type).toBe("GetRoomListsRequest:#Exchange");
    let rooms = owaGetRoomsRequest("a@example.com");
    expect(rooms.action).toBe("GetRooms");
    expect(rooms.__type).toBe("GetRoomsJsonRequest:#Exchange");
    expect(JSON.parse(JSON.stringify(rooms)).Body).toEqual({
      __type: "GetRoomsRequest:#Exchange",
      RoomList: { __type: "EmailAddress:#Exchange", EmailAddress: "a@example.com" },
    });
  });

  test("RoomLists массивом и объектом с Address", () => {
    let list = { __type: "EmailAddress:#Exchange", Name: "Офис", EmailAddress: "office@example.com", RoutingType: "SMTP", MailboxType: "PublicDL" };
    expect(parseOWARoomLists({ RoomLists: [list] })).toEqual([{ name: "Офис", emailAddress: "office@example.com" }]);
    expect(parseOWARoomLists({ RoomLists: { Address: [list] } })).toEqual([{ name: "Офис", emailAddress: "office@example.com" }]);
    expect(parseOWARoomLists({ RoomLists: null })).toEqual([]);
    expect(parseOWARoomLists({})).toEqual([]);
  });

  test("Rooms: с Id и без", () => {
    expect(parseOWARooms({
      Rooms: [
        { __type: "Room:#Exchange", Id: { Name: "Переговорная 2", EmailAddress: "room2@example.com" } },
        { Name: "Переговорная 1", EmailAddress: "room1@example.com" },
      ],
    })).toEqual([kRoom, kRoom2]);
    expect(parseOWARooms({ Rooms: { Room: { Id: { Name: "Переговорная 1", EmailAddress: "room1@example.com" } } } })).toEqual([kRoom]);
    expect(parseOWARooms({ Rooms: null })).toEqual([]);
  });
});

describe("Занятость комнат", () => {
  const from = new Date("2026-11-02T10:00:00Z");
  const to = new Date("2026-11-02T11:00:00Z");

  test("isFree: пересечение, касание границ, «свободно» в расписании, нет данных", () => {
    expect(isFree(undefined, from, to)).toBe(undefined);
    expect(isFree([], from, to)).toBe(true);
    expect(isFree([{ from: new Date("2026-11-02T09:00:00Z"), to: from, free: false }], from, to)).toBe(true);
    expect(isFree([{ from: to, to: new Date("2026-11-02T12:00:00Z"), free: false }], from, to)).toBe(true);
    expect(isFree([{ from: new Date("2026-11-02T10:30:00Z"), to: new Date("2026-11-02T12:00:00Z"), free: false }], from, to)).toBe(false);
    expect(isFree([{ from: new Date("2026-11-02T10:30:00Z"), to: new Date("2026-11-02T12:00:00Z"), free: true }], from, to)).toBe(true);
  });

  test("getRoomsAvailability через arePersonsFree, частями", async () => {
    let rooms: MeetingRoom[] = [];
    for (let i = 0; i < kRoomsPerAvailabilityRequest + 2; i++) {
      rooms.push({ name: "Room " + i, emailAddress: `Room${i}@example.com` });
    }
    let calendar = new Calendar();
    let calls: number[] = [];
    calendar.arePersonsFree = vi.fn(async (participants: Participant[], f: Date, t: Date) => {
      calls.push(participants.length);
      expect(f).toBe(from);
      expect(t).toBe(to);
      return participants.map(participant => ({
        participant,
        availability: participant.emailAddress.toLowerCase() == "room0@example.com" ? [{ from, to, free: false }] :
          participant.emailAddress.toLowerCase() == "room1@example.com" ? undefined :
          [],
      }));
    });
    let result = await getRoomsAvailability(calendar, rooms, from, to);
    expect(calls).toEqual([kRoomsPerAvailabilityRequest, 2]);
    expect(result.get("room0@example.com")).toBe(false);
    expect(result.get("room1@example.com")).toBe(undefined);
    expect(result.has("room1@example.com")).toBe(true);
    expect(result.get(`room${kRoomsPerAvailabilityRequest + 1}@example.com`)).toBe(true);
  });
});

describe("Комната во встрече", () => {
  test("добавить: ресурс и «Место», без повторов", () => {
    let event = new Event();
    event.location = "";
    addRoomToEvent(event, kRoom);
    addRoomToEvent(event, kRoom);
    expect(event.location).toBe("Переговорная 1");
    expect(getRoomsOfEvent(event).map(p => p.emailAddress)).toEqual(["room1@example.com"]);
    expect(event.participants.length).toBe(1);
    addRoomToEvent(event, kRoom2);
    expect(event.location).toBe("Переговорная 1; Переговорная 2");
    expect(eventHasRoom(event, { name: "x", emailAddress: "ROOM2@example.com" })).toBe(true);
  });

  test("добавить к уже заданному месту; приглашённого человека переводит в ресурсы", () => {
    let event = new Event();
    event.location = "Москва, офис";
    event.participants.add(new Participant("room1@example.com", "Переговорная 1", InvitationResponse.Unknown, true));
    addRoomToEvent(event, kRoom);
    expect(event.location).toBe("Москва, офис; Переговорная 1");
    expect(event.participants.length).toBe(1);
    expect(event.participants.get(0).isResource).toBe(true);
    expect(event.participants.get(0).isOptional).toBe(false);
  });

  test("убрать: из ресурсов и из «Места», остальное место не трогает", () => {
    let event = new Event();
    event.location = "Москва, офис";
    addRoomToEvent(event, kRoom);
    addRoomToEvent(event, kRoom2);
    removeRoomFromEvent(event, kRoom);
    expect(event.location).toBe("Москва, офис; Переговорная 2");
    expect(getRoomsOfEvent(event).map(p => p.emailAddress)).toEqual(["room2@example.com"]);
    removeRoomFromEvent(event, kRoom2);
    expect(event.location).toBe("Москва, офис");
    expect(event.participants.length).toBe(0);
  });
});

function fakeCalendar(): Calendar {
  let calendar = new Calendar();
  calendar.name = "Test";
  (calendar as any).folderID = "calendar-folder";
  return calendar;
}

function meeting<T extends Event>(event: T): T {
  event.calUID = "uid-1";
  event.title = "Планёрка";
  event.startTime = new Date("2026-11-02T10:00:00Z");
  event.endTime = new Date("2026-11-02T11:00:00Z");
  event.timezone = "UTC";
  event.myParticipation = InvitationResponse.Organizer;
  event.participants.add(new Participant("me@example.com", "Я", InvitationResponse.Organizer));
  event.participants.add(new Participant("ivan@example.com", "Иван", InvitationResponse.Unknown));
  return event;
}

describe("EWS: комната в CalendarItem", () => {
  function ewsEvent() {
    let calendar = fakeCalendar();
    let requests: any[] = [];
    (calendar as any).account = {
      callEWS: vi.fn(async (request: any) => {
        requests.push(request);
        return { Items: { CalendarItem: { ItemId: { Id: "item-1" } } } };
      }),
    };
    return { event: meeting(new EWSEvent(calendar as any)), requests };
  }

  test("новая встреча: комната только в Resources, порядок полей по схеме", async () => {
    let { event, requests } = ewsEvent();
    addRoomToEvent(event, kRoom);
    await event.saveCalendarItemToServer();
    let item = requests[0].m$CreateItem.m$Items.t$CalendarItem;
    expect(item.t$RequiredAttendees.t$Attendee.map(a => a.t$Mailbox.t$EmailAddress)).toEqual(["me@example.com", "ivan@example.com"]);
    expect(item.t$Resources.t$Attendee).toEqual([{ t$Mailbox: { t$EmailAddress: "room1@example.com", t$Name: "Переговорная 1" } }]);
    expect(item.t$Location).toBe("Переговорная 1");
    let keys = Object.keys(item);
    expect(keys.indexOf("t$Resources")).toBe(keys.indexOf("t$OptionalAttendees") + 1);
    let doc = requestXML(requests[0]);
    let resources = doc.getElementsByTagName("t:Resources")[0];
    expect(resources.getElementsByTagName("t:EmailAddress")[0].textContent).toBe("room1@example.com");
  });

  test("встреча без комнат: поле Resources не пишется, как раньше", async () => {
    let { event, requests } = ewsEvent();
    await event.saveCalendarItemToServer();
    expect(requests[0].m$CreateItem.m$Items.t$CalendarItem.t$Resources).toBeUndefined();
    event.startEditing();
    await event.saveCalendarItemToServer();
    expect(JSON.stringify(requests[1])).not.toContain("calendar:Resources");
  });

  test("без участников (сначала вложения) комната тоже не уходит", async () => {
    let { event, requests } = ewsEvent();
    addRoomToEvent(event, kRoom);
    await event.saveCalendarItemToServer(true);
    expect(requests[0].m$CreateItem.m$Items.t$CalendarItem.t$Resources).toBeUndefined();
  });

  test("комнату убрали при правке — DeleteItemField calendar:Resources", async () => {
    let { event, requests } = ewsEvent();
    addRoomToEvent(event, kRoom);
    await event.saveCalendarItemToServer();
    event.startEditing();
    removeRoomFromEvent(event, kRoom);
    await event.saveCalendarItemToServer();
    let updates = requests[1].m$UpdateItem.m$ItemChanges.t$ItemChange.t$Updates;
    expect(updates.t$DeleteItemField.map(f => f.t$FieldURI?.FieldURI)).toContain("calendar:Resources");
    event.finishEditing();
  });

  test("чтение: Resources с сервера — ресурсы встречи", () => {
    let calendar = fakeCalendar();
    let event = new EWSEvent(calendar as any);
    event.fromXML({
      ItemId: { Id: "item-1" },
      UID: "uid-1",
      Subject: "Планёрка",
      Start: "2026-11-02T10:00:00Z",
      End: "2026-11-02T11:00:00Z",
      Location: "Переговорная 1",
      Organizer: { Mailbox: { Name: "Я", EmailAddress: "me@example.com" } },
      Resources: { Attendee: { Mailbox: { Name: "Переговорная 1", EmailAddress: "room1@example.com" }, ResponseType: "Accept" } },
    });
    expect(event.participants.contents.map(p => [p.emailAddress, p.isResource])).toEqual([
      ["me@example.com", false],
      ["room1@example.com", true],
    ]);
    expect(event.participants.get(1).response).toBe(InvitationResponse.Accept);
  });
});

describe("OWA: комната в CalendarItem", () => {
  function owaEvent() {
    let calendar = fakeCalendar();
    let requests: any[] = [];
    (calendar as any).account = { provider: () => null };
    (calendar as any).callOWA = vi.fn(async (request: any) => {
      requests.push(request);
      return { Items: [{ ItemId: { Id: "item-1" } }] };
    });
    return { event: meeting(new OWAEvent(calendar as any)), requests };
  }

  test("новая встреча: Resources отдельно от RequiredAttendees", async () => {
    let { event, requests } = owaEvent();
    addRoomToEvent(event, kRoom);
    await event.saveCalendarItem();
    let item = requests[0].Body.Items[0];
    expect(item.RequiredAttendees.map(a => a.Mailbox.EmailAddress)).toEqual(["me@example.com", "ivan@example.com"]);
    expect(item.Resources).toEqual([{
      __type: "AttendeeType:#Exchange",
      Mailbox: { EmailAddress: "room1@example.com", Name: "Переговорная 1" },
    }]);
  });

  test("без комнат поле не трогаем; убрали комнату — DeleteItemField", async () => {
    let { event, requests } = owaEvent();
    await event.saveCalendarItem();
    expect("Resources" in requests[0].Body.Items[0]).toBe(false);
    event.startEditing();
    addRoomToEvent(event, kRoom);
    event.finishEditing();
    event.startEditing();
    removeRoomFromEvent(event, kRoom);
    await event.saveCalendarItem();
    let updates = requests[1].Body.ItemChanges[0].Updates;
    let resources = updates.find(update => update.Path.FieldURI == "calendar:Resources");
    expect(resources.__type).toBe("DeleteItemField:#Exchange");
  });

  test("чтение: Resources", () => {
    let event = new OWAEvent(fakeCalendar() as any);
    event.fromJSON({
      ItemId: { Id: "item-1" },
      UID: "uid-1",
      Subject: "Планёрка",
      Start: "2026-11-02T10:00:00Z",
      End: "2026-11-02T11:00:00Z",
      Organizer: { Mailbox: { Name: "Я", EmailAddress: "me@example.com" } },
      Resources: [{ Mailbox: { Name: "Переговорная 1", EmailAddress: "room1@example.com" }, ResponseType: "Unknown" }],
    });
    expect(getRoomsOfEvent(event).map(p => p.emailAddress)).toEqual(["room1@example.com"]);
  });
});
