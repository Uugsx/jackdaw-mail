import { OWARequest } from "./OWARequest";
import type { OWAEMail } from "../OWAEMail";
import type { ExchangePermission } from "../../EWS/ExchangePermission";
import { EMailFlagTimePidTag, IconIndexPidTag } from "../../EWS/ExchangeEMail";

/** Shared AdditionalProperties for FindItem / SyncFolderItems / search.
 * Keep this shape minimal — ExtendedPropertyUri (IconIndex) broke FindItem
 * on some on-prem / shared OWA endpoints. */
function owaMessageListProperties(): object[] {
  return [{
    __type: "PropertyUri:#Exchange",
    FieldURI: "message:IsRead",
  }, {
    __type: "PropertyUri:#Exchange",
    FieldURI: "item:IsDraft",
  }, {
    __type: "PropertyUri:#Exchange",
    FieldURI: "item:DateTimeReceived",
  }, {
    __type: "PropertyUri:#Exchange",
    FieldURI: "item:DateTimeSent",
  }, {
    __type: "PropertyUri:#Exchange",
    FieldURI: "item:Categories",
  }, {
    __type: "PropertyUri:#Exchange",
    FieldURI: "item:Flag",
  }, {
    __type: "PropertyUri:#Exchange",
    FieldURI: "item:Importance",
  }, {
    __type: "PropertyUri:#Exchange",
    FieldURI: "item:HasAttachments",
  }];
}

export function owaFindMsgsInFolderRequest(folderID: string, maxFetchCount: number, recentOnly = false, fromEnd = false): OWARequest {
  let body: Record<string, unknown> = {
    __type: "FindItemRequest:#Exchange",
    ItemShape: {
      __type: "ItemResponseShape:#Exchange",
      BaseShape: "IdOnly",
      AdditionalProperties: owaMessageListProperties(),
    },
    ParentFolderIds: [{
      __type: "FolderId:#Exchange",
      Id: folderID,
    }],
    Traversal: "Shallow",
    Paging: {
      __type: "IndexedPageView:#Exchange",
      // Shared folders on some Exchange builds ignore SortOrder; page from End
      // so "recent" sync returns newest messages instead of oldest.
      BasePoint: fromEnd ? "End" : "Beginning",
      Offset: 0,
      MaxEntriesReturned: maxFetchCount,
    },
  };
  if (recentOnly && !fromEnd) {
    // Correct Exchange FieldURI with "item:" prefix so Exchange applies sort order
    // for both primary and shared mailboxes, returning the newest messages.
    body.SortOrder = [{
      __type: "SortResults:#Exchange",
      Order: "Descending",
      Path: {
        __type: "PropertyUri:#Exchange",
        FieldURI: "item:DateTimeReceived",
      },
    }];
  }
  return new OWARequest("FindItem", body);
}

/** AQS / QueryString search within a folder (server-side). */
export function owaFindMsgsByQueryRequest(folderID: string, queryString: string, maxFetchCount: number): OWARequest {
  return new OWARequest("FindItem", {
    __type: "FindItemRequest:#Exchange",
    ItemShape: {
      __type: "ItemResponseShape:#Exchange",
      BaseShape: "IdOnly",
      AdditionalProperties: owaMessageListProperties(),
    },
    ParentFolderIds: [{
      __type: "FolderId:#Exchange",
      Id: folderID,
    }],
    Traversal: "Shallow",
    QueryString: queryString,
    Paging: {
      __type: "IndexedPageView:#Exchange",
      BasePoint: "Beginning",
      Offset: 0,
      MaxEntriesReturned: maxFetchCount,
    },
    SortOrder: [{
      __type: "SortResults:#Exchange",
      Order: "Descending",
      Path: {
        __type: "PropertyUri:#Exchange",
        FieldURI: "item:DateTimeReceived",
      },
    }],
  });
}

/** EWS-style delta sync over the OWA JSON bridge. */
export function owaSyncFolderItemsRequest(folderID: string, syncState: string | null, maxChanges: number): OWARequest {
  return new OWARequest("SyncFolderItems", {
    __type: "SyncFolderItemsRequest:#Exchange",
    ItemShape: {
      __type: "ItemResponseShape:#Exchange",
      BaseShape: "IdOnly",
      AdditionalProperties: owaMessageListProperties(),
    },
    SyncFolderId: {
      __type: "TargetFolderId:#Exchange",
      BaseFolderId: {
        __type: "FolderId:#Exchange",
        Id: folderID,
      },
    },
    SyncState: syncState,
    MaxChangesReturned: maxChanges,
  });
}

export function owaGetNewMsgHeadersRequest(newMessageIDs: string[]): OWARequest {
  return new OWARequest("GetItem", {
    __type: "GetItemRequest:#Exchange",
    ItemShape: {
      __type: "ItemResponseShape:#Exchange",
      BaseShape: "IdOnly",
      AdditionalProperties: [{
        __type: "PropertyUri:#Exchange",
        FieldURI: "message:InternetMessageId",
      }, {
        __type: "PropertyUri:#Exchange",
        FieldURI: "message:IsRead",
      }, {
        __type: "PropertyUri:#Exchange",
        FieldURI: "message:References",
      }, {
        __type: "PropertyUri:#Exchange",
        FieldURI: "message:ReplyTo",
      }, {
        __type: "PropertyUri:#Exchange",
        FieldURI: "message:From",
      }, {
        __type: "PropertyUri:#Exchange",
        FieldURI: "message:Sender",
      }, {
        __type: "PropertyUri:#Exchange",
        FieldURI: "message:ToRecipients",
      }, {
        __type: "PropertyUri:#Exchange",
        FieldURI: "message:CcRecipients",
      }, {
        __type: "PropertyUri:#Exchange",
        FieldURI: "message:BccRecipients",
      }, {
        __type: "PropertyUri:#Exchange",
        FieldURI: "item:ItemClass",
      }, {
        __type: "PropertyUri:#Exchange",
        FieldURI: "item:HasAttachments",
      }, {
        __type: "PropertyUri:#Exchange",
        FieldURI: "item:Subject",
      }, {
        __type: "PropertyUri:#Exchange",
        FieldURI: "item:DateTimeReceived",
      }, {
        __type: "PropertyUri:#Exchange",
        FieldURI: "item:InReplyTo",
      }, {
        __type: "PropertyUri:#Exchange",
        FieldURI: "item:IsDraft",
      }, {
        __type: "PropertyUri:#Exchange",
        FieldURI: "item:DateTimeSent",
        /* Non-MIME
        }, {
          __type: "PropertyUri:#Exchange",
          FieldURI: "item:Body",
        */
      }, {
        __type: "PropertyUri:#Exchange",
        FieldURI: "item:Categories",
      }, {
        __type: "PropertyUri:#Exchange",
        FieldURI: "item:Flag",
      }, {
        __type: "PropertyUri:#Exchange",
        FieldURI: "item:Importance",
      }, {
        __type: "ExtendedPropertyUri:#Exchange",
        PropertyTag: IconIndexPidTag,
        PropertyType: "Integer",
      }],
    },
    ItemIds: newMessageIDs.map(id => ({
      __type: "ItemId:#Exchange",
      Id: id,
    })),
  });
}

/**
 * Загружает категории и метаданные ответа/пересылки для сообщений из кеша.
 * FindItem на общих ящиках часто возвращает пустую оболочку Categories;
 * GetItem здесь — авторитетный источник, как для новых писем.
 */
export function owaGetMessageActionFlagsRequest(messageIDs: string[], includeActionTime = true): OWARequest {
  let additionalProperties: object[] = [{
    __type: "PropertyUri:#Exchange",
    FieldURI: "item:Categories",
  }, {
    __type: "ExtendedPropertyUri:#Exchange",
    PropertyTag: IconIndexPidTag,
    PropertyType: "Integer",
  }];
  if (includeActionTime) {
    additionalProperties.push({
      __type: "ExtendedPropertyUri:#Exchange",
      PropertyTag: EMailFlagTimePidTag,
      PropertyType: "SystemTime",
    });
  }
  return new OWARequest("GetItem", {
    __type: "GetItemRequest:#Exchange",
    ItemShape: {
      __type: "ItemResponseShape:#Exchange",
      BaseShape: "IdOnly",
      AdditionalProperties: additionalProperties,
    },
    ItemIds: messageIDs.map(id => ({
      __type: "ItemId:#Exchange",
      Id: id,
    })),
  });
}

export function owaDownloadMsgsRequest(messages: OWAEMail[]): OWARequest {
  return new OWARequest("GetItem", {
    __type: "GetItemRequest:#Exchange",
    ItemShape: {
      __type: "ItemResponseShape:#Exchange",
      BaseShape: "IdOnly",
      AdditionalProperties: [{ // Work around Office365 bug
        __type: "PropertyUri:#Exchange",
        FieldURI: "item:Size"
      }],
      IncludeMimeContent: true,
    },
    ItemIds: messages.map(message => ({
      __type: "ItemId:#Exchange",
      Id: message.itemID,
    })),
  });
}

export function owaMoveOrCopyMsgsIntoFolderRequest(
  action: "Move" | "Copy",
  folderID: string,
  messages: OWAEMail[],
  returnNewItemIds = true,
): OWARequest {
  return new OWARequest(action + "Item", {
    __type: action + "ItemRequest:#Exchange",
    ItemIds: messages.map(message => ({
      __type: "ItemId:#Exchange",
      Id: message.itemID,
    })),
    ToFolderId: {
      __type: "TargetFolderId:#Exchange",
      BaseFolderId: {
        __type: "FolderId:#Exchange",
        Id: folderID,
      },
    },
    // Prefer true so we can keep the message in the target folder UI immediately.
    // Some shared/on-prem setups fail with ErrorPropertyRequestFailed — caller falls back.
    ReturnNewItemIds: returnNewItemIds,
  });
}

/** Переместить сообщения из основной папки в соответствующую папку сетевого архива. */
export function owaArchiveMessagesRequest(sourceFolderID: string, messages: OWAEMail[]): OWARequest {
  return new OWARequest("ArchiveItem", {
    __type: "ArchiveItemRequest:#Exchange",
    ArchiveSourceFolderId: {
      __type: "TargetFolderId:#Exchange",
      BaseFolderId: {
        __type: "FolderId:#Exchange",
        Id: sourceFolderID,
      },
    },
    ItemIds: messages.map(message => ({
      __type: "ItemId:#Exchange",
      Id: message.itemID,
    })),
  });
}

export function owaFindFoldersRequest(
  deep: boolean,
  sharedFolderRoot?: string | null,
  username?: string,
  rootFolderID = "msgfolderroot",
): OWARequest {
  return new OWARequest("FindFolder", {
    __type: "FindFolderRequest:#Exchange",
    FolderShape: {
      BaseShape: "Default",
      AdditionalProperties: [{
        __type: "PropertyUri:#Exchange",
          FieldURI: "folder:FolderClass",
      }, {
        __type: "PropertyUri:#Exchange",
          FieldURI: "folder:ParentFolderId",
      }, {
        __type: "PropertyUri:#Exchange",
          FieldURI: "folder:DistinguishedFolderId",
      }, {
        __type: "PropertyUri:#Exchange",
          FieldURI: "folder:UnreadCount",
      }, {
        __type: "PropertyUri:#Exchange",
          FieldURI: "folder:TotalCount",
      }],
    },
    Paging: null,
    ParentFolderIds: [sharedFolderRoot
    ? {
      __type: "DistinguishedFolderId:#Exchange",
      Id: sharedFolderRoot,
      Mailbox: {
        EmailAddress: username,
      },
    }
    : {
      __type: "DistinguishedFolderId:#Exchange",
      Id: rootFolderID,
    }],
    ReturnParentFolder: true,
    Traversal: deep ? "Deep" : "Shallow",
  });
}

export function owaMoveEntireFolderRequest(sourceFolderID: string, newParentFolderId: string): OWARequest {
  return new OWARequest("MoveFolder", {
    __type: "MoveFolderRequest:#Exchange",
    FolderIds: [{
      FolderId: {
        __type: "FolderId:#Exchange",
        Id: sourceFolderID,
      },
    }],
    ToFolderId: {
      __type: "TargetFolderId:#Exchange",
      FolderId: {
        __type: "FolderId:#Exchange",
        Id: newParentFolderId,
      },
    },
  });
}

export function owaCreateNewSubFolderRequest(name: string, parentFolderID: string): OWARequest {
  return new OWARequest("CreateFolder", {
    __type: "CreateFolderRequest:#Exchange",
    ParentFolderId: {
      __type: "TargetFolderId:#Exchange",
      BaseFolderId: {
        __type: "FolderId:#Exchange",
        Id: parentFolderID,
      },
    },
    Folders: [{
      __type: "Folder:#Exchange",
      FolderClass: "IPF.Note",
      DisplayName: name,
    }],
  });
}

export function owaCreateNewTopLevelFolderRequest(name: string, username: string | null): OWARequest {
  return new OWARequest("CreateFolder", {
    __type: "CreateFolderRequest:#Exchange",
    ParentFolderId: {
      __type: "TargetFolderId:#Exchange",
      BaseFolderId: username
      ? {
        __type: "DistinguishedFolderId:#Exchange",
        Id: "msgfolderroot",
        Mailbox: {
          EmailAddress: username,
        },
      }
      : {
        __type: "DistinguishedFolderId:#Exchange",
        Id: "msgfolderroot",
      },
    },
    Folders: [{
      __type: "Folder:#Exchange",
      FolderClass: "IPF.Note",
      DisplayName: name,
    }],
  });
}

export function owaRenameFolderRequest(name: string, folderID: string): OWARequest {
  return new OWARequest("UpdateFolder", {
    __type: "UpdateFolderRequest:#Exchange",
    FolderChanges: [{
      __type: "FolderChange:#Exchange",
      FolderId: {
        __type: "FolderId:#Exchange",
        Id: folderID,
      },
      Updates: [{
        __type: "SetFolderField:#Exchange",
        Folder: {
          __type: "Folder:#Exchange",
          DisplayName: name,
        },
        Path: {
          __type: "PropertyUri:#Exchange",
          FieldURI: "FolderDisplayName",
        },
      }],
    }],
  });
}

export function owaSharedFolderRequest(distinguishedIDs: string[], emailAddress: string): OWARequest {
  return new OWARequest("GetFolder", {
    __type: "GetFolderRequest:#Exchange",
    FolderShape: {
      __type: "FolderResponseShape:#Exchange",
      BaseShape: "Default",
      AdditionalProperties: [{
        __type: "PropertyUri:#Exchange",
        FieldURI: "folder:FolderClass",
      }, {
        __type: "PropertyUri:#Exchange",
        FieldURI: "folder:ParentFolderId",
      }, {
        __type: "PropertyUri:#Exchange",
        FieldURI: "folder:DistinguishedFolderId",
      }],
    },
    FolderIds: distinguishedIDs.map(distinguishedID => ({
      __type: "DistinguishedFolderId:#Exchange",
      Id: distinguishedID,
      Mailbox: {
        EmailAddress: emailAddress,
      },
    })),
  });
}

/** Subtly different to owaSetFolderPermissionsRequst */
export function owaSetCalendarPermissionsRequest(folderID: string, permissions: ExchangePermission[]): OWARequest {
  return new OWARequest("UpdateFolder", {
    __type: "UpdateFolderRequest:#Exchange",
    FolderChanges: [{
      __type: "FolderChange:#Exchange",
      FolderId: {
        __type: "FolderId:#Exchange",
        Id: folderID,
      },
      Updates: [{
        __type: "SetFolderField:#Exchange",
        Folder: {
          __type: "CalendarFolder:#Exchange",
          PermissionSet: {
            CalendarPermissions: permissions.map(permission => permission.toOWACalendarPermission()),
          },
        },
        Path: {
          __type: "PropertyUri:#Exchange",
          FieldURI: "PermissionSet",
        },
      }],
    }],
  });
}

export function owaSetFolderPermissionsRequest(folderID: string, permissions: ExchangePermission[]): OWARequest {
  return new OWARequest("UpdateFolder", {
    __type: "UpdateFolderRequest:#Exchange",
    FolderChanges: [{
      __type: "FolderChange:#Exchange",
      FolderId: {
        __type: "FolderId:#Exchange",
        Id: folderID,
      },
      Updates: [{
        __type: "SetFolderField:#Exchange",
        Folder: {
          __type: "Folder:#Exchange",
          PermissionSet: {
            __type: "PermissionSet:#Exchange",
            Permissions: permissions.map(permission => permission.toOWAFolderPermission()),
          },
        },
        Path: {
          __type: "PropertyUri:#Exchange",
          FieldURI: "PermissionSet",
        },
      }],
    }],
  });
}

/** Also works with calendars, but returns CalendarFolder permissions */
export function owaGetPermissionsRequest(folderID: string): OWARequest {
  return new OWARequest("GetFolder", {
    __type: "GetFolderRequest:#Exchange",
    FolderShape: {
      __type: "FolderResponseShape:#Exchange",
      BaseShape: "IdOnly",
      AdditionalProperties: [{
        __type: "PropertyUri:#Exchange",
        FieldURI: "folder:PermissionSet",
      }],
    },
    FolderIds: [{
      __type: "FolderId:#Exchange",
      Id: folderID,
    }],
  });
}

export function owaFolderCountsRequest(folderID: string): OWARequest {
  return owaFolderCountsBatchRequest([folderID]);
}

/** Один GetFolder для нескольких папок дополнительного ящика. */
export function owaFolderCountsBatchRequest(folderIDs: string[]): OWARequest {
  return new OWARequest("GetFolder", {
    __type: "GetFolderRequest:#Exchange",
    FolderShape: {
      __type: "FolderResponseShape:#Exchange",
      BaseShape: "IdOnly",
      AdditionalProperties: [{
        __type: "PropertyUri:#Exchange",
        FieldURI: "folder:UnreadCount",
      }, {
        __type: "PropertyUri:#Exchange",
        FieldURI: "folder:TotalCount",
      }],
    },
    FolderIds: folderIDs.map(folderID => ({
      __type: "FolderId:#Exchange",
      Id: folderID,
    })),
  });
}

/** Deep FindFolder by FolderId (delegate-safe) — all unread/total badges in one call. */
export function owaFindFolderCountsByRootRequest(rootFolderID: string): OWARequest {
  return new OWARequest("FindFolder", {
    __type: "FindFolderRequest:#Exchange",
    FolderShape: {
      BaseShape: "IdOnly",
      AdditionalProperties: [{
        __type: "PropertyUri:#Exchange",
        FieldURI: "folder:UnreadCount",
      }, {
        __type: "PropertyUri:#Exchange",
        FieldURI: "folder:TotalCount",
      }, {
        __type: "PropertyUri:#Exchange",
        FieldURI: "folder:DisplayName",
      }],
    },
    Paging: null,
    ParentFolderIds: [{
      __type: "FolderId:#Exchange",
      Id: rootFolderID,
    }],
    ReturnParentFolder: true,
    Traversal: "Deep",
  });
}

export function owaDeleteFolderRequest(folderID: string): OWARequest {
  return new OWARequest("DeleteFolder", {
    __type: "DeleteFolderRequest:#Exchange",
    FolderIds: [{
      __type: "FolderId:#Exchange",
      Id: folderID,
    }],
    DeleteType: "SoftDelete",
  });
}

export function owaFolderMarkAllMsgsReadRequest(folderID: string, read = true): OWARequest {
  return new OWARequest("MarkAllItemsAsRead", {
    __type: "MarkAllItemsAsReadRequest:#Exchange",
    ReadFlag: read,
    SuppressReadReceipts: true,
    FolderIds: [{
      __type: "FolderId:#Exchange",
      Id: folderID,
    }],
    ItemIdsToExclude: [],
  });
}
