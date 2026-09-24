import { ExchangeMailAccount } from "../EWS/ExchangeMailAccount";
import { MailIdentity } from "../MailIdentity";
import { AuthMethod, type Account } from "../../Abstract/Account";
import { Provider } from "../../Auth/OAuth2URLs";
import type { EMail } from "../EMail";
import { SpecialFolder, type Folder, type MailShareCombinedPermissions, type MailShareIndividualPermissions } from "../Folder";
import { OWAFolder } from "./OWAFolder";
import type { OWAEMail } from "./OWAEMail";
import { owaCategoriesPresent } from "./OWAEMail";
import { OWAError } from "./OWAError";
import type { OWANotifications } from "./Notification/OWANotifications";
import { OWAExchangeNotifications } from "./Notification/OWAExchangeNotifications";
import { OWAOffice365Notifications } from "./Notification/OWAOffice365Notifications";
import { newAccountForProtocol } from "../AccountsList/MailAccounts";
import { newAddressbookForProtocol } from "../../Contacts/AccountsList/Addressbooks";
import { OWAGAL } from "../../Contacts/OWA/OWAGAL";
import { OWAAddressbook } from "../../Contacts/OWA/OWAAddressbook";
import { newCalendarForProtocol} from "../../Calendar/AccountsList/Calendars";
import { OWACalendar } from "../../Calendar/OWA/OWACalendar";
import { OWARequest } from "./Request/OWARequest";
import { OWACreateItemRequest } from "./Request/OWACreateItemRequest";
import { OWAUpdateItemRequest } from "./Request/OWAUpdateItemRequest";
import { OWAGetUserConfigurationRequest } from "./Request/OWAGetUserConfigurationRequest";
import { OWASubscribeToNotificationRequest } from "./Request/OWASubscribeToNotificationRequest";
import { owaCreateNewTopLevelFolderRequest, owaFindFoldersRequest, owaFindFolderCountsByRootRequest, owaFolderCountsRequest, owaSharedFolderRequest } from "./Request/OWAFolderRequests";
import { OWALoginBackground } from "./Login/OWALoginBackground";
import { deleteExchangePermissions, setExchangePermissions } from "../EWS/ExchangePermission";
import type { PersonUID } from "../../Abstract/PersonUID";
import { OWAAuth } from "../../Auth/OWAAuth";
import { type Attachment, ContentDisposition } from "../../Abstract/Attachment";
import { LoginError } from "../../Abstract/Account";
import { ensureLicensed } from "../../util/LicenseClient";
import { appGlobal } from "../../app";
import { Throttle } from "../../util/flow/Throttle";
import { Semaphore } from "../../util/flow/Semaphore";
import { RunOnce } from "../../util/flow/RunOnce";
import { Lock } from "../../util/flow/Lock";
import { notifyChangedProperty } from "../../util/Observable";
import { isNetworkError, waitUntilOnline } from "../../util/netUtil";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { assert, blobToBase64, ensureArray, NotSupported, NotReached, sleep } from "../../util/util";
import { gt } from "../../../l10n/l10n";
import { ArrayColl, type Collection } from "svelte-collections";
import {
  getTagsSyncAccountId,
  setTagsSyncAccountId,
  syncTagsFromMasterCategoryList,
  type MasterCategoryEntry,
} from "../../Abstract/Tag";

const kOutlookCategoryColors = [
  "#ED616F", "#FB6F25", "#E1B46D", "#FCD146", "#56A659",
  "#3FA296", "#82A034", "#3096D0", "#8C82D0", "#D146A3",
  "#6B8E9E", "#4A6777", "#8A8A8A", "#555555", "#000000",
  "#B52A32", "#C65A0A", "#9C6D22", "#C79F12", "#2D7B36",
  "#207A70", "#64751F", "#1F6D9A", "#5E5BA5", "#9B2D79",
];
const kOWAPollIntervalMs = 3_000;
/** Badge-only FindFolder for delegate mailboxes. */
const kOWASharedCountsPollIntervalMs = 3_000;
/** RowNotification subscriptions are batched to stay under OWA header limits. */
const kOWANotificationFolderBatchSize = 8;
/** Dirty non-Inbox folders polled per background cycle so Inbox stays responsive. */
const kOWAMaxDirtyFoldersPerPoll = 3;
/** Throttle retries per request; each waits 5s. */
const kOWAMaxThrottleRetries = 6;
/** Shared mailboxes tend to have many active subfolders. */
const kOWAMaxDirtyFoldersPerPollShared = 2;
/** Shared mailboxes: refresh server folder counts in rotating batches. */
const kOWAFolderCountsPerPollShared = 12;
/** How many shared accounts the main poller may sync at once. */
const kSharedPollConcurrency = 2;
/** Extra Row subscriptions per shared mailbox for folders that currently have unread. */
const kSharedUnreadRowSubscriptionLimit = 3;
/** On-premise OWA may need time to activate a session after the login POST. */
const kOWALoginSessionRetryDelaysSeconds = [1, 2, 4, 8, 16, 30];
/** Distinguished root of the optional Exchange Online Archive mailbox. */
const kArchiveMailboxRoot = "archivemsgfolderroot";

export class OWAAccount extends ExchangeMailAccount {
  readonly protocol: string = "owa";
  readonly folderMap = new Map<string, OWAFolder>;
  /**
   * We get notifications for folders we're not interested in.
   * We filter them out by checking that the parent exists.
   * But we have to special-case the root folder,
   * since Jackdaw doesn't use a dedicated root folder object.
   */
  protected msgFolderRootID: string | undefined;
  /**
   * OAuth2 authorization header for Hotmail or Office 365 environments.
   * In future it might be possible to perform requests from the front end?
   */
  authorizationHeader: string | undefined;
  /** requests only work after the login form has been successfully submitted */
  @notifyChangedProperty
  protected hasLoggedIn = false;
  protected notifications: OWANotifications;
  protected throttle = new Throttle(50, 1);
  protected semaphore = new Semaphore(8);
  /** Serialize explicit-logon shared mailbox requests; each may open a MAPI session. */
  protected sharedMailboxSemaphore = new Semaphore(1);
  protected lastSharedMailboxRequestAt = 0;
  protected loginRunOnce = new RunOnce();
  protected startupRunOnce = new RunOnce();
  /** Latches `startup()`. Cleared on logout so a re-login starts up again. */
  protected hasStartedUp = false;
  protected listFoldersLock = new Lock();
  /** One silent session refresh at a time, however many requests hit the 401. */
  protected sessionRefreshSemaphore = new Lock();
  protected poller: ReturnType<typeof setInterval> | null = null;
  protected sharedCountsPoller: ReturnType<typeof setInterval> | null = null;
  protected sharedFoldersPoller: ReturnType<typeof setInterval> | null = null;
  protected pollIntervalMs = kOWAPollIntervalMs;
  protected pollInProgress = false;
  protected pollBackgroundInProgress = false;
  protected sharedFoldersPollInProgress = false;
  /** Один цикл восстановления для всех запросов во время одного сбоя. */
  protected networkRecoveryPromise: Promise<void> | null = null;
  protected pollFolderCountOffset = 0;
  /**
   * Shared mailbox folder the user is currently viewing.
   * Polled like a personal Inbox so the open list stays fresh without
   * switching folders (push alone is unreliable for shared subfolders).
   */
  watchedFolder: OWAFolder | null = null;
  /** Some shared / on-prem endpoints reject `ReturnNewItemIds` on Move/Copy.
   * Cleared after the first rejection, so we ask only once per session. */
  supportsReturnNewItemIds = true;
  protected watchedRowFolderID: string | null = null;
  /** Folders we already hold a Row subscription for on this channel. */
  readonly subscribedRowFolderIDs = new Set<string>();
  /** Shared Row subscriptions can be rejected for explicit-logon folder IDs. */
  protected sharedRowSubscriptionFailures = new Set<string>();
  protected notificationRun: Promise<void> | null = null;
  protected notificationFailureCount = 0;
  protected notificationSubscriptionSemaphore = new Semaphore(1);
  protected notificationChannelReady = false;
  protected notificationChannelReadyPromise: Promise<void> | null = null;
  protected rowNotificationsDisabled = false;
  /** Avoid duplicate SubscribeToNotification calls on the same OWA channel. */
  protected notificationsSubscribedForChannel: string | null = null;
  /** Row folder set last pushed to Exchange for dependent mailboxes. */
  protected lastDependentRowFolderSignature = "";
  /** Explicit-logon mailboxes blocked after SessionLimit until this timestamp. */
  protected sharedMailboxBlockedUntil = new Map<string, number>();
  /** Assigned by the notification transport: on-premise Exchange dictates it,
   * Office 365 lets the client pick one. */
  notificationChannelID: string = crypto.randomUUID();
  // null: if this is our account
  // msgfolderroot: if this is an account shared with us
  // inbox: if this is an inbox shared with us
  protected sharedFolderRoot: "msgfolderroot" | "inbox" | null;

  constructor() {
    super();
    assert(appGlobal.remoteApp.OWA, "OWA: Need backend");
  }

  newFolder(): OWAFolder {
    return new OWAFolder(this);
  }

  /**
   * The cookie jar used for OWA requests. This allows you to have
   * multiple OWA accounts for the same host.
   */
  get partition(): string {
    return 'persist:' + this.webSessionID;
  }

  // See below as to why this doesn't use OAuth2.
  get isLoggedIn(): boolean {
    if (this.mainAccount) {
      return this.mainAccount.isLoggedIn;
    }
    return this.hasLoggedIn;
  }

  async testLoggedIn(): Promise<boolean> {
    if (this.mainAccount) {
      throw new NotReached();
    }
    this.authorizationHeader = await appGlobal.remoteApp.OWA.getAnyScrapedAuth(this.partition);
    let url = this.url + 'service.svc?action=FindFolder&EP=1';
    let options = {
      body: JSON.stringify(owaFindFoldersRequest(false)),
      headers: {
        Action: "FindFolder",
        Authorization: this.authorizationHeader,
        "Content-Type": "application/json",
        "x-anchormailbox": this.emailAddress,
      },
      method: "POST",
    };
    if (this.authorizationHeader) {
      let response = await fetch(url, options);
      if ([401, 440].includes(response.status)) {
        return false;
      }
      try {
        await response.json();
        return true;
      } catch (ex) {
        return false;
      }
    }
    let response = await appGlobal.remoteApp.OWA.fetchJSON(this.partition, url, options);
    if ([401, 440].includes(response.status)) {
      return false;
    }
    if (!response.json && response.url != url && response.contentType?.toLowerCase().split(";")[0].trim() == "text/html") {
      return false;
    }
    return Boolean(response.ok || response.json);
  }

  async verifyLogin(): Promise<void> {
    if (this.mainAccount) {
      throw new NotReached();
    }
    await this.loginCommon(true);
  }

  /**
   * OWA full page login resembles OAuth2, so we label it as such,
   * although it's actually Office 365 itself doing its own OAuth2.
   */
  protected async loginCommon(interactive: boolean): Promise<void> {
    if (this.authMethod == AuthMethod.OAuth2) {
      this.oAuth2 ??= new OWAAuth(this);
      let owaAuth = this.oAuth2 as OWAAuth;
      // The on-premise OWA session is stored in the account's persistent
      // browser partition. Reuse it first; when the server has expired that
      // session, a saved password can restore it without opening a login tab.
      if (await this.testLoggedIn()) {
        owaAuth.isLoggedIn = true;
        return;
      }
      if (this.password) {
        try {
          await this.loginWithPasswordForm();
          owaAuth.isLoggedIn = true;
          return;
        } catch (ex) {
          if (!interactive) {
            throw ex;
          }
        }
      }
      await owaAuth.login(interactive);
    } else if (!await this.testLoggedIn()) {
      await this.loginWithPasswordForm();
    }
  }

  protected async loginWithPasswordForm(): Promise<void> {
    let elements = await OWALoginBackground.findLoginElements(this.url, this.partition);
    if (!elements) {
      // HTTP 440 leaves a dead session cookie that makes `/owa/` reload
      // itself instead of showing the form. Drop it and load logon.aspx.
      await appGlobal.remoteApp.OWA.clearStorageData(this.partition);
      elements = await OWALoginBackground.findLoginElements(this.url, this.partition);
    }
    if (!elements) {
      throw new Error(gt`Could not find login form`);
    }
    let response = await OWALoginBackground.submitLoginForm(this.username, this.password, this.partition, elements);
    let formURL = new URL(elements.url);
    let responseURL = new URL(response.url);
    if (response.status == 401 || responseURL.origin == formURL.origin && /\/auth\/logon\.aspx$/i.test(responseURL.pathname) && responseURL.searchParams.get("reason") == "2") {
      throw new LoginError(null, gt`Password incorrect`);
    }
    let isSessionActivationError = response.status == 500 && responseURL.origin == formURL.origin && /\/auth\/errorfe\.aspx$/i.test(responseURL.pathname);
    // Successful OWA logon is a 302 to `/owa/`. Treat that as OK even when
    // the backend reports the redirect itself rather than the final page.
    let loggedIn = false;
    if (!response.ok && ![302, 303].includes(response.status)) {
      if (!isSessionActivationError) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      // Some on-premise OWA builds return HTTP 500 from errorfe.aspx after
      // setting a valid session cookie. Prefer the session check over that
      // misleading final response so startup login can remain silent.
      for (let attempt = 0; attempt <= kOWALoginSessionRetryDelaysSeconds.length; attempt++) {
        loggedIn = await this.testLoggedIn();
        if (loggedIn || attempt == kOWALoginSessionRetryDelaysSeconds.length) {
          break;
        }
        await sleep(kOWALoginSessionRetryDelaysSeconds[attempt]);
      }
      if (!loggedIn) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
    }
    if (!loggedIn && !await this.testLoggedIn()) {
      throw new LoginError(null, `Login check failed`);
    }
  }

  async login(interactive: boolean): Promise<void> {
    await this.loginRunOnce.runOnce(async () => {
      if (this.mainAccount) {
        await this.mainAccount.login(interactive);
        await this.listFolders();
        if (this.inbox) {
          if (this.sharedFolderRoot) {
            this.inbox.dirty = true;
          } else {
            await this.inbox.getNewMessages();
          }
        }
        return;
      }
      await ensureLicensed();
      await super.login(interactive);
      await this.loginCommon(interactive);
      this.authorizationHeader = await appGlobal.remoteApp.OWA.getAnyScrapedAuth(this.partition);
      this.hasLoggedIn = true;
      this.rowNotificationsDisabled = false;
      this.notificationChannelID = crypto.randomUUID();
      this.notifyObserversOfSubaccounts();

      await this.startup();
      // `startup()` is also called by the desktop startup coordinator. Keep
      // the timer alive when a session is re-established after a 401/440.
      this.startPolling();
    });
  }

  async startup() {
    // `RunOnce` only de-duplicates *concurrent* calls; it clears itself once
    // the first awaiter returns. Both `login()` and the desktop startup
    // coordinator call this, sequentially, so without a latch the whole body -
    // including the destructive `listFolders()` - runs twice at every launch.
    if (this.hasStartedUp) {
      return;
    }
    await this.startupRunOnce.runOnce(async () => {
      if (this.hasStartedUp) {
        return;
      }
      this.hasStartedUp = true;
      try {
        // Do the MailAccount startup steps here so a failed initial message
        // scan cannot prevent the fallback poller from starting.
        await this.listFolders();
        let inbox = this.findInboxFolder();
        assert(inbox, gt`Inbox not found`);
        try {
          if (this.sharedFolderRoot) {
            if (inbox) {
              inbox.dirty = true;
            }
          } else {
            await inbox.getNewMessages();
          }
        } catch (ex) {
          this.errorCallback(ex);
        }

        if (!this.isDependentAccount) {
          this.startPolling();
        }

        await this.startupDependentAccounts();

        if (!this.isDependentAccount) {
          this.startNotifications();
        }

        if (!this.isDependentAccount) {
          try {
            await this.loadCategoryColors();
          } catch {
            // Optional category metadata
          }
        }

        // Create primary addressbook automatically
        try {
          let haveAddressbook = appGlobal.addressbooks.some(addressbook => addressbook.dependsOn(this));
          if (!haveAddressbook) {
            let response = await this.callOWA(new OWAGetPeopleFiltersRequest());
            let folder = response.find(ab => !ab.IsReadOnly && ab.FolderId?.Id); // first one is main addressbook
            if (folder) {
              let addressbook = this.createAddressbookAccount(folder, true);
              appGlobal.addressbooks.add(addressbook);
              await addressbook.save();
            }
          }
        } catch {
          // Optional addressbook initialization
        }

        if (!this.isDependentAccount) {
          try {
            let haveGAL = appGlobal.searchOnlyAddressbooks.some(ab =>
              ab.mainAccount == this && ab.protocol == "gal-owa");
            if (!haveGAL) {
              appGlobal.searchOnlyAddressbooks.add(new OWAGAL(this));
            }
          } catch {
            // Optional GAL
          }
        }
      } finally {
        if (!this.isDependentAccount) {
          await this.refreshNotificationSubscriptions();
        }
      }
    });
  }

  protected async startupDependentAccounts(): Promise<void> {
    for (let dependent of this.dependentAccounts()) {
      if (dependent instanceof OWAAccount) {
        try {
          await dependent.listFolders();
          if (dependent.inbox) {
            dependent.inbox.dirty = true;
          }
          dependent.startPolling();
        } catch (ex) {
          dependent.errorCallback(ex);
        }
      }
      dependent.startup().catch(dependent.errorCallback);
    }
  }

  /**
   * OWA message items contain category names but not their Master Category List
   * colors. Load the mailbox list once so existing Outlook colors are retained.
   * This is optional metadata and must not prevent mail startup if the server
   * does not expose the configuration endpoint.
   */
  protected async loadCategoryColors(): Promise<void> {
    try {
      let config = await this.callOWA(new OWAGetUserConfigurationRequest());

      // Load user signature if configured on the server
      let userOptions = config?.UserOptions ?? config?.userOptions ?? config?.Options ?? config?.options ?? config;
      let sig = userOptions?.SignatureHtml ?? userOptions?.signatureHtml ??
        userOptions?.SignatureText ?? userOptions?.signatureText ??
        config?.SignatureHtml ?? config?.signatureHtml;
      if (typeof sig === "string" && sig.trim()) {
        let signatureHTML = sig.trim();
        if (!/<[a-z][\s\S]*>/i.test(signatureHTML)) {
          signatureHTML = `<p>${signatureHTML.replace(/\r?\n/g, "<br>")}</p>`;
        }
        for (let identity of this.identities) {
          if (!identity.signatureHTML) {
            identity.signatureHTML = signatureHTML;
            await this.save();
          }
        }
      }

      let syncAccount = resolveOWAAccountForTagSync(this);
      if (!syncAccount) {
        return;
      }
      if (!getTagsSyncAccountId()) {
        setTagsSyncAccountId(syncAccount.id);
      }
      let entries = await syncAccount.fetchMasterCategoryList();
      await syncTagsFromMasterCategoryList(entries, { removeOthers: false });
    } catch {
      // Category colors and signature are an enhancement; keep mail startup independent of it.
    }
  }

  /**
   * @param keepStoredSession
   *   Keep the browser partition, i.e. the persisted OWA cookies. Set this
   *   when the session merely looks expired: dropping the cookie jar forces
   *   the user through the password form or an interactive login tab, which is
   *   far too harsh a response to one failed background request.
   */
  async logout(keepStoredSession = false): Promise<void> {
    this.stopPolling();
    for (let dependent of this.dependentAccounts()) {
      if (dependent instanceof OWAAccount) {
        dependent.stopPolling();
      }
    }
    this.hasLoggedIn = false;
    this.hasStartedUp = false;
    this.stopNotifications();
    this.notifyObserversOfSubaccounts();
    if (!keepStoredSession) {
      try {
        // Ends the session server-side, so only do it on a deliberate logout.
        await appGlobal.remoteApp.OWA.serverLogoff(this.partition, this.url);
      } catch (ex) {
        console.warn("OWA server logoff failed", ex);
      }
    }
    if (keepStoredSession) {
      // A silent 401/440 recovery must keep the persistent OWA cookies.
      // Account.logout() delegates to OWAAuth.logout(), which clears them.
      if (this.oAuth2 instanceof OWAAuth) {
        this.oAuth2.isLoggedIn = false;
      }
      await this.disconnect();
    } else {
      await super.logout();
      if (!this.oAuth2) {
        await appGlobal.remoteApp.OWA.clearStorageData(this.partition);
      }
    }
  }

  async disconnect() {
    this.stopPolling();
    let galAB = appGlobal.searchOnlyAddressbooks.find(ab => ab.mainAccount == this);
    if (galAB) {
      appGlobal.searchOnlyAddressbooks.remove(galAB);
    }
  }

  /**
   * Background polling keeps mailboxes in sync when push fails or lags.
   * Shared mailboxes use the same interval as the primary mailbox; SessionLimit
   * backoff is handled per mailbox via sharedMailboxBlockedUntil.
   */
  protected startPolling(intervalMs = kOWAPollIntervalMs): void {
    this.stopPolling();
    this.pollIntervalMs = intervalMs;
    this.poller = setInterval(() => {
      if (this.isLoggedIn) {
        this.pollInbox().catch(ex => this.handlePollingError(ex));
      }
    }, intervalMs);
    if (this.isLoggedIn) {
      this.pollInbox().catch(ex => this.handlePollingError(ex));
    }
    if (!this.isDependentAccount) {
      this.startSharedCountsPolling();
      this.startSharedFoldersPolling();
    }
  }

  /** Независимая быстрая синхронизация shared-папок не должна ждать Inbox основного ящика. */
  protected startSharedFoldersPolling(): void {
    if (this.sharedFoldersPoller) {
      clearInterval(this.sharedFoldersPoller);
    }
    let tick = () => {
      if (!this.isLoggedIn || this.sharedFoldersPollInProgress) {
        return;
      }
      this.sharedFoldersPollInProgress = true;
      this.pollDependentSharedFolders()
        .catch(ex => this.handlePollingError(ex))
        .finally(() => {
          this.sharedFoldersPollInProgress = false;
        });
    };
    tick();
    this.sharedFoldersPoller = setInterval(tick, kOWAPollIntervalMs);
  }

  /** Обновление счётчиков основного и общих ящиков через GetFolder без загрузки тел писем. */
  protected startSharedCountsPolling(): void {
    if (this.sharedCountsPoller) {
      clearInterval(this.sharedCountsPoller);
    }
    let tick = () => {
      if (!this.isLoggedIn) {
        return;
      }
      let retryRowSubscriptions = false;
      for (let account of [this, ...this.dependentAccounts()]) {
        if (!(account instanceof OWAAccount) || !account.isLoggedIn) {
          continue;
        }
        let mailboxKey = account.emailAddress.toLowerCase();
        let isDependent = account.isDependentAccount;
        let blockedUntil = isDependent ? this.sharedMailboxBlockedUntil.get(mailboxKey) ?? 0 : 0;
        if (isDependent && blockedUntil > Date.now()) {
          continue;
        }
        if (isDependent && blockedUntil > 0) {
          this.sharedMailboxBlockedUntil.delete(mailboxKey);
          if (this.sharedRowSubscriptionFailures.delete(account.id)) {
            retryRowSubscriptions = true;
          }
        }
        account.refreshAllFolderCounts().catch(ex => {
          if (!(ex instanceof OWAError && ex.isSessionLimit)) {
            account.errorCallback(ex);
          }
        });
      }
      let depSig = this.dependentNotificationFolderIDs().join("|");
      if (depSig !== this.lastDependentRowFolderSignature || retryRowSubscriptions) {
        void this.refreshNotificationSubscriptions();
      }
    };
    tick();
    this.sharedCountsPoller = setInterval(tick, kOWASharedCountsPollIntervalMs);
  }

  /**
   * OWA's web client keeps a pending request open and receives a response as
   * soon as Exchange has a mailbox event. Use the same mechanism when it is
   * available, while keeping the Inbox poller as a recovery path.
   */
  protected startNotifications(): void {
    if (this.isDependentAccount || !this.isLoggedIn || this.notificationRun) {
      return;
    }
    let run = this.runNotifications();
    this.notificationRun = run;
    run.catch(this.errorCallback).finally(() => {
      if (this.notificationRun == run) {
        this.notificationRun = null;
      }
    });
  }

  /** Tears the stream down so that `startNotifications()` works again after a
   * re-login. Without this, `notificationRun` never settles, its guard makes
   * every later start a no-op, and the account is stuck on polling. */
  protected stopNotifications(): void {
    this.notifications?.stop();
    this.notificationRun = null;
    this.notificationsSubscribedForChannel = null;
    this.lastDependentRowFolderSignature = "";
    this.subscribedRowFolderIDs.clear();
    this.sharedRowSubscriptionFailures.clear();
    this.notificationChannelReady = false;
  }

  protected async runNotifications(): Promise<void> {
    while (this.isLoggedIn) {
      let channelReadyResolve!: () => void;
      let channelReadyReject!: (reason?: unknown) => void;
      let channelReady = new Promise<void>((resolve, reject) => {
        channelReadyResolve = resolve;
        channelReadyReject = reject;
      });
      channelReady.catch(() => void 0);
      this.notificationChannelReadyPromise = channelReady;
      this.notificationChannelReady = false;
      try {
        this.notifications = this.provider() == Provider.Office365
          ? new OWAOffice365Notifications(this)
          : new OWAExchangeNotifications(this);
        // Both transports bind subscriptions to the channel ID and only know
        // it once the channel exists, so subscribe from the callback rather
        // than before `start()`.
        await this.notifications.start(async () => {
          this.notificationChannelReady = true;
          channelReadyResolve();
          await this.subscribeNotifications();
        });
        this.notificationFailureCount = 0;
      } catch (ex) {
        channelReadyReject(ex);
        if (!this.isLoggedIn) {
          return;
        }
        if (isNetworkError(ex)) {
          this.scheduleNetworkRecovery(ex);
          this.notificationFailureCount++;
          if (!navigator.onLine) {
            await waitUntilOnline();
          } else {
            await sleep(Math.min(30, this.notificationFailureCount * 5));
          }
          continue;
        }
        this.startPolling();
        for (let account of this.dependentAccounts()) {
          if (account instanceof OWAAccount) {
            account.startPolling();
          }
        }
        this.errorCallback(ex);
        this.notificationFailureCount++;
        let backoffSec = Math.min(30, this.notificationFailureCount * 5);
        await sleep(backoffSec);
      } finally {
        if (this.notificationChannelReadyPromise == channelReady) {
          this.notificationChannelReadyPromise = null;
          this.notificationChannelReady = false;
        }
      }
    }
  }

  protected notificationFolderIDs(): string[] {
    if (this.rowNotificationsDisabled) {
      return [];
    }
    let ids: string[] = [];
    if (this.inbox?.id) {
      ids.push(this.inbox.id);
    }
    if (this.watchedFolder?.id && !ids.includes(this.watchedFolder.id)) {
      ids.push(this.watchedFolder.id);
    }
    // Personal: Inbox + open folder only (lazy sync for everything else).
    // Shared: same Row scope as above. Calendar/contacts still get Row subscriptions.
    this.appendCalendarContactFolderIDs(ids);
    return ids;
  }

  /** Calendar and contacts folder IDs for RowNotification (item-level sync). */
  protected appendCalendarContactFolderIDs(ids: string[]): void {
    for (let calendar of appGlobal.calendars) {
      if (calendar instanceof OWACalendar && calendar.mainAccount == this && calendar.folderID
          && !ids.includes(calendar.folderID)) {
        ids.push(calendar.folderID);
      }
    }
    for (let addressbook of appGlobal.addressbooks) {
      if (addressbook instanceof OWAAddressbook && addressbook.mainAccount == this
          && addressbook.folderID && !ids.includes(addressbook.folderID)) {
        ids.push(addressbook.folderID);
      }
    }
  }

  /** Folder IDs that should have delegate Row subscriptions for one shared mailbox.
   * Matches on-prem OWA capture: special folders + open folder + a few unread folders. */
  protected sharedAccountRowFolderIDs(account: OWAAccount): string[] {
    let ids: string[] = [];
    for (let folder of account.getAllFolders().contents) {
      if (folder instanceof OWAFolder && folder.id &&
          [SpecialFolder.Inbox, SpecialFolder.Trash, SpecialFolder.Drafts, SpecialFolder.Spam]
            .includes(folder.specialFolder)) {
        ids.push(folder.id);
      }
    }
    let watched = account.watchedFolder;
    if (watched instanceof OWAFolder && watched.id && !ids.includes(watched.id)) {
      ids.push(watched.id);
    }
    for (let folder of account.getAllFolders().contents
      .filter((f): f is OWAFolder =>
        f instanceof OWAFolder && !!f.id && f.countUnread > 0 && !ids.includes(f.id))
      .sort((a, b) => b.countUnread - a.countUnread)
      .slice(0, kSharedUnreadRowSubscriptionLimit)) {
      ids.push(folder.id);
    }
    return ids;
  }

  /** All delegate Row folder IDs across dependent mailboxes (for subscription signature). */
  protected dependentNotificationFolderIDs(): string[] {
    let ids: string[] = [];
    for (let account of this.dependentAccounts()) {
      if (account instanceof OWAAccount) {
        ids.push(...this.sharedAccountRowFolderIDs(account));
      }
    }
    return [...new Set(ids)].sort();
  }

  protected async subscribeRowNotifications(
    folderIDs: string[],
    subscribe: (batch: string[]) => Promise<any>,
  ): Promise<boolean> {
    if (!folderIDs.length) {
      return true;
    }
    let succeeded = true;
    for (let i = 0; i < folderIDs.length; i += kOWANotificationFolderBatchSize) {
      let batch = folderIDs.slice(i, i + kOWANotificationFolderBatchSize);
      try {
        let result = await subscribe(batch);
        if (!notificationSubscriptionsSucceeded(result)) {
          succeeded = false;
        }
      } catch {
        succeeded = false;
      }
    }
    return succeeded;
  }

  protected async refreshNotificationSubscriptions(): Promise<void> {
    if (this.isDependentAccount || !this.isLoggedIn) {
      return;
    }
    if (this.notificationRun && !this.notificationChannelReady) {
      try {
        await this.notificationChannelReadyPromise;
      } catch {
        return;
      }
    }
    if (!this.notificationChannelReady) {
      return;
    }
    try {
      await this.subscribeNotifications();
    } catch (ex) {
      this.errorCallback(ex);
    }
  }

  protected async subscribeNotifications(): Promise<void> {
    let lock = await this.notificationSubscriptionSemaphore.lock();
    try {
      let folderIDs = this.rowNotificationsDisabled ? [] : this.notificationFolderIDs();
      let dependentIDs = this.dependentNotificationFolderIDs();
      // Keying only on the channel ID would make this a permanent no-op: the
      // ID never changes, so folders created later - and the folder the user
      // just opened - would never get a subscription. Dependent folder IDs must
      // be part of the signature or new shared mailboxes never get Row push.
      let signature = [this.notificationChannelID, ...[...folderIDs].sort(), ...dependentIDs].join(" ");
      if (this.notificationsSubscribedForChannel === signature) {
        return;
      }
      try {
        let result = await this.callOWA(new OWASubscribeToNotificationRequest([], true, this.notificationChannelID));
        if (!notificationSubscriptionsSucceeded(result)) {
          this.startPolling();
        }
      } catch (ex) {
        this.errorCallback(ex);
        this.startPolling();
      }

      if (folderIDs.length) {
        let subscribed = await this.subscribeRowNotifications(folderIDs, batch =>
          this.callOWA(new OWASubscribeToNotificationRequest(batch, false, this.notificationChannelID, "string")));
        if (subscribed) {
          for (let folderID of folderIDs) {
            this.subscribedRowFolderIDs.add(folderID);
          }
        } else {
          this.startPolling();
        }
      }

      for (let account of this.dependentAccounts()) {
        if (!(account instanceof OWAAccount)) {
          continue;
        }
        if (this.sharedRowSubscriptionFailures.has(account.id)) {
          continue;
        }
        // OWA DevTools (shared view): no Hierarchy with SMTP suffix, no
        // x-anchormailbox on Subscribe. Hierarchy is once with suffix "".
        // Background shared badges: Row on special folders (capture wire
        // format, primary session headers) + FindFolder count poll.
        let rowIDs = this.sharedAccountRowFolderIDs(account);
        if (rowIDs.length) {
          try {
            let delegateAnchor = account.emailAddress;
            let subscribed = await this.subscribeRowNotifications(rowIDs, batch =>
              this.callOWA(new OWASubscribeToNotificationRequest(
                batch, false, this.notificationChannelID, "string", "", true
              ), undefined, delegateAnchor)
            );
            if (subscribed) {
              for (let folderID of rowIDs) {
                this.subscribedRowFolderIDs.add(folderID);
              }
            } else {
              // Exchange may return HTTP 200 with per-row ErrorInfo. Fast polling
              // is the reliable fallback until SessionLimit backoff clears.
              this.sharedRowSubscriptionFailures.add(account.id);
              account.startPolling();
              this.startPolling();
            }
          } catch (ex) {
            this.errorCallback(ex);
            this.sharedRowSubscriptionFailures.add(account.id);
            account.startPolling();
            this.startPolling();
          }
        }
      }
      this.notificationsSubscribedForChannel = signature;
      this.lastDependentRowFolderSignature = dependentIDs.join("|");
    } finally {
      lock.release();
    }
  }

  protected stopPolling(): void {
    if (this.poller) {
      clearInterval(this.poller);
      this.poller = null;
    }
    if (this.sharedCountsPoller) {
      clearInterval(this.sharedCountsPoller);
      this.sharedCountsPoller = null;
    }
    if (this.sharedFoldersPoller) {
      clearInterval(this.sharedFoldersPoller);
      this.sharedFoldersPoller = null;
    }
  }

  /**
   * Восстанавливает OWA-аккаунт после возвращения сети.
   *
   * Локальный JPC-сокет может оставаться исправным, пока backend не может
   * обратиться к OWA, поэтому одного переподключения JPC недостаточно.
   * Для основного аккаунта используется один цикл восстановления: он ждёт
   * событие online и повторяет попытки, пока Inbox не будет проверен успешно.
   */
  async recoverAfterNetworkRestored(): Promise<void> {
    if (this.mainAccount instanceof OWAAccount) {
      await this.mainAccount.recoverAfterNetworkRestored();
      return;
    }
    if (this.networkRecoveryPromise) {
      await this.networkRecoveryPromise;
      return;
    }
    let recovery = this.recoverNetworkUntilReady();
    this.networkRecoveryPromise = recovery;
    try {
      await recovery;
    } finally {
      if (this.networkRecoveryPromise == recovery) {
        this.networkRecoveryPromise = null;
      }
    }
  }

  protected async recoverNetworkUntilReady(): Promise<void> {
    let retryDelaySeconds = 1;
    while (true) {
      if (!navigator.onLine) {
        await waitUntilOnline();
      }
      try {
        if (!this.isLoggedIn) {
          await this.login(false);
          return;
        }
        if (!this.poller) {
          this.startPolling();
        }
        let inbox = this.findInboxFolder();
        if (inbox) {
          await inbox.syncRecentArrivals();
          this.notifyFolderUIUpdates([inbox]);
        }
        if (!this.isDependentAccount) {
          await this.pollDependentSharedFolders();
          if (!this.notificationRun) {
            this.startNotifications();
          }
        }
        return;
      } catch (ex) {
        if (!isNetworkError(ex)) {
          throw ex;
        }
        this.markNetworkErrorAsTemporary(ex);
        if (navigator.onLine) {
          await sleep(retryDelaySeconds);
          retryDelaySeconds = Math.min(30, retryDelaySeconds * 2);
        }
      }
    }
  }

  protected markNetworkErrorAsTemporary(ex: unknown): void {
    if (!isNetworkError(ex) || !ex || typeof ex != "object") {
      return;
    }
    try {
      (ex as any).doNotShow = true;
    } catch {
      // Некоторые ошибки после перехода через backend могут быть неизменяемыми.
    }
  }

  protected scheduleNetworkRecovery(ex: unknown): void {
    if (!isNetworkError(ex)) {
      return;
    }
    this.markNetworkErrorAsTemporary(ex);
    if (this.networkRecoveryPromise || (!this.isLoggedIn && !this.loginOnStartup)) {
      return;
    }
    this.recoverAfterNetworkRestored().catch(recoveryError => {
      if (!isNetworkError(recoveryError)) {
        this.errorCallback(recoveryError);
      }
    });
  }

  protected async pollInbox(): Promise<void> {
    if (this.pollInProgress || !this.isLoggedIn) {
      return;
    }
    let inbox = this.findInboxFolder();
    if (!inbox) {
      return;
    }
    this.pollInProgress = true;
    try {
      // Fast path: inbox only so the next 3s tick is not skipped by heavy folders.
      await inbox.syncRecentArrivals();
      this.notifyFolderUIUpdates([inbox]);
    } finally {
      this.pollInProgress = false;
    }
    void this.pollInboxBackground(inbox).catch(this.errorCallback);
  }

  /** Personal mailbox: background body sync only for root Inbox and the open folder.
   * Subfolders and other folders stay lazy (badges update via Hierarchy). */
  shouldBackgroundSyncBodies(folder: OWAFolder): boolean {
    if (!folder?.id) {
      return false;
    }
    if (folder === this.watchedFolder) {
      return true;
    }
    if (this.sharedFolderRoot || this.isDependentAccount) {
      return folder === this.watchedFolder || folder.specialFolder == SpecialFolder.Inbox;
    }
    return folder === this.findInboxFolder();
  }

  /** Root Inbox of this account (not a nested folder under Inbox). */
  isRootInbox(folder: OWAFolder): boolean {
    let inbox = this.findInboxFolder();
    return !!inbox && folder === inbox;
  }

  protected shouldSyncFolderAfterCountUpdate(
    folder: OWAFolder,
    previousTotal: number,
    previousUnread: number,
    countTotal: number,
    countUnread: number,
  ): boolean {
    let mailArrived = countUnread > previousUnread || countTotal > previousTotal;
    let needsBodies = folder.messages.isEmpty && countTotal > 0;
    return (mailArrived || needsBodies) && folder.account.shouldBackgroundSyncBodies(folder);
  }

  /** Публикует счётчик только после первой загрузки соответствующего заголовка. */
  protected syncFolderAfterServerCountUpdate(
    folder: OWAFolder,
    countTotal: number,
    countUnread: number,
  ): void {
    let account = folder.account;
    let sync = folder.syncRecentArrivalsWithServerCounts(countTotal, countUnread);
    sync.then(
      () => account.notifyFolderUIUpdates([folder]),
      ex => {
        // При ошибке синхронизации всё равно показываем свежий счётчик.
        account.notifyFolderUIUpdates([folder]);
        if (!(ex instanceof OWAError && ex.isSessionLimit)) {
          account.errorCallback(ex);
        }
      },
    );
  }

  /** Badge refresh without downloading messages when push arrives for a lazy folder. */
  protected lazyFolderBadgeOnly(folder: OWAFolder): void {
    this.refreshFolderBadge(folder);
  }

  /** Dirty folders and shared mailboxes — must not block the inbox poller. */
  protected async pollInboxBackground(inbox: OWAFolder): Promise<void> {
    if (this.pollBackgroundInProgress || !this.isLoggedIn) {
      return;
    }
    this.pollBackgroundInProgress = true;
    try {
      if (!this.isDependentAccount && !this.sharedFolderRoot) {
        return;
      }
      let nonInboxFolders = this.getAllFolders().contents
        .filter((folder): folder is OWAFolder => folder instanceof OWAFolder && folder != inbox);
      let syncLimit = this.sharedFolderRoot ? kOWAMaxDirtyFoldersPerPollShared : kOWAMaxDirtyFoldersPerPoll;
      let foldersToSync = nonInboxFolders
        .filter(folder => folder.dirty || folder.isBehindServer())
        .sort((a, b) => b.countUnread - a.countUnread)
        .slice(0, syncLimit);
      for (let folder of foldersToSync) {
        await folder.getNewMessages(true).catch(this.errorCallback);
        folder.dirty = false;
      }
      if (foldersToSync.length) {
        this.notifyFolderUIUpdates(foldersToSync);
      }

    } finally {
      this.pollBackgroundInProgress = false;
    }
  }

  /** Prefer folders whose unread badges users notice first. */
  protected sharedCountPriorityFolders(folders: OWAFolder[]): OWAFolder[] {
    const priority = new Set([
      SpecialFolder.Inbox, SpecialFolder.Trash, SpecialFolder.Drafts,
      SpecialFolder.Spam, SpecialFolder.Sent,
    ]);
    let special = folders.filter(f => priority.has(f.specialFolder));
    if (this.watchedFolder instanceof OWAFolder && this.watchedFolder.id &&
        folders.includes(this.watchedFolder) && !special.includes(this.watchedFolder)) {
      special.push(this.watchedFolder);
    }
    return special;
  }

  /** Instant sidebar badge update for one folder (delegate GetFolder). */
  protected refreshFolderBadge(folder: OWAFolder): void {
    if (!folder?.id) {
      return;
    }
    this.callOWA(owaFolderCountsRequest(folder.id)).then(result => {
      let raw = result?.Folders?.[0];
      if (!raw) {
        return;
      }
      let prevUnread = folder.countUnread;
      let prevTotal = folder.countTotal;
      let newUnread = sanitize.integer(raw.UnreadCount, prevUnread);
      let newTotal = sanitize.integer(raw.TotalCount, prevTotal);
      if (newUnread == prevUnread && newTotal == prevTotal) {
        return;
      }
      // Always fetch when mail arrived (unread/total up), or empty folder has mail.
      if (this.shouldSyncFolderAfterCountUpdate(folder, prevTotal, prevUnread, newTotal, newUnread)) {
        this.syncFolderAfterServerCountUpdate(folder, newTotal, newUnread);
      } else {
        folder.applyServerCounts(newTotal, newUnread);
        folder.dirty = true;
        this.notifyFolderUIUpdates([folder]);
      }
    }).catch(ex => {
      if (!(ex instanceof OWAError && ex.isSessionLimit)) {
        this.errorCallback(ex);
      }
    });
  }

  /** Обновляет счётчики всех известных папок без загрузки тел писем.
   * Один Deep FindFolder по msgFolderRoot обновляет всё дерево. */
  async refreshAllFolderCounts(): Promise<void> {
    let folders = this.getAllFolders().contents
      .filter((folder): folder is OWAFolder => folder instanceof OWAFolder && !!folder.id);
    if (!folders.length) {
      return;
    }
    let updatedFolders: OWAFolder[] = [];
    let pendingSync = new Map<OWAFolder, { countTotal: number; countUnread: number }>();
    let pendingPrevious = new Map<OWAFolder, { countTotal: number; countUnread: number }>();
    let applyCountUpdate = (folder: OWAFolder, countTotal: number, countUnread: number): void => {
      let previous = pendingPrevious.get(folder) ?? {
        countTotal: folder.countTotal,
        countUnread: folder.countUnread,
      };
      if (countTotal == previous.countTotal && countUnread == previous.countUnread) {
        return;
      }
      if (this.shouldSyncFolderAfterCountUpdate(
        folder, previous.countTotal, previous.countUnread, countTotal, countUnread)) {
        pendingPrevious.set(folder, { countTotal, countUnread });
        pendingSync.set(folder, { countTotal, countUnread });
        return;
      }
      pendingPrevious.delete(folder);
      pendingSync.delete(folder);
      folder.applyServerCounts(countTotal, countUnread);
      folder.dirty = true;
      if (!updatedFolders.includes(folder)) {
        updatedFolders.push(folder);
      }
    };
    let finishCountUpdates = (): void => {
      if (updatedFolders.length) {
        this.notifyFolderUIUpdates(updatedFolders);
      }
      for (let [folder, counts] of pendingSync) {
        this.syncFolderAfterServerCountUpdate(folder, counts.countTotal, counts.countUnread);
      }
    };
    if (this.msgFolderRootID) {
      try {
        let result = await this.callOWA(owaFindFolderCountsByRootRequest(this.msgFolderRootID));
        let rawFolders = result?.RootFolder?.Folders ?? [];
        for (let raw of rawFolders) {
          let id = raw?.FolderId?.Id;
          if (!id) {
            continue;
          }
          let folder = this.folderMap.get(id);
          if (!folder) {
            continue;
          }
          let newUnread = sanitize.integer(raw.UnreadCount, folder.countUnread);
          let newTotal = sanitize.integer(raw.TotalCount, folder.countTotal);
          applyCountUpdate(folder, newTotal, newUnread);
        }
        // Parent folder counts (often Inbox/root) also arrive in ParentFolder.
        let parent = result?.RootFolder?.ParentFolder;
        if (parent?.FolderId?.Id) {
          let folder = this.folderMap.get(parent.FolderId.Id);
          if (folder) {
            let newUnread = sanitize.integer(parent.UnreadCount, folder.countUnread);
            let newTotal = sanitize.integer(parent.TotalCount, folder.countTotal);
            applyCountUpdate(folder, newTotal, newUnread);
          }
        }
        finishCountUpdates();
        return;
      } catch (ex) {
        if (!(ex instanceof OWAError && ex.isSessionLimit)) {
          this.errorCallback(ex);
        }
      }
    }
    // Fallback: rotating GetFolder batches if FindFolder-by-root fails.
    let priority = this.sharedCountPriorityFolders(folders);
    let rotating = folders.filter(f => !priority.includes(f));
    let batch: OWAFolder[] = [...priority];
    let rotateSlots = Math.max(0, kOWAFolderCountsPerPollShared - priority.length);
    if (rotating.length && rotateSlots > 0) {
      let take = Math.min(rotateSlots, rotating.length);
      // The folder tree can shrink between cycles, so normalise the cursor
      // before indexing; a stale offset would otherwise pick no folder.
      let offset = Number.isFinite(this.pollFolderCountOffset)
        ? Math.max(0, Math.floor(this.pollFolderCountOffset)) % rotating.length
        : 0;
      for (let i = 0; i < take; i++) {
        let folder = rotating.at((offset + i) % rotating.length);
        if (folder) {
          batch.push(folder);
        }
      }
      this.pollFolderCountOffset = (offset + take) % rotating.length;
    }
    for (let folder of batch) {
      try {
        let result = await this.callOWA(owaFolderCountsRequest(folder.id));
        let raw = result?.Folders?.[0];
        if (!raw) {
          continue;
        }
        let newUnread = sanitize.integer(raw.UnreadCount, folder.countUnread);
        let newTotal = sanitize.integer(raw.TotalCount, folder.countTotal);
        applyCountUpdate(folder, newTotal, newUnread);
      } catch (ex) {
        if (!(ex instanceof OWAError && ex.isSessionLimit)) {
          this.errorCallback(ex);
        }
      }
    }
    finishCountUpdates();
  }

  /** Track the open shared folder and subscribe RowNotification for it only. */
  async setWatchedFolder(folder: OWAFolder | null): Promise<void> {
    this.watchedFolder = folder;
    let folderID = folder?.id ?? null;
    if (folderID == this.watchedRowFolderID) {
      return;
    }
    this.watchedRowFolderID = folderID;
    let main = (this.mainAccount instanceof OWAAccount ? this.mainAccount : this.isDependentAccount ? null : this) as OWAAccount | null;
    if (!main || !folderID) {
      return;
    }
    // Exchange caps subscriptions per session and OWA offers no unsubscribe,
    // so subscribing on every folder switch eventually trips
    // ErrorMailboxSessionLimit. One subscription per folder is enough - it
    // stays valid for the life of the channel.
    if (main.subscribedRowFolderIDs.has(folderID)) {
      return;
    }
    if (this.isDependentAccount && main.sharedRowSubscriptionFailures.has(this.id)) {
      return;
    }
    if (!main.notificationChannelReady) {
      // Retried from subscribeNotifications() once the channel comes up.
      return;
    }
    try {
      // OWA capture: Row Subscribe without explicit-logon headers; FolderId is
      // enough. Use primary session (no x-anchormailbox) + renew message view.
      let delegateAnchor = this.isDependentAccount ? this.emailAddress : undefined;
      let result = await main.callOWA(new OWASubscribeToNotificationRequest(
        [folderID], false, main.notificationChannelID, "string", "", true),
        undefined, delegateAnchor);
      if (notificationSubscriptionsSucceeded(result)) {
        main.subscribedRowFolderIDs.add(folderID);
      } else if (this.isDependentAccount) {
        main.sharedRowSubscriptionFailures.add(this.id);
        this.startPolling();
        main.startPolling();
      }
    } catch (ex) {
      if (this.isDependentAccount) {
        main.sharedRowSubscriptionFailures.add(this.id);
        this.startPolling();
        main.startPolling();
      } else {
        this.errorCallback(ex);
      }
    }
  }

  /**
   * Keep shared mailboxes in sync: watched folder and any dirty/behind folders.
   * Счётчики папок обновляются отдельно через sharedCountsPoller.
   */
  protected async pollDependentSharedFolders(): Promise<void> {
    let accounts = this.dependentAccounts().contents.filter(
      (account): account is OWAAccount =>
        account instanceof OWAAccount && account.isDependentAccount && account.isLoggedIn);
    if (!accounts.length) {
      return;
    }
    let index = 0;
    let workers = Array.from(
      { length: Math.min(kSharedPollConcurrency, accounts.length) },
      async () => {
        while (index < accounts.length) {
          let account = accounts[index++];
          await this.pollOneDependentSharedAccount(account);
        }
      },
    );
    await Promise.all(workers);
  }

  protected async pollOneDependentSharedAccount(account: OWAAccount): Promise<void> {
    let blockedUntil = this.sharedMailboxBlockedUntil.get(account.emailAddress.toLowerCase()) ?? 0;
    if (blockedUntil > Date.now()) {
      return;
    }

    let inbox = account.findInboxFolder() as OWAFolder | null;
    let watched = account.watchedFolder;
    let toSync: OWAFolder[] = [];
    if (watched instanceof OWAFolder && watched.account === account) {
      toSync.push(watched);
    }
    if (inbox && !toSync.includes(inbox)) {
      toSync.push(inbox);
    }
    let syncLimit = account.sharedFolderRoot ? kOWAMaxDirtyFoldersPerPollShared : kOWAMaxDirtyFoldersPerPoll;
    for (let folder of account.getAllFolders().contents
      .filter((f): f is OWAFolder =>
        f instanceof OWAFolder && !toSync.includes(f) && (f.dirty || f.isBehindServer()))
      .sort((a, b) => b.countUnread - a.countUnread)
      .slice(0, syncLimit)) {
      toSync.push(folder);
    }
    for (let folder of toSync) {
      try {
        if (folder === inbox || folder === watched) {
          await folder.syncRecentArrivals();
        } else {
          await folder.getNewMessages(true);
        }
        folder.dirty = false;
        this.notifyFolderUIUpdates([folder]);
      } catch (ex) {
        this.errorCallback(ex);
      }
    }
  }

  /** Best-effort background fetch (metadata poll, push refresh). No toast for transient failures. */
  handleBackgroundSyncError(ex: unknown): void {
    this.handlePollingError(ex);
  }

  protected handlePollingError(ex: unknown): void {
    // The poller runs every few seconds. Toasting each failure would flood the
    // user with the same message while offline or during a server hiccup.
    if (isNetworkError(ex)) {
      this.scheduleNetworkRecovery(ex);
      return;
    }
    if (ex instanceof OWAError && ex.doNotShow) {
      console.warn("OWA polling failed", ex);
    } else {
      this.errorCallback(ex);
    }
    // callOWA() logs out on an expired OWA session and stops the timer. Try
    // the stored credentials in the background so mail does not require a
    // manual click to resume after a session timeout.
    if (!this.isLoggedIn && !this.poller) {
      this.startPolling();
      this.login(false).catch(this.errorCallback);
    }
  }

  notifyObserversOfSubaccounts() {
    for (let account of this.dependentAccounts()) {
      account.notifyObservers();
    }
  }

  needsLicense(): boolean {
    return false;
  }

  /**
   * Exchange constructs the message. Attachments (incl. signature CID images)
   * go in the same CreateItem + SendAndSaveCopy — not SaveOnly→Drafts first.
   */
  async send(email: EMail): Promise<void> {
    if (email.iCalMethod) {
      throw new NotSupported("Please use Exchange APIs to send iMIP messages");
    }
    let folder = email.folder as OWAFolder;
    assert(folder?.id, "Need folder to save the sent email in");
    assert((folder.account.mainAccount ?? folder.account) == (this.mainAccount ?? this), "Need saved folder to have same master account");
    if (folder.account.mainAccount) {
      let mainAccount = folder.account.mainAccount as OWAAccount;
      if (!await folder.mayCreateItems(mainAccount.emailAddress)) {
        folder = mainAccount.getSpecialFolder(SpecialFolder.Sent) as OWAFolder;
      }
    }
    let request = new OWACreateItemRequest({ SavedItemFolderId: { __type: "TargetFolderId:#Exchange", BaseFolderId: { __type: "FolderId:#Exchange", Id: folder.id } }, MessageDisposition: "SendAndSaveCopy" });
    if (email.sendRawMIME) {
      request.addField("Message", "MimeContent", btoa(email.sendRawMIME), "item:MimeContent");
    } else {
      request.addField("Message", "ItemClass", "IPM.Note", "item:ItemClass");
      request.addField("Message", "Subject", email.subject, "item:Subject");
      request.addField("Message", "Body", {
        __type: "BodyContentType:#Exchange",
        BodyType: email.rawHTMLDangerous || email.html ? "HTML" : "Text",
        Value: email.rawHTMLDangerous || email.html || email.text,
      }, "item:Body");
      if (email.attachments.hasItems) {
        // Inline in CreateItem — do not SaveOnly to Drafts first
        request.addField("Message", "Attachments", await Promise.all(email.attachments.contents.map(async attachment => ({
          __type: "FileAttachment:#Exchange",
          Name: attachment.filename,
          ContentType: attachment.mimeType,
          ContentId: attachment.contentID,
          Size: attachment.size,
          IsInline: attachment.disposition == ContentDisposition.inline || !!attachment.related,
          Content: await attachment.contentAsBase64(),
        }))), "item:Attachments");
      }
      if (email.headers.hasItems) {
        request.addField("Message", "ExtendedProperty", [...email.headers.entries()].map(([header, value]) => ({
          ExtendedFieldURI: {
            PropertyName: header,
            DistinguishedPropertySetId: "InternetHeaders",
            PropertyType: "String",
          },
          Value: value,
        })), null);
      }
      if (email.inReplyTo) {
        request.addField("Message", "InReplyTo", email.inReplyTo, "item:InReplyTo");
      }
      if (email.replyTo) {
        addRecipients(request, "ReplyTo", [email.replyTo]);
      }
      addRecipients(request, "ToRecipients", email.to.contents);
      addRecipients(request, "CcRecipients", email.cc.contents);
    }
    addRecipients(request, "BccRecipients", email.bcc.contents);
    request.addField("Message", "From", { Mailbox: { Name: email.from.name, EmailAddress: email.from.emailAddress } }, "message:From");
    let importance = email.importanceLevel === "high" ? "High"
      : email.importanceLevel === "low" ? "Low" : "Normal";
    request.addField("Message", "Importance", importance, "item:Importance");
    if (email.requestReadReceipt) {
      request.addField("Message", "IsReadReceiptRequested", true, "item:IsReadReceiptRequested");
    }
    if (email.requestDeliveryReceipt) {
      request.addField("Message", "IsDeliveryReceiptRequested", true, "item:IsDeliveryReceiptRequested");
    }
    if (email.tags.hasItems) {
      request.addField("Message", "Categories", email.tags.contents.map(tag => tag.name), "item:Categories");
    }
    if (email.isStarred) {
      request.addField("Message", "Flag", {
        __type: "FlagType:#Exchange",
        FlagStatus: "Flagged",
        StartDate: null,
        DueDate: null,
        CompleteDate: null,
      }, "item:Flag");
    }
    let result = await this.callOWA(request);
    await this.refreshAfterSend(email, folder, result);
  }

  /** Push Sent (and Inbox for send-to-self) without waiting for RowNotification. */
  protected async refreshAfterSend(email: EMail, savedFolder: OWAFolder, result: any): Promise<void> {
    try {
      let itemID = sanitize.nonemptystring(
        result?.Items?.[0]?.ItemId?.Id
        ?? result?.ItemId?.Id
        ?? result?.ResponseMessages?.Items?.[0]?.Items?.[0]?.ItemId?.Id,
        null);
      let sentFolder = (savedFolder.specialFolder == SpecialFolder.Sent
        ? savedFolder
        : this.getSpecialFolder(SpecialFolder.Sent)) as OWAFolder | null;
      if (itemID && sentFolder?.id) {
        let headers = await sentFolder.getNewMessageHeaders([itemID]);
        sentFolder.addMessagesIfAbsent(headers);
        sentFolder.downloadMessages(headers).catch(this.errorCallback);
      } else if (sentFolder) {
        sentFolder.getNewMessages(true).catch(this.errorCallback);
      }

      let sentToSelf = [...email.to, ...email.cc, ...email.bcc]
        .some(p => p.emailAddress && this.isMyEMailAddress(p.emailAddress));
      if (sentToSelf) {
        let inbox = this.inbox as OWAFolder | null;
        if (inbox) {
          inbox.getNewMessages(true).catch(this.errorCallback);
        }
      }
    } catch (ex) {
      this.errorCallback(ex);
    }
  }

  /** @deprecated Prefer CreateItem with inline Attachments. Kept for large-file Office365 uploads if needed later. */
  async addAttachmentsAndSend(email: EMail, folder: OWAFolder, itemID: string): Promise<void> {
    let changeKey: string | undefined;
    for (let attachment of email.attachments) {
      let parentItemId: any = {
        __type: "ItemId:#Exchange",
        Id: itemID,
      };
      if (changeKey) {
        parentItemId.ChangeKey = changeKey;
      }
      let request = new OWARequest("CreateAttachment", {
        __type: "CreateAttachmentRequest:#Exchange",
        Attachments: [{
          __type: "FileAttachment:#Exchange",
          Name: attachment.filename,
          ContentType: attachment.mimeType,
          ContentId: attachment.contentID,
          Size: attachment.size,
          IsInline: attachment.disposition == ContentDisposition.inline || !!attachment.related,
          Content: "",
        }],
        ParentItemId: parentItemId,
      });
      let result: any;
      if (this.authorizationHeader) {
        result = await this.callOWAWithOffice365Attachment(request, attachment);
      } else {
        request.Body.Attachments[0].Content = await attachment.contentAsBase64();
        result = await this.callOWA(request);
      }
      // CreateAttachment returns a new ChangeKey; UpdateItem needs it
      changeKey = result?.Attachments?.[0]?.AttachmentId?.RootItemChangeKey
        ?? result?.RootItemChangeKey
        ?? result?.Items?.[0]?.ItemId?.ChangeKey
        ?? changeKey;
    }
    let update = new OWAUpdateItemRequest(itemID, {
      ComposeOperation: "newMail",
      SavedItemFolderId: {
        __type: "TargetFolderId:#Exchange",
        BaseFolderId: {
          __type: "FolderId:#Exchange",
          Id: folder.id,
        }
      },
      MessageDisposition: "SendAndSaveCopy",
      SendCalendarInvitationsOrCancellations: "SendToNone",
      SuppressReadReceipts: false
    });
    if (changeKey) {
      update.Body.ItemChanges[0].ItemId.ChangeKey = changeKey;
    }
    await this.callOWA(update);
  }

  async callOWAWithOffice365Attachment(aRequest: any, attachment: Attachment, mailbox?: string) {
    if (this.mainAccount) {
      let mainAccount = this.mainAccount as OWAAccount;
      return await mainAccount.callOWAWithOffice365Attachment(aRequest, attachment, this.username);
    }
    let headers: { [key: string]: string } = {
      Action: "CreateAttachmentFromLocalFile",
      Authorization: this.authorizationHeader,
      "x-anchormailbox": mailbox ?? this.emailAddress,
      "x-owa-urlpostdata": encodeURIComponent(JSON.stringify(aRequest)),
    };
    if (mailbox) {
      headers["x-customowascenariodata"] = "MailboxAccess:SharedMailbox,ExplicitLogon";
      headers["x-owa-explicitlogonuser"] = mailbox;
    }
    return await this.callOWAShared(this.url + "service.svc/CreateAttachmentFromLocalFile", {
      // n.b. use `await attachment.content.arrayBuffer` if you want to inspect
      body: attachment.content,
      headers: headers,
      method: "POST",
    });
  }

  /** Whether a shared-mailbox request must use OWA Explicit Logon headers. */
  protected static needsExplicitLogon(aRequest: any): boolean {
    let action = aRequest?.action;
    if (action === "GetOwaUserConfiguration") {
      return true;
    }
    let body = aRequest?.Body;
    if (action === "FindFolder") {
      for (let parent of body?.ParentFolderIds ?? []) {
        if (parent?.Mailbox?.EmailAddress) {
          return true;
        }
      }
      return false;
    }
    if (action === "GetFolder") {
      for (let folderId of body?.FolderIds ?? []) {
        if (folderId?.DistinguishedFolderId || folderId?.Mailbox?.EmailAddress) {
          return true;
        }
      }
      return false;
    }
    return false;
  }

  async callOWA(aRequest: any, mailbox?: string, delegateAnchor?: string): Promise<any> {
    if (this.mainAccount) {
      let mainAccount = this.mainAccount as OWAAccount;
      if (this.sharedFolderRoot && !OWAAccount.needsExplicitLogon(aRequest)) {
        return await mainAccount.callOWA(aRequest, undefined, this.emailAddress);
      }
      return await mainAccount.callOWA(aRequest, mailbox ?? this.username);
    }
    if (mailbox && !delegateAnchor) {
      let blockedUntil = this.sharedMailboxBlockedUntil.get(mailbox.toLowerCase()) ?? 0;
      if (blockedUntil > Date.now()) {
        throw new OWAError({ message: gt`Too many active sessions for this mailbox. Please wait a few minutes.` });
      }
    }
    let url = this.url + "service.svc";
    if (aRequest?.action) {
      url += "?action=" + encodeURIComponent(aRequest.action) + "&EP=1";
      if (aRequest.action == "SubscribeToNotification") {
        // These context parameters are part of the on-premise OWA mail
        // client's subscription request. Without them Exchange may return a
        // successful response but keep the row subscription out of the
        // pending notification channel.
        url += "&UA=0&ID=-24&AC=1";
      }
    }
    let jsonBody = JSON.stringify(aRequest);
    let headers: Record<string, string> = {
      Action: aRequest.action,
      Authorization: this.authorizationHeader,
      "Content-Type": "application/json",
      "x-anchormailbox": delegateAnchor ?? mailbox ?? this.emailAddress,
    };
    // Avoid HTTP 414 Request-URI / Header Too Long on large requests
    if (jsonBody.length < 512) {
      headers["x-owa-urlpostdata"] = encodeURIComponent(jsonBody);
    }
    if (mailbox && !delegateAnchor) {
      headers["x-customowascenariodata"] = "MailboxAccess:SharedMailbox,ExplicitLogon";
      headers["x-owa-explicitlogonuser"] = mailbox;
    }
    if (mailbox && !delegateAnchor) {
      let lock = await this.sharedMailboxSemaphore.lock();
      try {
        let gap = Date.now() - this.lastSharedMailboxRequestAt;
        if (gap < 800) {
          await sleep((800 - gap) / 1000);
        }
        this.lastSharedMailboxRequestAt = Date.now();
        return await this.callOWAShared(url, {
          body: jsonBody,
          headers: headers,
          method: "POST",
        });
      } finally {
        lock.release();
      }
    }
    return await this.callOWAShared(url, {
      body: jsonBody,
      headers: headers,
      method: "POST",
    });
  }

  protected isMailboxSessionLimitError(response: any): boolean {
    let text = String(response.text ?? response.json?.MessageText ?? response.message ?? "");
    let code = String(response.json?.ResponseCode ?? response.json?.Body?.ResponseCode ?? "");
    return /too many active/i.test(text) ||
      /активных сеансов/i.test(text) ||
      /TooManyObjectsOpened/i.test(text) ||
      /MapiExceptionSessionLimit/i.test(text) ||
      code === "ErrorMailboxSessionLimit" ||
      code === "ErrorTooManyObjectsOpened";
  }

  /** Re-establishes the OWA session without user interaction, from the stored
   * partition cookies or a saved password. */
  protected async refreshSessionSilently(): Promise<boolean> {
    if (this.isDependentAccount) {
      return false;
    }
    let lock = await this.sessionRefreshSemaphore.lock();
    try {
      // Another request may have refreshed it while we waited.
      if (await this.testLoggedIn()) {
        return true;
      }
      await this.loginCommon(false);
      this.authorizationHeader = await appGlobal.remoteApp.OWA.getAnyScrapedAuth(this.partition);
      return await this.testLoggedIn();
    } catch (ex) {
      console.warn("OWA silent session refresh failed", ex);
      return false;
    } finally {
      lock.release();
    }
  }

  async callOWAShared(url: string, options: RequestInit, throttleRetries = 0, sessionRetried = false) {
    if (!this.hasLoggedIn) {
      throw new LoginError(null, gt`Please login`);
    }
    await this.throttle.throttle();
    let lock = await this.semaphore.lock();
    let response: any;
    try {
      if (this.authorizationHeader) {
        let result = await fetch(url, options);
        response = {
          ok: result.ok,
          status: result.status,
          statusText: result.statusText,
          url: result.url,
          contentType: result.headers.get('Content-Type'),
          text: await result.text(),
        };
        try {
          response.json = JSON.parse(response.text);
        } catch (ex) {
          if (this.isMailboxSessionLimitError(response)) {
            this.throttle.waitForSecond(120);
            throw new OWAError({ message: gt`Too many active sessions for this mailbox. Please wait a few minutes.` });
          }
          response.ok = false;
          response.statusText = ex.message;
        }
      } else {
        response = await appGlobal.remoteApp.OWA.fetchJSON(this.partition, url, options);
      }
    } catch (ex) {
      this.scheduleNetworkRecovery(ex);
      throw ex;
    } finally {
      lock.release();
    }
    if (this.isMailboxSessionLimitError(response)) {
      let headers = options.headers as Record<string, string>;
      let mailbox = headers?.["x-owa-explicitlogonuser"]
        ?? (headers?.["x-anchormailbox"]?.toLowerCase() !== this.emailAddress.toLowerCase()
          ? headers?.["x-anchormailbox"]
          : undefined);
      if (mailbox) {
        this.sharedMailboxBlockedUntil.set(mailbox.toLowerCase(), Date.now() + 5 * 60_000);
      }
      this.throttle.waitForSecond(120);
      throw new OWAError({ message: gt`Too many active sessions for this mailbox. Please wait a few minutes.` });
    }
    if ([401, 440].includes(response.status)) {
      // A single expired request must not cost the user their session.
      // `logout()` also clears the browser partition, so the stored OWA cookies
      // are gone and the next login needs the password form or a login tab.
      // Try to refresh the session silently and replay the request once.
      if (!sessionRetried && await this.refreshSessionSilently()) {
        return await this.callOWAShared(url, options, throttleRetries, true);
      }
      await this.logout(true);
      throw new LoginError(null, gt`Please login`);
    }
    if (!response.ok) {
      this.throttle.waitForSecond(1);
      if (this.isMailboxSessionLimitError(response)) {
        this.throttle.waitForSecond(120);
        throw new OWAError({ message: gt`Too many active sessions for this mailbox. Please wait a few minutes.` });
      }
      if (!response.json && response.url != url && response.contentType?.toLowerCase().split(";")[0].trim() == "text/html") {
        // Redirected to a login page: the session expired, but the stored
        // cookies may still let us log back in without prompting.
        await this.logout(true);
        throw new Error(response.statusText);
      }
      throw new OWAError(response);
    }
    let result = response.json;
    if (!result) {
      // A 200 without a JSON body is an interstitial login or error page.
      await this.logout(true);
      throw new LoginError(null, gt`Please login`);
    }
    if (result.Body) {
      result = result.Body;
    }
    if (result.ResponseMessages?.Items?.length == 1) {
      result = result.ResponseMessages.Items[0];
    }
    if (this.isThrottleError(result)) {
      // Each retry waits 5s inside the throttle. Without a cap, a server that
      // stays throttled keeps this request - and its semaphore slot - alive
      // indefinitely.
      if (throttleRetries >= kOWAMaxThrottleRetries) {
        throw new OWAError({ message: gt`Too many active sessions for this mailbox. Please wait a few minutes.` });
      }
      return await this.callOWAShared(url, options, throttleRetries + 1, sessionRetried);
    }
    // Only treat real errors as failures. Success MoveItem responses must not
    // throw just because MessageText is present on some Exchange builds.
    if (result.ResponseClass == "Error" ||
        (result.MessageText && result.ResponseClass != "Success" && result.ResponseCode != "NoError")) {
      this.throttle.waitForSecond(1);
      throw new OWAError(response);
    }
    return result;
  }

  /** Skips and reports failed items in a batch response,
   * e.g. broken or inaccessible items,
   * so that one broken item does not abort the entire sync.
   * @param element which array the responses hold, e.g. `Attachments` */
  itemsFromResponses(responses: any[], element: string = "Items"): any[] {
    let items = [];
    for (let response of responses) {
      if (response.ResponseClass == "Error") {
        this.errorCallback(new OWAError({ json: response }));
      } else {
        let item = response?.[element]?.[0];
        if (item) {
          items.push(item);
        }
      }
    }
    return items;
  }

  async listFolders(): Promise<void> {
    // Rebuilding the hierarchy is destructive - it deletes folders that are no
    // longer on the server, including their cached messages. Two overlapping
    // runs (startup plus a hierarchy notification) would see each other's
    // half-built tree and duplicate or drop folders.
    let lock = await this.listFoldersLock.lock();
    try {
      await this.listFoldersUnlocked();
    } finally {
      lock.release();
    }
  }

  protected async listFoldersUnlocked(): Promise<void> {
    await this.storage.readFolderHierarchy(this);
    this.adoptCachedArchiveMailboxRoot();

    await this.throttle.throttle();
    let result = await this.callOWA(owaFindFoldersRequest(true, this.sharedFolderRoot, this.username));
    if (this.sharedFolderRoot == "inbox") {
      let response = await this.callOWA(owaSharedFolderRequest(["inbox"], this.username));
      let inboxFolder = response?.Folders?.[0];
      if (inboxFolder) {
        result.RootFolder.Folders.unshift(inboxFolder);
        result.RootFolder.ParentFolder = inboxFolder;
      }
    }
    this.msgFolderRootID = await this.applyFolderHierarchy(result, false);
    if (!this.isDependentAccount && !this.sharedFolderRoot) {
      await this.listArchiveMailbox();
    }
    // `MailAccount.inbox` may have been resolved before the remote hierarchy
    // was loaded and then cached the first root folder. Rebind it explicitly
    // after every OWA hierarchy refresh so background polling cannot target
    // Sent Items by mistake.
    this.findInboxFolder();
  }

  /** Keep cached archive folders available while the server hierarchy loads. */
  protected adoptCachedArchiveMailboxRoot(): void {
    let cachedRoot = this.rootFolders.find(folder =>
      folder instanceof OWAFolder && folder.isArchiveMailboxRoot) as OWAFolder | undefined;
    if (cachedRoot) {
      this.rootFolders.remove(cachedRoot);
      this.archiveMailboxRoot ??= cachedRoot;
    }
  }

  /** Fetch the optional secondary mailbox without making login depend on it. */
  protected async listArchiveMailbox(): Promise<void> {
    let result: any;
    try {
      result = await this.callOWA(owaFindFoldersRequest(true, null, undefined, kArchiveMailboxRoot));
    } catch {
      // Not every Exchange account has an Online Archive. Keep a previously
      // cached hierarchy if the optional request is unavailable temporarily.
      return;
    }
    await this.applyFolderHierarchy(result, true);
  }

  /** Apply one OWA folder tree to either the primary or archive root. */
  protected async applyFolderHierarchy(result: any, archiveMailbox: boolean): Promise<string | null> {
    let rootParent = result?.RootFolder?.ParentFolder ?? result?.RootFolder?.parentFolder;
    let rootID = objectID(rootParent?.FolderId) ?? objectID(rootParent?.folderId);
    if (!rootID) {
      if (archiveMailbox) {
        return null;
      }
      throw new OWAError({ message: gt`Could not determine mailbox folder root` });
    }
    if (archiveMailbox && rootID == this.msgFolderRootID) {
      return null;
    }

    let rootFolder = archiveMailbox ? this.archiveMailboxRoot as OWAFolder | null : null;
    if (archiveMailbox && (!rootFolder || rootFolder.id != rootID)) {
      rootFolder = this.newFolder();
    }
    if (rootFolder) {
      rootFolder.id = rootID;
      rootFolder.name = sanitize.label(
        rootParent?.DisplayName,
        `${this.name || ""} — ${gt`Archive`}`.trim(),
      );
      rootFolder.parent = null;
      rootFolder.specialFolder = SpecialFolder.Normal;
      rootFolder.isArchiveMailbox = true;
      rootFolder.isArchiveMailboxRoot = true;
      rootFolder.applyServerCounts(
        sanitize.integer(rootParent?.TotalCount, rootFolder.countTotal),
        sanitize.integer(rootParent?.UnreadCount, rootFolder.countUnread),
      );
      this.archiveMailboxRoot = rootFolder;
    }

    let rootCollection = (rootFolder?.subFolders ?? this.rootFolders) as Collection<OWAFolder>;
    let existingFolders = new Map<string, OWAFolder>();
    collectFolderTree(rootCollection, existingFolders);
    let rawFolders = ensureArray(result?.RootFolder?.Folders);
    let haveCalendar = archiveMailbox || this.sharedFolderRoot != null ||
      appGlobal.calendars.some(calendar => calendar.dependsOn(this));
    // Build the new tree beside the live one and swap it in at the end, so the
    // UI and any concurrent reader never observe a partially cleared tree.
    let newFolderMap = new Map<string, OWAFolder>();
    for (let folder of rawFolders) {
      let folderClass = typeof folder?.FolderClass == "string" ? folder.FolderClass : "";
      if (!folderClass || folderClass == "IPF.Note" || folderClass.startsWith("IPF.Note.")) {
        let folderId = objectID(folder?.FolderId) ?? objectID(folder?.folderId);
        if (!folderId || (folder === rootParent && this.sharedFolderRoot != "inbox")) {
          continue;
        }
        let owaFolder = existingFolders.get(folderId) ?? this.newFolder();
        try {
          owaFolder.fromJSON(folder, archiveMailbox);
        } catch (ex) {
          // One folder with an unexpected shape must not cost the user their
          // entire folder tree.
          this.errorCallback(ex);
          continue;
        }
        newFolderMap.set(folderId, owaFolder);
      } else if (!archiveMailbox && folder.DistinguishedFolderId == "calendar" && !haveCalendar) {
        let calendar = this.createCalendarAccount(folder);
        appGlobal.calendars.add(calendar);
        await calendar.save();
      }
    }
    let newRootFolders: OWAFolder[] = [];
    let newSubFolders = new Map<OWAFolder, OWAFolder[]>();
    for (let folder of rawFolders) {
      let folderId = objectID(folder?.FolderId) ?? objectID(folder?.folderId);
      let owaFolder = folderId ? newFolderMap.get(folderId) : undefined;
      if (!owaFolder) {
        continue;
      }
      let parentId = objectID(folder?.ParentFolderId) ?? objectID(folder?.parentFolderId);
      let parent = parentId && (parentId != rootID ||
        (!archiveMailbox && this.sharedFolderRoot == "inbox"))
        ? newFolderMap.get(parentId) : undefined;
      owaFolder.parent = parent || rootFolder || null;
      if (parent) {
        let siblings = newSubFolders.get(parent) ?? [];
        siblings.push(owaFolder);
        newSubFolders.set(parent, siblings);
      } else {
        newRootFolders.push(owaFolder);
      }
    }
    let oldFolders = [...existingFolders.values()];
    // Iterate from deepest to shallowest.
    for (let folder of oldFolders.reverse()) {
      if (!newFolderMap.has(folder.id)) {
        await folder.deleteItLocally();
      }
    }
    for (let folder of newFolderMap.values()) {
      folder.subFolders.replaceAll(newSubFolders.get(folder) ?? []);
    }
    rootCollection.replaceAll(newRootFolders);
    for (let folder of this.getAllFolders()) {
      await folder.save();
    }
    this.rebuildFolderMap();
    return rootID;
  }

  protected rebuildFolderMap(): void {
    this.folderMap.clear();
    for (let folder of this.getAllFolders()) {
      if (folder instanceof OWAFolder && folder.id && !folder.isArchiveMailboxRoot) {
        this.folderMap.set(folder.id, folder);
      }
    }
  }

  protected findInboxFolder(): OWAFolder | null {
    let folders = this.getAllFolders();
    let inbox = folders.find(folder => folder.specialFolder == SpecialFolder.Inbox) as OWAFolder | undefined;
    if (inbox) {
      this._inbox = inbox;
      this.notifyObservers("inbox");
    }
    return inbox ?? null;
  }

  protected isThrottleError(result: any): boolean {
    if (result.MessageText &&
        (result.ResponseCode == "OverBudgetException" ||
         result.ResponseCode == "ErrorTooManyObjectsOpened")) {
      let match = result.MessageText.match(/'MaxConcurrency'.*'(\d+)'.*'Owa'/);
      let maxConcurrency = match ? Number(match[1]) : this.semaphore.countRunning + 1;
      if (maxConcurrency < this.semaphore.maxParallel) {
        const minConcurrency = 3;
        this.semaphore.maxParallel = Math.max(maxConcurrency, minConcurrency);
        console.log(`Server busy, reduced max concurrency to ${this.semaphore.maxParallel}`);
      }
      this.throttle.waitForSecond(5);
      return true;
    }
    return false;
  }

  provider(): Provider | null {
    return this.authorizationHeader != null
      ? Provider.Office365
      : super.provider();
  }

  async createToplevelFolder(name: string): Promise<OWAFolder> {
    if (this.sharedFolderRoot == "inbox") {
      throw new Error(gt`You only have access to the Inbox of this shared account`);
    }
    let result = await this.callOWA(owaCreateNewTopLevelFolderRequest(name, this.sharedFolderRoot && this.username));
    let folderID = sanitize.nonemptystring(result.Folders[0].FolderId.Id);
    let existing = this.folderMap.get(folderID)
      ?? (this.findFolder(folder => folder.id == folderID) as OWAFolder | null);
    if (existing) {
      existing.name = name;
      this.folderMap.set(folderID, existing);
      return existing;
    }
    let folder = await super.createToplevelFolder(name) as OWAFolder;
    let concurrentFolder = this.folderMap.get(folderID)
      ?? (this.findFolder(candidate => candidate.id == folderID) as OWAFolder | null);
    if (concurrentFolder && concurrentFolder != folder) {
      this.rootFolders.remove(folder);
      folder.parent = null;
      concurrentFolder.name = name;
      this.folderMap.set(folderID, concurrentFolder);
      return concurrentFolder;
    }
    folder.id = folderID;
    this.folderMap.set(folderID, folder);
    return folder;
  }

  getEmailByItemID(id: string): OWAEMail | undefined {
    for (let folder of this.getAllFolders()) {
      if (folder instanceof OWAFolder) {
        let email = folder.getEmailByItemID(id);
        if (email) {
          return email;
        }
      }
    }
    for (let dependent of this.dependentAccounts()) {
      if (dependent instanceof OWAAccount) {
        let email = dependent.getEmailByItemID(id);
        if (email) {
          return email;
        }
      }
    }
    return undefined;
  }

  async onNotificationMessages(messages: any[][]) {
    if (!this.isLoggedIn) {
      return;
    }
    let newMessages = new Map<OWAFolder, string[]>();
    let refreshes = new Map<OWAFolder, string[]>();
    let deletions = new Map<OWAFolder, string[]>();
    for (let notification of flattenNotifications(messages)) {
      if (notification?.data == "reinitSubscription" || notification?.id == "reinitSubscription") {
        // Exchange reset its notification state and wants us to subscribe again.
        this.notificationsSubscribedForChannel = null;
        this.refreshNotificationSubscriptions().catch(this.errorCallback);
        continue;
      }
      let subId = String(notification?.SubscriptionId ?? notification?.subscriptionId ?? "");
      let notificationID = String(
        notification?.id ??
        notification?.Id ??
        notification?.NotificationType ??
        notification?.notificationType ??
        subId ??
        notification?.EventType ??
        notification?.eventType ??
        ""
      );
      let itemID = notificationItemID(notification);
      let folderID = notificationFolderID(notification);
      let eventType = String(notification?.EventType ?? notification?.eventType ?? "");
      let row = isRowNotification(notificationID, notification);
      let isNewMail = notificationID == "NewMailNotification" ||
        notificationID.startsWith("NewMailNotification") ||
        subId.startsWith("NewMailNotification") ||
        notification?.NotificationType == "NewMailNotification";
      let isHierarchy = notificationID == "HierarchyNotification" ||
        notificationID.startsWith("HierarchyNotification") ||
        subId.startsWith("HierarchyNotification") ||
        notification?.NotificationType == "HierarchyNotification";
      let folder = row || isNewMail
        ? this.folderForNotification(folderID)
        : null;

      if (isHierarchy) {
        this.handleHierarchyNotification(notification);
      } else if (isNewMail) {
        if (folder && itemID) {
          if (folder instanceof OWAFolder && folder.account instanceof OWAAccount &&
              !folder.account.shouldBackgroundSyncBodies(folder)) {
            folder.account.lazyFolderBadgeOnly(folder);
          } else {
            let ids = newMessages.get(folder) ?? [];
            if (!ids.includes(itemID)) {
              ids.push(itemID);
            }
            newMessages.set(folder, ids);
          }
          if (folder.account instanceof OWAAccount &&
              (folder.account.sharedFolderRoot || folder.account.isDependentAccount) &&
              folder !== folder.account.watchedFolder) {
            // Still enqueue headers above; also refresh badge for sidebar.
            folder.account.refreshFolderBadge(folder);
          }
        } else if (folder) {
          if (folder instanceof OWAFolder && folder.account instanceof OWAAccount &&
              folder.account.shouldBackgroundSyncBodies(folder)) {
            folder.markNextSyncMessagesAsNew();
            folder.syncRecentArrivals().catch(this.errorCallback);
          } else if (folder instanceof OWAFolder && folder.account instanceof OWAAccount) {
            folder.account.lazyFolderBadgeOnly(folder);
          }
        } else {
          this.handleSharedNewMailNotification(folderID, itemID);
        }
      } else if (row) {
        if (this.handleCalendarContactRowNotification(folderID, itemID, eventType)) {
          continue;
        }
        let targetFolder = folder;
        let itemData = notification?.Item ?? notification?.item ??
          notification?.Payload?.Item ?? notification?.payload?.item ??
          notification?.Payload?.Row ?? notification?.payload?.row ??
          notification?.Row ?? notification?.row ?? notification;
        if (targetFolder) {
          if (targetFolder.account instanceof OWAAccount &&
              (targetFolder.account.sharedFolderRoot || targetFolder.account.isDependentAccount) &&
              targetFolder !== targetFolder.account.watchedFolder) {
            targetFolder.account.refreshFolderBadge(targetFolder);
          }
          if (targetFolder.account instanceof OWAAccount &&
              !targetFolder.account.shouldBackgroundSyncBodies(targetFolder)) {
            let hasCachedMessage = !!(itemID && targetFolder.getEmailByItemID(itemID));
            if (eventType == "RowDeleted" && hasCachedMessage) {
              // Ниже — deleteMessageLocally.
            } else if (hasCachedMessage && itemID && eventType != "RowAdded") {
              // Категории/флаги на lazy-папке: GetItem, без полного body sync.
              let email = targetFolder.getEmailByItemID(itemID) ??
                this.getEmailByItemID(itemID);
              if (email && itemData && typeof itemData === "object") {
                if (owaCategoriesPresent(itemData)) {
                  if (email.setFlags({
                    Categories: itemData.Categories ?? itemData.categories,
                  }, "full")) {
                    if (!email.dbID) {
                      email.saveMetadataLocally().catch(this.errorCallback);
                    } else {
                      email.saveWritablePropsLocally().catch(this.errorCallback);
                    }
                  }
                  targetFolder.invalidateMetadataBackfill(itemID);
                }
                let partial = { ...itemData };
                delete partial.Categories;
                delete partial.categories;
                if (email.setFlags(partial, "partial")) {
                  email.saveWritablePropsLocally().catch(this.errorCallback);
                }
              }
              let ids = refreshes.get(targetFolder) ?? [];
              if (!ids.includes(itemID)) {
                ids.push(itemID);
              }
              refreshes.set(targetFolder, ids);
              continue;
            } else {
              targetFolder.account.lazyFolderBadgeOnly(targetFolder);
              continue;
            }
          }
          if (eventType == "RowDeleted" && itemID) {
            let ids = deletions.get(targetFolder) ?? [];
            if (!ids.includes(itemID)) {
              ids.push(itemID);
            }
            deletions.set(targetFolder, ids);
          } else if (eventType == "RowAdded" && itemID) {
            let ids = newMessages.get(targetFolder) ?? [];
            if (!ids.includes(itemID)) {
              ids.push(itemID);
            }
            newMessages.set(targetFolder, ids);
          } else if (itemID) {
            let email = targetFolder.getEmailByItemID(itemID) ?? this.getEmailByItemID(itemID);
            if (email && itemData && typeof itemData === "object") {
              // Row snippets may carry fresh Categories — apply them immediately.
              if (owaCategoriesPresent(itemData)) {
                if (email.setFlags({
                  Categories: itemData.Categories ?? itemData.categories,
                }, "full")) {
                  if (!email.dbID) {
                    email.saveMetadataLocally().catch(this.errorCallback);
                  } else {
                    email.saveWritablePropsLocally().catch(this.errorCallback);
                  }
                }
                targetFolder.invalidateMetadataBackfill(itemID);
              }
              // Other fields may be stale; GetItem refresh below is authoritative.
              let partial = { ...itemData };
              delete partial.Categories;
              delete partial.categories;
              if (email.setFlags(partial, "partial")) {
                email.saveWritablePropsLocally().catch(this.errorCallback);
              }
              let ids = refreshes.get(targetFolder) ?? [];
              if (!ids.includes(itemID)) {
                ids.push(itemID);
              }
              refreshes.set(targetFolder, ids);
            } else {
              let ids = newMessages.get(targetFolder) ?? [];
              if (!ids.includes(itemID)) {
                ids.push(itemID);
              }
              newMessages.set(targetFolder, ids);
            }
          } else {
            if (targetFolder.account instanceof OWAAccount &&
                targetFolder.account.shouldBackgroundSyncBodies(targetFolder)) {
              targetFolder.dirty = true;
              targetFolder.getNewMessages(true).catch(this.errorCallback);
            } else if (targetFolder.account instanceof OWAAccount) {
              targetFolder.account.lazyFolderBadgeOnly(targetFolder);
            }
          }
        } else if (folderID) {
          this.handleSharedNewMailNotification(folderID, itemID);
        }
      }
    }

    await Promise.all([...refreshes].map(async ([folder, itemIDs]) => {
      try {
        await folder.refreshMessages(itemIDs);
      } catch (ex) {
        this.errorCallback(ex);
      }
    }));

    await Promise.all([...newMessages].map(async ([folder, itemIDs]) => {
      // A concurrent folder listing may have already picked up the message.
      let ids = itemIDs.filter((id, i, all) => !folder.getEmailByItemID(id) && all.indexOf(id) == i);
      if (!ids.length) {
        return;
      }
      await folder.withQuickFetchLock(async () => {
        ids = ids.filter(id => !folder.getEmailByItemID(id));
        if (!ids.length) {
          return;
        }
        let messages = await folder.getNewMessageHeaders(ids);
        for (let message of messages) {
          message.isNewArrived = true;
        }
        folder.addMessagesIfAbsent(messages);
        folder.downloadMessages(messages)
          .catch(this.errorCallback);
        folder.dirty = false;
      });
    }));

    await Promise.all([...deletions].map(async ([folder, itemIDs]) => {
      for (let itemID of itemIDs) {
        let email = folder.getEmailByItemID(itemID);
        if (email) {
          await email.deleteMessageLocally();
        }
      }
      folder.noteServerDeletes();
    }));

    this.notifyFolderUIUpdates([...newMessages.keys(), ...refreshes.keys(), ...deletions.keys()]);
  }

  /** Push folder/account observers so open views refresh without switching mailboxes. */
  protected notifyFolderUIUpdates(folders: Iterable<OWAFolder>): void {
    let seenAccounts = new Set<OWAAccount>();
    for (let folder of folders) {
      folder.notifyObservers();
      let account = folder.account;
      if (account instanceof OWAAccount && !seenAccounts.has(account)) {
        seenAccounts.add(account);
        account.notifyObservers();
        account.mainAccount?.notifyObservers();
      }
    }
  }

  /** New mail that `folderForNotification()` could not attribute to a folder.
   * Without a folder id we cannot tell whose mailbox it belongs to, so refresh
   * the open folder and the Inbox of this account and of every shared mailbox
   * hanging off it. */
  protected handleSharedNewMailNotification(folderID: string | null, itemID: string | null): void {
    let accounts: OWAAccount[] = folderID ? [] : [this];
    for (let dependent of this.dependentAccounts()) {
      if (dependent instanceof OWAAccount) {
        accounts.push(dependent);
      }
    }
    for (let account of accounts) {
      if (folderID) {
        let folder = account.folderMap.get(folderID);
        if (folder) {
          if (itemID) {
            folder.withQuickFetchLock(async () => {
              let messages = await folder.getNewMessageHeaders([itemID]);
              for (let message of messages) {
                message.isNewArrived = true;
              }
              folder.addMessagesIfAbsent(messages);
              folder.downloadMessages(messages).catch(this.errorCallback);
              folder.dirty = false;
              this.notifyFolderUIUpdates([folder]);
            }).catch(this.errorCallback);
          } else {
            folder.markNextSyncMessagesAsNew();
            folder.syncRecentArrivals().then(() => {
              this.notifyFolderUIUpdates([folder]);
            }).catch(this.errorCallback);
          }
        }
        continue;
      }
      // NewMail without folder id: refresh the open folder first, then inbox.
      let targets: OWAFolder[] = [];
      if (account.watchedFolder instanceof OWAFolder) {
        targets.push(account.watchedFolder);
      }
      let inbox = account.findInboxFolder() as OWAFolder | null;
      if (inbox && !targets.includes(inbox)) {
        targets.push(inbox);
      }
      for (let folder of targets) {
        folder.markNextSyncMessagesAsNew();
        folder.syncRecentArrivals().then(() => {
          this.notifyFolderUIUpdates([folder]);
        }).catch(this.errorCallback);
      }
    }
  }

  protected folderForNotification(folderID: string | null): OWAFolder | null {
    if (folderID) {
      let folder = this.folderMap.get(folderID);
      if (folder) {
        return folder;
      }
      for (let account of this.dependentAccounts()) {
        if (account instanceof OWAAccount) {
          folder = account.folderMap.get(folderID);
          if (folder) {
            return folder;
          }
        }
      }
      return null;
    }
    // A notification without a folder id cannot be attributed. Guessing the
    // primary Inbox would pull shared-mailbox mail - which is exactly what
    // arrives without a folder id on the delegate channel - into it.
    return null;
  }

  /**
   * RowNotification for calendar / contacts folders: incremental refresh
   * instead of treating the folder as mail (or falling through to shared mail).
   * @returns true if this notification was for cal/contacts (caller should skip mail handling).
   */
  protected handleCalendarContactRowNotification(
    folderID: string | null,
    itemID: string | null,
    eventType: string,
  ): boolean {
    if (!folderID) {
      return false;
    }
    let calendar = appGlobal.calendars.find((c: OWACalendar) =>
      c instanceof OWACalendar && c.mainAccount == this && c.folderID == folderID) as OWACalendar | undefined;
    if (calendar) {
      if (eventType == "RowDeleted" && itemID) {
        let event = calendar.getEventByItemID(itemID);
        if (event) {
          event.deleteLocally().catch(this.errorCallback);
        }
      } else if (itemID) {
        calendar.createOrUpdateEventFromServerByID(itemID).catch(this.errorCallback);
      } else {
        calendar.listEvents().catch(this.errorCallback);
      }
      return true;
    }
    let addressbook = appGlobal.addressbooks.find((ab: OWAAddressbook) =>
      ab instanceof OWAAddressbook && ab.mainAccount == this && ab.folderID == folderID) as OWAAddressbook | undefined;
    if (addressbook) {
      addressbook.refreshFromRowNotification(itemID, eventType).catch(this.errorCallback);
      return true;
    }
    return false;
  }

  protected dependentAccountForHierarchyNotification(notification: any): OWAAccount | null {
    let folderId = notificationFolderID(notification);
    let parentFolderId = objectID(notification.parentFolderId ?? notification.ParentFolderId);
    let subId = String(notification?.SubscriptionId ?? notification?.subscriptionId ?? notification?.id ?? "");
    for (let account of this.dependentAccounts()) {
      if (!(account instanceof OWAAccount)) {
        continue;
      }
      let smtp = account.emailAddress?.toLowerCase() ?? "";
      if (smtp && subId.toLowerCase().includes(smtp)) {
        return account;
      }
      if (folderId && account.folderMap.has(folderId)) {
        return account;
      }
      if (parentFolderId && (parentFolderId == account.msgFolderRootID || account.folderMap.has(parentFolderId))) {
        return account;
      }
    }
    return null;
  }

  protected handleHierarchyNotification(notification: any) {
    try {
      let folderId = notificationFolderID(notification);
      let parentFolderId = objectID(notification.parentFolderId ?? notification.ParentFolderId);
      let addressbook = appGlobal.addressbooks.find((addressbook: OWAAddressbook) => addressbook.mainAccount == this && addressbook.folderID == folderId) as OWAAddressbook | null;
      if (addressbook) {
        addressbook.listContacts().catch(this.errorCallback);
        return;
      }
      let calendar = appGlobal.calendars.find((calendar: OWACalendar) => calendar.mainAccount == this && calendar.folderID == folderId) as OWACalendar | null;
      if (calendar) {
        calendar.listEvents().catch(this.errorCallback);
        return;
      }
      if (!this.isDependentAccount) {
        let sharedAccount = this.dependentAccountForHierarchyNotification(notification);
        if (sharedAccount) {
          sharedAccount.handleHierarchyNotification(notification);
          return;
        }
      }
      if (!folderId) {
        return;
      }
      let folder = this.folderMap.get(folderId)
        ?? (this.findFolder(candidate => candidate.id == folderId) as OWAFolder | null);
      if (folder) {
        // A create response and a hierarchy notification can arrive in either
        // order. Keep the object already present in the tree as canonical.
        this.folderMap.set(folderId, folder);
      }
      if (!folder) {
        let parent = parentFolderId ? this.folderMap.get(parentFolderId) : null;
        if (!parent && parentFolderId != this.msgFolderRootID) {
          return;
        }
        let parentFolders = parent ? parent.subFolders : this.rootFolders;
        folder = this.newFolder();
        folder.id = folderId;
        folder.parent = parent || null;
        parentFolders.push(folder);
        this.folderMap.set(folderId, folder);
      }
      let previousUnread = folder.countUnread;
      let previousTotal = folder.countTotal;
      let rawUnread = notification.unreadCount ?? notification.UnreadCount;
      let rawTotal = notification.itemCount ?? notification.ItemCount;
      let countsMissing = rawUnread == null && rawTotal == null;
      let deferredCountUpdate: { countTotal: number; countUnread: number } | null = null;
      let countsChanged = false;
      if (!countsMissing) {
        let unreadCount = sanitize.integer(rawUnread, previousUnread);
        let itemCount = sanitize.integer(rawTotal, previousTotal);
        countsChanged = itemCount != previousTotal || unreadCount != previousUnread;
        if (countsChanged && this.shouldSyncFolderAfterCountUpdate(
          folder, previousTotal, previousUnread, itemCount, unreadCount)) {
          deferredCountUpdate = { countTotal: itemCount, countUnread: unreadCount };
        } else {
          folder.applyServerCounts(itemCount, unreadCount);
        }
      }
      if (notification.displayName || notification.DisplayName) {
        folder.name = sanitize.nonemptylabel(notification.displayName ?? notification.DisplayName);
      }
      if (deferredCountUpdate) {
        this.syncFolderAfterServerCountUpdate(
          folder, deferredCountUpdate.countTotal, deferredCountUpdate.countUnread);
        return;
      }
      folder.dirty = true;
      // Badge update is immediate for lazy folders and changes without a body sync.
      this.notifyFolderUIUpdates([folder]);
      // Exchange sometimes omits counts on shared Hierarchy; one GetFolder
      // via delegate is enough to paint the badge without opening the folder.
      if (countsMissing) {
        this.callOWA(owaFolderCountsRequest(folder.id)).then(result => {
          let raw = result?.Folders?.[0];
          if (!raw) {
            return;
          }
          let previousUnread = folder.countUnread;
          let previousTotal = folder.countTotal;
          let newUnread = sanitize.integer(raw.UnreadCount, previousUnread);
          let newTotal = sanitize.integer(raw.TotalCount, previousTotal);
          let countsChanged = newUnread != previousUnread || newTotal != previousTotal;
          if (countsChanged && this.shouldSyncFolderAfterCountUpdate(
            folder, previousTotal, previousUnread, newTotal, newUnread)) {
            this.syncFolderAfterServerCountUpdate(folder, newTotal, newUnread);
            return;
          }
          if (countsChanged) {
            folder.applyServerCounts(newTotal, newUnread);
          }
          folder.dirty = true;
          this.notifyFolderUIUpdates([folder]);
          this.syncFolderAfterHierarchyNotification(folder, countsChanged);
        }).catch(this.errorCallback);
        return;
      }
      countsChanged = folder.countUnread != previousUnread || folder.countTotal != previousTotal;
      this.syncFolderAfterHierarchyNotification(folder, countsChanged);
    } catch (ex) {
      this.errorCallback(ex);
    }
  }

  /** Pull headers after a hierarchy badge update when the folder is visible. */
  protected syncFolderAfterHierarchyNotification(folder: OWAFolder, countsChanged: boolean): void {
    let syncMessages = this.isRootInbox(folder)
      ? countsChanged || folder.dirty || folder.isBehindServer()
      : this.shouldBackgroundSyncBodies(folder)
        && (folder === this.watchedFolder || countsChanged);
    if (syncMessages) {
      folder.syncRecentArrivals().then(() => {
        this.notifyFolderUIUpdates([folder]);
      }).catch(this.errorCallback);
    }
  }

  get mayHaveSubAccounts(): boolean {
    return true;
  }

  async listPossibleSubAccounts(): Promise<ArrayColl<Account>> {
    let accounts = await super.listPossibleSubAccounts();
    if (this.isDependentAccount) {
      return accounts;
    }
    let response = await this.callOWA(new OWAGetPeopleFiltersRequest());
    let addressbooks = response.filter(ab => !ab.IsReadOnly && ab.FolderId?.Id);
    let result = await this.callOWA(owaFindFoldersRequest(true));
    let calendars = result.RootFolder.Folders.filter(folder => folder.FolderClass == "IPF.Appointment");
    for (let dependentAcc of this.dependentAccounts()) {
      if (dependentAcc instanceof OWAAccount) {
        let result = await this.callOWA(owaSharedFolderRequest(["contacts", "calendar"], dependentAcc.username));
        for (let folder of result.ResponseMessages.Items.filter(folder => folder.ResponseClass == "Success").map(folder => folder.Folders?.[0]).filter(Boolean)) {
          folder.dependentAcc = dependentAcc; // passed to creation functions below
          if (folder.DistinguishedFolderId == "contacts") {
            addressbooks.push(folder);
          }
          if (folder.DistinguishedFolderId == "calendar") {
            calendars.push(folder);
          }
        }
      }
    }
    accounts.addAll(addressbooks.map((ab, i) => this.createAddressbookAccount(ab, i == 0, ab.dependentAcc)).filter(Boolean));
    accounts.addAll(calendars.map(cal => this.createCalendarAccount(cal, cal.dependentAcc)).filter(Boolean));
    return accounts;
  }

  private createAddressbookAccount(folder: any, isPrimary: boolean, dependentAcc?: OWAAccount): OWAAddressbook | null {
    let folderID = objectID(folder.FolderId) ?? objectID(folder.folderId);
    assert(!folder.IsReadOnly && folderID, "Need writable addressbook");
    if (this.dependentAccounts().find(account => account.protocol == "addressbook-owa" && (account as OWAAddressbook).folderID == folderID)) {
      return null;
    }
    let addressbook = newAddressbookForProtocol("addressbook-owa") as OWAAddressbook;
    addressbook.initFromMainAccount(this);
    if (!isPrimary && folder.DisplayName) {
      addressbook.name = `${(dependentAcc || this).name} ${sanitize.nonemptylabel(folder.DisplayName)}`;
    }
    if (dependentAcc) {
      addressbook.username = dependentAcc.username;
    }
    addressbook.folderID = sanitize.nonemptystring(folderID);
    return addressbook;
  }

  private createCalendarAccount(folder: any, dependentAcc?: OWAAccount): OWACalendar | null{
    assert(folder.FolderClass == "IPF.Appointment", "Need calendar");
    let folderID = objectID(folder.FolderId) ?? objectID(folder.folderId);
    if (this.dependentAccounts().find(account => account.protocol == "calendar-owa" && (account as OWACalendar).folderID == folderID)) {
      return null;
    }
    let calendar = newCalendarForProtocol("calendar-owa") as OWACalendar;
    calendar.initFromMainAccount(this);
    let isPrimary = folder.DistinguishedFolderId == "calendar";
    calendar.useForInvitations = isPrimary;
    if ((dependentAcc || !isPrimary) && folder.DisplayName) {
      calendar.name = `${(dependentAcc || this).name} ${sanitize.nonemptylabel(folder.DisplayName)}`;
    }
    if (dependentAcc) {
      calendar.username = dependentAcc.username;
    }
    calendar.folderID = sanitize.nonemptystring(folderID);
    return calendar;
  }

  /**
   * Used by the sharing UI to identify whether this user has access to any of
   * the specified known folders of another user given their email address,
   * for example, msgfolderroot (entire mailbox), inbox, calendar, contacts.
   */
  async findSharedFolders(person: PersonUID, distinguishedIDs: string[]): Promise<string[]> {
    if (this.mainAccount) {
      throw new NotReached();
    }
    let result = await this.callOWA(owaSharedFolderRequest(distinguishedIDs, person.emailAddress));
    return result.ResponseMessages.Items.filter(folder => folder.ResponseClass == "Success").map(folder => folder.Folders[0].DistinguishedFolderId);
  }

  /**
   * Used by the sharing UI to add another user's mailbox or inbox as an account
   */
  async addSharedFolders(person: PersonUID, sharedFolderRoot: "msgfolderroot" | "inbox"): Promise<OWAAccount> {
    if (this.mainAccount) {
      throw new NotReached();
    }
    let account = newAccountForProtocol("owa") as OWAAccount;
    account.initFromMainAccount(this);
    account.name = person.name;
    account.username = person.emailAddress;
    account.emailAddress = person.emailAddress;
    account.sharedFolderRoot = sharedFolderRoot;
    account.rowNotificationsDisabled = false;
    let identity = new MailIdentity(account);
    identity.realname = person.name;
    identity.emailAddress = person.emailAddress;
    account.identities.add(identity);
    await account.save();
    appGlobal.emailAccounts.add(account);
    await account.listFolders();
    if (account.inbox) {
      account.inbox.dirty = true;
    }
    await this.refreshNotificationSubscriptions();
    return account;
  }

  /**
   * Used by the sharing UI to add another user's addressbook as an account.
   * Only the default addressbook is supported.
   */
  async addSharedAddressbook(person: PersonUID): Promise<OWAAddressbook> {
    if (this.mainAccount) {
      throw new NotReached();
    }
    let result = await this.callOWA(owaSharedFolderRequest(["contacts"], person.emailAddress));
    let folder = result.Folders?.[0];
    assert(folder, gt`Shared contacts folder not found`);
    let addressbook = newAddressbookForProtocol("addressbook-owa") as OWAAddressbook;
    addressbook.initFromMainAccount(this);
    addressbook.name = `${person.name} ${folder.DisplayName}`;
    addressbook.username = person.emailAddress;
    addressbook.folderID = sanitize.nonemptystring(objectID(folder.FolderId) ?? objectID(folder.folderId));
    appGlobal.addressbooks.add(addressbook);
    await addressbook.listContacts();
    return addressbook;
  }

  /**
   * Used by the sharing UI to add another user's calendar as an account.
   * Only the default calendar is supported.
   */
  async addSharedCalendar(person: PersonUID): Promise<OWACalendar> {
    if (this.mainAccount) {
      throw new NotReached();
    }
    let result = await this.callOWA(owaSharedFolderRequest(["calendar"], person.emailAddress));
    let folder = result.Folders?.[0];
    assert(folder, gt`Shared calendar folder not found`);
    let calendar = newCalendarForProtocol("calendar-owa") as OWACalendar;
    calendar.initFromMainAccount(this);
    calendar.name = `${person.name} ${folder.DisplayName}`;
    calendar.username = person.emailAddress;
    calendar.folderID = sanitize.nonemptystring(objectID(folder.FolderId) ?? objectID(folder.folderId));
    calendar.useForInvitations = true;
    appGlobal.calendars.add(calendar);
    await calendar.listEvents();
    return calendar;
  }

  canShareWithPersons(): boolean {
    return true;
  }

  async getSharedPersons(): Promise<ArrayColl<PersonUID> | null> {
    // well, some of them at least...
    return await (this.inbox as OWAFolder)?.getSharedPersons();
  }

  async deleteSharedPerson(otherPerson: PersonUID) {
    for (let folder of this.getAllFolders()) {
      await deleteExchangePermissions(folder as OWAFolder, otherPerson);
    }
  }

  async addSharedPerson(otherPerson: PersonUID, mailFolder: OWAFolder | null, includeSubfolders: boolean, access: MailShareCombinedPermissions, ...permissions: MailShareIndividualPermissions[]) {
    // XXX Need root folder to share all mail
    let foldersToShare = (!mailFolder ? this.getAllFolders() : includeSubfolders ? mailFolder.getInclusiveDescendants() : new ArrayColl<Folder>([mailFolder]));
    for (let folder of foldersToShare) {
      await setExchangePermissions(folder as OWAFolder, otherPerson, access, ...permissions);
    }
  }

  /** Master Category List for this mailbox (primary or shared via explicit logon). */
  async fetchMasterCategoryList(): Promise<MasterCategoryEntry[]> {
    let config = await this.callOWA(new OWAGetUserConfigurationRequest());
    let list = config?.MasterCategoryList ?? config?.masterCategoryList ??
      config?.CategoryList ?? config?.categoryList ?? config;
    let categories = findCategoryEntries(list);
    let entries: MasterCategoryEntry[] = [];
    for (let [index, category] of categories.entries()) {
      let name = categoryName(category);
      if (!name) {
        continue;
      }
      entries.push({
        name,
        color: outlookCategoryColor(category?.Color ?? category?.color ?? category?.ColorIndex ?? category?.colorIndex) ?? "#0078D7",
        sortOrder: index,
      });
    }
    return entries;
  }

  fromConfigJSON(json: any) {
    super.fromConfigJSON(json);
    this.sharedFolderRoot = sanitize.enum(json.sharedFolderRoot, ["msgfolderroot", "inbox"], null);
  }

  toConfigJSON(): any {
    let json = super.toConfigJSON();
    json.sharedFolderRoot = this.sharedFolderRoot;
    return json;
  }
}

function resolveOWAAccountForTagSync(primary: OWAAccount): OWAAccount | null {
  let syncAccountId = getTagsSyncAccountId();
  if (syncAccountId) {
    let configured = appGlobal.emailAccounts.find(account => account.id == syncAccountId);
    if (configured instanceof OWAAccount && configured.isLoggedIn) {
      return configured;
    }
  }
  let shared: OWAAccount[] = [];
  for (let account of appGlobal.emailAccounts) {
    if (account instanceof OWAAccount && account.isDependentAccount && account.isLoggedIn) {
      shared.push(account);
    }
  }
  if (shared.length) {
    return shared[0];
  }
  return primary.isDependentAccount ? null : primary;
}

function flattenNotifications(value: any): any[] {
  if (Array.isArray(value)) {
    return value.flatMap(flattenNotifications);
  }
  if (!value || typeof value != "object") {
    return [];
  }
  if (Array.isArray(value.d)) {
    return value.d.flatMap(flattenNotifications);
  }
  if (Array.isArray(value.M)) {
    return value.M.flatMap(flattenNotifications);
  }
  if (Array.isArray(value.ResponseMessages?.Items)) {
    return value.ResponseMessages.Items.flatMap(flattenNotifications);
  }
  if (Array.isArray(value.Items)) {
    return value.Items.flatMap(flattenNotifications);
  }
  return [value];
}

function notificationSubscriptionsSucceeded(result: any): boolean {
  let items = Array.isArray(result)
    ? result
    : Array.isArray(result?.Items)
      ? result.Items
      : Array.isArray(result?.ResponseMessages?.Items)
        ? result.ResponseMessages.Items
        : null;
  if (!items) {
    return true;
  }
  return items.length > 0 && items.every((item: any) =>
    item?.SuccessfullyCreated === true || item?.SubscriptionExists === true ||
    !("SuccessfullyCreated" in (item ?? {})) && !("ErrorInfo" in (item ?? {}))
  );
}

function objectID(value: any): string | null {
  if (typeof value == "string" && value) {
    return value;
  }
  if (value && typeof value == "object") {
    if (typeof value.Id == "string" && value.Id) {
      return value.Id;
    }
    if (typeof value.id == "string" && value.id) {
      return value.id;
    }
  }
  return null;
}

function collectFolderTree(folders: Collection<OWAFolder>, result: Map<string, OWAFolder>): void {
  for (let folder of folders) {
    if (folder.id) {
      result.set(folder.id, folder);
    }
    collectFolderTree(folder.subFolders, result);
  }
}

function notificationItemID(notification: any): string | null {
  return [
    notification?.ItemId,
    notification?.itemId,
    notification?.Item?.ItemId,
    notification?.item?.ItemId,
    notification?.Item?.Id,
    notification?.item?.id,
    notification?.RowId,
    notification?.rowId,
    notification?.Row?.ItemId,
    notification?.row?.ItemId,
    notification?.Row?.ItemId?.Id,
    notification?.Payload?.ItemId,
    notification?.payload?.ItemId,
    notification?.Payload?.RowId,
    notification?.payload?.RowId,
    notification?.Payload?.Item?.ItemId,
    notification?.payload?.Item?.ItemId,
    notification?.Event?.ItemId,
    notification?.event?.ItemId,
    notification?.Event?.Item?.ItemId,
    notification?.event?.item?.ItemId,
  ].map(objectID).find(Boolean) ?? null;
}

function notificationFolderID(notification: any): string | null {
  let directId = [
    notification?.FolderId,
    notification?.folderId,
    notification?.Item?.ParentFolderId,
    notification?.item?.ParentFolderId,
    notification?.Payload?.FolderId,
    notification?.payload?.FolderId,
    notification?.Row?.ParentFolderId,
    notification?.row?.ParentFolderId,
  ].map(objectID).find(Boolean);
  if (directId) {
    return directId;
  }
  // Try extracting folder ID from the subscription identifier. Exchange 2019
  // delivers it in the `id` field as "RowNotification<folderID>_...", while
  // newer OWA builds use the view identifier from `SubscriptionId`.
  let subId = notification?.SubscriptionId ?? notification?.subscriptionId ?? notification?.id ?? notification?.Id;
  if (typeof subId == "string") {
    let modernMatch = subId.match(/^folderId:([^;]+)/);
    if (modernMatch?.[1]) {
      return modernMatch[1];
    }
    let match = subId.match(/^RowNotification(.*)_(?:true|false)_/);
    if (match && match[1]) {
      return match[1];
    }
  }
  return null;
}

function isRowNotification(notificationID: string, notification: any): boolean {
  let subId = String(notification?.SubscriptionId ?? notification?.subscriptionId ?? "");
  return notificationID == "RowNotification" || notificationID.startsWith("RowNotification") ||
    subId.startsWith("RowNotification") ||
    // Modern OWA identifies a row subscription by its view descriptor rather
    // than by the legacy `RowNotification<folder>_...` prefix.
    subId.startsWith("folderId:") ||
    notification?.NotificationType == "RowNotification" || notification?.notificationType == "RowNotification" ||
    typeof notification?.__type == "string" && notification.__type.startsWith("RowNotification") ||
    typeof notification?.EventType == "string" && notification.EventType.startsWith("Row") ||
    typeof notification?.eventType == "string" && notification.eventType.startsWith("Row");
}

function findCategoryEntries(list: any): any[] {
  if (typeof list == "string") {
    try {
      return findCategoryEntries(JSON.parse(list));
    } catch {
      let xmlCategories: any[] = [];
      let matches = list.matchAll(/<category\s+([^>]+)\/?>/gi);
      for (let match of matches) {
        let attrs = match[1];
        let nameMatch = attrs.match(/name=(?:"([^"]*)"|'([^']*)')/i);
        let colorMatch = attrs.match(/color=(?:"([^"]*)"|'([^']*)')/i);
        if (nameMatch) {
          xmlCategories.push({
            Name: nameMatch[1] ?? nameMatch[2],
            Color: colorMatch ? Number(colorMatch[1] ?? colorMatch[2]) : null,
          });
        }
      }
      if (xmlCategories.length) {
        return xmlCategories;
      }
      return [];
    }
  }
  if (Array.isArray(list)) {
    return list;
  }
  if (!list || typeof list != "object") {
    return [];
  }
  if (categoryName(list)) {
    return [list];
  }
  for (let key of ["Categories", "Category", "MasterCategoryList", "MasterCategory", "Items", "items", "value", "MasterList", "masterList"]) {
    let entries = list[key];
    if (Array.isArray(entries)) {
      return entries;
    }
    if (entries && typeof entries == "object") {
      if (categoryName(entries)) {
        return [entries];
      }
      let nested = findCategoryEntries(entries);
      if (nested.length) {
        return nested;
      }
    }
  }
  for (let value of Object.values(list)) {
    let nested = findCategoryEntries(value);
    if (nested.length) {
      return nested;
    }
  }
  return [];
}

function categoryName(category: any): string | null {
  let value = category?.Name ?? category?.name ?? category?.DisplayName ?? category?.displayName ??
    category?.CategoryName ?? category?.categoryName ?? category?.Value;
  return typeof value == "string" && value.trim() ? value.trim() : null;
}

function outlookCategoryColor(value: unknown): string | null {
  if (value && typeof value == "object") {
    for (let key of ["Value", "value", "Name", "name", "Color", "color", "Index", "index"]) {
      if (key in value) {
        let color = outlookCategoryColor((value as any)[key]);
        if (color) {
          return color;
        }
      }
    }
    return null;
  }
  if (typeof value == "string" && /^#[0-9a-f]{6}$/i.test(value)) {
    return value;
  }
  let text = String(value ?? "").toLowerCase();
  if (text == "none" || text == "") {
    return null;
  }
  let match = text.match(/^(?:preset)?(\d+)$/);
  let index = match ? Number(match[1]) : Number(value);
  return Number.isInteger(index) && index >= 0 && index < kOutlookCategoryColors.length
    ? kOutlookCategoryColors[index]
    : null;
}

function addRecipients(aRequest: any, aType: string, aRecipients: PersonUID[]): void {
  if (!aRecipients.length) {
    return;
  }
  aRequest.addField("Message", aType, aRecipients.map(recipient => ({
    Name: recipient.name,
    EmailAddress: recipient.emailAddress,
  })), "message:" + aType);
}

class OWAGetPeopleFiltersRequest {
  /** This is an empty request, but it still needs an action. */
  get action() {
    return "GetPeopleFilters";
  }
}

export const kMaxFetchCount = 50;
