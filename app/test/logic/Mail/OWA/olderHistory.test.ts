import "../../../../logic/app";
import { appGlobal } from "../../../../logic/app";
import { SpecialFolder } from "../../../../logic/Mail/Folder";
import { OWAAccount } from "../../../../logic/Mail/OWA/OWAAccount";
import type { OWAFolder } from "../../../../logic/Mail/OWA/OWAFolder";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { afterEach, expect, test } from "vitest";

const kHour = 60 * 60_000;
/** Размер сетевого архива из пользовательского сценария. */
const kArchiveTotal = 21_754;
/** Сколько строк было в кеше: июль 906 + июнь 50 + прошлый год 49 + 2024 1. */
const kCachedCount = 1_006;

function makeArchiveInbox(): { account: OWAAccount, folder: OWAFolder } {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  account.id = "account-id";
  account.username = "user@example.test";
  account.emailAddress = "user@example.test";
  (account as any).hasLoggedIn = true;
  let folder = account.newFolder();
  folder.id = "archive-inbox";
  folder.name = "Входящие";
  folder.specialFolder = SpecialFolder.Inbox;
  folder.isArchiveMailbox = true;
  (folder as any).haveReadFolder = true;
  account.rootFolders.add(folder);
  account.folderMap.set(folder.id, folder);
  return { account, folder };
}

function header(id: string, received: Date): any {
  return {
    ItemId: { Id: id },
    InternetMessageId: `<${id}@example.test>`,
    Subject: id,
    DateTimeSent: received.toISOString(),
    DateTimeReceived: received.toISOString(),
    IsRead: true,
    ItemClass: "IPM.Note",
  };
}

/** Сервер с `total` письмами, отсортированными от новых к старым; первые
 * `cached` уже лежат в локальном кеше. */
function setupServer(account: OWAAccount, folder: OWAFolder, total: number, cached: number) {
  let now = Date.now();
  let server: any[] = [];
  for (let index = 0; index < total; index++) {
    server.push(header(`msg-${index}`, new Date(now - 90 * 24 * kHour - index * kHour)));
  }
  for (let item of server.slice(0, cached)) {
    let email = folder.newEMail();
    email.itemID = item.ItemId.Id;
    email.received = new Date(item.DateTimeReceived);
    email.sent = email.received;
    email.isRead = true;
    folder.messages.add(email);
  }
  folder.countTotal = total;
  let byID = new Map(server.map(item => [item.ItemId.Id, item]));
  let stats = { findItem: 0, getItem: 0, maxGetItemIDs: 0, inFlight: 0, maxInFlight: 0 };
  account.callOWA = async (request: any) => {
    stats.inFlight++;
    stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
    try {
      await Promise.resolve();
      if (request.action == "FindItem") {
        stats.findItem++;
        let offset = request.Body.Paging.Offset;
        let size = request.Body.Paging.MaxEntriesReturned;
        return {
          RootFolder: {
            Items: server.slice(offset, offset + size).map(item => ({
              ItemId: item.ItemId,
              DateTimeReceived: item.DateTimeReceived,
            })),
            IncludesLastItemInRange: offset + size >= server.length,
            TotalItemsInView: server.length,
          },
        };
      }
      if (request.action == "GetItem") {
        stats.getItem++;
        let ids: string[] = request.Body.ItemIds.map((itemId: any) => itemId.Id);
        stats.maxGetItemIDs = Math.max(stats.maxGetItemIDs, ids.length);
        return { Items: ids.map(id => byID.get(id)) };
      }
      throw new Error(`Неожиданный запрос OWA: ${request.action}`);
    } finally {
      stats.inFlight--;
    }
  };
  return { server, stats };
}

afterEach(() => {
  appGlobal.emailAccounts.clear();
});

test("сетевой архив на 21 754 письма догружается целиком, а не только первая тысяча", async () => {
  let { account, folder } = makeArchiveInbox();
  let { stats } = setupServer(account, folder, kArchiveTotal, kCachedCount);
  expect(folder.messages.length).toBe(kCachedCount);
  expect(folder.needsOlderHistorySync()).toBe(true);

  let passes = 0;
  let finished = false;
  while (!finished) {
    passes++;
    let sizeBefore = folder.messages.length;
    finished = await (folder as any).syncOlderHistoryPass();
    // Каждый шаг сразу добавляет строки в список, а не копит их до конца обхода.
    expect(finished || folder.messages.length > sizeBefore || sizeBefore == kCachedCount).toBe(true);
    expect(passes).toBeLessThan(100);
  }

  expect(folder.messages.length).toBe(kArchiveTotal);
  expect(folder.getEmailByItemID(`msg-${kArchiveTotal - 1}`)?.isNewArrived).toBe(false);
  // Без шторма: один FindItem на страницу (+ одна страница перекрытия на шаг),
  // GetItem только для отсутствующих писем, запросы строго по одному.
  let pages = Math.ceil(kArchiveTotal / 50);
  expect(stats.findItem).toBeLessThanOrEqual(pages + passes);
  expect(stats.getItem).toBeLessThanOrEqual(Math.ceil((kArchiveTotal - kCachedCount) / 50) + passes);
  expect(stats.maxGetItemIDs).toBeLessThanOrEqual(50);
  expect(stats.maxInFlight).toBe(1);

  // Полностью загруженная папка повторный обход не запускает.
  expect(folder.needsOlderHistorySync()).toBe(false);
});

test("фоновая догрузка идёт шагами и останавливается, когда папку закрыли", async () => {
  let { account, folder } = makeArchiveInbox();
  let { stats } = setupServer(account, folder, 3_000, 100);
  let allowed = 1;
  folder.syncOlderHistoryInBackground(() => allowed-- > 0);
  await (folder as any).olderHistoryPumpRunOnce.running;
  // Один шаг — 10 страниц по 50, затем пользователь ушёл из папки.
  expect(stats.findItem).toBe(10);
  expect(folder.messages.length).toBe(500);
  let resumeOffset = folder.toExtraJSON().olderHistoryResumeOffset;
  expect(resumeOffset).toBe(450);

  // Повторное открытие продолжает с сохранённого смещения и доходит до конца.
  stats.findItem = 0;
  folder.syncOlderHistoryInBackground();
  await (folder as any).olderHistoryPumpRunOnce.running;
  expect(folder.messages.length).toBe(3_000);
  expect(stats.findItem).toBeLessThanOrEqual(Math.ceil((3_000 - 450) / 50) + 6);
  expect(folder.toExtraJSON().olderHistoryResumeOffset).toBeUndefined();
  expect(folder.toExtraJSON().olderHistoryCompletedGap).toBe(0);
});

test("небольшое расхождение со счётчиком не запускает полный обход папки", async () => {
  let { account, folder } = makeArchiveInbox();
  let { stats } = setupServer(account, folder, 1_030, 1_000);
  expect(folder.needsOlderHistorySync()).toBe(false);
  folder.syncOlderHistoryInBackground();
  expect((folder as any).olderHistoryPumpRunOnce.running).toBeNull();
  expect(stats.findItem).toBe(0);
});

test("письма, которые сервер не отдаёт, не зацикливают обход", async () => {
  let { account, folder } = makeArchiveInbox();
  let { stats } = setupServer(account, folder, 400, 100);
  let callOWA = account.callOWA;
  account.callOWA = async (request: any) => {
    let result = await callOWA(request);
    if (request.action == "GetItem") {
      // GetItem никогда не отдаёт письма старше 200-го.
      result.Items = result.Items.filter((item: any) => Number(item.ItemId.Id.slice(4)) < 200);
    }
    return result;
  };
  folder.syncOlderHistoryInBackground();
  await (folder as any).olderHistoryPumpRunOnce.running;
  expect(folder.messages.length).toBe(200);
  let findItemCalls = stats.findItem;
  // Обход завершён; без роста расхождения повтор не запускается.
  (folder as any).olderHistoryNextAttemptAt = 0;
  expect(folder.needsOlderHistorySync()).toBe(false);
  folder.syncOlderHistoryInBackground();
  expect(stats.findItem).toBe(findItemCalls);
});

test("ошибка сервера откладывает повтор догрузки, а не повторяет её на каждом тике", async () => {
  let { account, folder } = makeArchiveInbox();
  setupServer(account, folder, 2_000, 100);
  let errors: unknown[] = [];
  account.errorCallback = ex => errors.push(ex);
  account.callOWA = async () => {
    throw new Error("Сервер недоступен");
  };
  folder.syncOlderHistoryInBackground();
  await (folder as any).olderHistoryPumpRunOnce.running?.catch(() => {});
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(folder.needsOlderHistorySync()).toBe(false);
  expect(errors.length).toBe(1);
});

test("смещение и итог догрузки переживают перезапуск через JSON папки", () => {
  let { folder } = makeArchiveInbox();
  folder.fromExtraJSON({ olderHistoryResumeOffset: 1_450, olderHistoryCompletedGap: 3 });
  expect(folder.toExtraJSON().olderHistoryResumeOffset).toBe(1_450);
  expect(folder.toExtraJSON().olderHistoryCompletedGap).toBe(3);
  folder.fromExtraJSON({ olderHistoryResumeOffset: "мусор", olderHistoryCompletedGap: -1 });
  expect(folder.toExtraJSON().olderHistoryResumeOffset).toBeUndefined();
  expect(folder.toExtraJSON().olderHistoryCompletedGap).toBeUndefined();
});
