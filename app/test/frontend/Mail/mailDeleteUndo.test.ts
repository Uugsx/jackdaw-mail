// @vitest-environment happy-dom

import { ArrayColl, type Collection } from "svelte-collections";
import { get } from "svelte/store";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { EMail } from "../../../logic/Mail/EMail";
import type { Folder } from "../../../logic/Mail/Folder";

const mocks = vi.hoisted(() => ({
  openEMailMessage: vi.fn(async () => undefined),
  openMailFolder: vi.fn(),
}));

vi.mock("../../../frontend/Mail/open", () => ({
  openEMailMessage: mocks.openEMailMessage,
  openMailFolder: mocks.openMailFolder,
}));
vi.mock("../../../logic/Mail/Folder", () => ({
  SpecialFolder: { Normal: "normal", Trash: "trash", Spam: "spam" },
}));
vi.mock("../../../logic/Mail/MailAccount", () => ({
  DeleteStrategy: { DeleteImmediately: 1, Flag: 2, MoveToTrash: 3 },
}));

import { deleteMessagesWithUndo, mailUndoToast } from "../../../frontend/Mail/mailDeleteUndo";
import { SpecialFolder } from "../../../logic/Mail/Folder";
import { UserError } from "../../../logic/util/util";

const BULK_COUNT = 600;
/** Имитация задержки сервера на один запрос перемещения. */
const SERVER_LATENCY_MS = 5;
/** Порог с запасом: поштучная отмена ждёт сервер BULK_COUNT раз (~3 с), пакетная — один раз. */
const BULK_UNDO_TIME_LIMIT_MS = 1000;

type FakeFolder = Folder & {
  moveCalls: EMail[][];
  fetchCalls: number;
  pendingOnServer: EMail[];
};

type FakeAccount = {
  trash?: FakeFolder;
  getSpecialFolder(type: SpecialFolder): FakeFolder | undefined;
};

function makeAccount(): FakeAccount {
  return {
    getSpecialFolder(type: SpecialFolder) {
      return type == SpecialFolder.Trash ? this.trash : undefined;
    },
  };
}

function makeFolder(account: FakeAccount, specialFolder = SpecialFolder.Normal): FakeFolder {
  let folder = {
    account,
    specialFolder,
    messages: new ArrayColl<EMail>(),
    moveCalls: [] as EMail[][],
    fetchCalls: 0,
    pendingOnServer: [] as EMail[],
    async moveMessagesHere(messages: Collection<EMail>) {
      let list = messages.contents;
      folder.moveCalls.push(list);
      await new Promise(resolve => setTimeout(resolve, SERVER_LATENCY_MS));
      let sources = new Set(list.map(message => message.folder));
      expect(sources.size).toBe(1);
      for (let message of list) {
        (message.folder as FakeFolder).messages.remove(message);
        message.folder = folder;
        folder.messages.add(message);
      }
    },
    async moveMessageHere(message: EMail) {
      await folder.moveMessagesHere(new ArrayColl([message]));
    },
    async fetchNewMailQuick() {
      folder.fetchCalls++;
      folder.messages.addAll(folder.pendingOnServer);
      folder.pendingOnServer = [];
      return new ArrayColl<EMail>();
    },
  } as unknown as FakeFolder;
  return folder;
}

function makeMessage(folder: FakeFolder, id: string): EMail {
  let message = { pID: id, messageID: `${id}@example.com`, folder, isDeleted: false } as unknown as EMail;
  folder.messages.add(message);
  return message;
}

/** Удаление как в IMAP/EWS: оригинал исчезает, в Корзине появляется копия с тем же Message-ID. */
function copyToTrash(source: FakeFolder, trash: FakeFolder, onServerOnly = false) {
  source.deleteMessages = vi.fn(async (messages: Collection<EMail>) => {
    for (let message of messages.contents) {
      source.messages.remove(message);
      let copy = { pID: `trash-${message.pID}`, messageID: message.messageID, folder: trash, isDeleted: false } as unknown as EMail;
      if (onServerOnly) {
        trash.pendingOnServer.push(copy);
      } else {
        trash.messages.add(copy);
      }
    }
  }) as Folder["deleteMessages"];
}

/** Удаление как в OWA: тот же объект письма переезжает в Корзину. */
function moveObjectToTrash(source: FakeFolder, trash: FakeFolder) {
  source.deleteMessages = vi.fn(async (messages: Collection<EMail>) => {
    for (let message of messages.contents) {
      source.messages.remove(message);
      message.folder = trash;
      trash.messages.add(message);
    }
  }) as Folder["deleteMessages"];
}

function currentUndo(): () => Promise<void> {
  let state = get(mailUndoToast);
  expect(state).toBeTruthy();
  return state!.undo;
}

/** Перенос как в IMAP: на сервере письмо вернулось, а в списке папки появится
 * только новой копией после синхронизации. Объект из Корзины помечен удалённым. */
function moveOnServerOnly(target: FakeFolder) {
  target.moveMessagesHere = vi.fn(async (messages: Collection<EMail>) => {
    for (let message of messages.contents) {
      (message.folder as FakeFolder).messages.remove(message);
      (message as any).isDeleted = true;
      target.pendingOnServer.push({ pID: `back-${message.pID}`, messageID: message.messageID, folder: target, isDeleted: false } as unknown as EMail);
    }
  }) as Folder["moveMessagesHere"];
}

describe("отмена удаления писем", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mailUndoToast.set(null);
  });

  test(`возвращает ${BULK_COUNT} писем одной пачкой и синхронизирует Корзину один раз`, async () => {
    let account = makeAccount();
    let inbox = makeFolder(account);
    let trash = makeFolder(account, SpecialFolder.Trash);
    account.trash = trash;
    copyToTrash(inbox, trash, true);
    let messages = Array.from({ length: BULK_COUNT }, (_, i) => makeMessage(inbox, `m${i}`));

    await deleteMessagesWithUndo(messages);
    let startedAt = performance.now();
    await currentUndo()();
    let elapsed = performance.now() - startedAt;

    expect(trash.fetchCalls).toBe(1);
    expect(inbox.moveCalls).toHaveLength(1);
    expect(inbox.moveCalls[0]).toHaveLength(BULK_COUNT);
    expect(inbox.messages.length).toBe(BULK_COUNT);
    expect(trash.messages.length).toBe(0);
    expect(mocks.openEMailMessage).toHaveBeenCalledTimes(1);
    expect(mocks.openEMailMessage).toHaveBeenCalledWith(inbox.moveCalls[0][BULK_COUNT - 1]);
    expect(get(mailUndoToast)).toBeNull();
    expect(elapsed).toBeLessThan(BULK_UNDO_TIME_LIMIT_MS);
  });

  test("не синхронизирует Корзину, если все копии уже есть локально", async () => {
    let account = makeAccount();
    let inbox = makeFolder(account);
    let trash = makeFolder(account, SpecialFolder.Trash);
    account.trash = trash;
    copyToTrash(inbox, trash);
    let messages = Array.from({ length: 3 }, (_, i) => makeMessage(inbox, `m${i}`));

    await deleteMessagesWithUndo(messages);
    await currentUndo()();

    expect(trash.fetchCalls).toBe(0);
    expect(inbox.moveCalls).toHaveLength(1);
  });

  test("группирует письма по исходным папкам (OWA переносит сам объект)", async () => {
    let account = makeAccount();
    let inbox = makeFolder(account);
    let archive = makeFolder(account);
    let trash = makeFolder(account, SpecialFolder.Trash);
    account.trash = trash;
    moveObjectToTrash(inbox, trash);
    moveObjectToTrash(archive, trash);
    let fromInbox = [makeMessage(inbox, "a"), makeMessage(inbox, "b")];
    let fromArchive = [makeMessage(archive, "c")];

    await deleteMessagesWithUndo([...fromInbox, ...fromArchive]);
    await currentUndo()();

    expect(inbox.moveCalls).toEqual([fromInbox]);
    expect(archive.moveCalls).toEqual([fromArchive]);
    expect(trash.fetchCalls).toBe(0);
    expect(mocks.openEMailMessage).toHaveBeenCalledWith(fromArchive[0]);
  });

  test("возвращает найденные письма и сообщает о ненайденных", async () => {
    let account = makeAccount();
    let inbox = makeFolder(account);
    let trash = makeFolder(account, SpecialFolder.Trash);
    account.trash = trash;
    copyToTrash(inbox, trash);
    let messages = [makeMessage(inbox, "kept"), makeMessage(inbox, "lost")];

    await deleteMessagesWithUndo(messages);
    trash.messages.removeAll(trash.messages.contents.filter(copy => copy.pID == "trash-lost"));

    await expect(currentUndo()()).rejects.toBeInstanceOf(UserError);
    expect(trash.fetchCalls).toBe(1);
    expect(inbox.moveCalls).toHaveLength(1);
    expect(inbox.moveCalls[0].map(message => message.pID)).toEqual(["trash-kept"]);
    expect(get(mailUndoToast)).toBeNull();
  });

  test("закрывает тост и пробрасывает ошибку сервера", async () => {
    let account = makeAccount();
    let inbox = makeFolder(account);
    let trash = makeFolder(account, SpecialFolder.Trash);
    account.trash = trash;
    copyToTrash(inbox, trash);
    let serverError = new Error("server");
    inbox.moveMessagesHere = vi.fn(async () => { throw serverError; });

    await deleteMessagesWithUndo([makeMessage(inbox, "x")]);

    await expect(currentUndo()()).rejects.toBe(serverError);
    expect(mocks.openEMailMessage).not.toHaveBeenCalled();
    expect(get(mailUndoToast)).toBeNull();
  });

  test("открывает вернувшуюся копию в исходной папке, а не удалённый объект в Корзине", async () => {
    let account = makeAccount();
    let inbox = makeFolder(account);
    let trash = makeFolder(account, SpecialFolder.Trash);
    account.trash = trash;
    copyToTrash(inbox, trash);
    moveOnServerOnly(inbox);
    let [message] = [makeMessage(inbox, "a")];

    await deleteMessagesWithUndo([message]);
    await currentUndo()();

    expect(inbox.fetchCalls).toBe(1);
    expect(mocks.openEMailMessage).toHaveBeenCalledTimes(1);
    let opened = (mocks.openEMailMessage.mock.calls[0] as unknown as [EMail])[0];
    expect(opened.folder).toBe(inbox);
    expect(opened.messageID).toBe("a@example.com");
    expect(opened.isDeleted).toBe(false);
  });

  test("если копия ещё не пришла, показывает исходную папку", async () => {
    let account = makeAccount();
    let inbox = makeFolder(account);
    let trash = makeFolder(account, SpecialFolder.Trash);
    account.trash = trash;
    copyToTrash(inbox, trash);
    inbox.moveMessagesHere = vi.fn(async (messages: Collection<EMail>) => {
      for (let message of messages.contents) {
        (message.folder as FakeFolder).messages.remove(message);
        (message as any).isDeleted = true;
      }
    }) as Folder["moveMessagesHere"];
    let message = makeMessage(inbox, "a");

    await deleteMessagesWithUndo([message]);
    await currentUndo()();

    expect(mocks.openEMailMessage).not.toHaveBeenCalled();
    expect(mocks.openMailFolder).toHaveBeenCalledWith(inbox);
  });
});
