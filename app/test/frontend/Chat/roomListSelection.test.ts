// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { mount, tick, unmount } from "svelte";
import { ArrayColl } from "svelte-collections";

let Person: any;
let selectedPerson: any;
let RoomListHarness: any;
let appGlobal: any;
let Addressbook: any;
let ContactEntry: any;

beforeAll(async () => {
  appGlobal = (await import("../../../logic/app")).appGlobal;
  Addressbook = (await import("../../../logic/Contacts/Addressbook")).Addressbook;
  ContactEntry = (await import("../../../logic/Abstract/Person")).ContactEntry;
  Person = (await import("../../../logic/Abstract/Person")).Person;
  selectedPerson = (await import("../../../frontend/Contacts/Person/Selected")).selectedPerson;
  RoomListHarness = (await import("./RoomListHarness.svelte")).default;
});

let mounted: ReturnType<typeof mount>[] = [];

afterEach(() => {
  for (let instance of mounted) {
    unmount(instance);
  }
  mounted = [];
  selectedPerson.set(null);
  document.body.replaceChildren();
});

describe("список комнат чата", () => {
  test("не подставляет выбранного человека вместо комнаты", async () => {
    let person = new Person();
    person.name = "Собеседник";
    selectedPerson.set(person);
    let seen: unknown[] = [];
    let target = document.createElement("div");
    document.body.append(target);
    mounted.push(mount(RoomListHarness, {
      target,
      props: { rooms: new ArrayColl(), onSelected: (room: unknown) => seen.push(room) },
    }));
    await tick();
    await tick();
    expect(seen.at(-1) ?? null).toBeNull();
    expect(seen).not.toContain(person);
  });

  test("поиск находит контакт без чата и выбирает его как контакт, а не как комнату", async () => {
    let addressbook = new Addressbook();
    let person = addressbook.newPerson();
    person.name = "Никита Галкин";
    person.emailAddresses.add(new ContactEntry("nikita@example.com", "work"));
    addressbook.persons.add(person);
    appGlobal.addressbooks.add(addressbook);
    try {
      let rooms: unknown[] = [];
      let contacts: unknown[] = [];
      let target = document.createElement("div");
      document.body.append(target);
      mounted.push(mount(RoomListHarness, {
        target,
        props: {
          rooms: new ArrayColl(),
          onSelected: (room: unknown) => rooms.push(room),
          onContact: (contact: unknown) => contacts.push(contact),
        },
      }));
      await tick();
      let input = target.querySelector("input[type=search]") as HTMLInputElement;
      input.value = "галк";
      input.dispatchEvent(new Event("input"));
      for (let i = 0; i < 5; i++) await tick();
      expect(contacts.at(-1)).toBe(person);
      expect(rooms.at(-1) ?? null).toBeNull();
    } finally {
      appGlobal.addressbooks.remove(addressbook);
    }
  });
});
