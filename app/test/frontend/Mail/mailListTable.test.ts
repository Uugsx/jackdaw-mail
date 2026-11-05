// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { mount, tick, unmount } from "svelte";
import type { EMail as EMailType } from "../../../logic/Mail/EMail";

const openEMailMessageFullscreenMock = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../../../frontend/Mail/open", () => ({ openEMailMessageFullscreen: openEMailMessageFullscreenMock }));
vi.mock("../../../frontend/Mail/Message/messageNative", () => ({
  supportsNativeMessageWindow: vi.fn(() => false),
  openNativeMessageWindow: vi.fn(async () => {}),
}));

let VerticalMessageListItem: any;
let MailListHeader: any;
let EMailClass: any;
let FolderClass: any;
let MailAccountClass: any;
let PersonUIDClass: any;
let mounted: ReturnType<typeof mount>[] = [];
let localStorageValues = new Map<string, string>();

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => localStorageValues.get(key) ?? null,
    setItem: (key: string, value: string) => localStorageValues.set(key, value),
    removeItem: (key: string) => localStorageValues.delete(key),
  },
});

beforeAll(async () => {
  await import("../../../logic/app");
  EMailClass = (await import("../../../logic/Mail/EMail")).EMail;
  FolderClass = (await import("../../../logic/Mail/Folder")).Folder;
  MailAccountClass = (await import("../../../logic/Mail/MailAccount")).MailAccount;
  PersonUIDClass = (await import("../../../logic/Abstract/PersonUID")).PersonUID;
  VerticalMessageListItem = (await import("../../../frontend/Mail/Vertical/VerticalMessageListItem.svelte")).default;
  MailListHeader = (await import("../../../frontend/Mail/Vertical/MailListHeader.svelte")).default;
}, 120_000);

afterEach(() => {
  for (let instance of mounted) {
    unmount(instance);
  }
  mounted = [];
  document.body.replaceChildren();
  localStorageValues.clear();
});

function createMessage(): EMailType {
  let message = new EMailClass(new FolderClass(new MailAccountClass()));
  message.contact = new PersonUIDClass("sender@example.test", "Отправитель");
  message.received = new Date(2026, 9, 9, 12, 0);
  message.subject = "Табличное письмо";
  message.size = 182 * 1024;
  return message;
}

function mountInto(component: any, props: Record<string, unknown>): HTMLElement {
  let target = document.createElement("div");
  document.body.append(target);
  mounted.push(mount(component, { target, props }));
  return target;
}

describe("строка табличного вида", () => {
  test("ячейки идут в порядке столбцов, длинный текст — с подсказкой", async () => {
    let message = createMessage();
    let target = mountInto(VerticalMessageListItem, {
      message,
      columns: ["subject", "from", "size", "flag"],
    });
    await tick();

    let row = target.querySelector(".message");
    expect(row?.classList.contains("table")).toBe(true);
    let cells = [...row!.children].map(cell => cell.className.match(/(?:^| )(t-[a-z-]+)/)?.[1]);
    expect(cells).toEqual(["t-subject-cell", "t-from", "t-size", "t-flag"]);
    expect(target.querySelector(".t-subject")?.getAttribute("title")).toBe("Табличное письмо");
    expect(target.querySelector(".t-from")?.getAttribute("title")).toBe("Отправитель");
    expect(target.querySelector(".t-size")?.textContent).toMatch(/^182 /);
    // Двухстрочной карточки в таблице нет
    expect(target.querySelector(".top-row")).toBeNull();
  });

  test("без столбцов остаётся двухстрочная карточка", async () => {
    let target = mountInto(VerticalMessageListItem, { message: createMessage() });
    await tick();

    expect(target.querySelector(".message")?.classList.contains("table")).toBe(false);
    expect(target.querySelector(".top-row")).not.toBeNull();
  });

  test("флажок в строке ставит и снимает отметку", async () => {
    let message = createMessage();
    message.markStarred = vi.fn(async (starred: boolean) => {
      message.isStarred = starred;
    });
    let target = mountInto(VerticalMessageListItem, { message, columns: ["flag"] });
    await tick();

    (target.querySelector(".t-flag button") as HTMLButtonElement).click();
    await tick();
    expect(message.markStarred).toHaveBeenCalledWith(true);
  });

  test("непрочитанное отмечено точкой, как в Outlook; после ответа — значком ответа", async () => {
    let message = createMessage();
    message.isRead = false;
    let target = mountInto(VerticalMessageListItem, { message, columns: ["status", "from", "subject"] });
    await tick();

    expect(target.querySelector(".message")?.classList.contains("unread")).toBe(true);
    expect(target.querySelector(".t-status")?.classList.contains("dot")).toBe(true);

    message.isReplied = true;
    await tick();
    expect(target.querySelector(".t-status")?.classList.contains("dot")).toBe(false);
    expect(target.querySelector(".t-status")?.classList.contains("unread")).toBe(true);

    message.isRead = true;
    await tick();
    expect(target.querySelector(".message")?.classList.contains("unread")).toBe(false);
  });
});

describe("заголовки столбцов", () => {
  test("щелчок сортирует по столбцу, стрелка и aria-sort показывают направление", async () => {
    let onSort = vi.fn();
    let target = mountInto(MailListHeader, {
      columns: ["importance", "from", "subject", "received", "size"],
      sort: "date-desc",
      onSort,
    });
    await tick();

    let headers = [...target.querySelectorAll("[role=columnheader]")];
    expect(headers.map(header => header.getAttribute("aria-sort")))
      .toEqual(["none", "none", "none", "descending", "none"]);
    expect(headers[3].querySelector(".sort-arrow")).not.toBeNull();

    (headers[1].querySelector("button") as HTMLButtonElement).click();
    expect(onSort).toHaveBeenCalledWith("from");
    (headers[0].querySelector("button") as HTMLButtonElement).click();
    expect(onSort).toHaveBeenCalledWith("importance");
  });
});
