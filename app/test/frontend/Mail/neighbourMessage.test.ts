// @vitest-environment happy-dom

import { ArrayColl } from "svelte-collections";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { EMail } from "../../../logic/Mail/EMail";
import type { MailListRow } from "../../../frontend/Mail/mailListRows";

vi.mock("../../../logic/Mail/Store/QuickSearchEMail", () => ({
  QuickSearchEMail: class {},
}));
vi.mock("../../../frontend/Mail/LeftPane/SearchSwitcher.svelte", () => ({
  SearchView: { Folder: 0, Person: 1, Search: 2 },
}));

import { listRowsInView, neighbourMessage } from "../../../frontend/Mail/Selected";

/** Письма в порядке загрузки из БД: `nextMessage()` идёт по нему */
function fakeMessage(name: string): EMail {
  return { name, nextMessage: vi.fn(() => ({ name: "folder-order" })) } as unknown as EMail;
}

function showRows(messages: EMail[]) {
  let rows: MailListRow[] = [
    { kind: "day", id: "day:today" } as unknown as MailListRow,
    ...messages.map(message => ({ kind: "message", message }) as unknown as MailListRow),
  ];
  listRowsInView.set(new ArrayColl(rows));
}

describe("соседнее письмо по видимому списку", () => {
  let a = fakeMessage("a");
  let b = fakeMessage("b");
  let c = fakeMessage("c");

  beforeEach(() => {
    // На экране порядок c, a, b (например, сортировка по отправителю)
    showRows([c, a, b]);
  });
  afterEach(() => {
    listRowsInView.set(null);
  });

  test("стрелки идут по строкам на экране, а не по порядку в папке", () => {
    expect(neighbourMessage(c, false)).toBe(a);
    expect(neighbourMessage(a, false)).toBe(b);
    expect(neighbourMessage(a, true)).toBe(c);
  });

  test("у края списка стрелка оставляет то же письмо", () => {
    expect(neighbourMessage(c, true)).toBe(c);
    expect(neighbourMessage(b, false)).toBe(b);
  });

  test("после удаления — письмо ниже, а у последнего — выше", () => {
    expect(neighbourMessage(a)).toBe(b);
    expect(neighbourMessage(b)).toBe(a);
  });

  test("единственное письмо: после удаления выбирать нечего", () => {
    showRows([a]);
    expect(neighbourMessage(a)).toBeNull();
  });

  test("письма нет в списке: прежний порядок папки", () => {
    let hidden = fakeMessage("hidden");
    expect(neighbourMessage(hidden, false)).toEqual({ name: "folder-order" });
    expect(hidden.nextMessage).toHaveBeenCalledWith(false);
  });

  test("списка нет (мобильный вид): прежний порядок папки", () => {
    listRowsInView.set(null);
    expect(neighbourMessage(a, true)).toEqual({ name: "folder-order" });
  });
});
