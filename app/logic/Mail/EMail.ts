import { Message } from "../Abstract/Message";
import { SpecialFolder, type Folder } from "./Folder";
import { ComposeActions } from "./ComposeActions";
import { Attachment, ContentDisposition } from "../Abstract/Attachment";
import type { Tag } from "../Abstract/Tag";
import { DeleteStrategy, type MailAccountStorage } from "./MailAccount";
import { PersonUID, findOrCreatePersonUID, kDummyPerson } from "../Abstract/PersonUID";
import type { MailIdentity } from "./MailIdentity";
import { RawFilesAttachment } from "./Store/RawFilesAttachment";
import { EMailProcessorList, ProcessingStartOn } from "./EMailProcessor";
import type { ExtraData } from "./ExtraData";
import type { SMLData } from "./SML/SMLData";
import type { FollowUpChoice } from "./FollowUp/FollowUpReminder";
import type { PublicKey } from "./Encryption/PublicKey";
import { Event } from "../Calendar/Event";
import { InvitationMessage, type iCalMethod } from "../Calendar/Invitation/InvitationStatus";
import { FilterMoment } from "./FilterRules/FilterMoments";
import type { EncryptionSystem } from "./Encryption/enums";
import { fileExtensionForMIMEType, assert, AbstractFunction, blobToDataURL } from "../util/util";
import { sanitize } from "../../../lib/util/sanitizeDatatypes";
import { PromiseAllDone } from "../util/flow/PromiseAllDone";
import { Lock } from "../util/flow/Lock";
import { RunOnce } from "../util/flow/RunOnce";
import { notifyChangedProperty } from "../util/Observable";
import { gt } from "../../l10n/l10n";
import { Collection, ArrayColl, MapColl, SetColl } from "svelte-collections";
import PostalMIME, { type Email as MIME } from "postal-mime";

export type MailImportanceLevel = "high" | "normal" | "low";

export class EMail extends Message {
  @notifyChangedProperty
  from = new PersonUID();
  @notifyChangedProperty
  replyTo: PersonUID | null = null;
  readonly to = new ArrayColl<PersonUID>();
  readonly cc = new ArrayColl<PersonUID>();
  readonly bcc = new ArrayColl<PersonUID>();
  /** Tags/keywords that apply to this message.
   * To modify them (based on user input, not reading), use addTag()/removeTag()
   * @see Tag */
  readonly tags = new SetColl<Tag>();
  readonly headers = new MapColl<string, string>();
  /** Size of full RFC822 MIME message, in bytes */
  @notifyChangedProperty
  size: number;
  /** List of parent message IDs, starting with top level and ending with direct parent.
   * The last entry should theoretically match `inReplyTo`. */
  @notifyChangedProperty
  references: string[] | null = null;

  /** This is a Junk message */
  @notifyChangedProperty
  isSpam = false;
  /** The user has answered this message, by clicking "Reply" */
  @notifyChangedProperty
  isReplied = false;
  /** The user has forwarded this message to somebody else */
  @notifyChangedProperty
  isForwarded = false;
  /** Время последнего ответа или пересылки, зафиксированного сервером или клиентом. */
  @notifyChangedProperty
  lastVerbAt: Date | null = null;
  /** The sender or the server marked this message as important,
   * e.g. `Importance: high` or IMAP keyword `$Important` */
  @notifyChangedProperty
  isImportant = false;
  /** Compose/send importance (Exchange High / Normal / Low). */
  @notifyChangedProperty
  importanceLevel: MailImportanceLevel = "normal";
  /** Пользователь удалил подпись в редакторе: при отправке её не возвращаем. */
  signatureRemovedByUser = false;
  /** For composer/send only: «Напомнить, если не ответят». Not persisted. */
  @notifyChangedProperty
  followUpReminder: FollowUpChoice | null = null;
  /** Request a read receipt when sending (OWA/EWS + MDN header). */
  @notifyChangedProperty
  requestReadReceipt = false;
  /** Request a delivery receipt when sending (OWA/EWS + Return-Receipt-To header). */
  @notifyChangedProperty
  requestDeliveryReceipt = false;
  /** The user started writing this message, but didn't send it yet */
  @notifyChangedProperty
  isDraft = false;
  @notifyChangedProperty
  isDeleted = false;
  /** Server-reported attachment hint from Exchange (FindItem / GetItem). */
  @notifyChangedProperty
  hasAttachmentsFlag = false;

  /** Whether the list/filter should show an attachment indicator. */
  get hasVisibleAttachments(): boolean {
    if (this.hasAttachmentsFlag) {
      return true;
    }
    return this.attachments.hasItems && this.attachments.some(att => !att.hidden);
  }

  /** Complete MIME source of the email */
  @notifyChangedProperty
  mime: Uint8Array | undefined;
  folder: Folder;
  /** msg ID of the thread starter message */
  threadID: string | null = null;
  /** Protocol-specific ID for this email.
   * E.g. UID or seq for IMAP, or EWS ID string.
   * The type string or number depends on the protocol.
   * Each protocol defines a get/set function with the protocol-specific name,
   * E.g. `IMAPEMail.uid: number` and `EWSEMail.itemID: string` are getters for pID. */
  pID: string | number | null = null;
  /** This message has been downloaded completely,
   * with header, body, and all attachments. */
  downloadComplete = false;
  /** Was just downloaded, but wasn't saved to local disk yet.
   * Set only temporarily. */
  needSave = false;
  /** Body has been loaded already */
  @notifyChangedProperty
  loadedBody = false;
  /** For SQLEMail and alternatives only */
  readonly storageLock = new Lock();
  /** For composer only. Optional. */
  identity: MailIdentity;

  /** PGP or S/MIME or none */
  system: EncryptionSystem | null = null;
  /** For composer/send only: This email should be end-to-end encrypted. */
  @notifyChangedProperty
  shouldEncrypt = false;
  /** For composer/send only: This email must be end-to-end encrypted, e.g.
   * because it quotes from an encrypted email. */
  @notifyChangedProperty
  _mustEncrypt = false;
  /** Message being replied to or forwarded. Set while composing; not persisted. */
  composeSource: EMail | null = null;
  /** This email was end-to-end encrypted on the wire.
   * It has now been decrypted and stored in decrypted form. */
  @notifyChangedProperty
  wasEncrypted = false;
  /** This email was correctly signed with this public key.
   * The signature was valid and the public key matches `From:`.
   * This gives you the specific public key that was used to sign.
   * Format: `PublicKey.id` */
  @notifyChangedProperty
  signedByKeyID: string | null = null;
  /** As `signed` but giving you the actual PublicKey object */
  signedKey: PublicKey | null = null;
  /** Contains the complete MIME message for sending.
   * Used for encrypted messages. */
  sendRawMIME: string | null = null;

  /** Allows data-specific processors to add data to the message.
   * ExtraData.extraDataName -> ExtraData */
  extraData = new MapColl<string, ExtraData>();
  @notifyChangedProperty
  sml: SMLData | null = null;

  // Calendar invitations - TODO move into `ExtraData`
  /* Only used when constructing iMIP outgoing messages */
  iCalMethod: iCalMethod | undefined;
  @notifyChangedProperty
  invitationMessage: InvitationMessage = InvitationMessage.None;
  @notifyChangedProperty
  event: Event | null = null;

  constructor(folder: Folder) {
    super();
    this.folder = folder;
  }

  async markRead(read = true) {
    let wasRead = this.isRead;
    await super.markRead(read);
    if (wasRead == read || !this.folder) {
      return;
    }
    if (read) {
      this.folder.countUnread = Math.max(0, this.folder.countUnread - 1);
      this.folder.countNewArrived = Math.max(0, this.folder.countNewArrived - 1);
    } else {
      this.folder.countUnread++;
    }
  }

  /** Inbox: received time (like OWA). Sent/Drafts/Outbox: sent time. */
  listDisplayDate(): Date {
    let special = this.folder?.specialFolder;
    if (this.outgoing ||
        special === SpecialFolder.Sent ||
        special === SpecialFolder.Drafts ||
        special === SpecialFolder.Outbox) {
      return this.sent ?? this.received;
    }
    return this.received ?? this.sent;
  }

  get messageID(): string {
    return this.id;
  }
  set messageID(val: string) {
    this.id = val;
  }

  get baseSubject(): string {
    return this.subject.replace(/^((Re|RE|AW|Aw): ?)+/g, "");
  }

  get storage(): MailAccountStorage {
    return this.folder.account.storage;
  }

  get mustEncrypt(): boolean {
    return this._mustEncrypt;
  }
  set mustEncrypt(val: boolean) {
    if (!val) {
      // cannot disable once enforced
      return;
    }
    this._mustEncrypt = val;
    this.shouldEncrypt = val;
  }

  allRecipients(): Collection<PersonUID> {
    let recipients = new ArrayColl<PersonUID>();
    recipients.addAll(this.to);
    recipients.addAll(this.cc);
    return recipients;
  }

  /** Marks as spam, and deletes or moves the message, as configured */
  async treatSpam(isSpam = true) {
    let strategy = this.folder.account.spamStrategy;
    if (strategy == DeleteStrategy.MoveToTrash) {
      let spamFolder = this.folder.account.findSpecialFolder(SpecialFolder.Spam);
      assert(spamFolder, gt`Spam folder is not set. Please go to folder properties and set Use As: Spam.`);
      if (isSpam) {
        await this.markSpam(true);
        if (this.folder !== spamFolder) {
          // Relocate like soft-delete → Trash (do not wipe local copy first).
          await spamFolder.moveMessageHere(this);
        }
      } else {
        await this.markSpam(false);
        if (this.folder == spamFolder) {
          await this.folder.account.inbox.moveMessageHere(this);
        }
      }
    } else if (strategy == DeleteStrategy.DeleteImmediately) {
      if (this.pID) {
        this.folder.deletions.add(this.pID);
      }
      try {
        if (isSpam) {
          await this.deleteMessageLocally();
          await this.markSpam(true);
          await this.deleteMessageOnServer(DeleteStrategy.DeleteImmediately);
        } else {
          await this.markSpam(false);
        }
      } finally {
        if (this.pID) {
          this.folder.deletions.delete(this.pID);
        }
      }
    }
  }

  /** You probably want to call @see treatSpam() */
  async markSpam(isSpam = true) {
    this.isSpam = isSpam;
  }

  async markReplied(actionAt = new Date()) {
    this.isReplied = true;
    this.isForwarded = false;
    this.lastVerbAt = actionAt;
  }

  async markForwarded(actionAt = new Date()) {
    this.isReplied = false;
    this.isForwarded = true;
    this.lastVerbAt = actionAt;
  }

  async markImportant(isImportant = true) {
    this.isImportant = isImportant;
  }

  async markDraft(isDraft = true) {
    this.isDraft = isDraft;
    if (this.dbID) {
      await this.saveWritablePropsLocally();
    }
  }

  async moveToArchive() {
    let account = this.folder.account;
    let archive = account.findSpecialFolder(SpecialFolder.Archive);
    if (!archive) {
      archive = await account.inbox.createSubFolder(gt`Archive`);
      archive.specialFolder = SpecialFolder.Archive; // TODO set on server
    }
    await archive.moveMessageHere(this);
  }

  async moveToArchiveMailbox() {
    await this.folder.moveMessagesToArchiveMailbox(new ArrayColl([this]));
  }

  /** Move out of Trash/Spam back to Inbox (restore). */
  async restoreFromTrash() {
    let account = this.folder.account;
    let inbox = account.findSpecialFolder(SpecialFolder.Inbox) ?? account.inbox;
    assert(inbox, gt`Inbox folder is not set`);
    if (this.folder === inbox) {
      return;
    }
    await inbox.moveMessageHere(this);
  }

  async deleteMessage(strategy?: DeleteStrategy) {
    await this.deleteMessageLocally();
    await this.deleteMessageOnServer(strategy);
  }

  async deleteMessageLocally() {
    this.isDeleted = true;
    this.downloadComplete = false;
    this.folder.messages.remove(this);
    await this.storage.deleteMessage(this);
    let contentDeletes = new PromiseAllDone();
    for (let contentStorage of this.folder.account.contentStorage) {
      contentDeletes.add(contentStorage.deleteIt(this));
    }
    await contentDeletes.wait();
  }

  async deleteMessageOnServer(strategy?: DeleteStrategy) {
  }

  async addTag(tag: Tag) {
    await this.addTags([tag]);
  }

  async addTags(tags: readonly Tag[]) {
    let toAdd = tags.filter(tag => !this.tags.contains(tag));
    if (!toAdd.length) {
      return;
    }
    for (let tag of toAdd) {
      this.tags.add(tag);
    }
    await this.storage.saveMessageTags(this);
    await this.addTagsOnServer(toAdd);
  }

  async removeTag(tag: Tag) {
    await this.removeTags([tag]);
  }

  async removeTags(tags: readonly Tag[]) {
    let toRemove = tags.filter(tag => this.tags.contains(tag));
    if (!toRemove.length) {
      return;
    }
    for (let tag of toRemove) {
      this.tags.remove(tag);
    }
    await this.storage.saveMessageTags(this);
    await this.removeTagsOnServer(toRemove);
  }

  async clearTags() {
    await this.removeTags(this.tags.contents.slice());
  }

  async addTagOnServer(tag: Tag) {
  }

  async addTagsOnServer(tags: readonly Tag[]) {
    for (let tag of tags) {
      await this.addTagOnServer(tag);
    }
  }

  async removeTagOnServer(tag: Tag) {
  }

  async removeTagsOnServer(tags: readonly Tag[]) {
    for (let tag of tags) {
      await this.removeTagOnServer(tag);
    }
  }

  newAttachment(): Attachment {
    let att = new Attachment();
    att.message = this;
    att.storage = this.folder.account.contentStorage.filterOnce(storage => storage.supportsAttachments);
    return att;
  }

  /** Returns the identity which best matches the recipient/from
   * of this email, out of the identities of the account where this email is. */
  getIdentity(): MailIdentity {
    let persons = [this.from, ...this.to, ...this.cc, ...this.bcc];
    let identities = this.folder.account.identities;
    for (let person of persons) {
      for (let identity of identities) {
        if (identity.isEMailAddress(person.emailAddress)) {
          return identity;
        }
      }
    }
    return identities.first;
  }

  protected loadedEvent = false;
  readonly loadEventRunOnce = new RunOnce<void>();
  async loadEvent() {
    assert(this.invitationMessage, "This is not an invitation or response");
    if (this.event || this.loadedEvent) {
      return;
    }
    await this.loadEventRunOnce.runOnce(async () => {
      if (this.mime) {
        await this.parseMIME();
      } else {
        await this.loadMIME();
      }
      // indirectly calls @see `ICalEMailProcessor.process()`
      this.loadedEvent = true;
    });
  }

  async parseMIME(): Promise<MIME> {
    assert(this.mime?.length, "MIME source not yet downloaded");
    assert(this.mime instanceof Uint8Array, "MIME source should be a byte array");
    //console.log("MIME source", this.mime, new TextDecoder("utf-8").decode(this.mime));
    // We may need access to internal PostalMIME data.
    let postalMIME = new PostalMIME();
    let mail = await postalMIME.parse(this.mime);

    this.id ??= sanitize.string(mail.messageId, this.id ?? "");
    this.subject ??= sanitize.string(mail.subject, this.subject ?? "");
    this.sent ??= sanitize.date(mail.date, this.sent ?? new Date());
    if (!this.from || this.from.emailAddress == kDummyPerson.emailAddress) {
      // Некоторые провайдеры передают только Sender, если RFC-заголовок From
      // отсутствует. Сначала используем From, затем Sender, и только потом
      // показываем фиктивного отправителя.
      const parsedSender = mail.from?.address ? mail.from : mail.sender;
      const senderAddress = sanitize.emailAddress(parsedSender?.address, null);
      this.from = senderAddress
        ? findOrCreatePersonUID(
            senderAddress,
            sanitize.nonemptylabel(parsedSender?.name, null))
        : kDummyPerson;
    }
    setPersons(this.to, mail.to);
    setPersons(this.cc, mail.cc);
    setPersons(this.bcc, mail.bcc);
    this.outgoing = this.folder?.account.isMyEMailAddress(this.from.emailAddress);
    this.contact = computeEMailContact(this);
    if (!this.replyTo && mail.replyTo?.length) {
      let p = mail.replyTo[0];
      this.replyTo = findOrCreatePersonUID(
        sanitize.emailAddress(p.address, null),
        sanitize.nonemptylabel(p.name, null));
    }
    if (!this.inReplyTo) {
      this.inReplyTo = sanitize.string(mail.inReplyTo, null);
    }
    this.references = sanitize.string(mail.references, null)?.split(" ");
    // RFC 4021 `Importance:`, RFC 2156 `Priority:`, and the de-facto `X-Priority: 1` = highest
    this.isImportant ||= this.mimeHeader(mail, "importance") == "high" ||
      this.mimeHeader(mail, "priority") == "urgent" ||
      ["1", "2"].includes(this.mimeHeader(mail, "x-priority")[0]);

    // Body
    this.text = mail.text;
    let html = sanitize.string(mail.html, null);
    if (html) {
      this.html = html;
    }

    // Attachments
    let fallbackID = 0;
    let oldAttachments = new ArrayColl<Attachment>(this.attachments);
    this.attachments.replaceAll(mail.attachments.map(a => {
      try {
        let attachment = this.newAttachment();
        attachment.contentID = sanitize.nonemptystring(a.contentId, "" + ++fallbackID);
        attachment.mimeType = sanitize.nonemptystring(a.mimeType, "application/octet-stream");
        attachment.filename = sanitize.nonemptystring(a.filename, "attachment-" + fallbackID + "." + fileExtensionForMIMEType(attachment.mimeType));
        attachment.filepathLocal = oldAttachments.find(old =>
          old.contentID == attachment.contentID &&
          old.filename == attachment.filename)
          ?.filepathLocal;
        attachment.disposition = sanitize.translate(a.disposition, {
          attachment: ContentDisposition.attachment,
          inline: ContentDisposition.inline,
        }, ContentDisposition.unknown);
        attachment.related = sanitize.boolean(a.related, false);
        attachment.content = new File([a.content], attachment.filename, { type: attachment.mimeType });
        attachment.size = sanitize.integer(attachment.content.size, -1);
        return attachment;
      } catch (ex) {
        this.folder.account.errorCallback(ex);
        return null;
      }
    }).filter(attachment => !!attachment));
    oldAttachments.clear();

    // Run processors, filters, calendar invitations, SML, etc.
    for (let processor of EMailProcessorList.processors) {
      if (processor.runOn != ProcessingStartOn.Parse) {
        continue;
      }
      try {
        await processor.process(this, mail);
      } catch (ex) {
        this.folder.account.errorCallback(ex);
      }
    }
    return mail;
  }

  async parseHeaders() {
    if (this.headers.hasItems) {
      return;
    }
    assert(this.mime instanceof Uint8Array, "Need MIME");
    let mail = await new PostalMIME().parse(this.mime);
    for (let header of mail.headers) {
      try {
        let name = sanitize.nonemptystring(header.key).toLowerCase();
        let value = sanitize.string(header.value, "");
        this.headers.set(name, value);
      } catch (ex) {
        this.folder.account.errorCallback(ex);
      }
    }
  }

  /** @param name must be lowercase
   * @returns the header value, normalized for comparison */
  protected mimeHeader(mail: MIME, name: string): string {
    let header = mail.headers.find(h => h.key.toLowerCase() == name);
    return sanitize.string(header?.value, "").toLowerCase().trim();
  }

  /** Used by encrypted messages.
   * Let `parseMIME()` set all properties. */
  resetProperties() {
    // This MUST list all properties where `parseMIME()` does `this.prop ??=` or `if (!this.prop)`
    this.id = null;
    this.subject = "";
    this.sent = null;
    this.from = new PersonUID();
    this.replyTo = null;
    this.inReplyTo = null;
  }

  async saveMetadataLocally() {
    await this.storage.saveMessage(this);
  }

  async saveWritablePropsLocally() {
    await this.storage.saveMessageWritableProps(this);
  }

  /**
   * Saves the email
   * 1. in the database (meta-data, body text)
   * 2. attachments as raw files
   * 3. the MIME source as mail.zip
   *
   * Do this only exactly once per email `dbID`.
   * This typically happens immediately after`parseMIME()`. */
  async saveCompleteMessage() {
    if (this.isDeleted || !this.mime || await this.isDownloadCompleteDoublecheck()) {
      return;
    }
    await this.processMessage();
    await this.saveMetadataLocally();
    let contentSaves = new PromiseAllDone();
    for (let contentStorage of this.folder.account.contentStorage) {
      contentSaves.add(contentStorage.save(this));
    }
    await contentSaves.wait();
    this.downloadComplete = true;
    await this.saveWritablePropsLocally(); // save downloadComplete = true
  }

  protected async isDownloadCompleteDoublecheck(): Promise<boolean> {
    if (this.downloadComplete) {
      return true;
    }
    // Double-check for concurrent downloads
    let check = this.folder.newEMail();
    check.dbID = this.dbID;
    await this.storage.readMessageWritableProps(check);
    return this.downloadComplete = check.downloadComplete;
  }

  async loadForDisplay() {
    await this.loadMIME();
  }

  readonly loadMIMERunOnce = new RunOnce<void>();
  async loadMIME() {
    if (this.mime) {
      return;
    }
    await this.loadMIMERunOnce.runOnce(async () => {
      if (this.dbID) {
        try {
          await this.storage.readMessage(this);
          await this.folder.account.contentStorage.first.read(this);
          if (this.mime) {
            const hadUnknownSender =
              this.from.emailAddress == kDummyPerson.emailAddress;
            await this.parseMIME();
            if (
              hadUnknownSender &&
              this.dbID &&
              this.from.emailAddress != kDummyPerson.emailAddress
            ) {
              try {
                // Сохраняем отправителя, восстановленного из локального MIME,
                // чтобы следующий список писем снова не показывал unknown@invalid.
                await this.saveMetadataLocally();
              } catch (ex) {
                // Ошибка сохранения не должна заставлять повторно скачивать
                // уже успешно прочитанный локальный MIME.
                this.folder.account.errorCallback(ex);
              }
            }
            return;
          }
        } catch (ex) {
          console.error(ex);
        }
      }
      await this.download();
    });
  }

  async loadAttachments() {
    if (this.attachments.hasItems && this.attachments.every(a => a.content)) {
      return;
    }
    if (!this.attachments.hasItems) {
      return;
    }
    try {
      let storage = this.folder.account.contentStorage.find(store => store instanceof RawFilesAttachment);
      assert(storage, "Raw attachment storage not configured");
      await storage.read(this);
    } catch (ex) {
      console.error(ex);
    }
    if (this.attachments.hasItems && this.attachments.every(a => a.content)) {
      return;
    }
    // A message can have attachment metadata without a local file yet. In
    // that case read the original MIME so inline parts get their contents.
    if (this.mime) {
      await this.parseMIME();
    } else {
      await this.loadMIME();
    }
  }

  readonly loadBodyRunOnce = new RunOnce<void>();
  async loadBody() {
    if (this.loadedBody) {
      return;
    }
    /* RunOnce: Svelte 5 re-invokes `{#await message.loadBody()}` while the
     * load is still running, whenever an ancestor re-assigns the `message` prop */
    await this.loadBodyRunOnce.runOnce(async () => {
      await Promise.resolve(); // Work around Svelte 5 bug #17678
      if (!this._rawHTML && !this._text) {
        if (this.dbID) {
          await this.storage.readMessageBody(this);
        }
        if (!this._rawHTML && !this._text) {
          await this.download();
        }
      }

      let html = this.html;
      if (html && /cid:/i.test(html)) {
        this._sanitizedHTML = await addCID(html, this);
      }
      this.loadedBody = true; // triggers UI reload
    });
  }

  get html(): string {
    return super.html;
  }
  set html(val: string) {
    if (this._rawHTML == val) {
      return;
    }
    super.html = val;
    this.loadedBody = false;
  }

  get loadExternalImages(): boolean {
    return super.loadExternalImages;
  }
  set loadExternalImages(val: boolean) {
    if (this.loadExternalImages == val) {
      return;
    }
    this.loadedBody = false;
    super.loadExternalImages = val;
  }

  readonly downloadRunOnce = new RunOnce<void>();
  async download() {
    throw new AbstractFunction();
    //this.mime = await SMTPAccount.getMIME(this);
  }

  /**
   * Runs filters, spam filter, and content interpreters on the message.
   *
   * Should be called after the entire message has been downloaded,
   * and before it is stored.
   */
  async processMessage() {
    let rules = this.folder?.account?.filterRuleActions.contents;
    rules = rules?.filter(rule => rule.when == FilterMoment.IncomingBeforeSpam || rule.when == FilterMoment.IncomingAfterSpam);
    for (let rule of rules) {
      await rule.run(this);
    }
  }

  async findThread(messages: Collection<EMail>): Promise<string | null> {
    if (!this.dbID) {
      return null;
    }
    let threadID = this.threadID ?? this.inReplyTo;
    let lastThreadIDs = new SetColl<string>();
    while (threadID && !lastThreadIDs.contains(threadID)) {
      lastThreadIDs.add(threadID);
      console.log("finding thread", threadID);
      let parent = messages.find(msg => msg.threadID == threadID || msg.messageID == threadID)
        //?? await findMessageByID(threadID);
      threadID = parent?.threadID ?? parent?.inReplyTo;
      if (threadID && parent.threadID != threadID) {
        parent.threadID = threadID;
        await parent.saveWritablePropsLocally();
      }
    }
    if (threadID && this.threadID != threadID) {
      this.threadID = threadID;
      await this.saveWritablePropsLocally();
    }
    return this.threadID;
  }

  copyFrom(other: EMail): void {
    super.copyFrom(other, true);
    // <copied to="SendEncrypted.cloneEMail()">
    other.folder = this.folder;
    other.identity = this.identity;
    other.from = this.from;
    other.replyTo = this.replyTo;
    other.to.replaceAll(this.to);
    other.cc.replaceAll(this.cc);
    // </copied>
    other.bcc.replaceAll(this.bcc);
    other.tags.replaceAll(this.tags);
    //other.headers.replaceAll(this.headers);
    other.headers.clear();
    for (let name of this.headers.keys()) {
      other.headers.set(name, this.headers.get(name));
    }
    other.size = this.size;
    if (this.references) {
      other.references = this.references.slice();
    }
    other.threadID = this.threadID;
    other.isSpam = this.isSpam;
    other.isReplied = this.isReplied;
    other.isForwarded = this.isForwarded;
    other.lastVerbAt = this.lastVerbAt ? new Date(this.lastVerbAt) : null;
    other.isImportant = this.isImportant;
    other.isDraft = this.isDraft;
    other.isDeleted = this.isDeleted;
    other.mime = this.mime;
    other.invitationMessage = this.invitationMessage;
    other.event = this.event;
    other.sml = this.sml;
    //other.extraData.replaceAll(this.extraData);
    other.extraData.clear();
    for (let name of this.extraData.keys()) {
      other.extraData.set(name, this.extraData.get(name));
    }

    other.mustEncrypt = this.mustEncrypt;
    other.shouldEncrypt = this.shouldEncrypt;
    other.wasEncrypted = this.wasEncrypted;
    other.signedByKeyID = this.signedByKeyID;
    other.system = this.system;
  }

  /**
   * @param previous
   * true: older message
   * false: newer message
   * null: Same list position, after deleting this message
   *
   * Implementation: If there are more functions that are
   * not about the email itself, this might move to an `EMailActions` class,
   * like `ComposeActions`.
   * For now, given that it's just 1 function and small, keep it here.
   */
  nextMessage(previous?: boolean): EMail {
    let i = this.folder.messages.getKeyForValue(this);
    if (typeof (previous) == "boolean") {
      previous ? --i : ++i;
    }
    return this.folder.messages.getIndex(i) ??
      this.folder.messages.first ??
      this.folder.account.inbox.messages.first ??
      this.folder.newEMail();
  }

  get compose(): ComposeActions {
    return new ComposeActions(this);
  }
}

/** Преобразует ссылки `cid:` на встроенные изображения в data URL. */
export async function addCID(html: string, email: EMail): Promise<string> {
  try {
    let doc = new DOMParser().parseFromString(html, "text/html");
    let imgs = doc.querySelectorAll("img[src]");
    let cidImages = [...imgs].filter(img => {
      let src = img.getAttribute("src");
      return src?.substring(0, 4).toLowerCase() == "cid:";
    });
    if (cidImages.length) {
      await email.loadAttachments();
    }
    let attachmentsByContentID = indexAttachmentsByContentID(email);
    if (cidImages.some(img => {
      let cid = normalizeContentID(img.getAttribute("src"));
      let attachment = attachmentsByContentID.get(cid) ?? attachmentsByContentID.get(cid.toLowerCase());
      return !attachment?.content;
    })) {
      if (email.mime) {
        await email.parseMIME();
      } else {
        await email.loadMIME();
      }
      attachmentsByContentID = indexAttachmentsByContentID(email);
    }
    let inlineImageURLs = new Map<Attachment, string>();
    for (let img of imgs) {
      let src = img.getAttribute("src");
      if (!src || src.substring(0, 4).toLowerCase() != "cid:") {
        continue;
      }
      let cid = normalizeContentID(src);
      let attachment = attachmentsByContentID.get(cid) ?? attachmentsByContentID.get(cid.toLowerCase());
      if (attachment?.content) {
        src = inlineImageURLs.get(attachment);
        if (!src) {
          src = await blobToDataURL(attachment.content);
          inlineImageURLs.set(attachment, src);
        }
      } else {
        src = "";
      }
      img.setAttribute("src", src);
      if (src) {
        attachment.hidden = true;
      }
    }
    html = new XMLSerializer().serializeToString(doc);
  } catch (ex) {
    email.folder.account.errorCallback(ex);
  }
  return html;
}

function indexAttachmentsByContentID(email: EMail): Map<string, Attachment> {
  let attachmentsByContentID = new Map<string, Attachment>();
  for (let attachment of email.attachments) {
    let contentID = normalizeContentID(attachment.contentID);
    if (contentID) {
      attachmentsByContentID.set(contentID, attachment);
      attachmentsByContentID.set(contentID.toLowerCase(), attachment);
    }
  }
  return attachmentsByContentID;
}

function normalizeContentID(contentID: string): string {
  if (!contentID) {
    return "";
  }
  let normalized = contentID.trim();
  if (normalized.substring(0, 4).toLowerCase() == "cid:") {
    normalized = normalized.substring(4);
  }
  try {
    normalized = decodeURIComponent(normalized);
  } catch (ex) {
    // Сохраняем потенциально пригодный идентификатор с некорректным URL-кодированием.
  }
  return normalized.trim().replace(/^<+|>+$/g, "");
}

/** Correspondent shown in the message list. */
export function computeEMailContact(email: EMail): PersonUID {
  let account = email.folder?.account;
  // Shared mailbox outgoing (Inbox thread or Sent): show the mailbox name like Outlook.
  if (email.outgoing && account?.isDependentAccount) {
    if (email.from?.emailAddress && account.isMyEMailAddress(email.from.emailAddress)) {
      return email.from;
    }
    return findOrCreatePersonUID(account.emailAddress, account.name);
  }
  return email.outgoing ? email.to.first : email.from;
}

export function setPersons(targetList: ArrayColl<PersonUID>, personList: { address: string, name: string }[]): void {
  targetList.clear();
  if (!personList?.length) {
    return;
  }
  targetList.addAll(personList.map(p => findOrCreatePersonUID(
    sanitize.emailAddress(p.address, null),
    sanitize.label(p.name, null))));
}
