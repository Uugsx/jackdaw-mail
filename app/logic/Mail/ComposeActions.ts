import type { EMail } from "./EMail";
import { SpecialFolder } from "./Folder";
import { Attachment, ContentDisposition } from "../Abstract/Attachment";
import { PersonUID, findOrCreatePersonUID } from "../Abstract/PersonUID";
import { MailIdentity } from "./MailIdentity";
import { SendEncrypted } from "./Encryption/SendEncrypted";
import { appName, appVersion, siteRoot } from "../build";
import { getLocalStorage } from "../../frontend/Util/LocalStorage";
import { importAutoCryptKeys } from "./Encryption/PGP/AutoCrypt";
import { fileExtensionForMIMEType } from "../Files/FileType/MIMETypes";
import { backgroundError } from "../../frontend/Util/error";
import { sanitize } from "../../../lib/util/sanitizeDatatypes";
import { UserError, assert, dataURLToBlob, type URLString, ensureArray } from "../util/util";
import { convertTextToHTML } from "../util/convertHTML";
import { getDateTimeLocale, gt } from "../../l10n/l10n";
import { ArrayColl, type Collection } from "svelte-collections";
import { addSenderToCC } from "./composeRecipients";
import { playNotificationSound } from "../../frontend/Shared/NotificationSound";
import { normalizeSignatureHTML } from "./SignatureHTML";

/** Functions based on the email, which are either
 * not changing the email itself, but are based on the email,
 * or are higher-level functions not inherently about the email object. */
export class ComposeActions {
  readonly email: EMail;

  constructor(email: EMail) {
    this.email = email;
  }

  quotePrefixLine(): string {
    function getDate(date: Date) {
      return date.toLocaleString(getDateTimeLocale(), { year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" });
    }
    let from = this.email.from.name || this.email.from.emailAddress;
    let date = getDate(this.email.sent);
    return gt`{from} wrote on {date}:`({ from, date });
  }

  /** Split user reply from quoted original (header + blockquote). */
  protected splitReplyAndQuote(html: string): { reply: string; quote: string } {
    let body = html ?? "";
    let headerMatch = body.match(/<p\b[^>]*\bclass=(["'])quote-header\1[^>]*>[\s\S]*$/i);
    if (headerMatch?.index != null) {
      return {
        reply: body.slice(0, headerMatch.index),
        quote: body.slice(headerMatch.index),
      };
    }
    let blockquoteMatch = body.match(/<blockquote\b[\s\S]*$/i);
    if (blockquoteMatch?.index != null) {
      return {
        reply: body.slice(0, blockquoteMatch.index),
        quote: body.slice(blockquoteMatch.index),
      };
    }
    return { reply: body, quote: "" };
  }

  protected stripSignatureFooters(html: string): string {
    let body = html ?? "";
    body = body.replace(/<footer\b[^>]*\bclass=(["'])[^"']*\bsignature\b[^"']*\1[^>]*>[\s\S]*?<\/footer>/gi, "");
    body = body.replace(/<footer\b[^>]*\bclass=(['"])?signature\1?\b[^>]*>[\s\S]*?<\/footer>/gi, "");
    body = body.replace(/<footer\b(?![^>]*\bclass=)[^>]*>[\s\S]*?<\/footer>/gi, "");
    return body;
  }

  /** HTML blockquote for a reply, optionally with an attribution line above it. */
  protected buildReplyQuote(original: EMail): string {
    let showAttribution = getLocalStorage("mail.send.quote.attribution", false).value;
    let header = showAttribution
      ? `<p class="quote-header">${this.quotePrefixLine()}</p>
    `
      : "";
    return `${header}<blockquote cite="mid:${original.id}">
      ${original.html}
    </blockquote>`;
  }

  generateMessageID(): void {
    let hostname = this.email.from?.emailAddress?.split("@")[1]
      ?? "msgid." + new URL(siteRoot).hostname;
    this.email.messageID = crypto.randomUUID() + "@" + hostname;
  }

  /** New unrelated message from the same identity and folder */
  newMailFromSameIdentity(): EMail {
    let original = this.email;
    let account = original.folder.account;
    let reply = account.newEMailFrom();
    reply.compose.generateMessageID();

    let findFrom = new ArrayColl<PersonUID>();
    if (original.from?.emailAddress) {
      findFrom.add(original.from);
      findFrom.addAll(original.to);
      findFrom.addAll(original.cc);
      findFrom.addAll(original.bcc);
    }
    let from = MailIdentity.findIdentity(findFrom, account);
    reply.identity = from.identity;
    reply.from = from.personUID;
    reply.compose.applySignature();

    reply.folder = original.folder?.specialFolder == SpecialFolder.Normal
      ? original.folder
      : account.getSpecialFolder(SpecialFolder.Sent);
    return reply;
  }

  protected _reply(): EMail {
    let reply = this.newMailFromSameIdentity();

    let original = this.email;
    reply.composeSource = original;

    reply.subject = "Re: " + original.baseSubject; // Do *not* localize "Re: "
    reply.inReplyTo = original.messageID;
    reply.references = original.references?.slice() ?? [];
    reply.references.push(original.messageID);
    reply.mustEncrypt = original.wasEncrypted;
    importAutoCryptKeys(original)
      .catch(original.folder.account.errorCallback);

    let quoteSetting = getLocalStorage("mail.send.quote", "below").value;
    let quote = this.buildReplyQuote(original);
    reply.html = quoteSetting == "none" ? `<p></p>` :
      quoteSetting == "below" ? `<p></p>
    <p></p>
    ${quote}`
        : `${quote}
    <p></p>
    <p></p>`;
    // reply.html заменяет тело, которое было создано в newMailFromSameIdentity.
    // Вставляем подпись после формирования цитаты, чтобы она не терялась до
    // открытия редактора и сохраняла стили выбранной личности.
    reply.compose.applySignature();
    return reply;
  }

  protected _addFromAsRecipient(reply: EMail) {
    let to = this.email.replyTo ?? this.email.from;
    if (this.isAddressOwnedByMessageAccount(to) && this.email.to.first) {
      to = this.email.to.first;
    }
    reply.to.add(to);
  }

    /** Проверка адреса для ответа должна выполняться только внутри аккаунта письма.
     * Глобальный поиск путает адреса из других пространств и заменяет автора
     * ответа исходным получателем письма. */
  protected isAddressOwnedByMessageAccount(person: PersonUID | null | undefined): boolean {
    let account = this.email.folder?.account ?? this.email.identity?.account;
    return !!account && !!person?.emailAddress && account.isMyEMailAddress(person.emailAddress);
  }

  replyToAuthor(): EMail {
    let reply = this._reply();
    this._addFromAsRecipient(reply);
    return reply;
  }

  /** Plain-text reply typed in an OS notification inline field. */
  insertQuickReplyPlaintext(text: string): void {
    let trimmed = text?.trim();
    if (!trimmed) {
      return;
    }
    let userHtml = convertTextToHTML(trimmed);
    let quoteSetting = getLocalStorage("mail.send.quote", "below").value;
    let html = this.email.rawHTMLDangerous ?? "";
    if (quoteSetting == "none") {
      this.email.rawHTMLDangerous = userHtml;
      return;
    }
    if (quoteSetting == "below") {
      this.email.rawHTMLDangerous = html.replace(/^(\s*<p><\/p>)/i, userHtml) || userHtml + html;
      return;
    }
    // Quote above the reply text
    this.email.rawHTMLDangerous = html.replace(
      /(<\/blockquote>[\s\S]*?)<p><\/p>/i,
      `$1${userHtml}`,
    ) || html + userHtml;
  }

  replyAll(): EMail {
    let reply = this.replyToAuthor();
    reply.to.addAll(this.email.to.contents.filter(pe => !this.isAddressOwnedByMessageAccount(pe) && pe != reply.to.first));
    reply.cc.addAll(this.email.cc.contents.filter(pe => !this.isAddressOwnedByMessageAccount(pe) && pe != reply.to.first));
    return reply;
  }

  /** Whether Reply All would include more than one party. */
  canReplyAll(): boolean {
    // BCC recipients must not expose other hidden recipients via Reply All.
    if (this.email.bcc.hasItems && !this.email.outgoing) {
      return false;
    }
    return this.distinctReplyAllParties().size > 1;
  }

  private distinctReplyAllParties(): Set<string> {
    let parties = new Set<string>();
    let account = this.email.folder?.account;
    if (!account) {
      return parties;
    }
    let ownAddresses = new Set<string>();
    if (account.emailAddress) {
      ownAddresses.add(account.emailAddress.toLowerCase());
    }
    for (let identity of account.identities ?? []) {
      if (identity.emailAddress) {
        ownAddresses.add(identity.emailAddress.toLowerCase());
      }
    }
    let addParty = (pe: PersonUID | null | undefined) => {
      let addr = pe?.emailAddress?.toLowerCase();
      if (addr && !ownAddresses.has(addr)) {
        parties.add(addr);
      }
    };
    addParty(this.email.replyTo ?? this.email.from);
    for (let pe of this.email.to.contents) {
      addParty(pe);
    }
    for (let pe of this.email.cc.contents) {
      addParty(pe);
    }
    return parties;
  }

  newToAll(): EMail {
    let mail = this.newMailFromSameIdentity();
    this._addFromAsRecipient(mail);
    mail.to.addAll(this.email.to.contents.filter(pe => !this.isAddressOwnedByMessageAccount(pe) && pe != mail.to.first));
    mail.cc.addAll(this.email.cc.contents.filter(pe => !this.isAddressOwnedByMessageAccount(pe) && pe != mail.to.first));
    return mail;
  }

  async forward(): Promise<EMail> {
    let setting = getLocalStorage("mail.send.forward", "inline").value;
    if (setting == "attachment") {
      return await this.forwardAsAttachment();
    } else {
      return await this.forwardInline();
    }
  }

  protected _forward(): EMail {
    let forward = this.email.folder.account.newEMailFrom();
    forward.composeSource = this.email;
    forward.subject = "Fwd: " + this.email.subject; // Do *not* localize "Fwd: "
    forward.mustEncrypt = this.email.wasEncrypted;
    return forward;
  }

  async forwardInline(): Promise<EMail> {
    await this.email.loadAttachments();
    let forward = this._forward();
    forward.html = `<p></p>
    <p></p>
    <p></p>
    <hr />
    <p class="forward-header">
      <div>
        <span class="field">From:</span> <span class="value">
          ${this.email.from?.name ?? this.email.from.emailAddress}${this.email.from?.name != this.email.from?.emailAddress ? ' <' + this.email.from.emailAddress + '>' : ''}
        </span>
      </div>
      <div>
        <span class="field">Date:</span> <span class="value">
          ${this.email.sent.toLocaleString(getDateTimeLocale(), { year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", minute: "numeric" })}
        </span>
      </div>
      <div>
        <span class="field">Subject:</span> <span class="value">
          ${this.email.subject ?? ""}
        </span>
      </div>
    </p>
    <p></p>
    ${ this.email.html }`;
    forward.attachments.addAll(this.email.attachments.map(a => a.cloneTo(forward)));
    return forward;
  }

  async forwardAsAttachment(): Promise<EMail> {
    await this.email.loadMIME();
    let forward = this._forward();
    let a = forward.newAttachment();
    a.mimeType = "message/rfc822";
    a.disposition = ContentDisposition.inline;
    a.filename = sanitize.filename(this.email.subject, "email") + ".eml";
    a.content = new File([this.email.mime], a.filename);
    a.size = this.email.size;
    forward.attachments.add(a);
    return forward;
  }

  async redirect(): Promise<EMail> {
    await this.email.loadAttachments();
    let redirect = this.email.folder.account.newEMailFrom();
    redirect.replyTo = this.email.from;
    redirect.subject = this.email.subject;
    redirect.html = this.email.html;
    redirect.attachments.addAll(this.email.attachments.map(a => a.cloneTo(redirect)));
    return redirect;
  }

  async editAsNew(): Promise<EMail> {
    await this.email.loadAttachments();
    let clone = this.email.folder.account.newEMailFrom();
    clone.to.addAll(this.email.to);
    clone.cc.addAll(this.email.cc);
    clone.subject = this.email.subject;
    clone.html = this.email.html;
    clone.attachments.addAll(this.email.attachments.map(a => a.cloneTo(clone)));
    return clone;
  }

  async convertInlineAttachmentsURLs() {
    let changed = false;
    let html = new DOMParser().parseFromString(this.email.rawHTMLDangerous ?? "", "text/html");
    for (let node of html.querySelectorAll("img[src]")) {
      let img = node as HTMLImageElement;
      let prev = img.getAttribute("src") ?? "";
      let next = await this.convertDataURLToCIDURL(prev.startsWith("data:") ? prev : img.src);
      if (next != prev) {
        img.setAttribute("src", next);
        changed = true;
      }
    }
    if (changed) {
      // Keep a body fragment so later signature / MIME paths don't wrap a full document
      this.email.rawHTMLDangerous = html.body.innerHTML;
    }
  }

  protected async convertDataURLToCIDURL(url: URLString): Promise<URLString> {
    if (!url?.startsWith("data:")) {
      return url;
    }
    // Images dragged into the mail composer are already made attachments
    let attachment = this.email.attachments.find(a => a.dataURL == url) ??
      // For image pastes, the editor creates only a `img src="data:…"` URL, so build an attachment
      await this.createInlineAttachment(url);
    attachment.contentID ??= crypto.randomUUID();
    return "cid:" + attachment.contentID;
  }

  protected async createInlineAttachment(dataURL: URLString): Promise<Attachment> {
    let blob = await dataURLToBlob(dataURL);
    let ext = fileExtensionForMIMEType(blob.type);
    let filename = `image-${this.email.attachments.length}.${ext}`;
    let attachment = this.email.newAttachment();
    attachment.fromFile(new File([blob], filename, { type: blob.type }));
    attachment.disposition = ContentDisposition.inline;
    attachment.related = true;
    attachment.dataURL = dataURL;
    this.email.attachments.add(attachment);
    return attachment;
  }

  protected convertBlobURLToCIDURL(url: URLString): URLString {
    if (!url?.startsWith("blob:")) {
      return url;
    }
    let attachment = this.email.attachments.find(a => a.blobURL == url);
    if (!attachment) {
      console.warn(attachment, "Attachment for blob URL not found", url, this.email.attachments.contents);
      return url;
    }

    attachment.contentID ??= crypto.randomUUID();
    return "cid:" + attachment.contentID;
  }

  /** Handles mailto: URLs.
   * Takes the arguments given in the URL, checks them, and
   * set them on this.email.
   * @throws when the input is invalid */
  populateFromMailtoURL(mailtoURL: URLString) {
    let urlObj = new URL(mailtoURL);
    let args = new URLSearchParams(urlObj.search);
    let tos = ensureArray(urlObj.pathname.split(","));
    for (let to of tos) {
      this.email.to.add(findOrCreatePersonUID(sanitize.emailAddress(to), null));
    }
    let ccs = ensureArray(args.get("cc")?.split(","));
    for (let cc of ccs) {
      this.email.cc.add(findOrCreatePersonUID(sanitize.emailAddress(cc), null));
    }
    this.email.subject = sanitize.label(args.get("subject"), null);
    this.email.text = sanitize.label(args.get("body"), null);
    this.email.html; // Generate HTML from plaintext TODO doesn't work

    /* Attachments
      SECURITY DANGER The URL came come from the web, is untrusted, and may be an attack.
      While we only attach the file into the composer and don't send it immediately,
      a) the user might not check that it's the file he intended to send
      b) simply *reading* the file might trigger OS actions, like printing (`LPT:`),
          `/dev/`, `/proc/`, `/sys/` etc.
      Therefore, not doing this for now.
      Event if you do implement the checks, keep this warning comment.
    for (let filepath of args.getAll("attach")) {
      try {
        sanitize.filename(filepath)
        let file = new File(...);
        this.email.attachments.add(Attachment.fromFile(file));
      } catch (ex) {
        console.error(ex);
      }
    }*/
  }

  /**
   * Insert the identity signature into the HTML body for the composer,
   * or ensure it is present before send. Replaces any existing signature footer.
   *
   * Must operate on the raw body fragment — never on `email.html`, which runs
   * through DOMPurify WHOLE_DOCUMENT and can place the footer outside `</html>`.
   */
  applySignatureHTML(html: string | null | undefined, signatureHTML: string | null | undefined): string {
    let { reply, quote } = this.splitReplyAndQuote(html ?? "");
    reply = this.stripSignatureFooters(reply);

    let sig = normalizeSignatureHTML(signatureHTML)?.trim();
    if (!sig || this.isEmptySignatureHTML(sig)) {
      return reply + quote;
    }
    let footer = `<footer class="signature">${sig}</footer>`;

    let quoteSetting = getLocalStorage("mail.send.quote", "below").value;
    if (quoteSetting == "below" && quote) {
      return reply + footer + quote;
    }
    if (quote) {
      return quote + reply + footer;
    }
    return reply + footer;
  }

  protected isEmptySignatureHTML(sig: string): boolean {
    if (/<img[\s>]/i.test(sig)) {
      return false;
    }
    let text = sig.replace(/<[^>]+>/g, "").replace(/&nbsp;/gi, " ").trim();
    return !text;
  }

  protected hasSignatureFooter(html: string | null | undefined): boolean {
    let { reply } = this.splitReplyAndQuote(html ?? "");
    return /<footer\b[^>]*>/i.test(reply);
  }

  /** Apply current identity signature onto the raw HTML body. */
  applySignature() {
    let identity = this.email.identity;
    this.email.rawHTMLDangerous = this.applySignatureHTML(
      this.email.rawHTMLDangerous,
      identity?.signatureHTML);
  }

  /** Apply importance and read-receipt options before send. */
  applyComposeSendOptions() {
    this.email.headers.delete("Importance");
    this.email.headers.delete("X-Priority");
    this.email.headers.delete("Disposition-Notification-To");
    this.email.headers.delete("Return-Receipt-To");

    if (this.email.importanceLevel === "high") {
      this.email.isImportant = true;
      this.email.headers.set("Importance", "high");
      this.email.headers.set("X-Priority", "1");
    } else if (this.email.importanceLevel === "low") {
      this.email.isImportant = false;
      this.email.headers.set("Importance", "low");
      this.email.headers.set("X-Priority", "5");
    } else {
      this.email.isImportant = false;
    }

    let receiptAddress = this.email.from.emailAddress ?? this.email.identity?.emailAddress;
    if (this.email.requestReadReceipt && receiptAddress) {
      this.email.headers.set("Disposition-Notification-To", receiptAddress);
    }
    if (this.email.requestDeliveryReceipt && receiptAddress) {
      this.email.headers.set("Return-Receipt-To", receiptAddress);
    }
  }

  /**
   * Sets up the email for sending, with all the headers, signature etc.
   *
   * - Insert inline images
   * - Add footer signature
   * - Encrypt
   * - Delete drafts
   *
   * Called by composer.
   * The actual send on the protocol level is done by `EMail.send()`
   */
  async send(): Promise<void> {
    let fromIdentity = this.email.identity;
    assert(fromIdentity, "Need identity set on mail");
    if (fromIdentity.replyTo) {
      this.email.replyTo = new PersonUID(fromIdentity.replyTo, fromIdentity.realname);
    }
    let account = fromIdentity.account;

    // Add the signature when it is missing, but keep user edits made inside
    // the existing signature footer.
    if (!this.hasSignatureFooter(this.email.rawHTMLDangerous)) {
      this.applySignature();
    }
    await this.convertInlineAttachmentsURLs();
    this.applyComposeSendOptions();
    this.email.regenerateTextFromHTML();
    this.email.headers.set("User-Agent", `${appName}/${appVersion}`);

    if (fromIdentity.isCatchAll) {
      if (this.email.from.emailAddress.includes("*")) {
        throw new UserError(gt`Please fill out * in catch-all From address ${this.email.from.emailAddress}`);
      }
      if (!fromIdentity.isEMailAddress(this.email.from.emailAddress)) {
        throw new UserError(gt`From address ${this.email.from.emailAddress} does not match the catch-all identity ${fromIdentity.emailAddress}`);
      }
    }

    if (fromIdentity.account.copyToSelf) {
      addSenderToCC(this.email);
    }

    let previousDrafts = this.getDrafts();
    let previousFolder = this.email.folder;
    if (this.email.folder?.specialFolder != SpecialFolder.Normal) {
      this.email.folder = account.getSpecialFolder(SpecialFolder.Sent);
    }
    this.email.isDraft = false;

    let mail = await SendEncrypted.encryptAsNeeded(this.email);
    await account.send(mail);
    void playNotificationSound("mail-outgoing");

    await this.markComposeSourceFlags();

    this.email.folder = previousFolder;
    this.deleteDrafts(previousDrafts)
      .catch(backgroundError);
  }

  async saveAsDraft(): Promise<void> {
    let account = this.email.folder?.account ?? this.email.identity?.account;
    assert(account, "Need mail account to save draft");
    let draftFolder = account.getSpecialFolder(SpecialFolder.Drafts);
    if (!draftFolder) {
      draftFolder = await account.createToplevelFolder("Drafts");
      draftFolder.specialFolder = SpecialFolder.Drafts;
      await draftFolder.storage.saveFolderProperties(draftFolder);
    }
    // Older copies of this draft (different ItemId), not the message we are saving.
    let previousDrafts = this.getDrafts().filterOnce(mail =>
      mail !== this.email && mail.pID != this.email.pID);

    this.email.isDraft = true;
    // TODO encrypt
    assert(!this.email.shouldEncrypt, "TODO encrypt drafts");

    await draftFolder.addMessage(this.email);

    await this.deleteDrafts(previousDrafts);
  }

  getDrafts(): Collection<EMail> {
    let account = this.email.folder?.account ?? this.email.identity?.account;
    let draftFolder = account.getSpecialFolder(SpecialFolder.Drafts);
    if (!draftFolder) {
      return new ArrayColl<EMail>();
    }
    // Prefer Exchange ItemId when known; fall back to Message-ID.
    let pid = this.email.pID;
    if (pid != null) {
      let byPID = draftFolder.messages.filterOnce(mail => mail.pID == pid);
      if (byPID.hasItems) {
        return byPID;
      }
    }
    let mid = this.email.messageID;
    if (!mid) {
      return new ArrayColl<EMail>();
    }
    return draftFolder.messages.filterOnce(mail => mail.messageID == mid);
  }

  async deleteDrafts(previousDrafts?: Collection<EMail>): Promise<void> {
    previousDrafts ??= this.getDrafts();
    for (let previousDraft of previousDrafts) {
      await previousDraft.deleteMessage();
    }
  }

  /** Mark the original message only after a reply/forward was actually sent. */
  private async markComposeSourceFlags(): Promise<void> {
    let source = this.email.composeSource;
    if (!source && this.email.inReplyTo) {
      const { findMessageByID } = await import("./Store/setStorage");
      source = await findMessageByID(this.email.inReplyTo);
    }
    if (!source) {
      return;
    }
    let actionAt = this.email.sent ?? new Date();
    let marked = false;
    try {
      if (this.email.inReplyTo) {
        marked = true;
        await source.markReplied(actionAt);
      } else if (this.email.subject?.startsWith("Fwd: ")) {
        marked = true;
        await source.markForwarded(actionAt);
      }
    } catch (ex) {
      backgroundError(ex);
    }
    if (marked) {
      await source.saveWritablePropsLocally().catch(backgroundError);
    }
  }
}
