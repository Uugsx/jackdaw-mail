// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { mount, tick, unmount } from "svelte";
import { availableTags, Tag } from "../../../logic/Abstract/Tag";
import { SetColl } from "svelte-collections";

let SearchCriteria: any;
let SearchEMail: any;
let mounted: ReturnType<typeof mount>[] = [];

beforeAll(async () => {
  await import("../../../logic/app");
  SearchCriteria = (await import("../../../frontend/Mail/Search/SearchCriteria.svelte")).default;
  SearchEMail = (await import("../../../logic/Mail/Store/SearchEMail")).SearchEMail;
});

afterEach(() => {
  for (let instance of mounted) {
    unmount(instance);
  }
  mounted = [];
  availableTags.clear();
  document.body.replaceChildren();
});

describe("SearchCriteria", () => {
  test("сообщает об изменении после возврата tri-state фильтра в пустое состояние", async () => {
    let search = new SearchEMail();
    let changes = 0;
    let target = document.createElement("div");
    document.body.append(target);

    let instance = mount(SearchCriteria, {
      target,
      props: {
        search,
        showSearchTerm: false,
        showAccount: false,
      },
      events: { change: () => changes++ },
    });
    mounted.push(instance);
    await tick();

    let sentByMe = target.querySelector(".checkbox") as HTMLElement;
    sentByMe.click();
    await tick();
    expect(search.isOutgoing).toBe(true);

    sentByMe.click();
    await tick();
    expect(search.isOutgoing).toBe(false);

    sentByMe.click();
    await tick();
    expect(search.isOutgoing).toBeUndefined();
    expect(changes).toBe(3);
  });

  test("сбрасывает фильтр прочитанности после возврата tri-state фильтра в пустое состояние", async () => {
    let search = new SearchEMail();
    let target = document.createElement("div");
    document.body.append(target);
    let instance = mount(SearchCriteria, {
      target,
      props: { search, showSearchTerm: false, showAccount: false },
    });
    mounted.push(instance);
    await tick();

    let unread = target.querySelectorAll(".checkbox")[1] as HTMLElement;
    unread.click();
    await tick();
    expect(search.isRead).toBe(false);

    unread.click();
    await tick();
    expect(search.isRead).toBe(true);

    unread.click();
    await tick();
    expect(search.isRead).toBeNull();
  });

  test("позволяет выбрать несколько тегов и применяет режим любого тега", async () => {
    let firstTag = new Tag();
    firstTag.name = "Первый тег";
    firstTag.color = "#B45309";
    let secondTag = new Tag();
    secondTag.name = "Второй тег";
    secondTag.color = "#2563EB";
    availableTags.add(firstTag);
    availableTags.add(secondTag);

    let search = new SearchEMail();
    let changes = 0;
    let target = document.createElement("div");
    document.body.append(target);
    let instance = mount(SearchCriteria, {
      target,
      props: {
        search,
        showSearchTerm: false,
        showAccount: false,
        compact: true,
      },
      events: { change: () => changes++ },
    });
    mounted.push(instance);
    await tick();

    let tagsCheckbox = target.querySelectorAll(".checkbox")[5] as HTMLElement;
    tagsCheckbox.click();
    await tick();
    let tagBubbles = [...target.querySelectorAll(".tag")] as HTMLElement[];
    expect(tagBubbles).toHaveLength(2);

    tagBubbles[0].click();
    await tick();
    tagBubbles[1].click();
    await tick();

    expect(search.tags.contains(firstTag)).toBe(true);
    expect(search.tags.contains(secondTag)).toBe(true);
    expect(search.tagsMatchAny).toBe(true);
    expect(changes).toBe(3);
  });

  test("снимает минус фильтра вложений и возвращает состояние без ограничения", async () => {
    let search = new SearchEMail();
    let target = document.createElement("div");
    document.body.append(target);
    let instance = mount(SearchCriteria, {
      target,
      props: { search, showSearchTerm: false, showAccount: false },
    });
    mounted.push(instance);
    await tick();

    let attachment = target.querySelectorAll(".checkbox")[3] as HTMLElement;
    attachment.click();
    await tick();
    expect(search.hasAttachment).toBe(true);

    attachment.click();
    await tick();
    expect(search.hasAttachment).toBe(false);

    attachment.click();
    await tick();
    expect(search.hasAttachment).toBeNull();
  });

  test("сохраняет старую семантику всех тегов и поддерживает режим любого тега отдельно", () => {
    let firstTag = new Tag();
    firstTag.name = "Первый тег";
    firstTag.color = "#B45309";
    let secondTag = new Tag();
    secondTag.name = "Второй тег";
    secondTag.color = "#2563EB";
    let search = new SearchEMail();
    search.tags.add(firstTag);
    search.tags.add(secondTag);

    let firstOnly = { tags: new SetColl([firstTag]) } as any;
    let both = { tags: new SetColl([firstTag, secondTag]) } as any;
    expect(search.matches(firstOnly)).toBe(false);
    expect(search.matches(both)).toBe(true);

    search.tagsMatchAny = true;
    expect(search.matches(firstOnly)).toBe(true);
  });
});
