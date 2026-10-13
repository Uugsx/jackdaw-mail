import { afterEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  goTo: vi.fn(),
  openApp: vi.fn(),
  selectedApp: { set: vi.fn() },
  selectedAccount: { set: vi.fn() },
  selectedFolder: { set: vi.fn() },
  selectedMessage: { set: vi.fn() },
  selectedSearchTab: { set: vi.fn() },
  mailApp: { id: "mail" },
  appGlobal: { isMobile: false },
}));

vi.mock("../../../frontend/AppsBar/selectedApp", () => ({
  goTo: mocks.goTo,
  openApp: mocks.openApp,
  selectedApp: mocks.selectedApp,
}));
vi.mock("../../../frontend/Mail/MailJackdawApp", () => ({ mailApp: mocks.mailApp }));
vi.mock("../../../frontend/Mail/Selected", () => ({
  selectedAccount: mocks.selectedAccount,
  selectedFolder: mocks.selectedFolder,
  selectedMessage: mocks.selectedMessage,
  selectedSearchTab: mocks.selectedSearchTab,
}));
vi.mock("../../../frontend/Util/util", () => ({
  URLPart(literals: TemplateStringsArray, ...values: unknown[]) {
    return literals.map((literal, index) => {
      let value = values[index] == undefined ? "" : encodeURIComponent(String(values[index]));
      return literal + value;
    }).join("");
  },
}));
vi.mock("../../../logic/app", () => ({ appGlobal: mocks.appGlobal }));
vi.mock("../../../logic/util/util", () => ({
  assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message);
    }
  },
}));

import { openEMailMessageFullscreen } from "../../../frontend/Mail/open";

afterEach(() => {
  vi.clearAllMocks();
  mocks.appGlobal.isMobile = false;
});

function createMessage() {
  let account = { id: "account-id" };
  let folder = { id: "folder-id", account };
  return {
    id: "message-id",
    folder,
  };
}

describe("полноэкранное открытие письма", () => {
  test("на десктопе переводит почту на отдельный маршрут просмотра", async () => {
    let message = createMessage();

    await openEMailMessageFullscreen(message as any);

    expect(mocks.selectedApp.set).toHaveBeenCalledWith(mocks.mailApp);
    expect(mocks.goTo).toHaveBeenCalledWith(
      "/mail/message/account-id/folder-id/message-id/display",
      {
        message,
        folder: message.folder,
        account: message.folder.account,
        tab: undefined,
      },
    );
    expect(mocks.openApp).not.toHaveBeenCalled();
  });

  test("на мобильном устройстве сохраняет существующий переход", async () => {
    mocks.appGlobal.isMobile = true;
    let message = createMessage();

    await openEMailMessageFullscreen(message as any);

    expect(mocks.goTo).toHaveBeenCalledWith(
      "/mail/message/account-id/folder-id/message-id/display",
      {
        message,
        folder: message.folder,
        account: message.folder.account,
        tab: undefined,
      },
    );
    expect(mocks.openApp).not.toHaveBeenCalled();
  });
});
