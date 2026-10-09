/**
 * Contains the hardcoded URLs for a handful of important providers,
 * including the client ID and secret.
 *
 * This is for legacy reasons. Going forward, we should use mAuth and
 * the client ID should be hardcoded ("messaging").
 *
 * This is essentially a JSON file, but allowing comments and trailing commas :).
 * It contains only data, no code.
 */

/**
 * Компания, которая обслуживает сервер учетной записи.
 * Указываем только наиболее распространенных провайдеров,
 * для которых приложения используют специальные настройки.
 */
export enum Provider {
  Office365 = "office365",
  Google = "google",
  MailRu = "mail.ru",
}

export const OAuth2URLs = [
  {
    provider: Provider.Office365,
    domains: ["outlook.com", "outlook.office365.com", "outlook.cloud.microsoft"],
    hostnames: ["outlook.office365.com", "outlook.cloud.microsoft", "outlook.office.com"],
    authURL: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    authDoneURL: "https://login.microsoftonline.com/common/oauth2/nativeclient",
    tokenURL: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    // tokenURLPasswordAuth: "https://login.microsoftonline.com/organizations/oauth2/v2.0/token", works only for some business accounts
    logoutURL: "https://login.microsoftonline.com/common/oauth2/logout",
    scope: "offline_access EWS.AccessAsUser.All EAS.AccessAsUser.All https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/POP.AccessAsUser.All https://outlook.office.com/SMTP.Send",
    clientID: "1d01f7d4-334b-475a-9176-a0d504c6a38a",
    clientSecret: null,
    doPKCE: false,
  },
  {
    provider: Provider.Office365,
    domains: ["graph.microsoft.com"],
    hostnames: ["graph.microsoft.com"],
    authURL: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    authDoneURL: "https://login.microsoftonline.com/common/oauth2/nativeclient",
    tokenURL: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    logoutURL: "https://login.microsoftonline.com/common/oauth2/logout",
    scope: "Mail.ReadWrite Mail.ReadWrite.Shared Mail.Send Mail.Send.Shared Calendars.ReadWrite Calendars.ReadWrite.Shared Contacts.ReadWrite Contacts.ReadWrite.Shared Chat.ReadWrite OnlineMeetings.ReadWrite Files.ReadWrite.All User.Read openid profile offline_access",
    clientID: "1d01f7d4-334b-475a-9176-a0d504c6a38a",
    clientSecret: null,
    doPKCE: false,
  },
  {
    provider: Provider.Google,
    domains: ["google.com", "gmail.com", "googlemail.com" ],
    hostnames: ["imap.gmail.com", "smtp.gmail.com", "pop.gmail.com"],
    authURL: "https://accounts.google.com/o/oauth2/auth",
    tokenURL: "https://oauth2.googleapis.com/token",
    logoutURL: "https://www.google.com/accounts/Logout?continue=https://appengine.google.com/_ah/logout?continue=http://localhost",
    scope: "https://mail.google.com/ https://www.googleapis.com/auth/carddav https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/drive",
    clientID: "",
    clientSecret: null,
    doPKCE: true,
  },
  {
    provider: Provider.MailRu,
    domains: ["mail.ru", "inbox.ru", "list.ru", "bk.ru", "internet.ru"],
    hostnames: ["imap.mail.ru", "pop.mail.ru", "smtp.mail.ru"],
    authURL: "https://o2.mail.ru/login",
    authDoneURL: "http://localhost",
    tokenURL: "https://o2.mail.ru/token",
    scope: "mail.imap",
    clientID: "thunderbird",
    clientSecret: "I0dCAXrcaNFujaaY",
    doPKCE: false,
  },
  {
    provider: null,
    domains: ["yahoo.com"],
    hostnames: ["imap.mail.yahoo.com", "pop.mail.yahoo.com", "smtp.mail.yahoo.com" ],
    authURL: "https://api.login.yahoo.com/oauth2/request_auth",
    tokenURL: "https://api.login.yahoo.com/oauth2/get_token",
    logoutURL: "https://login.yahoo.com/account/logout?logout_all=1&src=app&.done=https%3A%2F%2Fwww.yahoo.com%2F",
    scope: "mail-w",
    clientID: "",
    clientSecret: null,
    doPKCE: true,
  },
  {
    provider: null,
    domains: ["aol.com"],
    hostnames: ["imap.aol.com", "pop.aol.com", "smtp.aol.com"],
    authURL: "https://api.login.aol.com/oauth2/request_auth",
    tokenURL: "https://api.login.aol.com/oauth2/get_token",
    logoutURL: "https://login.aol.com/account/logout?logout_all=1&src=app&.done=https%3A%2F%2Fwww.aol.com%2F",
    scope: "mail-w",
    clientID: "",
    clientSecret: null,
    doPKCE: true,
  },
  {
    provider: null,
    domains: ["fastmail.com", "fastmail.fm"],
    hostnames: ["api.fastmail.com", "fastmail.com", "imap.fastmail.com"],
    authURL: "https://api.fastmail.com/oauth/authorize",
    authDoneURL: null,
    tokenURL: "https://api.fastmail.com/oauth/refresh",
    scope: "https://www.fastmail.com/dev/protocol-imap https://www.fastmail.com/dev/protocol-pop https://www.fastmail.com/dev/protocol-smtp https://www.fastmail.com/dev/protocol-carddav https://www.fastmail.com/dev/protocol-caldav https://www.fastmail.com/dev/protocol-webdav urn:ietf:params:jmap:core urn:ietf:params:jmap:mail urn:ietf:params:jmap:submission urn:ietf:params:jmap:vacationresponse",
    clientID: "352641ae", // Jackdaw
    clientSecret: null,
    doPKCE: true,
  },
];
