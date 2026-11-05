import "../../../../logic/app";
import { appGlobal } from "../../../../logic/app";
import { IMAPAccount } from "../../../../logic/Mail/IMAP/IMAPAccount";
import { IMAPFolder } from "../../../../logic/Mail/IMAP/IMAPFolder";
import type { IMAPEMail } from "../../../../logic/Mail/IMAP/IMAPEMail";
import { SpecialFolder } from "../../../../logic/Mail/Folder";
import { DeleteStrategy } from "../../../../logic/Mail/MailAccount";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { afterEach, expect, test, vi } from "vitest";

const kUID = 7;

function createFolders(): { inbox: IMAPFolder, trash: IMAPFolder, message: IMAPEMail } {
  appGlobal.remoteApp = { createIMAPFlowConnection: () => null };
  let account = new IMAPAccount();
  account.storage = new DummyMailStorage();
  let inbox = new IMAPFolder(account);
  inbox.path = "INBOX";
  inbox.name = "Inbox";
  inbox.dbID = 1;
  inbox.specialFolder = SpecialFolder.Inbox;
  (inbox as any).haveReadFolder = true;
  let trash = new IMAPFolder(account);
  trash.path = "[Gmail]/Trash";
  trash.name = "Trash";
  trash.dbID = 2;
  trash.specialFolder = SpecialFolder.Trash;
  (trash as any).haveReadFolder = true;
  account.rootFolders.addAll([inbox, trash]);
  inbox.countTotal = 1;
  let message = inbox.newEMail();
  message.uid = kUID;
  message.subject = "Удаляемое письмо";
  inbox.messages.add(message);
  return { inbox, trash, message };
}

/**
 * Сессия Fetch у Gmail ещё не получила EXPUNGE: SEARCH и FETCH по-прежнему
 * возвращают перенесённое в Корзину письмо.
 */
function staleFetchConnection(messageMove: () => Promise<unknown>) {
  return {
    id: "stale-connection",
    messageMove,
    search: async () => [kUID],
    fetch: async () => (async function* () {
      yield {
        uid: kUID,
        size: 100,
        internalDate: new Date(),
        flags: new Set<string>(),
        envelope: {
          subject: "Удаляемое письмо",
          messageId: "<deleted@example.com>",
          date: new Date(),
          from: [],
          to: [],
        },
      };
    })(),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

test("письмо, перенесённое в Корзину, не возвращается в список от устаревшей IMAP-сессии", async () => {
  vi.useFakeTimers();
  let { inbox, message } = createFolders();
  let messageMove = vi.fn(async () => true);
  let connection = staleFetchConnection(messageMove);
  (inbox as any).runCommand = async (callback: (connection: any) => Promise<unknown>) => callback(connection);

  await message.deleteMessage(DeleteStrategy.MoveToTrash);

  expect(messageMove).toHaveBeenCalledWith(String(kUID), "[Gmail]/Trash", { uid: true });
  expect(inbox.messages.contains(message)).toBe(false);

  // Синхронизация по IDLE-уведомлению сразу после MOVE
  await (inbox as any).listAllUnknownMessages(false);
  expect(inbox.messages.some(candidate => candidate.uid == kUID)).toBe(false);

  // Когда все сессии увидели удаление, защита снимается
  vi.advanceTimersByTime(180_000);
  expect(inbox.deletions.has(kUID)).toBe(false);
});

test("UID защищён от синхронизации ещё до локального удаления письма", async () => {
  let { inbox, message } = createFolders();
  let protectedDuringLocalDelete: boolean | undefined;
  let storage = inbox.account.storage as DummyMailStorage;
  let deleteLocally = storage.deleteMessage.bind(storage);
  storage.deleteMessage = async (email) => {
    protectedDuringLocalDelete ??= inbox.deletions.has(kUID);
    await deleteLocally(email);
  };
  let connection = staleFetchConnection(async () => true);
  (inbox as any).runCommand = async (callback: (connection: any) => Promise<unknown>) => callback(connection);

  await message.deleteMessage(DeleteStrategy.MoveToTrash);

  expect(protectedDuringLocalDelete).toBe(true);
});

test("при ошибке сервера письмо возвращается и снова синхронизируется", async () => {
  let { inbox, message } = createFolders();
  let connection = staleFetchConnection(async () => {
    throw new Error("NO [TEMPFAIL] move failed");
  });
  (inbox as any).runCommand = async (callback: (connection: any) => Promise<unknown>) => callback(connection);

  await expect(message.deleteMessage(DeleteStrategy.MoveToTrash)).rejects.toThrow("move failed");

  expect(inbox.messages.contains(message)).toBe(true);
  expect(inbox.deletions.has(kUID)).toBe(false);
});

test("после окончательного удаления UID тоже защищён от устаревшей сессии", async () => {
  vi.useFakeTimers();
  let { inbox, message } = createFolders();
  inbox.specialFolder = SpecialFolder.Trash;
  let messageDelete = vi.fn(async () => true);
  let connection = { ...staleFetchConnection(async () => true), messageDelete };
  (inbox as any).runCommand = async (callback: (connection: any) => Promise<unknown>) => callback(connection);

  await message.deleteMessage(DeleteStrategy.DeleteImmediately);
  await (inbox as any).listAllUnknownMessages(false);

  expect(messageDelete).toHaveBeenCalledWith(kUID, { uid: true });
  expect(inbox.messages.some(candidate => candidate.uid == kUID)).toBe(false);
});
