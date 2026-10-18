import "../../../../logic/app";
import { EWSAccount } from "../../../../logic/Mail/EWS/EWSAccount";
import { EWSFolder } from "../../../../logic/Mail/EWS/EWSFolder";
import { ArrayColl } from "svelte-collections";
import { expect, test } from "vitest";

function fakeAccount(): EWSAccount {
  let account = new EWSAccount();
  account.storage = {
    readFolderHierarchy: async () => void 0,
    saveFolder: async () => void 0,
    deleteFolder: async () => void 0,
    deleteMessage: async () => void 0,
  } as any;
  return account;
}

test("loads the Exchange Online Archive through EWS", async () => {
  let account = fakeAccount();
  account.name = "Nikita Galkin SDS";
  let requests: any[] = [];
  (account as any).callEWS = async (request: any) => {
    requests.push(request);
    return {
      RootFolder: {
        ParentFolder: {
          FolderId: { Id: "archive-root" },
          DisplayName: "In-Place Archive — Nikita Galkin SDS",
        },
        Folders: {
          Folder: [{
            FolderClass: "IPF.Note",
            FolderId: { Id: "archive-inbox" },
            ParentFolderId: { Id: "archive-root" },
            DistinguishedFolderId: "archiveinbox",
            DisplayName: "Inbox",
            TotalCount: 5,
            UnreadCount: 2,
          }],
        },
      },
    };
  };

  await (account as any).listArchiveMailbox();

  expect(requests[0].m$FindFolder.m$ParentFolderIds.t$DistinguishedFolderId.Id)
    .toBe("archivemsgfolderroot");
  expect(account.archiveMailboxRoot?.id).toBe("archive-root");
  expect(account.archiveMailboxRoot?.subFolders.first.name).toBe("Inbox");
  expect(account.archiveMailboxRoot?.subFolders.first.countUnread).toBe(2);
  expect(account.rootFolders.length).toBe(0);
});

test("moves primary mailbox messages to the Exchange Online Archive", async () => {
  let account = fakeAccount();
  account.archiveMailboxRoot = new EWSFolder(account);

  let source = new EWSFolder(account);
  source.id = "primary-inbox";
  source.countTotal = 1;
  source.countUnread = 1;
  let message = source.newEMail();
  message.itemID = "message-1";
  message.isRead = false;
  source.messages.add(message);

  let requests: any[] = [];
  (account as any).callEWS = async (request: any) => {
    requests.push(request);
    return {};
  };

  await source.moveMessagesToArchiveMailbox(new ArrayColl([message]));

  expect(requests[0].m$ArchiveItem.m$ArchiveSourceFolderId.t$FolderId.Id).toBe("primary-inbox");
  expect(requests[0].m$ArchiveItem.m$ItemIds.t$ItemId[0].Id).toBe("message-1");
  expect(source.messages.length).toBe(0);
  expect(source.countTotal).toBe(0);
  expect(source.countUnread).toBe(0);
  expect(message.isDeleted).toBe(true);
});

test("запрашивает сетевой архив общего ящика через его адрес", async () => {
  let account = fakeAccount();
  account.username = "integrators@example.com";
  (account as any).sharedFolderRoot = "msgfolderroot";
  let requests: any[] = [];
  (account as any).callEWS = async (request: any) => {
    requests.push(request);
    return {
      RootFolder: {
        ParentFolder: { FolderId: { Id: "integrators-archive-root" } },
        Folders: { Folder: [] },
      },
    };
  };

  await (account as any).listArchiveMailbox();

  let parent = requests[0].m$FindFolder.m$ParentFolderIds.t$DistinguishedFolderId;
  expect(parent.Id).toBe("archivemsgfolderroot");
  expect(parent.t$Mailbox.t$EmailAddress).toBe("integrators@example.com");
  expect(account.archiveMailboxRoot?.id).toBe("integrators-archive-root");
});
