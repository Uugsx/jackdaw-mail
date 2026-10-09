// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { mount, tick, unmount } from "svelte";
import type { EMail as EMailType } from "../../../logic/Mail/EMail";

let VerticalMessageListItem: any;
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
  message.subject = "Помеченное письмо";
  return message;
}

describe("выделение писем со звёздочкой", () => {
  test("добавляет класс starred и обновляет его при снятии отметки", async () => {
    let message = createMessage();
    message.isStarred = true;
    let target = document.createElement("div");
    document.body.append(target);

    mounted.push(mount(VerticalMessageListItem, { target, props: { message } }));
    await tick();

    let messageElement = target.querySelector(".message");
    expect(messageElement?.classList.contains("starred")).toBe(true);

    message.isStarred = false;
    await tick();

    expect(messageElement?.classList.contains("starred")).toBe(false);
  });
});
