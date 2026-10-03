// @vitest-environment happy-dom

import { ArrayColl } from "svelte-collections";
import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { EMail } from "../../../logic/Mail/EMail";

vi.mock("../../../logic/Mail/MailAccount", () => ({
  DeleteStrategy: { DeleteImmediately: "DeleteImmediately" },
}));
vi.mock("../../../frontend/Mail/mailDeleteUndo", () => ({
  deleteMessagesFromUI: vi.fn(async () => undefined),
  deleteMessagesPermanent: vi.fn(async () => undefined),
}));
vi.mock("../../../frontend/Mail/open", () => ({
  openComposer: vi.fn(),
}));
vi.mock("../../../logic/Mail/Store/QuickSearchEMail", () => ({
  QuickSearchEMail: class {},
}));
vi.mock("../../../frontend/Mail/LeftPane/SearchSwitcher.svelte", () => ({
  SearchView: { Folder: 0, Person: 1, Search: 2 },
}));

import { onKeyOnList } from "../../../frontend/Mail/Message/MessageKeyboard";
import { selectedMessage, selectedMessages } from "../../../frontend/Mail/Selected";
import { deleteMessagesFromUI, deleteMessagesPermanent } from "../../../frontend/Mail/mailDeleteUndo";
import { focusMailPane } from "../../../frontend/MainWindow/paneFocus";

describe("mail keyboard shortcuts", () => {
  let previousMessage: EMail | undefined;
  let previousMessages: ArrayColl<EMail>;

  beforeEach(() => {
    previousMessage = get(selectedMessage);
    previousMessages = get(selectedMessages);
    focusMailPane();
    vi.clearAllMocks();
  });

  afterEach(() => {
    selectedMessage.set(previousMessage!);
    selectedMessages.set(previousMessages);
    document.body.replaceChildren();
  });

  test("оставляет Cmd+Q системному завершению работы macOS", async () => {
    let markRead = vi.fn(async () => undefined);
    let message = { isRead: false, markRead } as unknown as EMail;
    selectedMessage.set(message);
    selectedMessages.set(new ArrayColl([message]));
    let event = new KeyboardEvent("keydown", {
      key: "q",
      metaKey: true,
      cancelable: true,
    });

    await onKeyOnList(event);

    expect(markRead).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  test("сохраняет Ctrl+Q как сочетание для отметки письма прочитанным", async () => {
    let markRead = vi.fn(async () => undefined);
    let message = { isRead: false, markRead } as unknown as EMail;
    selectedMessage.set(message);
    selectedMessages.set(new ArrayColl([message]));
    let event = new KeyboardEvent("keydown", {
      key: "q",
      ctrlKey: true,
      cancelable: true,
    });

    await onKeyOnList(event);

    expect(markRead).toHaveBeenCalledWith(true);
    expect(event.defaultPrevented).toBe(true);
  });

  test("не удаляет письма при Backspace в поле поиска", async () => {
    let message = { nextMessage: vi.fn(() => null) } as unknown as EMail;
    selectedMessage.set(message);
    selectedMessages.set(new ArrayColl([message]));

    let input = document.createElement("input");
    document.body.append(input);
    let dispatchedEvent: KeyboardEvent | null = null;
    input.addEventListener("keydown", event => {
      dispatchedEvent = event;
      void onKeyOnList(event);
    });
    input.focus();
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));
    await Promise.resolve();

    expect(deleteMessagesFromUI).not.toHaveBeenCalled();
    expect(dispatchedEvent?.defaultPrevented).toBe(false);
  });

  test("удаляет выбранные письма пакетным путём по Shift+Delete", async () => {
    let message = { nextMessage: vi.fn(() => null) } as unknown as EMail;
    selectedMessage.set(message);
    selectedMessages.set(new ArrayColl([message]));
    let event = new KeyboardEvent("keydown", {
      key: "Delete",
      shiftKey: true,
      cancelable: true,
    });

    await onKeyOnList(event);

    expect(deleteMessagesPermanent).toHaveBeenCalledWith([message]);
    expect(event.defaultPrevented).toBe(true);
  });
});
