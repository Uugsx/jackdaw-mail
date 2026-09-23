import { ExchangeEMail, type EMailFlag, EMailFlagPidTag, EMailFlagTimePidTag, IconIndex, IconIndexPidTag } from "../EWS/ExchangeEMail";
import type { OWAFolder } from "./OWAFolder";
import { SpecialFolder } from "../Folder";
import { DeleteStrategy } from "../MailAccount";
import { OWAEvent } from "../../Calendar/OWA/OWAEvent";
import { getTagByName } from "../../Abstract/Tag";
import { OWARequest } from "./Request/OWARequest";
import { OWAError } from "./OWAError";
import { OWADeleteItemRequest } from "./Request/OWADeleteItemRequest";
import { OWAUpdateItemRequest } from "./Request/OWAUpdateItemRequest";
import { owaDownloadMsgsRequest } from "./Request/OWAFolderRequests";
import { owaGetEventsRequest } from "../../Calendar/OWA/Request/OWAEventRequests";
import { PersonUID, findOrCreatePersonUID, kDummyPerson } from "../../Abstract/PersonUID";
import { computeEMailContact } from "../EMail";
import { InvitationMessage } from "../../Calendar/Invitation/InvitationStatus";
import { base64ToUint8Array, assert, ensureArray } from "../../util/util";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { gt } from "../../../l10n/l10n";
import type { ArrayColl } from "svelte-collections";

export class OWAEMail extends ExchangeEMail {
  declare folder: OWAFolder;

  /** Устаревшее обновление папки не должно отменять локальную отметку письма. */
  private pendingReadState: boolean | null = null;
  private readStateMutationVersion = 0;
  private readStateServerUpdateSucceeded = false;

  get itemID(): string | null {
    return this.pID as string | null;
  }
  set itemID(val: string | null) {
    assert(val == null || typeof (val) == "string", "OWA EMail itemID must be a string");
    this.pID = val;
  }

  async download() {
    await this.downloadRunOnce.runOnce(async () => {
      let result = await this.folder.account.callOWA(owaDownloadMsgsRequest([ this ]));
      let mimeBase64 = sanitize.nonemptystring(result?.Items?.[0]?.MimeContent?.Value, null);
      if (!mimeBase64) {
        throw new OWAError({ message: gt`This was deleted on the server` });
      }
      this.mime = base64ToUint8Array(mimeBase64);
      await this.parseMIME();
      await this.saveCompleteMessage();
    });
  }

  fromJSON(json: Record<string, any>) {
    this.itemID = sanitize.nonemptystring(json.ItemId?.Id ?? json.ItemId?.id ?? json.ItemId, "");
    this.id = sanitize.nonemptystring(json.InternetMessageId, "");
    this.subject = sanitize.nonemptystring(json.Subject, "");
    // Drafts have no `DateTimeSent`. Defaulting to "now" on every refresh
    // would keep re-stamping them and jumping them to the top of the list.
    this.sent = sanitize.date(json.DateTimeSent, this.sent ?? new Date());
    if (json.DateTimeReceived != null) {
      this.received = sanitize.date(json.DateTimeReceived, this.received ?? this.sent);
    } else if (!this.received) {
      this.received = this.sent;
    }
    this.setFlags(json, "full");
    this.inReplyTo = sanitize.nonemptystring(json.InReplyTo, null);
    this.references = sanitize.nonemptystring(json.References, null)?.split(" ");
    /*if ("ReplyTo" in json) {
      this.replyTo = findOrCreatePersonUID(
        sanitize.emailAddress(json.ReplyTo.Mailbox.EmailAddress, null),
        sanitize.nonemptylabel(json.ReplyTo.Mailbox.Name, null));
    }*/
    // Exchange `From` is PR_SENT_REPRESENTING_*, `Sender` is PR_SENDER_*.
    // There is no `message:SentRepresenting` property; asking for one makes
    // Exchange reject the whole request.
    let displayMailbox = owaMailbox(json.From) ?? owaMailbox(json.Sender);
    if (displayMailbox) {
      this.from = findOrCreatePersonUID(
        sanitize.emailAddress(displayMailbox.EmailAddress, null),
        sanitize.nonemptylabel(displayMailbox.Name, null));
    } else {
      this.from = kDummyPerson;
    }
    this.outgoing = this.folder?.account.isMyEMailAddress(this.from?.emailAddress);
    setPersons(this.to, json.ToRecipients);
    setPersons(this.cc, json.CcRecipients);
    setPersons(this.bcc, json.BccRecipients);
    this.contact = computeEMailContact(this);
    this.invitationMessage = ExchangeScheduling[sanitize.string(json.ItemClass)] || InvitationMessage.None;
    this.applyHasAttachmentsFromJSON(json);
  }

  /** Exchange `HasAttachments` from FindItem / GetItem (no extra round-trip). */
  applyHasAttachmentsFromJSON(json: Record<string, any>): boolean {
    if (!("HasAttachments" in json)) {
      return false;
    }
    let next = sanitize.boolean(propertyValue(json.HasAttachments), false);
    if (this.hasAttachmentsFlag == next) {
      return false;
    }
    this.hasAttachmentsFlag = next;
    return true;
  }

  /**
   * @param source
   *   `full` — GetItem / authoritative fetch with `item:Categories`. An omitted
   *     `Categories` means none; an empty shell means cleared on the server.
   *   `list` — FindItem / SyncFolderItems. An empty Categories shell is treated
   *     as unreliable — keep local tags until GetItem confirms.
   *   `partial` — Row notification snippet without categories, or action-flag
   *     fields only. Omitted categories must not wipe local tags.
   */
  setFlags(json: Record<string, any>, source: "full" | "list" | "partial" = "partial"): boolean {
    let datesChanged = this.applyHeaderDates(json);
    let oldTagNames = this.tags.contents.map(tag => tag.name);
    let serverIsRead = "IsRead" in json ? sanitize.boolean(propertyValue(json.IsRead), this.isRead) : this.isRead;
    if ("IsRead" in json && this.pendingReadState != null &&
        this.readStateServerUpdateSucceeded && serverIsRead == this.pendingReadState) {
      this.pendingReadState = null;
    }
    let isRead = this.pendingReadState ?? serverIsRead;
    let isStarred = "Flag" in json ? propertyValue(json.Flag)?.FlagStatus == "Flagged" : this.isStarred;
    let isDraft = "IsDraft" in json ? sanitize.boolean(propertyValue(json.IsDraft), this.isDraft) : this.isDraft;
    let tagNames: string[];
    if ("Categories" in json) {
      tagNames = owaCategoryNames(json.Categories);
      // FindItem / SyncFolderItems sometimes return an empty Categories shell.
      if (source != "full" && !tagNames.length && oldTagNames.length) {
        tagNames = oldTagNames;
      }
    } else if (source == "full") {
      // Exchange omits empty Categories — treat as cleared so OWA removals sync in.
      tagNames = [];
    } else {
      tagNames = oldTagNames;
    }
    let iconIndex = extendedPropertyValue(json, IconIndexPidTag) ?? propertyValue(json.IconIndex);
    let isReplied = this.isReplied;
    let isForwarded = this.isForwarded;
    let lastVerbAt = this.lastVerbAt;
    if (iconIndex != null) {
      isReplied = Number(iconIndex) == IconIndex.Replied;
      isForwarded = Number(iconIndex) == IconIndex.Forwarded;
      if (isReplied || isForwarded) {
        let rawLastVerbAt = extendedPropertyValue(json, EMailFlagTimePidTag);
        if (rawLastVerbAt != null) {
          lastVerbAt = sanitize.date(rawLastVerbAt as string | number, this.lastVerbAt);
        }
      } else {
        lastVerbAt = null;
      }
    }
    // Not `=`: The sender's `Importance:` header is not in the response
    let isImportant = "Importance" in json ? propertyValue(json.Importance) == "High" : this.isImportant;
    let tagsChanged = oldTagNames.length != tagNames.length ||
      oldTagNames.some((name, i) => name != tagNames[i]) ||
      tagNames.some((name, i) => name != oldTagNames[i]);
    let attachmentsFlagChanged = this.applyHasAttachmentsFromJSON(json);
    let lastVerbAtChanged = this.lastVerbAt?.getTime() != lastVerbAt?.getTime();
    let changed = this.isRead != isRead || this.isReplied != isReplied ||
      this.isForwarded != isForwarded || this.isImportant != isImportant ||
      this.isStarred != isStarred || this.isDraft != isDraft ||
      tagsChanged || datesChanged || attachmentsFlagChanged || lastVerbAtChanged;
    this.isRead = isRead;
    this.isReplied = isReplied;
    this.isForwarded = isForwarded;
    this.lastVerbAt = lastVerbAt;
    this.isImportant = isImportant;
    this.isStarred = isStarred;
    // can't work out how to find junk status
    this.isDraft = isDraft;
    if (tagsChanged) {
      this.tags.replaceAll(tagNames.map(name => getTagByName(name)));
    }
    if (changed) {
      this.notifyObservers();
    }
    return changed;
  }

  /** FindItem / GetItem header fields — keep received vs sent in sync with OWA. */
  applyHeaderDates(json: Record<string, any>): boolean {
    let changed = false;
    if (json.DateTimeSent != null) {
      let sent = sanitize.date(json.DateTimeSent, this.sent);
      if (sent.getTime() != this.sent?.getTime()) {
        this.sent = sent;
        changed = true;
      }
    }
    if (json.DateTimeReceived != null) {
      let received = sanitize.date(json.DateTimeReceived, this.received);
      if (received.getTime() != this.received?.getTime()) {
        this.received = received;
        changed = true;
      }
    }
    return changed;
  }

  async markRead(read = true) {
    let mutationVersion = ++this.readStateMutationVersion;
    this.pendingReadState = read;
    this.readStateServerUpdateSucceeded = false;
    let serverUpdateSucceeded = false;
    try {
      await super.markRead(read);
      await this.saveWritablePropsLocally().catch(() => null);
      await this.withItemIdRetry(() => this.updateIsReadOnServer(read));
      serverUpdateSucceeded = true;
      if (mutationVersion == this.readStateMutationVersion) {
        this.readStateServerUpdateSucceeded = true;
      }
    } finally {
      if (mutationVersion == this.readStateMutationVersion && !serverUpdateSucceeded) {
        this.pendingReadState = null;
        this.readStateServerUpdateSucceeded = false;
      }
    }
  }

  protected async updateIsReadOnServer(read: boolean) {
    let request = new OWAUpdateItemRequest(this.itemID, {
      MessageDisposition: "SaveOnly",
      SendCalendarInvitationsOrCancellations: "SendToNone",
      SuppressReadReceipts: true,
    });
    request.addField("Message", "IsRead", read, "message:IsRead");
    await this.folder.account.callOWA(request);
  }

  async markStarred(starred = true) {
    await super.markStarred(starred);
    await this.saveWritablePropsLocally().catch(() => null);
    await this.withItemIdRetry(() => this.updateFlagOnServer(starred));
  }

  protected async updateFlagOnServer(starred: boolean) {
    let request = new OWAUpdateItemRequest(this.itemID, {
      MessageDisposition: "SaveOnly",
      SendCalendarInvitationsOrCancellations: "SendToNone",
      SuppressReadReceipts: true,
    });
    request.addField("Message", "Flag", {
      __type: "FlagType:#Exchange",
      CompleteDate: null,
      DueDate: null,
      StartDate: null,
      FlagStatus: starred ? "Flagged" : "NotFlagged",
    }, "item:Flag");
    await this.folder.account.callOWA(request);
  }

  async updateTags() {
    await this.storage.saveMessageTags(this).catch(() => null);
    await this.withItemIdRetry(async () => {
      let request = new OWAUpdateItemRequest(this.itemID, {
        MessageDisposition: "SaveOnly",
        SendCalendarInvitationsOrCancellations: "SendToNone",
        SuppressReadReceipts: true,
      });
      // Empty → DeleteItemField; never send [] (Exchange ignores / keeps old).
      let categories = this.tags.hasItems
        ? this.tags.contents.map(tag => tag.name)
        : null;
      request.addField("Message", "Categories", categories, "item:Categories");
      await this.folder.account.callOWA(request);
    });
  }

  /**
   * After Move/Restore the ItemId may still be stale until twin-match finishes.
   * Retry once after forcing an ItemId fix when Exchange says ItemNotFound.
   */
  protected async withItemIdRetry(fn: () => Promise<void>): Promise<void> {
    if (!this.itemID) {
      return;
    }
    try {
      await fn();
    } catch (ex) {
      if (!(ex instanceof OWAError && ex.type == "ErrorItemNotFound")) {
        throw ex;
      }
      await this.folder.ensureMovedItemId(this);
      if (!this.itemID) {
        throw ex;
      }
      await fn();
    }
  }

  /*async markSpam(spam = true) {
    let request = new OWARequest("MarkAsJunk", {
      __type: "MarkAsJunkRequest:#Exchange",
      IsJunk: spam,
      MoveItem: false,
      ItemIds: [{
        __type: "ItemId:#Exchange",
        Id: this.itemID,
      }],
    });
    await this.folder.account.callOWA(request);
    await super.markSpam(spam);
  }*/

  async markSpam(spam = true) {
    if (!this.itemID) {
      await super.markSpam(spam);
      return;
    }
    let request = new OWARequest("MarkAsJunk", {
      __type: "MarkAsJunkRequest:#Exchange",
      IsJunk: spam,
      // treatSpam already moves to Junk; avoid double-move.
      MoveItem: false,
      ItemIds: [{
        __type: "ItemId:#Exchange",
        Id: this.itemID,
      }],
    });
    try {
      await this.folder.account.callOWA(request);
    } catch (ex) {
      // Some on-prem builds lack MarkAsJunk; move-only spam still works.
      if (!(ex instanceof OWAError && (
        ex.type == "ErrorInvalidRequest" ||
        ex.type == "ErrorInvalidOperation" ||
        /MarkAsJunk/i.test(ex.message)))) {
        throw ex;
      }
    }
    await super.markSpam(spam);
  }

  async markImportant(isImportant = true) {
    let request = new OWAUpdateItemRequest(this.itemID, {
      MessageDisposition: "SaveOnly",
      SendCalendarInvitationsOrCancellations: "SendToNone",
      SuppressReadReceipts: true,
    });
    request.addField("Message", "Importance", isImportant ? "High" : "Normal", "item:Importance");
    await this.folder.account.callOWA(request);
    await super.markImportant(isImportant);
  }

  protected async setFlagOnServer(verb: EMailFlag, icon: IconIndex) {
    let request = new OWAUpdateItemRequest(this.itemID, {
      MessageDisposition: "SaveOnly",
      SendCalendarInvitationsOrCancellations: "SendToNone",
      SuppressReadReceipts: true,
    });
    request.addExtendedField("Message", EMailFlagPidTag, "Integer", verb);
    request.addExtendedField("Message", EMailFlagTimePidTag, "SystemTime", new Date().toISOString());
    request.addExtendedField("Message", IconIndexPidTag, "Integer", icon);
    await this.folder.account.callOWA(request);
  }

  /**
   * Exchange has no writable draft flag. `IsDraft` is an `item:` property that
   * the server derives from `PR_MESSAGE_FLAGS`, and a `SetItemField` on it is
   * rejected with `ErrorInvalidPropertySet` - the previous `message:IsDraft`
   * spelling did not even exist and failed the whole `UpdateItem`. The draft
   * state follows from saving to the Drafts folder vs. submitting the message,
   * so we only track it locally.
   */
  async markDraft(isDraft = true) {
    await super.markDraft(isDraft);
  }

  async deleteMessage(strategy = this.folder.account.deleteStrategy) {
    let hardDelete = strategy == DeleteStrategy.DeleteImmediately ||
      [SpecialFolder.Trash, SpecialFolder.Spam].includes(this.folder.specialFolder);
    if (!hardDelete) {
      let trash = this.folder.account.findSpecialFolder(SpecialFolder.Trash) as OWAFolder | null;
      if (trash && trash !== this.folder) {
        // Soft-delete via Move so Trash UI gets the message immediately
        // (same path as drag Trash ↔ Inbox).
        await trash.moveMessageHere(this);
        return;
      }
    }
    await super.deleteMessage(strategy);
  }

  async deleteMessageOnServer(strategy = this.folder.account.deleteStrategy) {
    try {
      this.folder.deletions.add(this.itemID);
      let hardDelete = strategy == DeleteStrategy.DeleteImmediately ||
        [SpecialFolder.Trash, SpecialFolder.Spam].includes(this.folder.specialFolder);
      let request = new OWADeleteItemRequest(this.itemID, {
        DeleteType: hardDelete ? "HardDelete" : "MoveToDeletedItems",
        // Exchange требует этот параметр для элементов календаря. Очистка
        // почты не должна отправлять участникам встречи отмену.
        SendMeetingCancellations: "SendToNone",
        SuppressReadReceipts: true,
      });
      await this.folder.account.callOWA(request);
    } finally {
      this.folder.releaseDeletionAfterGracePeriod(this.itemID);
    }
  }

  /** OWA only provides event data for invitations,
   * but not responses to invitations.
   * Disabled, but keeping the code, in case it will be useful later.
   *
   * `EMail.loadEvent()` works for all iTIP messages.
   * By not overriding `loadEvent()` here, `EMail.loadEvent()` will be called. */
  async loadEvent_disabled() {
    assert(this.invitationMessage == InvitationMessage.Invitation, "This is not an invitation");
    assert(!this.event, "Event has already been loaded");
    let result = await this.folder.account.callOWA(owaGetEventsRequest([ this.itemID ]));
    let event = new OWAEvent();
    event.fromJSON(result.Items[0]);
    this.event = event;
  }
}

function extendedPropertyValue(json: Record<string, any>, propertyTag: string): unknown {
  let properties = ensureArray(json.ExtendedProperty);
  let property = properties.find(item => String(item?.ExtendedFieldURI?.PropertyTag ?? "").toLowerCase() == propertyTag.toLowerCase());
  if (property) {
    return propertyValue(property.Value);
  }
  // Некоторые ответы OWA не содержат ExtendedFieldURI, если запрошено ровно
  // одно дополнительное свойство. Для нескольких свойств fallback не применяем:
  // время действия нельзя ошибочно принять за IconIndex.
  return properties.length == 1 && !properties[0]?.ExtendedFieldURI
    ? propertyValue(properties[0]?.Value)
    : undefined;
}

function propertyValue(value: any): any {
  if (value && typeof value == "object" && "Value" in value) {
    return value.Value;
  }
  return value;
}

/** Categories were explicitly returned and parsed to at least one name. */
export function owaCategoriesPresent(json: Record<string, any> | null | undefined): boolean {
  return owaCategoryNames(json?.Categories ?? json?.categories).length > 0;
}

/** GetItem omitted Categories — on a full fetch that means none on the server. */
export function owaCategoriesConfirmedAbsent(json: Record<string, any> | null | undefined): boolean {
  return !!json && !("Categories" in json) && !("categories" in json);
}

function owaCategoryNames(value: any): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(owaCategoryNames);
  }
  if (typeof value == "string") {
    let trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (!value || typeof value != "object") {
    return [];
  }
  for (let key of ["Strings", "strings", "String", "string", "Category", "Categories", "categories", "Value", "value", "Items", "items"]) {
    if (key in value && value[key] != null) {
      let result = owaCategoryNames(value[key]);
      if (result.length) {
        return result;
      }
    }
  }
  for (let val of Object.values(value)) {
    let nested = owaCategoryNames(val);
    if (nested.length) {
      return nested;
    }
  }
  return [];
}


const ExchangeScheduling: Record<string, number> = {
  "IPM.Schedule.Meeting.Resp.Pos": InvitationMessage.ParticipantReply,
  "IPM.Schedule.Meeting.Resp.Tent": InvitationMessage.ParticipantReply,
  "IPM.Schedule.Meeting.Resp.Neg": InvitationMessage.ParticipantReply,
  "IPM.Schedule.Meeting.Request": InvitationMessage.Invitation,
  "IPM.Schedule.Meeting.Canceled": InvitationMessage.CancelledEvent,
};

type OWAMailbox = { EmailAddress?: string, Name?: string };

/** Exchange wraps recipients in `{ Mailbox: {…} }`, but some OWA responses
 * return the mailbox directly. Accept both. */
function owaMailbox(value: { Mailbox?: OWAMailbox } | OWAMailbox | null | undefined): OWAMailbox | null {
  return (value as { Mailbox?: OWAMailbox })?.Mailbox ?? (value as OWAMailbox) ?? null;
}

function setPersons(targetList: ArrayColl<PersonUID>, mailboxes?: unknown): void {
  if (!mailboxes) {
    return;
  }
  targetList.replaceAll(ensureArray(mailboxes).map(entry => {
    let mailbox = owaMailbox(entry as { Mailbox?: OWAMailbox });
    return findOrCreatePersonUID(
      sanitize.emailAddress(mailbox?.EmailAddress, null),
      sanitize.nonemptylabel(mailbox?.Name, null));
  }));
}
