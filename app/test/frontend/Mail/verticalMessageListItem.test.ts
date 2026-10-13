// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { mount, tick, unmount } from "svelte";
import type { EMail as EMailType } from "../../../logic/Mail/EMail";

const openEMailMessageFullscreenMock = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../../../frontend/Mail/open", () => ({ openEMailMessageFullscreen: openEMailMessageFullscreenMock }));
const nativeMessageWindowMocks = vi.hoisted(() => ({
  supportsNativeMessageWindow: vi.fn(() => false),
  openNativeMessageWindow: vi.fn(async () => {}),
}));
vi.mock("../../../frontend/Mail/Message/messageNative", () => nativeMessageWindowMocks);

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
  openEMailMessageFullscreenMock.mockClear();
  nativeMessageWindowMocks.supportsNativeMessageWindow.mockReturnValue(false);
  nativeMessageWindowMocks.openNativeMessageWindow.mockClear();
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

describe("открытие письма", () => {
  test("в веб-режиме открывает письмо двойным кликом во встроенном просмотре", async () => {
    let message = createMessage();
    let target = document.createElement("div");
    document.body.append(target);

    mounted.push(mount(VerticalMessageListItem, { target, props: { message } }));
    await tick();

    let messageElement = target.querySelector(".message");
    expect(messageElement).not.toBeNull();
    messageElement?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await tick();

    expect(openEMailMessageFullscreenMock).toHaveBeenCalledTimes(1);
    expect(openEMailMessageFullscreenMock).toHaveBeenCalledWith(message);
  });

  test("в десктопном режиме открывает письмо двойным кликом в нативном окне", async () => {
    nativeMessageWindowMocks.supportsNativeMessageWindow.mockReturnValue(true);
    let message = createMessage();
    let target = document.createElement("div");
    document.body.append(target);

    mounted.push(mount(VerticalMessageListItem, { target, props: { message } }));
    await tick();

    target.querySelector(".message")?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await tick();

    expect(nativeMessageWindowMocks.openNativeMessageWindow).toHaveBeenCalledTimes(1);
    expect(nativeMessageWindowMocks.openNativeMessageWindow).toHaveBeenCalledWith(message);
    expect(openEMailMessageFullscreenMock).not.toHaveBeenCalled();
  });

  test("при ошибке нативного окна не переключается в другой режим просмотра", async () => {
    nativeMessageWindowMocks.supportsNativeMessageWindow.mockReturnValue(true);
    nativeMessageWindowMocks.openNativeMessageWindow.mockRejectedValueOnce(new Error("window failed"));
    let message = createMessage();
    let target = document.createElement("div");
    document.body.append(target);

    mounted.push(mount(VerticalMessageListItem, { target, props: { message } }));
    await tick();

    target.querySelector(".message")?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await tick();
    await tick();

    expect(nativeMessageWindowMocks.openNativeMessageWindow).toHaveBeenCalledTimes(1);
    expect(nativeMessageWindowMocks.openNativeMessageWindow).toHaveBeenCalledWith(message);
    expect(openEMailMessageFullscreenMock).not.toHaveBeenCalled();
  });
});
