import { describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ accounts: [] as any[] }));

vi.mock("../../../logic/app", () => ({ appGlobal: { emailAccounts: mocks.accounts } }));
vi.mock("../../../logic/Mail/MailAccount", () => ({
  MailAccount: class {},
}));
vi.mock("../../../frontend/Mail/open", () => ({ openEMailMessage: vi.fn() }));
vi.mock("../../../l10n/l10n", () => ({ gt: (s: TemplateStringsArray) => s.join("") }));

import { MailAccount } from "../../../logic/Mail/MailAccount";
import { loadReportMessage } from "../../../frontend/Mail/openPendingResponse";

function makeAccount(readMessage: () => Promise<void>, folderFound = true) {
  const account: any = new (MailAccount as any)();
  const email: any = { storage: { readMessage } };
  const folder = {
    dbID: 5,
    messages: { find: () => undefined },
    newEMail: () => email,
  };
  account.dbID = 1;
  account.readFromDB = async () => {};
  account.findFolder = () => (folderFound ? folder : null);
  account.inbox = folderFound ? null : folder;
  return { account, email };
}

describe("loadReportMessage", () => {
  test("читает письмо по идентификатору, не открывая почту", async () => {
    const readMessage = vi.fn(async () => {});
    const { account, email } = makeAccount(readMessage);
    mocks.accounts.splice(0, mocks.accounts.length, account);
    const result = await loadReportMessage({ accountId: 1, folderId: 5, emailId: 42 });
    expect(result).toBe(email);
    expect(email.dbID).toBe(42);
    expect(readMessage).toHaveBeenCalledOnce();
  });

  test("нет ящика — понятная ошибка", async () => {
    mocks.accounts.splice(0, mocks.accounts.length);
    await expect(loadReportMessage({ accountId: 9, folderId: 5, emailId: 1 }))
      .rejects.toThrow("The mailbox for this message is not available.");
  });

  test("папка перемещена — письмо ищется через входящие", async () => {
    const { account, email } = makeAccount(async () => {}, false);
    mocks.accounts.splice(0, mocks.accounts.length, account);
    expect(await loadReportMessage({ accountId: 1, folderId: 404, emailId: 7 })).toBe(email);
  });

  test("письмо удалено — ошибка про удаление или перемещение", async () => {
    const { account } = makeAccount(async () => { throw new Error("EMail DB ID 1 not found"); });
    mocks.accounts.splice(0, mocks.accounts.length, account);
    await expect(loadReportMessage({ accountId: 1, folderId: 5, emailId: 1 }))
      .rejects.toThrow("This message was deleted or moved and can no longer be opened.");
  });
});
