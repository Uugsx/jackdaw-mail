import { describe, expect, test, vi } from "vitest";

vi.mock("../../../../logic/Chat/SQL/SQLChatAccount", () => ({
  SQLChatAccount: { countRooms: vi.fn(async (account: { rooms: number | null }) => account.rooms) },
}));

const { appGlobal } = await import("../../../../logic/app");
const { JACKDAW_CHAT_PROTOCOL } = await import("../../../../logic/Chat/Jackdaw/JackdawChatAccount");
const { startJackdawChat, markChatAccountsRead, removeEmptyDuplicateAccounts } =
  await import("../../../../logic/Chat/Jackdaw/JackdawChats");

function fakeAccount(rooms: number | null) {
  let account = {
    protocol: JACKDAW_CHAT_PROTOCOL,
    rooms,
    attachClient: vi.fn(),
    deleteIt: vi.fn(async () => {
      appGlobal.chatAccounts.remove(account as any);
    }),
  };
  return account;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

describe("Аккаунт чата Jackdaw при запуске", () => {
  test("ждёт чтения сохранённых аккаунтов и не создаёт дубль", async () => {
    appGlobal.chatAccounts.clear();
    let client = {
      isOnline: true,
      verifiedEmails: ["me@example.com"],
      subscribe(callback: () => void) {
        callback();
        return () => {};
      },
    };
    let stop = startJackdawChat(client as any);
    await settle();
    // Соединение уже есть, а аккаунты из базы ещё не прочитаны: ничего не создаётся
    expect(appGlobal.chatAccounts.length).toBe(0);

    let saved = fakeAccount(1);
    let duplicate = fakeAccount(0);
    appGlobal.chatAccounts.addAll([saved as any, duplicate as any]);
    markChatAccountsRead();
    await settle();

    expect(saved.attachClient).toHaveBeenCalledWith(client);
    expect(duplicate.deleteIt).toHaveBeenCalled();
    expect(appGlobal.chatAccounts.contents).toEqual([saved]);
    stop();
    appGlobal.chatAccounts.clear();
  });

  test("оставляет аккаунт с перепиской, удаляет только пустые дубли", async () => {
    appGlobal.chatAccounts.clear();
    let emptyFirst = fakeAccount(0);
    let withRooms = fakeAccount(3);
    let emptyLast = fakeAccount(0);
    let notInDatabase = fakeAccount(null);
    appGlobal.chatAccounts.addAll([emptyFirst, withRooms, emptyLast, notInDatabase] as any[]);

    await removeEmptyDuplicateAccounts();

    expect(appGlobal.chatAccounts.contents).toEqual([withRooms, notInDatabase]);
    expect(withRooms.deleteIt).not.toHaveBeenCalled();
    expect(notInDatabase.deleteIt).not.toHaveBeenCalled();
    appGlobal.chatAccounts.clear();
  });

  test("один аккаунт не трогает", async () => {
    appGlobal.chatAccounts.clear();
    let only = fakeAccount(0);
    appGlobal.chatAccounts.add(only as any);
    await removeEmptyDuplicateAccounts();
    expect(only.deleteIt).not.toHaveBeenCalled();
    appGlobal.chatAccounts.clear();
  });
});
