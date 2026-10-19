import "../../../../logic/app";
import { appGlobal } from "../../../../logic/app";
import { OWAAccount } from "../../../../logic/Mail/OWA/OWAAccount";
import { ArrayColl } from "svelte-collections";
import { owaArchiveMessagesRequest } from "../../../../logic/Mail/OWA/Request/OWAFolderRequests";
import { expect, test } from "vitest";

test("builds an ArchiveItem request for the OWA bridge", () => {
  let request = owaArchiveMessagesRequest("primary-inbox", [
    { itemID: "message-1" },
    { itemID: "message-2" },
  ] as any);

  expect(request.action).toBe("ArchiveItem");
  expect(request.Body.ArchiveSourceFolderId.BaseFolderId.Id).toBe("primary-inbox");
  expect(request.Body.ItemIds.map((item: any) => item.Id)).toEqual(["message-1", "message-2"]);
});

test("reports OWA move progress and repairs stale header completion state", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = {
    readFolderHierarchy: async () => void 0,
    saveFolder: async () => void 0,
    deleteFolder: async () => void 0,
  } as any;

  let source = account.newFolder();
  source.id = "source";
  source.countTotal = 2;
  let target = account.newFolder();
  target.id = "target";
  let messages = new ArrayColl([source.newEMail(), source.newEMail()]);
  messages.contents.forEach((message, index) => {
    message.itemID = `message-${index + 1}`;
    message.downloadComplete = true;
    (message as any).saveMetadataLocally = async () => {
      expect(message.downloadComplete).toBe(false);
    };
  });
  source.messages.addAll(messages);

  (account as any).callOWA = async (request: any) => ({
    ResponseMessages: {
      Items: request.Body.ItemIds.map((item: any) => ({
        ResponseClass: "Success",
        Items: [{ ItemId: { Id: `new-${item.Id}` } }],
      })),
    },
  });
  let progress: number[] = [];

  await (target as any).moveOrCopyMessagesHere(
    "move",
    messages,
    undefined,
    (completed: number) => progress.push(completed),
  );

  // Обе записи уходят одним MoveItem, поэтому прогресс сообщается раз на пачку.
  expect(progress).toEqual([2]);
  expect(source.messages.length).toBe(0);
  expect(target.messages.length).toBe(2);
});
