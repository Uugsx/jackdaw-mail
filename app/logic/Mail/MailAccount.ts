import { TCPAccount } from "../Abstract/TCPAccount";
import { MailIdentity } from "./MailIdentity";
import { Folder, SpecialFolder, type MailShareCombinedPermissions, type MailShareIndividualPermissions } from "./Folder";
import type { EMail } from "./EMail";
import type { SMTPAccount } from "./SMTP/SMTPAccount";
import { ContactEntry } from "../Abstract/Person";
import type { PersonUID } from "../Abstract/PersonUID";
import { FilterRuleAction } from "./FilterRules/FilterRuleAction";
import { OAuth2 } from "../Auth/OAuth2";
import { getProvider } from "../Auth/OAuth2Util";
import type { Provider } from "../Auth/OAuth2URLs";
import type { AttachmentStorage } from "../Abstract/Attachment";
import type { Calendar } from "../Calendar/Calendar";
import type { SetupInfo } from "./AutoConfig/SetupInfo";
import { appGlobal } from "../app";
import { sanitize } from "../../../lib/util/sanitizeDatatypes";
import { AbstractFunction, assert } from "../util/util";
import { notifyChangedProperty } from "../util/Observable";
import { RunOnce } from "../util/flow/RunOnce";
import { Collection, ArrayColl } from 'svelte-collections';
import { gt } from "../../l10n/l10n";
import { ConnectionStatus } from "./connectionStatus";

export class MailAccount extends TCPAccount {
  readonly protocol: string = "mail";
  /** SMTP server
   * Only set for IMAP and POP3, but null for JMAP, Exchange etc. */
  @notifyChangedProperty
  _outgoing: SMTPAccount = null;
  spamStrategy: DeleteStrategy = DeleteStrategy.MoveToTrash;
  protected _inbox: Folder;
  readonly canSendOutgoingInvitations: boolean = true;
  /** @see `calendar` */
  protected calendarID: string;
  /** Where we got the config from, during setup */
  source: ConfigSource = null;
  storage: MailAccountStorage;
  /** Ways to store email content in RFC822 format. First storage will be used for reading. */
  contentStorage = new ArrayColl<MailContentStorage>();

  @notifyChangedProperty
  emailAddress: string;
  /** Add the selected mailbox address to Cc on outgoing messages. */
  @notifyChangedProperty
  copyToSelf = false;
  @notifyChangedProperty
  readonly identities = new ArrayColl<MailIdentity>();
  @notifyChangedProperty
  readonly filterRuleActions = new ArrayColl<FilterRuleAction>();
  setup: SetupInfo;

  readonly rootFolders: Collection<Folder> = new ArrayColl<Folder>();
  readDBRunOnce = new RunOnce();
  /** Есть ли связь с сервером. Сбой показывается в списке аккаунтов.
   * Общие ящики сообщают о связи через основной аккаунт: @see `connectionStatusSource` */
  readonly connectionStatus = new ConnectionStatus(
    () => this.notifyObservers(),
    () => this.name,
    () => this.id);

  async startup() {
    await super.startup();
    await this.listFolders();
    assert(this.inbox, gt`Inbox not found`);
    await this.inbox.getNewMessages();
  }

  async readFromDB(): Promise<void> {
    await this.readDBRunOnce.runOnce(async () => {
      await this.storage.readFolderHierarchy(this);
    });
  }

  async listFolders(): Promise<void> {
    throw new AbstractFunction();
  }

  getAllFolders(): ArrayColl<Folder> {
    let allFolders = new ArrayColl<Folder>();
    function iterateFolders(folders: Collection<Folder>) {
      allFolders.addAll(folders);
      for (let folder of folders) {
        iterateFolders(folder.subFolders);
      }
    }
    iterateFolders(this.rootFolders);
    return allFolders;
  }
  findFolder(findFunc: (folder: Folder) => boolean): Folder | null {
    return findSubFolderFromList(this.rootFolders, findFunc);
  }

  /** Чьё состояние связи показывать у этого аккаунта: общий ящик OWA
   * ходит на сервер через основной аккаунт, своих запросов у него нет. */
  get connectionStatusSource(): MailAccount {
    let main = this.mainAccount;
    return main instanceof MailAccount ? main : this;
  }

  get inbox(): Folder | null {
    if (this._inbox) {
      return this._inbox;
    }
    let found = this.findFolder(folder => folder.specialFolder == SpecialFolder.Inbox);
    if (found) {
      this._inbox = found;
    }
    return this._inbox ?? null;
  }

  get outgoing(): SMTPAccount {
    return this._outgoing;
  }
  set outgoing(smtp: SMTPAccount) {
    this._outgoing = smtp;
    if (smtp && smtp.mainAccount != this) {
      smtp.mainAccount = this;
    }
  }

  /** When accepting an incoming invitation, put the meeting in this calendar, by default.
   * The user can still change it in the dropdown. */
  get calendar(): Calendar | null {
    // Don't store the fallback: a calendar picked while the account's own
    // calendars were not known yet would stay the default forever.
    let available = this.calendarsAvailable;
    return available.find(cal => cal.id == this.calendarID) ?? available.first;
  }
  set calendar(cal: Calendar | null) {
    this.calendarID = cal?.id;
    this.save()
      .catch(this.errorCallback);
  }
  get calendarsAvailable(): Collection<Calendar> {
    let dependentCalendars = this.dependentAccounts().filterObservable(acc => !!(acc as Calendar).events) as ArrayColl<Calendar>;
    return dependentCalendars?.hasItems
      ? dependentCalendars
      : appGlobal.calendars.filterObservable(cal => cal.canAcceptAnyInvitation);
  }

  /**
   * Send the email purely on the protocol level,
   * and save it in the Sent folder. Nothing else.
   * All higher-level send preparations (signature, encryption etc.)
   * are done in `ComposeActions.send()`.
   */
  async send(email: EMail): Promise<void> {
    throw new AbstractFunction();
  }

  /** Create a folder on the top level, sibling of Inbox.
   * @see Folder.createSubFolder() */
  async createToplevelFolder(name: string): Promise<Folder> {
    let folder = this.newFolder();
    folder.name = name;
    folder.parent = null;
    this.rootFolders.add(folder);
    folder.initializeSortOrder();
    return folder;
  }

  newFolder(): Folder {
    return new Folder(this);
  }

  newEMailFrom(): EMail {
    let folder = this.getSpecialFolder(SpecialFolder.Sent);
    let email = folder.newEMail();
    email.compose.generateMessageID();
    email.loadedBody = true;
    email.identity = this.identities.first;
    email.from.emailAddress = this.emailAddress;
    email.from.name = this.realname;
    if (email.identity) {
      email.from = email.identity.asPersonUID();
      email.compose.applySignature();
    }
    return email;
  }

  async save(): Promise<void> {
    await super.save();
    console.log("mail account save", this.protocol, this.name, this, "outgoing", this.outgoing, "mainaccount", this.mainAccount, "storage", this.storage);
    await this.storage?.saveAccount(this);
  }

  /** Пользователь сохранил новые учётные данные. Если аккаунт был выкинут
   * из сессии, входим сразу, а не после перезапуска приложения. */
  async applyChangedCredentials(): Promise<void> {
    if (this.isLoggedIn) {
      return;
    }
    await this.login(false);
  }

  async deleteIt(): Promise<void> {
    await super.deleteIt();
    await this.storage?.deleteAccount(this);
    appGlobal.emailAccounts.remove(this);
  }

  isMyEMailAddress(emailAddress: string): boolean {
    if (!emailAddress) {
      return false;
    }
    let normalizedAddress = emailAddress.toLowerCase();
    return this.emailAddress?.toLowerCase() == normalizedAddress ||
      this.identities.some(id => id.isEMailAddress(emailAddress));
  }

  /**
   * @returns `MailIdentity` of *this* account, for the given email address.
   * @see also global function `findIdentityForEMailAddress()`, which searches all accounts. */
  findIdentityForEMailAddress(emailAddress: string): MailIdentity | null {
    for (let identity of this.identities) {
      if (identity.isEMailAddress(emailAddress)) {
        return identity;
      }
    }
    return null;
  }

  /** The `specialFolder` in this account, or null if the mailbox has none.
   *
   * Use this, and not `getSpecialFolder()`, whenever the caller has its own
   * fallback: `getSpecialFolder()` ends in `rootFolders.first`, so a `if
   * (!folder)` test after it never fires and the caller silently operates on
   * the root folder instead. */
  findSpecialFolder(specialFolder: SpecialFolder): Folder | null {
    return this.getAllFolders().find(folder => folder.specialFolder == specialFolder) ?? null;
  }

  /** Get the `specialFolder` in this account. Falls back to a related folder,
   * and ultimately to the root folder, so that callers which need *a* folder
   * always get one. Never returns null - see `findSpecialFolder()`. */
  getSpecialFolder(specialFolder: SpecialFolder): Folder {
    let folder = this.findSpecialFolder(specialFolder);
    if (folder) {
      return folder;
    }
    if (specialFolder == SpecialFolder.Sent) {
      return this.getSpecialFolder(SpecialFolder.Inbox);
    }
    if (specialFolder == SpecialFolder.Drafts) {
      return this.getSpecialFolder(SpecialFolder.Sent);
    }
    return this.rootFolders.first;
  }

  provider(): Provider | null {
    return getProvider(this);
  }

  canShareWithPersons(): boolean {
    return false;
  }

  async getSharedPersons(): Promise<ArrayColl<PersonUID>> {
    return new ArrayColl<PersonUID>();
  }

  async deleteSharedPerson(Person: PersonUID) {
  }

  async addSharedPerson(person: PersonUID, mailFolder: Folder | null, includeSubfolders: boolean, access: MailShareCombinedPermissions, ...permissions: MailShareIndividualPermissions[]) {
  }

  fromConfigJSON(json: any) {
    super.fromConfigJSON(json);
    this.emailAddress = sanitize.emailAddress(json.emailAddress);
    this.copyToSelf = sanitize.boolean(json.copyToSelf, false);
    this.identities.clear();
    for (let idJSON of sanitize.array(json.identities, [])) {
      try {
        this.identities.add(MailIdentity.fromConfigJSON(idJSON, this));
      } catch (ex) {
        this.errorCallback(ex);
      }
    }
    this.filterRuleActions.clear();
    for (let filterJSON of sanitize.array(json.filterRuleActions, [])) {
      try {
        let rule = new FilterRuleAction(this);
        rule.fromJSON(filterJSON);
        this.filterRuleActions.add(rule);
      } catch (ex) {
        this.errorCallback(ex);
      }
    }
    if (json.oAuth2) {
      this.oAuth2 = OAuth2.fromConfigJSON(json.oAuth2, this);
      this.oAuth2.subscribe(() => this.notifyObservers());
    }
    // On startup, the calendar might not be read yet, so we store the ID and resolve in the getter.
    this.calendarID = sanitize.alphanumdash(json.calendarID, null);

    if (!appGlobal.me.name && this.realname) {
      appGlobal.me.name = this.realname;
    }
    if (!appGlobal.me.emailAddresses.find(c => c.value == this.emailAddress)) {
      appGlobal.me.emailAddresses.add(new ContactEntry(this.emailAddress, "account"));
    }
  }
  toConfigJSON(): any {
    let json = super.toConfigJSON();
    json.identities = this.identities.contents.map(id => id.toConfigJSON());
    json.filterRuleActions = this.filterRuleActions.contents.map(rule => rule.toJSON());
    json.oAuth2 = this.oAuth2?.toConfigJSON();
    json.emailAddress = this.emailAddress;
    json.copyToSelf = this.copyToSelf;
    json.calendarID = this.calendarID;
    return json;
  }

  /** Fills this object with the config values from the other config */
  cloneFrom(other: MailAccount) {
    this.name = other.name;
    this.url = other.url;
    this.hostname = other.hostname;
    this.port = other.port;
    this.tls = other.tls;
    this.authMethod = other.authMethod;
    this.username = other.username;
    this.password = other.password;
    this.emailAddress = other.emailAddress;
    this.copyToSelf = other.copyToSelf;
    this.realname = other.realname;
    this.calendarID = other.calendarID;

    // objects
    this.oAuth2 = other.oAuth2;
    if (this.oAuth2) {
      // It logs in as us now, and its login web session is `webSessionID` = our account ID
      this.oAuth2.account = this;
    }
    this.identities.addAll(other.identities);
  }

  toDebugString() {
    return `${this.protocol.toUpperCase()} account, name ${this.name}, ID ${this.id}, host ${this.hostname}:${this.port}, URL ${this.url}, username ${this.username}, email ${this.emailAddress}`;
  }

  toString(): string {
    return this.toDebugString();
  }
}

function findSubFolderFromList(folders: Collection<Folder>, findFunc: (folder: Folder) => boolean): Folder | null {
  for (let folder of folders) {
    if (findFunc(folder)) {
      return folder;
    }
    let sub = findSubFolderFromList(folder.subFolders, findFunc);
    if (sub) {
      return sub;
    }
  }
  return null;
}

export type ConfigSource = "ispdb" | "autoconfig-isp" | "autodiscover-xml" | "autodiscover-json" | "guess" | "manual" | "harddisk" | "builtin" | null;

export interface MailAccountStorage {
  saveAccount(account: MailAccount): Promise<void>;
  deleteAccount(account: MailAccount): Promise<void>;
  readFolderHierarchy(account: MailAccount): Promise<void>;
  saveFolder(folder: Folder): Promise<void>;
  saveFolderProperties(folder: Folder): Promise<void>;
  deleteFolder(folder: Folder): Promise<void>;
  readMessage(email: EMail): Promise<void>;
  readMessageWritableProps(email: EMail): Promise<void>;
  readMessageBody(email: EMail): Promise<void>;
  saveMessage(email: EMail): Promise<void>;
  saveMessages(emails: Collection<EMail>): Promise<void>;
  saveMessageWritableProps(email: EMail): Promise<void>;
  saveMessageTags(email: EMail): Promise<void>;
  deleteMessage(email: EMail): Promise<void>;
  readAllMessages(folder: Folder, limit?: number, startWith?: number): Promise<void>;
  readAllMessagesMainProperties(folder: Folder, limit?: number, startWith?: number): Promise<void>;

  // Необязательные пакетные варианты: одна транзакция на все письма.
  // Хранилище без них получает те же письма по одному.
  /** Как `saveMessage()` для каждого письма, без пропуска писем без темы */
  saveMessagesMetadata?(emails: EMail[]): Promise<void>;
  /** Как `saveMessageWritableProps()` для каждого письма */
  saveMessagesWritableProps?(emails: EMail[]): Promise<void>;
  /** Как `deleteMessage()` для каждого письма */
  deleteMessages?(emails: EMail[]): Promise<void>;
  /** Отмечает прочитанными или непрочитанными все письма папки в хранилище */
  markFolderReadLocally?(folder: Folder, isRead: boolean): Promise<void>;
}

export interface MailContentStorage extends AttachmentStorage {
  save(email: EMail): Promise<void>;
  read(email: EMail): Promise<void>;
  deleteIt(email: EMail): Promise<void>;
}

export enum DeleteStrategy {
  DeleteImmediately = 1,
  Flag = 2,
  MoveToTrash = 3,
}
