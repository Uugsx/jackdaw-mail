// @vitest-environment happy-dom

// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import { EWSAccount } from "../../../../logic/Mail/EWS/EWSAccount";
import {
  addDays, flagDaysForChoice, localDay, parseExchangeDay, sanitizeDay, taskDueGroup, validateTaskInput,
  type ExchangeTaskInput,
} from "../../../../logic/Mail/Tasks/ExchangeTask";
import {
  ewsCompleteTaskRequest, ewsCreateTaskRequest, ewsDeleteTaskRequest, ewsFindTasksRequest, ewsGetTasksRequest,
  ewsSetMailFlagRequest, ewsUpdateTaskRequest, owaCompleteTaskRequest, owaCreateTaskRequest, owaDeleteTaskRequest,
  owaFindTasksRequest, owaGetTasksRequest, owaSetMailFlagRequest, owaUpdateTaskRequest, parseEWSCreatedTaskID,
  parseEWSFindTasks, parseEWSGetTasks, parseExchangeFlag, parseOWACreatedTaskID, parseOWAFindTasks, parseOWAGetTasks,
} from "../../../../logic/Mail/Tasks/ExchangeTaskRequests";
import { ewsTaskProtocol, fetchTasks, owaTaskProtocol } from "../../../../logic/Mail/Tasks/ExchangeTasks";
import { describe, expect, test } from "vitest";

const kNS = `xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages" xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types"`;

/** happy-dom теряет пространства имён у `createDocument()`, поэтому ищем по префиксам `m:` и `t:` */
function requestXML(request: any): Document {
  return new DOMParser().parseFromString(new EWSAccount().request2XML(request), "text/xml");
}

function tag(doc: Document | Element, name: string): Element {
  return doc.getElementsByTagName(name)[0];
}

/** happy-dom не находит `m:ResponseMessages` по querySelector, поэтому пространство m — по умолчанию */
function ewsResponse(body: string): any {
  body = body.replace(/<(\/?)m:/g, "<$1").replace(` ${kNS}`, ` xmlns="http://schemas.microsoft.com/exchange/services/2006/messages" ${kNS}`);
  let account = new EWSAccount();
  let text = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Body xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${body}</s:Body>
</s:Envelope>`;
  return account.checkResponse({ responseXML: account.parseXML(text) }, {} as any);
}

const kInput: ExchangeTaskInput = {
  subject: "  Подготовить отчёт  ",
  notes: "Цифры за квартал",
  startDay: "2026-10-23",
  dueDay: "2026-10-30",
  importance: "High",
};

function ewsTaskXML(id: string, extra = ""): string {
  return `<t:Task>
    <t:ItemId Id="${id}" ChangeKey="ck-${id}"/>
    <t:Subject>Задача ${id}</t:Subject>
    <t:Body BodyType="Text">Заметка ${id}</t:Body>
    <t:Importance>High</t:Importance>
    <t:LastModifiedTime>2026-10-22T10:00:00Z</t:LastModifiedTime>
    ${extra}
  </t:Task>`;
}

describe("дни без времени", () => {
  test("EWS (UTC): полночь UTC и флажок Outlook из другого пояса дают тот же день", () => {
    expect(parseExchangeDay("2026-10-23T00:00:00Z")).toBe("2026-10-23");
    expect(parseExchangeDay("2026-10-22T21:00:00Z")).toBe("2026-10-23");
    expect(parseExchangeDay("2026-10-23T04:00:00Z")).toBe("2026-10-23");
  });

  test("OWA (пояс ящика): день как написан", () => {
    expect(parseExchangeDay("2026-10-23T00:00:00+03:00")).toBe("2026-10-23");
    expect(parseExchangeDay("2026-10-23T00:00:00-05:00")).toBe("2026-10-23");
    expect(parseExchangeDay("2026-10-23T00:00:00")).toBe("2026-10-23");
  });

  test("мусор → null", () => {
    expect(parseExchangeDay(null)).toBeNull();
    expect(parseExchangeDay("")).toBeNull();
    expect(sanitizeDay("2026-02-30")).toBeNull();
    expect(sanitizeDay("завтра")).toBeNull();
  });

  test("addDays через границу месяца", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
  });
});

describe("срок флажка из меню", () => {
  // Пятница, 23 октября 2026
  const friday = new Date(2026, 9, 23, 15, 0);

  test("сегодня и завтра", () => {
    expect(flagDaysForChoice("today", friday)).toEqual({ startDay: "2026-10-23", dueDay: "2026-10-23" });
    expect(flagDaysForChoice("tomorrow", friday)).toEqual({ startDay: "2026-10-24", dueDay: "2026-10-24" });
  });

  test("на этой неделе — до пятницы; в выходные — сегодня", () => {
    let wednesday = new Date(2026, 9, 21, 9, 0);
    expect(flagDaysForChoice("this-week", wednesday)).toEqual({ startDay: "2026-10-21", dueDay: "2026-10-23" });
    expect(flagDaysForChoice("this-week", friday)).toEqual({ startDay: "2026-10-23", dueDay: "2026-10-23" });
    let sunday = new Date(2026, 9, 25, 9, 0);
    expect(flagDaysForChoice("this-week", sunday)).toEqual({ startDay: "2026-10-25", dueDay: "2026-10-25" });
  });

  test("на следующей неделе — с понедельника по пятницу, и из воскресенья тоже", () => {
    expect(flagDaysForChoice("next-week", friday)).toEqual({ startDay: "2026-10-26", dueDay: "2026-10-30" });
    let sunday = new Date(2026, 9, 25, 9, 0);
    expect(flagDaysForChoice("next-week", sunday)).toEqual({ startDay: "2026-10-26", dueDay: "2026-10-30" });
  });

  test("свой срок и без срока", () => {
    expect(flagDaysForChoice({ dueDay: "2026-11-05" }, friday)).toEqual({ startDay: "2026-10-23", dueDay: "2026-11-05" });
    expect(flagDaysForChoice({ dueDay: "2026-10-01" }, friday)).toEqual({ startDay: "2026-10-01", dueDay: "2026-10-01" });
    expect(flagDaysForChoice("no-date", friday)).toEqual({ startDay: null, dueDay: null });
  });

  test("группы списка задач", () => {
    expect(taskDueGroup("2026-10-22", friday)).toBe("overdue");
    expect(taskDueGroup("2026-10-23", friday)).toBe("today");
    expect(taskDueGroup("2026-10-24", friday)).toBe("tomorrow");
    expect(taskDueGroup("2026-12-01", friday)).toBe("later");
    expect(taskDueGroup(null, friday)).toBe("no-date");
    expect(localDay(friday)).toBe("2026-10-23");
  });

  test("проверка ввода задачи", () => {
    expect(validateTaskInput({ ...kInput, subject: "  " })).toBe("subject");
    expect(validateTaskInput({ ...kInput, startDay: "2026-11-01" })).toBe("dates");
    expect(validateTaskInput(kInput)).toBeNull();
  });
});

describe("EWS: запросы задач", () => {
  test("FindItem в папке tasks, по страницам", () => {
    let doc = requestXML(ewsFindTasksRequest(200));
    let find = tag(doc, "m:FindItem");
    expect(find.getAttribute("Traversal")).toBe("Shallow");
    expect(tag(doc, "t:DistinguishedFolderId").getAttribute("Id")).toBe("tasks");
    let view = tag(doc, "m:IndexedPageItemView");
    expect(view.getAttribute("Offset")).toBe("200");
    expect(view.getAttribute("MaxEntriesReturned")).toBe("200");
  });

  test("GetItem: поля задачи и текст заметок", () => {
    let doc = requestXML(ewsGetTasksRequest(["a", "b"]));
    expect(tag(doc, "t:BodyType").textContent).toBe("Text");
    let fields = [...doc.getElementsByTagName("t:FieldURI")].map(field => field.getAttribute("FieldURI"));
    expect(fields).toEqual(expect.arrayContaining(["item:Subject", "item:Body", "task:DueDate", "task:StartDate", "task:Status", "task:CompleteDate", "item:Importance"]));
    expect([...doc.getElementsByTagName("t:ItemId")].map(id => id.getAttribute("Id"))).toEqual(["a", "b"]);
  });

  test("CreateItem: папка tasks, поля в порядке схемы, день — полночь UTC", () => {
    let doc = requestXML(ewsCreateTaskRequest(kInput));
    expect(tag(tag(doc, "m:SavedItemFolderId"), "t:DistinguishedFolderId").getAttribute("Id")).toBe("tasks");
    let task = tag(doc, "t:Task");
    expect([...task.children].map(child => child.tagName))
      .toEqual(["t:Subject", "t:Body", "t:Importance", "t:DueDate", "t:StartDate", "t:Status"]);
    expect(tag(task, "t:Subject").textContent).toBe("Подготовить отчёт");
    expect(tag(task, "t:Body").getAttribute("BodyType")).toBe("Text");
    expect(tag(task, "t:Body").textContent).toBe("Цифры за квартал");
    expect(tag(task, "t:DueDate").textContent).toBe("2026-10-30T00:00:00Z");
    expect(tag(task, "t:StartDate").textContent).toBe("2026-10-23T00:00:00Z");
    expect(tag(task, "t:Status").textContent).toBe("NotStarted");
  });

  test("CreateItem без сроков: полей дат нет", () => {
    let doc = requestXML(ewsCreateTaskRequest({ ...kInput, startDay: null, dueDay: null }));
    expect(tag(doc, "t:DueDate")).toBeUndefined();
    expect(tag(doc, "t:StartDate")).toBeUndefined();
  });

  test("UpdateItem: снятый срок — DeleteItemField, остальное — SetItemField", () => {
    let doc = requestXML(ewsUpdateTaskRequest("id1", { ...kInput, dueDay: null }));
    expect(tag(doc, "t:ItemId").getAttribute("Id")).toBe("id1");
    let deleted = [...doc.getElementsByTagName("t:DeleteItemField")].map(field => tag(field, "t:FieldURI").getAttribute("FieldURI"));
    expect(deleted).toEqual(["task:DueDate"]);
    let set = [...doc.getElementsByTagName("t:SetItemField")].map(field => tag(field, "t:FieldURI").getAttribute("FieldURI"));
    expect(set).toEqual(["item:Subject", "item:Body", "item:Importance", "task:StartDate"]);
    expect(tag(doc, "m:UpdateItem").getAttribute("ConflictResolution")).toBe("AlwaysOverwrite");
  });

  test("выполнено / снова в работе — через Status", () => {
    let done = requestXML(ewsCompleteTaskRequest("id1", true));
    expect(tag(tag(done, "t:SetItemField"), "t:Status").textContent).toBe("Completed");
    let undone = requestXML(ewsCompleteTaskRequest("id1", false));
    expect(tag(tag(undone, "t:SetItemField"), "t:Status").textContent).toBe("NotStarted");
  });

  test("DeleteItem: в «Удалённые», AffectedTaskOccurrences обязателен", () => {
    let doc = requestXML(ewsDeleteTaskRequest("id1"));
    let request = tag(doc, "m:DeleteItem");
    expect(request.getAttribute("DeleteType")).toBe("MoveToDeletedItems");
    expect(request.getAttribute("AffectedTaskOccurrences")).toBe("AllOccurrences");
  });
});

describe("EWS: ответы задач", () => {
  test("FindItem: ID и следующая страница", () => {
    let response = ewsResponse(`<m:FindItemResponse ${kNS}><m:ResponseMessages>
      <m:FindItemResponseMessage ResponseClass="Success"><m:ResponseCode>NoError</m:ResponseCode>
        <m:RootFolder IndexedPagingOffset="2" TotalItemsInView="3" IncludesLastItemInRange="false">
          <t:Items><t:Task><t:ItemId Id="a"/></t:Task><t:Task><t:ItemId Id="b"/></t:Task></t:Items>
        </m:RootFolder>
      </m:FindItemResponseMessage></m:ResponseMessages></m:FindItemResponse>`);
    expect(parseEWSFindTasks(response)).toEqual({ ids: ["a", "b"], nextOffset: 2 });
  });

  test("FindItem: пустая папка", () => {
    let response = ewsResponse(`<m:FindItemResponse ${kNS}><m:ResponseMessages>
      <m:FindItemResponseMessage ResponseClass="Success"><m:ResponseCode>NoError</m:ResponseCode>
        <m:RootFolder IndexedPagingOffset="0" TotalItemsInView="0" IncludesLastItemInRange="true"><t:Items/></m:RootFolder>
      </m:FindItemResponseMessage></m:ResponseMessages></m:FindItemResponse>`);
    expect(parseEWSFindTasks(response)).toEqual({ ids: [], nextOffset: null });
  });

  test("GetItem: несколько задач, выполненная и с ошибкой", () => {
    let response = ewsResponse(`<m:GetItemResponse ${kNS}><m:ResponseMessages>
      <m:GetItemResponseMessage ResponseClass="Success"><m:ResponseCode>NoError</m:ResponseCode><m:Items>
        ${ewsTaskXML("a", "<t:DueDate>2026-10-30T00:00:00Z</t:DueDate><t:StartDate>2026-10-23T00:00:00Z</t:StartDate><t:Status>NotStarted</t:Status>")}
      </m:Items></m:GetItemResponseMessage>
      <m:GetItemResponseMessage ResponseClass="Success"><m:ResponseCode>NoError</m:ResponseCode><m:Items>
        ${ewsTaskXML("b", "<t:CompleteDate>2026-10-21T08:30:00Z</t:CompleteDate><t:Status>Completed</t:Status>")}
      </m:Items></m:GetItemResponseMessage>
      <m:GetItemResponseMessage ResponseClass="Error"><m:MessageText>Нет</m:MessageText><m:ResponseCode>ErrorItemNotFound</m:ResponseCode></m:GetItemResponseMessage>
    </m:ResponseMessages></m:GetItemResponse>`);
    let tasks = parseEWSGetTasks(response);
    expect(tasks.map(task => task.itemID)).toEqual(["a", "b"]);
    expect(tasks[0]).toMatchObject({
      changeKey: "ck-a", subject: "Задача a", notes: "Заметка a", importance: "High",
      startDay: "2026-10-23", dueDay: "2026-10-30", status: "NotStarted", completedAt: null,
    });
    expect(tasks[1].status).toBe("Completed");
    expect(tasks[1].completedAt?.toISOString()).toBe("2026-10-21T08:30:00.000Z");
    expect(tasks[1].dueDay).toBeNull();
  });

  test("CreateItem: ID новой задачи", () => {
    let response = ewsResponse(`<m:CreateItemResponse ${kNS}><m:ResponseMessages>
      <m:CreateItemResponseMessage ResponseClass="Success"><m:ResponseCode>NoError</m:ResponseCode>
        <m:Items><t:Task><t:ItemId Id="new1" ChangeKey="ck"/></t:Task></m:Items>
      </m:CreateItemResponseMessage></m:ResponseMessages></m:CreateItemResponse>`);
    expect(parseEWSCreatedTaskID(response)).toBe("new1");
  });
});

describe("EWS: флажок письма", () => {
  function flagOf(doc: Document): Element {
    return tag(tag(doc, "t:SetItemField"), "t:Flag");
  }

  test("со сроком: статус, начало и срок в порядке схемы", () => {
    let doc = requestXML(ewsSetMailFlagRequest("m1", { flagged: true, startDay: "2026-10-23", dueDay: "2026-10-26", completedAt: null }));
    expect(tag(tag(doc, "t:SetItemField"), "t:FieldURI").getAttribute("FieldURI")).toBe("item:Flag");
    let flag = flagOf(doc);
    expect([...flag.children].map(child => child.tagName)).toEqual(["t:FlagStatus", "t:StartDate", "t:DueDate"]);
    expect(tag(flag, "t:FlagStatus").textContent).toBe("Flagged");
    expect(tag(flag, "t:DueDate").textContent).toBe("2026-10-26T00:00:00Z");
    expect(tag(doc, "m:UpdateItem").getAttribute("MessageDisposition")).toBe("SaveOnly");
  });

  test("срок без начала: начало = срок (EWS требует оба)", () => {
    let flag = flagOf(requestXML(ewsSetMailFlagRequest("m1", { flagged: true, startDay: null, dueDay: "2026-10-26", completedAt: null })));
    expect(tag(flag, "t:StartDate").textContent).toBe("2026-10-26T00:00:00Z");
  });

  test("без срока, выполнен, снят", () => {
    let plain = flagOf(requestXML(ewsSetMailFlagRequest("m1", { flagged: true, startDay: null, dueDay: null, completedAt: null })));
    expect([...plain.children].map(child => child.tagName)).toEqual(["t:FlagStatus"]);
    let completedAt = new Date("2026-10-23T10:00:00Z");
    let done = flagOf(requestXML(ewsSetMailFlagRequest("m1", { flagged: false, startDay: null, dueDay: null, completedAt })));
    expect(tag(done, "t:FlagStatus").textContent).toBe("Complete");
    expect(tag(done, "t:CompleteDate").textContent).toBe("2026-10-23T10:00:00.000Z");
    let cleared = flagOf(requestXML(ewsSetMailFlagRequest("m1", { flagged: false, startDay: null, dueDay: null, completedAt: null })));
    expect(tag(cleared, "t:FlagStatus").textContent).toBe("NotFlagged");
  });

  test("разбор флажка с сервера", () => {
    expect(parseExchangeFlag({ FlagStatus: "Flagged", StartDate: "2026-10-23T00:00:00Z", DueDate: "2026-10-26T00:00:00Z" }))
      .toEqual({ flagged: true, startDay: "2026-10-23", dueDay: "2026-10-26", completedAt: null });
    expect(parseExchangeFlag({ FlagStatus: "Complete", CompleteDate: "2026-10-23T10:00:00Z" }).completedAt?.toISOString())
      .toBe("2026-10-23T10:00:00.000Z");
    expect(parseExchangeFlag({ FlagStatus: "NotFlagged" })).toEqual({ flagged: false, startDay: null, dueDay: null, completedAt: null });
    expect(parseExchangeFlag(undefined)).toEqual({ flagged: false, startDay: null, dueDay: null, completedAt: null });
  });
});

describe("OWA: запросы и ответы", () => {
  test("FindItem и GetItem", () => {
    let find = owaFindTasksRequest(0);
    expect(find.action).toBe("FindItem");
    expect(find.Body.ParentFolderIds[0]).toEqual({ __type: "DistinguishedFolderId:#Exchange", Id: "tasks" });
    let get = owaGetTasksRequest(["a"]);
    expect(get.action).toBe("GetItem");
    expect(get.Body.ItemShape.BodyType).toBe("Text");
    expect(get.Body.ItemIds).toEqual([{ __type: "ItemId:#Exchange", Id: "a" }]);
  });

  test("CreateItem: Task, день без пояса", () => {
    let request = owaCreateTaskRequest(kInput);
    expect(request.action).toBe("CreateItem");
    expect(request.Body.SavedItemFolderId.BaseFolderId).toEqual({ __type: "DistinguishedFolderId:#Exchange", Id: "tasks" });
    expect(request.Body.Items[0]).toMatchObject({
      __type: "Task:#Exchange",
      Subject: "Подготовить отчёт",
      Body: { __type: "BodyContentType:#Exchange", BodyType: "Text", Value: "Цифры за квартал" },
      Importance: "High",
      DueDate: "2026-10-30T00:00:00",
      StartDate: "2026-10-23T00:00:00",
      Status: "NotStarted",
    });
  });

  test("UpdateItem, выполнено, удаление", () => {
    let update = owaUpdateTaskRequest("id1", { ...kInput, startDay: null });
    let updates = update.Body.ItemChanges[0].Updates;
    expect(updates.find(item => item.Path.FieldURI == "task:StartDate").__type).toBe("DeleteItemField:#Exchange");
    expect(updates.find(item => item.Path.FieldURI == "task:DueDate").Item).toEqual({ __type: "Task:#Exchange", DueDate: "2026-10-30T00:00:00" });
    let done = owaCompleteTaskRequest("id1", true);
    expect(done.Body.ItemChanges[0].Updates[0].Item.Status).toBe("Completed");
    let remove = owaDeleteTaskRequest("id1");
    expect(remove.Body.AffectedTaskOccurrences).toBe("AllOccurrences");
    expect(remove.Body.ItemIds).toEqual([{ __type: "ItemId:#Exchange", Id: "id1" }]);
  });

  test("флажок письма", () => {
    let request = owaSetMailFlagRequest("m1", { flagged: true, startDay: "2026-10-23", dueDay: "2026-10-26", completedAt: null });
    expect(request.Body.ItemChanges[0].Updates[0].Item.Flag).toEqual({
      __type: "FlagType:#Exchange", FlagStatus: "Flagged", StartDate: "2026-10-23T00:00:00", DueDate: "2026-10-26T00:00:00",
    });
    expect(request.Body.MessageDisposition).toBe("SaveOnly");
  });

  test("разбор FindItem, GetItem (одна и несколько), CreateItem", () => {
    expect(parseOWAFindTasks({ RootFolder: { IncludesLastItemInRange: false, IndexedPagingOffset: 1, Items: [{ __type: "Task:#Exchange", ItemId: { Id: "a" } }] } }))
      .toEqual({ ids: ["a"], nextOffset: 1 });
    expect(parseOWAFindTasks({ RootFolder: { IncludesLastItemInRange: true, Items: [] } })).toEqual({ ids: [], nextOffset: null });
    let item = {
      __type: "Task:#Exchange", ItemId: { Id: "a", ChangeKey: "ck" }, Subject: "Звонок",
      Body: { BodyType: "Text", Value: "Позвонить" }, DueDate: "2026-10-30T00:00:00+03:00", Status: "InProgress", Importance: "Low",
    };
    let single = parseOWAGetTasks({ ResponseClass: "Success", Items: [item] });
    expect(single[0]).toMatchObject({ itemID: "a", subject: "Звонок", notes: "Позвонить", dueDay: "2026-10-30", status: "InProgress", importance: "Low" });
    let many = parseOWAGetTasks({ ResponseMessages: { Items: [
      { ResponseClass: "Success", Items: [item] },
      { ResponseClass: "Error", MessageText: "нет" },
      { ResponseClass: "Success", Items: [{ ...item, ItemId: { Id: "b" } }] },
    ] } });
    expect(many.map(task => task.itemID)).toEqual(["a", "b"]);
    expect(parseOWACreatedTaskID({ Items: [{ ItemId: { Id: "new1" } }] })).toBe("new1");
  });
});

describe("синхронизация", () => {
  test("FindItem по страницам, затем GetItem пачками; EWS и OWA одинаково", async () => {
    for (let make of [ewsTaskProtocol, owaTaskProtocol]) {
      let calls: string[] = [];
      let pages = [{ ids: ["a", "b"], nextOffset: 2 }, { ids: ["c"], nextOffset: null }];
      let protocol = make(async () => ({}));
      protocol.call = async (request: any) => {
        if (request === "find") {
          return pages.shift();
        }
        calls.push(request.join(","));
        return request.map((itemID: string) => ({ itemID }));
      };
      protocol.findRequest = () => "find";
      protocol.parseFind = result => result;
      protocol.getRequest = ids => ids;
      protocol.parseGet = result => result;
      let tasks = await fetchTasks(protocol);
      expect(tasks.map(task => task.itemID)).toEqual(["a", "b", "c"]);
      expect(calls).toEqual(["a,b,c"]);
    }
  });
});
