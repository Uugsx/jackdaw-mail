// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { mount, tick, unmount } from "svelte";

let AccountListItem: any;
let OWAAccount: any;
let connectionProblemLine: (lastSuccessAt: Date | null) => string;
let mounted: ReturnType<typeof mount>[] = [];

beforeAll(async () => {
  // Формат даты читает настройку языка из localStorage, в тестовом окружении его нет
  let storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  let appGlobal = (await import("../../../logic/app")).appGlobal;
  (appGlobal as any).remoteApp = { OWA: {} };
  AccountListItem = (await import("../../../frontend/Mail/LeftPane/AccountListItem.svelte")).default;
  OWAAccount = (await import("../../../logic/Mail/OWA/OWAAccount")).OWAAccount;
  connectionProblemLine = (await import("../../../frontend/Mail/connectionProblemNotice")).connectionProblemLine;
}, 120_000);

afterEach(() => {
  for (let instance of mounted) {
    unmount(instance);
  }
  mounted = [];
  document.body.replaceChildren();
});

function timeout(): Error {
  let ex = new Error("connect ETIMEDOUT");
  (ex as any).code = "ETIMEDOUT";
  return ex;
}

async function mountRow(account: any): Promise<HTMLElement> {
  let target = document.createElement("div");
  document.body.append(target);
  mounted.push(mount(AccountListItem, { target, props: { account }, context: new Map() }));
  await tick();
  return target;
}

describe("Строка аккаунта при сбое связи", () => {
  test("показывает «нет связи» с временем последней синхронизации и снимает при восстановлении", async () => {
    let account = new OWAAccount();
    account.name = "Работа";
    let lastSync = new Date(Date.now() - 5 * 60_000);
    account.connectionStatus.reportSuccess(lastSync);
    let row = await mountRow(account);
    expect(row.querySelector(".connection-status")).toBeNull();

    account.connectionStatus.reportFailure(timeout());
    await tick();

    let status = row.querySelector(".connection-status");
    expect(status?.textContent?.trim()).toBe(connectionProblemLine(lastSync));
    expect(row.querySelector(".icon.connection-problem")).not.toBeNull();
    let title = row.querySelector(".account-row")?.getAttribute("title") ?? "";
    expect(title).toContain(account.connectionStatus.problem.message);

    account.connectionStatus.reportSuccess();
    await tick();

    expect(row.querySelector(".connection-status")).toBeNull();
    expect(row.querySelector(".icon.connection-problem")).toBeNull();
    expect(row.querySelector(".account-row")?.getAttribute("title") ?? "").toBe("");
  });

  test("общий ящик показывает сбой основного аккаунта", async () => {
    let main = new OWAAccount();
    main.name = "Работа";
    let shared = new OWAAccount();
    shared.name = "Общий ящик";
    shared.mainAccount = main;
    let row = await mountRow(shared);

    main.connectionStatus.reportFailure(timeout());
    await tick();
    expect(row.querySelector(".connection-status")).not.toBeNull();

    main.connectionStatus.reportSuccess();
    await tick();
    expect(row.querySelector(".connection-status")).toBeNull();
  });
});

describe("Системное уведомление о сбое", () => {
  test("одно на эпизод и только при включённых всплывающих уведомлениях почты", async () => {
    let shown: { title: string; body: string }[] = [];
    vi.resetModules();
    vi.doMock("../../../frontend/Shared/SystemNotification", () => ({
      NotificationKinds: class {
        popup: boolean;
        constructor(kinds: string[]) {
          this.popup = kinds.includes("popup");
        }
      },
      SystemNotification: class {
        updatesTaskbarBadge = true;
        onClick: () => void;
        constructor(_kinds: any, public title: string, public body: string) {}
        async show() {
          shown.push({ title: this.title, body: this.body });
        }
      },
    }));
    let mailKinds = ["popup", "sound"];
    vi.doMock("../../../frontend/Util/LocalStorage", () => ({
      getLocalStorage: () => ({ value: mailKinds }),
    }));
    try {
      let { startConnectionProblemNotifications } = await import("../../../frontend/Mail/connectionProblemNotice");
      let { ConnectionStatus, kConnectionProblemNotifyAfterMs, setConnectionProblemListener } =
        await import("../../../logic/Mail/connectionStatus");
      startConnectionProblemNotifications();
      let status = new ConnectionStatus(() => {}, () => "Работа");
      let start = Date.now();
      for (let ms = 0; ms <= 3 * kConnectionProblemNotifyAfterMs; ms += 3_000) {
        status.reportFailure(timeout(), new Date(start + ms));
      }
      await Promise.resolve();
      expect(shown).toHaveLength(1);
      expect(shown[0].title).toContain("Работа");

      // Пользователь выключил всплывающие уведомления почты
      mailKinds = ["sound"];
      status.reportSuccess(new Date(start + 4 * kConnectionProblemNotifyAfterMs));
      let next = start + 5 * kConnectionProblemNotifyAfterMs;
      status.reportFailure(timeout(), new Date(next));
      status.reportFailure(timeout(), new Date(next + kConnectionProblemNotifyAfterMs));
      await Promise.resolve();
      expect(shown).toHaveLength(1);
      setConnectionProblemListener(null);
    } finally {
      vi.doUnmock("../../../frontend/Shared/SystemNotification");
      vi.doUnmock("../../../frontend/Util/LocalStorage");
      vi.resetModules();
    }
  });
});
