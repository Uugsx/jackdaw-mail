import "../../../../logic/app";
import { appGlobal } from "../../../../logic/app";
import { OWAAccount } from "../../../../logic/Mail/OWA/OWAAccount";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { expect, test } from "vitest";

test("не возвращает письмо в непрочитанные из-за устаревшего ответа OWA", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  let folder = account.newFolder();
  let message = folder.newEMail();
  message.itemID = "message-1";
  message.isRead = false;
  folder.messages.add(message);
  folder.countUnread = 1;

  let release!: () => void;
  let requestStarted!: () => void;
  let requestStartedPromise = new Promise<void>(resolve => requestStarted = resolve);
  let requestGate = new Promise<void>(resolve => release = resolve);
  (account as any).callOWA = async () => {
    requestStarted();
    await requestGate;
    return {};
  };

  let markRead = message.markRead(true);
  await requestStartedPromise;

  message.setFlags({ IsRead: false }, "list");
  expect(message.isRead).toBe(true);

  release();
  await markRead;

  // Старый запрос списка мог завершиться уже после UpdateItem.
  message.setFlags({ IsRead: false }, "list");
  expect(message.isRead).toBe(true);

  // После подтверждения серверного состояния внешнее изменение снова принимается.
  message.setFlags({ IsRead: true }, "list");
  message.setFlags({ IsRead: false }, "list");
  expect(message.isRead).toBe(false);
});
