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

import {
  executeConfigurableMailAction,
  onKeyOnList,
} from "../../../frontend/Mail/Message/MessageKeyboard";
import { selectedMessage, selectedMessages } from "../../../frontend/Mail/Selected";
import { deleteMessagesFromUI, deleteMessagesPermanent } from "../../../frontend/Mail/mailDeleteUndo";
import { focusMailPane } from "../../../frontend/MainWindow/paneFocus";
import { openComposer } from "../../../frontend/Mail/open";
import { hoverRow } from "./hoverRow";

describe("mail keyboard shortcuts", () => {
  let previousMessage: EMail | undefined;
  let previousMessages: ArrayColl<EMail>;
  let hover: ReturnType<typeof hoverRow> | null = null;

  function mail(name: string) {
    return {
      name,
      isRead: false,
      isStarred: false,
      markRead: vi.fn(async () => undefined),
      markStarred: vi.fn(async () => undefined),
      nextMessage: vi.fn(() => null),
      loadForDisplay: vi.fn(async () => undefined),
      compose: { replyToAuthor: vi.fn(() => ({ name })) },
    } as unknown as EMail & Record<string, any>;
  }

  function select(...messages: EMail[]) {
    selectedMessage.set(messages[0]);
    selectedMessages.set(new ArrayColl(messages));
  }

  beforeEach(() => {
    previousMessage = get(selectedMessage);
    previousMessages = get(selectedMessages);
    focusMailPane();
    vi.clearAllMocks();
  });

  afterEach(() => {
    hover?.leave();
    hover = null;
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

  test("клавиша действует на письмо под курсором, выделение не меняется", async () => {
    let selected = mail("selected");
    let hovered = mail("hovered");
    select(selected);
    hover = hoverRow(hovered);
    let event = new KeyboardEvent("keydown", { key: "m", cancelable: true });

    await onKeyOnList(event);

    expect(hovered.markRead).toHaveBeenCalledWith(true);
    expect(selected.markRead).not.toHaveBeenCalled();
    expect(get(selectedMessage)).toBe(selected);
    expect(get(selectedMessages).contents).toEqual([selected]);
  });

  test("Delete над невыделенным письмом удаляет только его и не двигает выделение", async () => {
    let selected = mail("selected");
    let hovered = mail("hovered");
    select(selected);
    hover = hoverRow(hovered);

    await onKeyOnList(new KeyboardEvent("keydown", { key: "Delete", cancelable: true }));

    expect(deleteMessagesFromUI).toHaveBeenCalledWith([hovered]);
    expect(get(selectedMessage)).toBe(selected);
    expect(get(selectedMessages).contents).toEqual([selected]);
  });

  test("курсор над одним из нескольких выделенных — действие для всего выделения", async () => {
    let first = mail("first");
    let second = mail("second");
    select(first, second);
    hover = hoverRow(second);

    await onKeyOnList(new KeyboardEvent("keydown", { key: "s", cancelable: true }));

    expect(first.markStarred).toHaveBeenCalledWith(true);
    expect(second.markStarred).toHaveBeenCalledWith(true);
  });

  test("без курсора над списком действует на выделенные письма", async () => {
    let first = mail("first");
    let second = mail("second");
    select(first, second);

    await onKeyOnList(new KeyboardEvent("keydown", { key: "s", cancelable: true }));

    expect(first.markStarred).toHaveBeenCalledWith(true);
    expect(second.markStarred).toHaveBeenCalledWith(true);
  });

  test("ввод в поле поиска не запускает действие даже с курсором над письмом", async () => {
    let selected = mail("selected");
    let hovered = mail("hovered");
    select(selected);
    hover = hoverRow(hovered);
    let input = document.createElement("input");
    document.body.append(input);
    let dispatched: KeyboardEvent | null = null;
    input.addEventListener("keydown", event => {
      dispatched = event;
    });
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "m", bubbles: true, cancelable: true }));

    await onKeyOnList(dispatched!);

    expect(hovered.markRead).not.toHaveBeenCalled();
    expect(selected.markRead).not.toHaveBeenCalled();
  });

  test("назначаемое действие применяется к письму под курсором", async () => {
    let selected = mail("selected");
    let hovered = mail("hovered");
    select(selected);
    hover = hoverRow(hovered);

    await expect(executeConfigurableMailAction("mail.toggleStar")).resolves.toBe(true);
    await expect(executeConfigurableMailAction("mail.reply")).resolves.toBe(true);

    expect(hovered.markStarred).toHaveBeenCalledWith(true);
    expect(selected.markStarred).not.toHaveBeenCalled();
    expect(openComposer).toHaveBeenCalledWith({ name: "hovered" });
    expect(get(selectedMessage)).toBe(selected);
  });

  test("назначаемое удаление над невыделенным письмом не двигает выделение", async () => {
    let selected = mail("selected");
    let hovered = mail("hovered");
    select(selected);
    hover = hoverRow(hovered);

    await executeConfigurableMailAction("mail.delete");

    expect(deleteMessagesFromUI).toHaveBeenCalledWith([hovered]);
    expect(get(selectedMessage)).toBe(selected);
  });

  test("после «следующего письма» с клавиатуры действие снова для выделенного", async () => {
    let selected = mail("selected");
    let next = mail("next");
    let hovered = mail("hovered");
    selected.nextMessage = vi.fn(() => next);
    select(selected);
    hover = hoverRow(hovered);

    await executeConfigurableMailAction("mail.nextMessage");
    expect(get(selectedMessage)).toBe(next);
    await executeConfigurableMailAction("mail.toggleStar");

    expect(hovered.markStarred).not.toHaveBeenCalled();
    expect(next.markStarred).toHaveBeenCalledWith(true);
  });
});
