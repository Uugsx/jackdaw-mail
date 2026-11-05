import "../../../../logic/app";
import { appGlobal } from "../../../../logic/app";
import { OWAAccount } from "../../../../logic/Mail/OWA/OWAAccount";
import { OWAError } from "../../../../logic/Mail/OWA/OWAError";
import { expect, test } from "vitest";

function fakeAccount(response: any): OWAAccount {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = {
    readFolderHierarchy: async () => void 0,
    saveFolder: async () => void 0,
    deleteFolder: async () => void 0,
  } as any;
  (account as any).throttle = { throttle: async () => void 0 };
  (account as any).callOWA = async () => response;
  return account;
}

test("reports a controlled OWA error when the folder root has no ID", async () => {
  let account = fakeAccount({ RootFolder: { Folders: [] } });
  let error: unknown;

  try {
    await account.listFolders();
  } catch (ex) {
    error = ex;
  }

  expect(error).toBeInstanceOf(OWAError);
  expect(error).not.toBeInstanceOf(TypeError);
});

test("loads valid folders and skips entries without a folder ID", async () => {
  let account = fakeAccount({
    RootFolder: {
      ParentFolder: { FolderId: { Id: "root" } },
      Folders: [
        { FolderClass: "IPF.Note", DisplayName: "Malformed" },
        {
          FolderClass: "IPF.Note",
          FolderId: { Id: "inbox" },
          ParentFolderId: { Id: "root" },
          DistinguishedFolderId: "inbox",
          DisplayName: "Inbox",
          TotalCount: 2,
          UnreadCount: 1,
        },
      ],
    },
  });

  await account.listFolders();

  expect(account.getAllFolders().length).toBe(1);
  expect(account.inbox?.id).toBe("inbox");
  expect(account.inbox?.countTotal).toBe(2);
  expect(account.inbox?.countUnread).toBe(1);
});

test("keeps the explicitly loaded shared inbox in the hierarchy", async () => {
  let account = fakeAccount({
    RootFolder: {
      ParentFolder: { FolderId: { Id: "shared-root" } },
      Folders: [{
        FolderClass: "IPF.Note",
        FolderId: { Id: "shared-subfolder" },
        ParentFolderId: { Id: "shared-inbox" },
        DisplayName: "Shared subfolder",
      }],
    },
  });
  (account as any).sharedFolderRoot = "inbox";
  let calls = 0;
  (account as any).callOWA = async () => calls++ ? {
    Folders: [{
      FolderClass: "IPF.Note",
      FolderId: { Id: "shared-inbox" },
      ParentFolderId: { Id: "shared-root" },
      DistinguishedFolderId: "inbox",
      DisplayName: "Inbox",
    }],
  } : {
    RootFolder: {
      ParentFolder: { FolderId: { Id: "shared-root" } },
      Folders: [{
        FolderClass: "IPF.Note",
        FolderId: { Id: "shared-subfolder" },
        ParentFolderId: { Id: "shared-inbox" },
        DisplayName: "Shared subfolder",
      }],
    },
  };

  await account.listFolders();

  expect(account.inbox?.id).toBe("shared-inbox");
  expect(account.rootFolders.contents.map(folder => ({ id: folder.id, children: folder.subFolders.contents.map(child => child.id) }))).toEqual([
    { id: "shared-inbox", children: ["shared-subfolder"] },
  ]);
  expect(account.inbox?.subFolders.length).toBe(1);
  expect(account.inbox?.subFolders.first.name).toBe("Shared subfolder");
});

test("loads the Exchange Online Archive as a separate hierarchy", async () => {
  let account = fakeAccount({
    RootFolder: {
      ParentFolder: { FolderId: { Id: "primary-root" } },
      Folders: [{
        FolderClass: "IPF.Note",
        FolderId: { Id: "inbox" },
        ParentFolderId: { Id: "primary-root" },
        DistinguishedFolderId: "inbox",
        DisplayName: "Inbox",
      }],
    },
  });
  account.name = "Nikita Galkin SDS";
  let archiveResponse = {
    RootFolder: {
      ParentFolder: {
        FolderId: { Id: "archive-root" },
        DisplayName: "In-Place Archive — Nikita Galkin SDS",
      },
      Folders: [{
        FolderClass: "IPF.Note",
        FolderId: { Id: "archive-inbox" },
        ParentFolderId: { Id: "archive-root" },
        DistinguishedFolderId: "archiveinbox",
        DisplayName: "Inbox",
        TotalCount: 5,
        UnreadCount: 2,
      }],
    },
  };
  let calls = 0;
  let requests: any[] = [];
  (account as any).callOWA = async (request: any) => {
    requests.push(request);
    return calls++ ? archiveResponse : {
      RootFolder: {
        ParentFolder: { FolderId: { Id: "primary-root" } },
        Folders: [{
          FolderClass: "IPF.Note",
          FolderId: { Id: "inbox" },
          ParentFolderId: { Id: "primary-root" },
          DistinguishedFolderId: "inbox",
          DisplayName: "Inbox",
        }],
      },
    };
  };

  await account.listFolders();

  expect(requests[1].Body.ParentFolderIds[0].Id).toBe("archivemsgfolderroot");
  expect(account.archiveMailboxRoot?.id).toBe("archive-root");
  expect(account.archiveMailboxRoot?.name).toBe("In-Place Archive — Nikita Galkin SDS");
  expect(account.archiveMailboxRoot?.subFolders.first.name).toBe("Inbox");
  expect(account.archiveMailboxRoot?.subFolders.first.countTotal).toBe(5);
  expect(account.getAllFolders().some(folder => folder.id == "archive-inbox")).toBe(true);
  expect(account.rootFolders.some(folder => folder.id == "archive-root")).toBe(false);
});

test("normalizes a stale shared-folder polling offset", async () => {
  let account = fakeAccount({ Folders: [] });
  let folder = account.newFolder();
  folder.id = "folder";
  folder.name = "Shared folder";
  account.rootFolders.add(folder);
  (account as any).pollFolderCountOffset = 1;

  let errors: unknown[] = [];
  account.errorCallback = (error) => errors.push(error);

  await account.refreshAllFolderCounts();

  expect(errors).toEqual([]);
});

test("reuses a folder created by a concurrent hierarchy notification", async () => {
  let account = fakeAccount({ Folders: [{ FolderId: { Id: "folder" } }] });
  account.msgFolderRootID = "root";
  (account as any).callOWA = async () => {
    (account as any).handleHierarchyNotification({
      folderId: "folder",
      parentFolderId: "root",
      displayName: "2",
      unreadCount: 0,
      itemCount: 0,
    });
    return { Folders: [{ FolderId: { Id: "folder" } }] };
  };

  let folder = await account.createToplevelFolder("2");
  let folders = account.rootFolders.filter(candidate => candidate.id == "folder");

  expect(folders.length).toBe(1);
  expect(folders.first).toBe(folder);
  expect(account.folderMap.get("folder")).toBe(folder);
});

function sharedMailboxResponses(requests: any[]) {
  return async (request: any) => {
    requests.push(request);
    let isArchive = request.Body.ParentFolderIds[0].Id == "archivemsgfolderroot";
    return isArchive ? {
      RootFolder: {
        ParentFolder: { FolderId: { Id: "integrators-archive-root" }, DisplayName: "Online Archive — integrators" },
        Folders: [{
          FolderClass: "IPF.Note",
          FolderId: { Id: "integrators-archive-inbox" },
          ParentFolderId: { Id: "integrators-archive-root" },
          DistinguishedFolderId: "archiveinbox",
          DisplayName: "Inbox",
        }],
      },
    } : {
      RootFolder: {
        ParentFolder: { FolderId: { Id: "integrators-root" } },
        Folders: [{
          FolderClass: "IPF.Note",
          FolderId: { Id: "integrators-inbox" },
          ParentFolderId: { Id: "integrators-root" },
          DistinguishedFolderId: "inbox",
          DisplayName: "Inbox",
        }],
      },
    };
  };
}

test("подключает сетевой архив общего ящика с полным доступом", async () => {
  let account = fakeAccount(null);
  account.username = "integrators@example.com";
  (account as any).sharedFolderRoot = "msgfolderroot";
  (account as any)._mainAccount = new OWAAccount();
  let requests: any[] = [];
  (account as any).callOWA = sharedMailboxResponses(requests);

  await account.listFolders();

  let archiveRequest = requests.find(request => request.Body.ParentFolderIds[0].Id == "archivemsgfolderroot");
  expect(archiveRequest?.Body.ParentFolderIds[0].Mailbox.EmailAddress).toBe("integrators@example.com");
  expect(account.archiveMailboxRoot?.id).toBe("integrators-archive-root");
  expect(account.archiveMailboxRoot?.subFolders.first.id).toBe("integrators-archive-inbox");
  expect(account.inbox?.id).toBe("integrators-inbox");
});

test("не запрашивает архив, если доступ выдан только ко «Входящим»", async () => {
  let account = fakeAccount(null);
  account.username = "integrators@example.com";
  (account as any).sharedFolderRoot = "inbox";
  (account as any)._mainAccount = new OWAAccount();
  let requests: any[] = [];
  let respond = sharedMailboxResponses(requests);
  (account as any).callOWA = async (request: any) => request.action == "GetFolder"
    ? { Folders: [] }
    : await respond(request);

  await account.listFolders();

  expect(requests.some(request => request.Body?.ParentFolderIds?.[0]?.Id == "archivemsgfolderroot")).toBe(false);
  expect(account.archiveMailboxRoot).toBeNull();
});

test("архивирование письма общего ящика идёт через Explicit Logon этого ящика", () => {
  expect((OWAAccount as any).needsExplicitLogon({ action: "ArchiveItem" })).toBe(true);
});
