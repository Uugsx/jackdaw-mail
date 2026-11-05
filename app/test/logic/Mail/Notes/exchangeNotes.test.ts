// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import {
  createNote, deleteNote, ewsCreateNoteRequest, ewsFindNotesRequest, ewsGetNotesRequest, ewsNoteProtocol, ewsUpdateNoteRequest,
  fetchNotes, kNoteItemClass, noteColorFromIndex, noteTitle, owaCreateNoteRequest, parseCreatedNoteID, parseFindNotes,
  parseGetNotes, parseNote, updateNote, type ExchangeNoteProtocol,
} from "../../../../logic/Mail/Notes/ExchangeNotes";
import { describe, expect, test } from "vitest";

function noteItem(id: string, text: string, modified: string, color?: number): any {
  return {
    ItemId: { Id: id, ChangeKey: "ck-" + id },
    ItemClass: kNoteItemClass,
    Subject: noteTitle(text),
    Body: { BodyType: "Text", Value: text },
    LastModifiedTime: modified,
    ExtendedProperty: color == null ? undefined : [{ ExtendedFieldURI: { PropertyId: String(0x8B00) }, Value: String(color) }],
  };
}

describe("Заметки Exchange", () => {
  test("Заголовок — первая непустая строка", () => {
    expect(noteTitle("\n  Купить хлеб \nи молоко")).toBe("Купить хлеб");
    expect(noteTitle("")).toBe("");
    expect(noteTitle("x".repeat(300)).length).toBe(255);
  });

  test("Цвет PidLidNoteColor", () => {
    expect(noteColorFromIndex("0")).toBe("blue");
    expect(noteColorFromIndex(2)).toBe("pink");
    expect(noteColorFromIndex(99)).toBe("yellow");
    expect(noteColorFromIndex("x")).toBe("yellow");
  });

  test("Разбор заметки, чужие классы пропускаются", () => {
    let note = parseNote(noteItem("n1", "Первая\r\nвторая", "2026-10-24T10:00:00Z", 1));
    expect(note).toEqual({
      itemID: "n1", changeKey: "ck-n1", text: "Первая\nвторая", color: "green",
      lastModified: new Date("2026-10-24T10:00:00Z"),
    });
    expect(parseNote({ ...noteItem("m", "x", "2026-10-24T10:00:00Z"), ItemClass: "IPM.Note" })).toBeNull();
    expect(parseNote({ Subject: "без id" })).toBeNull();
    // Пустое тело — берём тему
    expect(parseNote({ ItemId: { Id: "n2" }, Subject: "Тема", Body: { Value: "" } })?.text).toBe("Тема");
  });

  test("Запросы EWS: папка notes, класс, тип тела", () => {
    let find = ewsFindNotesRequest(200);
    expect(find.m$FindItem.m$ParentFolderIds.t$DistinguishedFolderId.Id).toBe("notes");
    expect(find.m$FindItem.m$IndexedPageItemView.Offset).toBe(200);
    let get = ewsGetNotesRequest(["a", "b"]);
    expect(get.m$GetItem.m$ItemIds.t$ItemId).toEqual([{ Id: "a" }, { Id: "b" }]);
    expect(get.m$GetItem.m$ItemShape.t$BodyType).toBe("Text");

    let create = ewsCreateNoteRequest("Идея\nподробности") as any;
    expect(create.m$CreateItem.MessageDisposition).toBe("SaveOnly");
    expect(create.m$CreateItem.m$SavedItemFolderId.t$DistinguishedFolderId.Id).toBe("notes");
    let message = create.m$CreateItem.m$Items.t$Message;
    expect(Object.keys(message)).toEqual(["t$ItemClass", "t$Subject", "t$Body", "t$ExtendedProperty"]);
    expect(message.t$ItemClass).toBe(kNoteItemClass);
    expect(message.t$Subject).toBe("Идея");
    expect(message.t$Body).toEqual({ BodyType: "Text", _TextContent_: "Идея\nподробности" });

    let update = ewsUpdateNoteRequest("n1", "Новый текст") as any;
    let fields = update.m$UpdateItem.m$ItemChanges.t$ItemChange.t$Updates.t$SetItemField;
    expect(fields.map((field: any) => field.t$FieldURI.FieldURI)).toEqual(["item:Subject", "item:Body"]);
  });

  test("Запрос OWA на создание", () => {
    let request = owaCreateNoteRequest("Заметка") as any;
    let json = JSON.stringify(request);
    expect(json).toContain(kNoteItemClass);
    expect(json).toContain('"Id":"notes"');
    expect(json).toContain('"SaveOnly"');
  });

  test("Разбор FindItem, GetItem и CreateItem", () => {
    expect(parseFindNotes({ RootFolder: { Items: { Message: [{ ItemId: { Id: "a" } }, { ItemId: { Id: "b" } }] },
      IncludesLastItemInRange: "false", IndexedPagingOffset: "2" } })).toEqual({ ids: ["a", "b"], nextOffset: 2 });
    expect(parseFindNotes({ RootFolder: { Items: { Message: { ItemId: { Id: "a" } } }, IncludesLastItemInRange: "true" } }))
      .toEqual({ ids: ["a"], nextOffset: null });
    let notes = parseGetNotes([
      { ResponseClass: "Success", Items: { Message: noteItem("old", "Старая", "2026-01-01T00:00:00Z") } },
      { ResponseClass: "Error" },
      { ResponseClass: "Success", Items: { Message: noteItem("new", "Новая", "2026-10-01T00:00:00Z") } },
    ]);
    expect(notes.map(note => note.itemID)).toEqual(["new", "old"]);
    expect(parseCreatedNoteID([{ Items: { Message: { ItemId: { Id: "c1" } } } }])).toBe("c1");
    expect(parseCreatedNoteID({ ResponseMessages: { Items: [{ Items: [{ ItemId: { Id: "c2" } }] }] } })).toBe("c2");
  });

  test("Загрузка по страницам, создание, правка и удаление", async () => {
    let store = new Map<string, any>();
    for (let i = 0; i < 3; i++) {
      store.set("n" + i, noteItem("n" + i, "Заметка " + i, `2026-10-0${i + 1}T00:00:00Z`));
    }
    let calls: string[] = [];
    let call = async (request: any) => {
      if (request.m$FindItem) {
        calls.push("find");
        let offset = request.m$FindItem.m$IndexedPageItemView.Offset;
        let ids = [...store.keys()].slice(offset, offset + 2);
        let last = offset + 2 >= store.size;
        return { RootFolder: { Items: { Message: ids.map(Id => ({ ItemId: { Id } })) },
          IncludesLastItemInRange: String(last), IndexedPagingOffset: String(offset + 2) } };
      }
      if (request.m$GetItem) {
        calls.push("get");
        return request.m$GetItem.m$ItemIds.t$ItemId.map(({ Id }: any) =>
          ({ ResponseClass: "Success", Items: { Message: store.get(Id) } }));
      }
      if (request.m$CreateItem) {
        let message = request.m$CreateItem.m$Items.t$Message;
        store.set("new", noteItem("new", message.t$Body._TextContent_, "2026-10-24T00:00:00Z"));
        return [{ ResponseClass: "Success", Items: { Message: { ItemId: { Id: "new" } } } }];
      }
      if (request.m$UpdateItem) {
        let change = request.m$UpdateItem.m$ItemChanges.t$ItemChange;
        let body = change.t$Updates.t$SetItemField.find((field: any) => field.t$FieldURI.FieldURI == "item:Body");
        store.set(change.t$ItemId.Id, noteItem(change.t$ItemId.Id, body.t$Message.t$Body._TextContent_, "2026-10-25T00:00:00Z"));
        return [{ ResponseClass: "Success" }];
      }
      if (request.m$DeleteItem) {
        store.delete(request.m$DeleteItem.m$ItemIds.t$ItemId.Id);
        return [{ ResponseClass: "Success" }];
      }
      throw new Error("unexpected request");
    };
    let protocol: ExchangeNoteProtocol = ewsNoteProtocol(call);

    let notes = await fetchNotes(protocol);
    expect(notes.map(note => note.itemID)).toEqual(["n2", "n1", "n0"]);
    expect(calls).toEqual(["find", "find", "get"]);

    let created = await createNote(protocol, "Свежая\nмысль");
    expect(created).toMatchObject({ itemID: "new", text: "Свежая\nмысль", color: "yellow" });

    let updated = await updateNote(protocol, created, "Исправлено");
    expect(updated.text).toBe("Исправлено");

    await deleteNote(protocol, updated);
    expect(store.has("new")).toBe(false);
  });
});
