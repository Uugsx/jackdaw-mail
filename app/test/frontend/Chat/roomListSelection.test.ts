// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { mount, tick, unmount } from "svelte";
import { ArrayColl } from "svelte-collections";

let Person: any;
let selectedPerson: any;
let RoomListHarness: any;

beforeAll(async () => {
  await import("../../../logic/app");
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
});
