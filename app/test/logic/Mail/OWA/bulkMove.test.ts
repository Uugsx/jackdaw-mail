import "../../../../logic/app";
import { appGlobal } from "../../../../logic/app";
import { OWAAccount } from "../../../../logic/Mail/OWA/OWAAccount";
import type { OWAFolder } from "../../../../logic/Mail/OWA/OWAFolder";
import type { OWAEMail } from "../../../../logic/Mail/OWA/OWAEMail";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { ArrayColl } from "svelte-collections";
import { expect, test } from "vitest";

const kMessageCount = 1000;
const kServerBatchSize = 50;

function setup(count: number) {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  let source = account.newFolder() as OWAFolder;
  source.id = "source";
  source.releaseDeletionAfterGracePeriod = () => {};
  let target = account.newFolder() as OWAFolder;
  target.id = "target";
  let messages: OWAEMail[] = [];
  for (let i = 0; i < count; i++) {
    let message = source.newEMail();
    message.itemID = `message-${i}`;
    message.isRead = i % 2 == 0;
    messages.push(message);
  }
  source.messages.addAll(messages);
  source.countTotal = count;
  source.countUnread = Math.floor(count / 2);
  return { account, source, target, messages };
}

/** Ответ Exchange на MoveItem: по элементу на каждый ItemId запроса. */
function moveResponse(request: any, errorFor: Record<string, string> = {}) {
  return {
    ResponseMessages: {
      Items: request.Body.ItemIds.map((item: any) => errorFor[item.Id]
        ? { ResponseClass: "Error", ResponseCode: errorFor[item.Id], MessageText: errorFor[item.Id] }
        : { ResponseClass: "Success", ResponseCode: "NoError", Items: [{ ItemId: { Id: `new-${item.Id}` } }] }),
    },
  };
}

test("перемещение 1000 писем OWA идёт пачками, а не по письму", async () => {
  let { account, source, target, messages } = setup(kMessageCount);
  let requests: any[] = [];
  (account as any).callOWA = async (request: any) => {
    requests.push(request);
    return moveResponse(request);
  };
  let listChanges = 0;
  source.messages.registerObserver({
    added: () => listChanges++,
    removed: () => listChanges++,
  });
  let folderNotifications = 0;
  source.subscribe(() => folderNotifications++);
  target.subscribe(() => folderNotifications++);
  let progress: number[] = [];

  await target.moveMessagesHere(new ArrayColl(messages), completed => progress.push(completed));

  let batches = kMessageCount / kServerBatchSize;
  expect(requests).toHaveLength(batches);
  expect(requests.every(request => request.action == "MoveItem")).toBe(true);
  expect(requests.every(request => request.Body.ItemIds.length == kServerBatchSize)).toBe(true);
  // Список перерисовывается раз на пачку, а не на каждое письмо.
  expect(listChanges).toBeLessThanOrEqual(batches);
  expect(folderNotifications).toBeLessThanOrEqual(batches * 4);
  expect(progress).toHaveLength(batches);
  expect(progress.at(-1)).toBe(kMessageCount);
  expect([...progress].sort((a, b) => a - b)).toEqual(progress);

  expect(source.messages.length).toBe(0);
  expect(target.messages.length).toBe(kMessageCount);
  expect(source.countTotal).toBe(0);
  expect(source.countUnread).toBe(0);
  expect(target.countTotal).toBe(kMessageCount);
  expect(target.countUnread).toBe(kMessageCount / 2);
  expect(messages.every(message => message.folder === target)).toBe(true);
  expect(messages[7].itemID).toBe("new-message-7");
});

test("частичный успех пачки: перенесённые уходят, ненайденные удаляются, прочие остаются с ошибкой", async () => {
  let { account, source, target, messages } = setup(5);
  (account as any).callOWA = async (request: any) => moveResponse(request, {
    "message-1": "ErrorItemNotFound",
    "message-3": "ErrorAccessDenied",
  });
  let progress: number[] = [];

  await expect(target.moveMessagesHere(new ArrayColl(messages), completed => progress.push(completed)))
    .rejects.toThrow();

  expect(target.messages.contents.map(message => message.itemID).sort())
    .toEqual(["new-message-0", "new-message-2", "new-message-4"]);
  expect(source.messages.contents.map(message => message.itemID)).toEqual(["message-3"]);
  expect(messages[3].folder).toBe(source);
  expect(messages[1].isDeleted).toBe(true);
  expect(progress).toEqual([4]);
  expect(target.countTotal).toBe(3);
  expect(source.countTotal).toBe(2);
});

test("сбой всего запроса не трогает письма пачки, следующие пачки переносятся", async () => {
  let { account, source, target, messages } = setup(kServerBatchSize + 10);
  let calls = 0;
  (account as any).callOWA = async (request: any) => {
    if (calls++ == 0) {
      throw new Error("network down");
    }
    return moveResponse(request);
  };

  await expect(target.moveMessagesHere(new ArrayColl(messages))).rejects.toThrow("network down");

  expect(calls).toBe(2);
  expect(source.messages.length).toBe(kServerBatchSize);
  expect(target.messages.length).toBe(10);
  // ItemId неудавшейся пачки сразу возвращаются синхронизации.
  expect(messages.slice(0, kServerBatchSize).some(message => source.deletions.has(message.itemID as string))).toBe(false);
});

test("копирование пачкой оставляет исходные письма на месте", async () => {
  let { account, source, target, messages } = setup(120);
  let requests: any[] = [];
  (account as any).callOWA = async (request: any) => {
    requests.push(request);
    return moveResponse(request);
  };

  await target.copyMessagesHere(new ArrayColl(messages));

  expect(requests).toHaveLength(3);
  expect(requests[0].action).toBe("CopyItem");
  expect(source.messages.length).toBe(120);
  expect(target.countTotal).toBe(120);
  expect(target.countUnread).toBe(60);
  expect(messages.every(message => message.folder === source && message.itemID?.startsWith("message-"))).toBe(true);
});

test("починка ItemId после переноса запускает полную синхронизацию не больше одного раза", async () => {
  let { target, messages } = setup(200);
  messages.forEach((message, index) => {
    message.subject = `subject-${index}`;
  });
  let listCalls = 0;
  let syncCalls = 0;
  (target as any).listMessages = async () => {
    listCalls++;
    return new ArrayColl();
  };
  (target as any).getNewMessages = async () => {
    syncCalls++;
    return new ArrayColl();
  };

  await target.fixMovedItemIds(messages);

  expect(listCalls).toBe(1);
  expect(syncCalls).toBe(1);
});

test("починка ItemId находит двойника по Message-ID без полной синхронизации", async () => {
  let { target, messages } = setup(3);
  let twins = messages.map((message, index) => {
    message.id = `<mid-${index}@example.com>`;
    let twin = target.newEMail();
    twin.id = message.id;
    twin.itemID = `server-${index}`;
    return twin;
  });
  target.messages.addAll(twins);
  let syncCalls = 0;
  (target as any).listMessages = async () => new ArrayColl(twins);
  (target as any).getNewMessages = async () => {
    syncCalls++;
    return new ArrayColl();
  };

  await target.fixMovedItemIds(messages);

  expect(syncCalls).toBe(0);
  expect(messages.map(message => message.itemID)).toEqual(["server-0", "server-1", "server-2"]);
  expect(twins.every(twin => !target.messages.contains(twin))).toBe(true);
});
