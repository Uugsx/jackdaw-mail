import { WebBasedAuth } from "./WebBasedAuth";
import { OAuth2LoginNeeded } from "./OAuth2Error";
import { OAuth2Tab } from "./UI/OAuth2Tab";
import { OWALoginBackground } from "../Mail/OWA/Login/OWALoginBackground";
import type { OWAAccount } from "../Mail/OWA/OWAAccount";
import { appGlobal } from "../app";
import { assert, NotReached, type URLString } from "../util/util";
import { isNetworkError } from "../util/netUtil";

/** Log into OWA web interface via browser. Mimics the `OAuth2` API. */
export class OWAAuth extends WebBasedAuth {
  declare account: OWAAccount;
  ui: OAuth2Tab | null = null;
  isLoggedIn = false;

  constructor(account: OWAAccount) {
    super(account);
  }

  // Called from `TBProfile.readMailAccount()`
  setTokenURLPasswordAuth(url: string | null | undefined) {
  }

  // Unused
  get authorizationHeader(): never {
    throw new NotReached();
  }

  // Called from `OWAAccount.loginCommon()`
  async login(interactive: boolean, skipSessionCheck = false): Promise<string> {
    assert(this.account, "Need to set account first");
    if (this.isLoggedIn) {
      return "";
    }
    // OWA authentication is backed by the persistent browser session rather
    // than by an OAuth refresh token. Reuse that session on application
    // startup, so a saved account does not require opening the login tab on
    // every launch.
    if (!skipSessionCheck) {
      try {
        if (await this.account.testLoggedIn()) {
          this.isLoggedIn = true;
          return "";
        }
      } catch (ex) {
        // Отмена сетевого запроса не означает неверные учётные данные. При
        // интерактивном входе всё равно открываем штатную форму авторизации.
        if (!isNetworkError(ex) || !interactive) {
          throw ex;
        }
      }
    }
    if (!interactive) {
      throw new OAuth2LoginNeeded();
    }
    return this.loginWithUI();
  }

  // Called from above to match behaviour of OAuth2 class
  async loginWithUI(): Promise<string> {
    this.ui = new OAuth2Tab(this);
    await this.ui.login();
    this.ui = null;
    return "";
  }

  // Called from `prepareLogin()` during account setup
  // ui is probably not actually set at this point, but whatever
  abort() {
    this.ui?.abort();
  }

  // Called from `OWAAccount.logout()`
  async logout() {
    this.isLoggedIn = false;
    return appGlobal.remoteApp.OWA.clearStorageData(this.account.partition);
  }

  // Unused
  async reset(): Promise<never> {
    throw new NotReached();
  }

  // Called from `startLogin()` during account setup
  async getAccessTokenFromAuthCode(authCode: string): Promise<string> {
    if (!await this.account.testLoggedIn()) {
      throw new OAuth2LoginNeeded();
    }
    return "";
  }

  // Called from `OAuth2Embed.login()` and `OAuth2Tab.login()`
  async getAuthURL(): Promise<URLString> {
    await appGlobal.remoteApp.OWA.scrapeStartupDataAuth(this.account.partition);
    // `/owa/` with an expired session cookie returns HTTP 440 and a script
    // that reloads itself, so the login tab never reaches the form.
    // Open the logon page directly, as a browser does after that 440.
    return OWALoginBackground.logonURL(this.account.url);
  }

  // Called from `OAuth2Embed.urlChanged()` and `OAuth2Tab.urlChanged()`
  async isAuthDoneURL(url: URLString): Promise<boolean> {
    if (url.includes("/auth/logon.aspx") || url.includes("/auth/errorfe.aspx") || url.includes("reason=2")) {
      return false;
    }
    return this.isLoggedIn = await this.account.testLoggedIn();
  }

  // Called from `OAuth2Embed.success()` and `OAuth2Tab.success()`
  getAuthCodeFromDoneURL(url: URLString): string {
    return "";
  }

  // Called from `MailAccount.toConfigJSON()`
  toConfigJSON() {
  }
}
