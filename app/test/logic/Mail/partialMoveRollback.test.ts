import "../../../logic/app";
import { appGlobal } from "../../../logic/app";
import { OWAAccount } from "../../../logic/Mail/OWA/OWAAccount";
import { ArrayColl } from "svelte-collections";
import { expect, test } from "vitest";

function makeAccount(id: string) {
  let account = new OWAAccount();
  account.storage = {
    readFolderHierarchy: async () => void 0,
    saveFolder: async () => void 0,
    deleteFolder: async () => void 0,
  } as any;
  let folder = account.newFolder();
  folder.id = id;
  return { account, folder };
}

test("cross-account move failing midway returns only untransferred messages to the source", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let { folder: source } = makeAccount("source");
  let { folder: target } = makeAccount("target");
  let messages = new ArrayColl([source.newEMail(), source.newEMail(), source.newEMail()]);
  messages.contents.forEach((message, index) => {
    message.itemID = `message-${index + 1}`;
    message.pID = index + 1;
    (message as any).loadMIME = async () => void 0;
    (message as any).deleteMessage = async () => void 0;
  });
  source.messages.addAll(messages);

  let uploaded = 0;
  (target as any).cloneForUpload = async (message: any) => message;
  (target as any).addMessage = async () => {
    if (++uploaded == 2) {
      throw new Error("upload failed");
    }
  };
  let released: Array<[number, boolean]> = [];
  source.releaseDeletion = (id: number, confirmed: boolean) => {
    released.push([id, confirmed]);
  };

  await expect((target as any).moveOrCopyMessagesHere("move", messages, false))
    .rejects.toThrow("upload failed");

  // Первое письмо уже лежит в целевом ящике и удалено в источнике.
  expect(source.messages.contents).toEqual([messages.get(1), messages.get(2)]);
  expect(released).toEqual([[1, true], [2, false], [3, false]]);
});
