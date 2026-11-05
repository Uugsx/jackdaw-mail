// @vitest-environment happy-dom

// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import {
  conversationKey, findRedundantMessages, folderMessagesForCleanup, kMaxFolderCleanupMessages, normalizeForCleanup,
} from "../../../../logic/Mail/Cleanup/ConversationCleanup";
import {
  classifyMessage, ewsFindOtherRequest, heuristicClassification, isAutomatedSender, parseFindItemIDs,
  senderOverride, setSenderOverride, setServerClassification,
} from "../../../../logic/Mail/Focused/FocusedInbox";
import {
  findFolderByKey, folderKey, getQuickSteps, parseAddresses, quickStepProblem, runQuickStep, sanitizeQuickSteps,
  saveQuickSteps, type QuickStep, type QuickStepHost,
} from "../../../../logic/Mail/QuickSteps/QuickSteps";
import { ArrayColl } from "svelte-collections";
import { beforeEach, describe, expect, test, vi } from "vitest";

beforeEach(() => {
  let store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => { store.set(key, value); },
    removeItem: key => { store.delete(key); },
    clear: () => { store.clear(); },
    key: () => null,
    length: 0,
  } as Storage;
});

function mail(fields: Record<string, any>): any {
  return {
    isRead: true, isStarred: false, isImportant: false, isReplied: false, outgoing: false,
    tags: new ArrayColl(), to: [], cc: [], subject: "Отчёт", threadID: "t1",
    ...fields,
  };
}

describe("Очистка беседы", () => {
  const first = "Коллеги, прошу прислать цифры за третий квартал до пятницы.";
  const second = "Цифры во вложении, проверьте, пожалуйста, вторую таблицу.";

  test("Нормализация убирает маркеры цитаты и регистр", () => {
    expect(normalizeForCleanup("> Привет,\n>> МИР  \n")).toBe("привет, мир");
  });

  test("Письмо, целиком процитированное в ответе, — лишнее", () => {
    let a = mail({ sent: new Date(2026, 9, 1), text: first });
    let b = mail({ sent: new Date(2026, 9, 2), text: second + "\n\n> " + first });
    let c = mail({ sent: new Date(2026, 9, 3), text: "Спасибо, принято, вопросов больше нет.\n> " + second + "\n>> " + first });
    let result = findRedundantMessages([a, b, c]);
    expect(result.map(candidate => candidate.email)).toEqual([a, b]);
    expect(result[0].coveredBy).toBe(b);
  });

  test("Непрочитанные, с флажком, с категорией и короткие — остаются", () => {
    let later = (text: string) => mail({ sent: new Date(2026, 9, 5), text: "Ответ на всё сразу.\n> " + text });
    for (let kept of [
      mail({ sent: new Date(2026, 9, 1), text: first, isRead: false }),
      mail({ sent: new Date(2026, 9, 1), text: first, isStarred: true }),
      mail({ sent: new Date(2026, 9, 1), text: first, tags: new ArrayColl([{ name: "Важно" }]) }),
      mail({ sent: new Date(2026, 9, 1), text: "Ок" }),
    ]) {
      expect(findRedundantMessages([kept, later(kept.text)])).toEqual([]);
    }
  });

  test("Другая беседа не покрывает письмо", () => {
    let a = mail({ sent: new Date(2026, 9, 1), text: first, threadID: "t1" });
    let b = mail({ sent: new Date(2026, 9, 2), text: "> " + first, threadID: "t2" });
    expect(findRedundantMessages([a, b])).toEqual([]);
  });

  test("Без ID нити беседа — по теме без Re:", () => {
    expect(conversationKey(mail({ threadID: "", subject: "Re: Отчёт" })))
      .toBe(conversationKey(mail({ threadID: "", subject: "Отчёт" })));
  });

  test("Очистка папки берёт только последние письма", () => {
    let list = Array.from({ length: kMaxFolderCleanupMessages + 10 }, (_, i) => mail({ sent: new Date(2020, 0, 1 + i) }));
    let picked = folderMessagesForCleanup(list);
    expect(picked.length).toBe(kMaxFolderCleanupMessages);
    expect(picked[0]).toBe(list[list.length - 1]);
  });
});

describe("Отсортированные / Другие", () => {
  const account = { isMyEMailAddress: (address: string) => address == "me@example.com" };
  const folder: any = { account };

  test("Автоматические отправители", () => {
    expect(isAutomatedSender("noreply@shop.ru")).toBe(true);
    expect(isAutomatedSender("news+weekly@example.com")).toBe(true);
    expect(isAutomatedSender("anna@mailchimp.com")).toBe(true);
    expect(isAutomatedSender("anna@example.com")).toBe(false);
    expect(isAutomatedSender("")).toBe(false);
  });

  test("Эвристика", () => {
    let unknown = () => false;
    let fromRobot = mail({ folder, from: { emailAddress: "noreply@shop.ru" }, to: [{ emailAddress: "me@example.com" }] });
    expect(heuristicClassification(fromRobot, unknown)).toBe("other");
    let personal = mail({ folder, from: { emailAddress: "anna@example.com" }, to: [{ emailAddress: "me@example.com" }] });
    expect(heuristicClassification(personal, unknown)).toBe("focused");
    let viaList = mail({ folder, from: { emailAddress: "anna@example.com" }, to: [{ emailAddress: "all@example.com" }] });
    expect(heuristicClassification(viaList, unknown)).toBe("other");
    expect(heuristicClassification(viaList, () => true)).toBe("focused");
    expect(heuristicClassification({ ...fromRobot, isStarred: true }, unknown)).toBe("focused");
  });

  test("Правило по отправителю важнее всего", () => {
    let robot = mail({ folder, from: { emailAddress: "NoReply@Shop.ru" } });
    setSenderOverride("noreply@shop.ru", "focused");
    expect(senderOverride("NOREPLY@shop.ru")).toBe("focused");
    expect(classifyMessage(robot, () => false)).toBe("focused");
    setSenderOverride("noreply@shop.ru", null);
    expect(classifyMessage(robot, () => false)).toBe("other");
  });

  test("Классификация Exchange важнее эвристики", () => {
    let serverFolder: any = { account };
    let robot = mail({ folder: serverFolder, itemID: "i1", from: { emailAddress: "noreply@shop.ru" } });
    let person = mail({ folder: serverFolder, itemID: "i2", from: { emailAddress: "anna@example.com" }, to: [{ emailAddress: "me@example.com" }] });
    setServerClassification(serverFolder, ["i2"]);
    expect(classifyMessage(robot, () => false)).toBe("focused");
    expect(classifyMessage(person, () => false)).toBe("other");
    setServerClassification(serverFolder, null);
    expect(classifyMessage(robot, () => false)).toBe("other");
  });

  test("Запрос FindItem и разбор ответа", () => {
    let request = ewsFindOtherRequest("f-inbox", 50);
    expect(request.m$FindItem.m$Restriction.t$IsEqualTo.t$FieldURI.FieldURI).toBe("item:InferenceClassification");
    expect(request.m$FindItem.m$IndexedPageItemView.MaxEntriesReturned).toBe(50);
    expect(Object.keys(request.m$FindItem)).toEqual(["m$ItemShape", "m$IndexedPageItemView", "m$Restriction", "m$SortOrder", "m$ParentFolderIds", "Traversal"]);
    expect(parseFindItemIDs({ RootFolder: { Items: { Message: [{ ItemId: { Id: "a" } }, { ItemId: { Id: "b" } }] } } })).toEqual(["a", "b"]);
    expect(parseFindItemIDs({ RootFolder: { Items: { Message: { ItemId: { Id: "a" } } } } })).toEqual(["a"]);
    expect(parseFindItemIDs({ RootFolder: { Items: [{ ItemId: { Id: "c" } }] } })).toEqual(["c"]);
    expect(parseFindItemIDs({})).toEqual([]);
  });
});

describe("Быстрые действия", () => {
  function fakeWorld() {
    let account: any = { id: "acc1" };
    let inbox: any = { id: "f-inbox", account, moveMessagesHere: vi.fn() };
    let archive: any = { id: "f-archive", account, moveMessagesHere: vi.fn() };
    account.findFolder = (test: (folder: any) => boolean) => [inbox, archive].find(test) ?? null;
    let email = (): any => ({
      folder: inbox,
      markRead: vi.fn(), markStarred: vi.fn(), markImportant: vi.fn(), deleteMessage: vi.fn(),
    });
    let host: QuickStepHost = {
      accounts: [account],
      forward: vi.fn(async () => {}),
      replyWithTemplate: vi.fn(async () => {}),
      addCategory: vi.fn(async () => {}),
    };
    return { account, inbox, archive, email, host };
  }

  test("Проверка шага", () => {
    expect(quickStepProblem({ id: "1", name: " ", actions: [{ type: "flag" }] })).toBeTruthy();
    expect(quickStepProblem({ id: "1", name: "A", actions: [] })).toBeTruthy();
    expect(quickStepProblem({ id: "1", name: "A", actions: [{ type: "move", value: "" }] })).toBeTruthy();
    expect(quickStepProblem({ id: "1", name: "A", actions: [{ type: "delete" }, { type: "flag" }] })).toBeTruthy();
    expect(quickStepProblem({ id: "1", name: "A", actions: [{ type: "flag" }, { type: "delete" }] })).toBeNull();
  });

  test("Хранение отбрасывает мусор", () => {
    expect(sanitizeQuickSteps(null)).toEqual([]);
    let steps = sanitizeQuickSteps([{ name: "A", actions: [{ type: "bogus" }, { type: "flag", value: 1 }] }, { name: "", actions: [{ type: "flag" }] }]);
    expect(steps.length).toBe(1);
    expect(steps[0].actions).toEqual([{ type: "flag", value: undefined }]);
    expect(steps[0].id).toMatch(/^qs-/);
    saveQuickSteps(steps);
    expect(getQuickSteps()).toEqual(steps);
  });

  test("Адреса и ключ папки", () => {
    expect(parseAddresses("a@b.ru, bad; c@d.com")).toEqual(["a@b.ru", "c@d.com"]);
    let { account, archive } = fakeWorld();
    expect(folderKey(archive)).toBe("acc1\tf-archive");
    expect(findFolderByKey([account], "acc1\tf-archive")).toBe(archive);
    expect(findFolderByKey([account], "acc2\tf-archive")).toBeNull();
  });

  test("Цепочка выполняется по порядку", async () => {
    let { archive, email, host } = fakeWorld();
    let emails = [email(), email()];
    let step: QuickStep = {
      id: "1", name: "Готово",
      actions: [
        { type: "mark-read" }, { type: "flag" }, { type: "category", value: " Проект " },
        { type: "forward", value: "boss@example.com" }, { type: "reply-template", value: "7" },
        { type: "move", value: "acc1\tf-archive" },
      ],
    };
    await runQuickStep(step, emails, host);
    for (let one of emails) {
      expect(one.markRead).toHaveBeenCalledWith(true);
      expect(one.markStarred).toHaveBeenCalledWith(true);
    }
    expect(host.addCategory).toHaveBeenCalledWith(emails, "Проект");
    expect(host.forward).toHaveBeenCalledWith(emails[0], ["boss@example.com"]);
    expect(host.replyWithTemplate).toHaveBeenCalledWith(emails[1], 7);
    expect(archive.moveMessagesHere).toHaveBeenCalledTimes(1);
    expect(archive.moveMessagesHere.mock.calls[0][0].contents).toEqual(emails);
  });

  test("Пропавшая папка и плохой адрес — понятная ошибка", async () => {
    let { email, host } = fakeWorld();
    await expect(runQuickStep({ id: "1", name: "A", actions: [{ type: "move", value: "acc1\tgone" }] }, [email()], host))
      .rejects.toThrow();
    await expect(runQuickStep({ id: "1", name: "A", actions: [{ type: "forward", value: "nobody" }] }, [email()], host))
      .rejects.toThrow();
  });
});
