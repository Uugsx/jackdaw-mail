import type { EMail } from "../../logic/Mail/EMail";
import { JackdawApp } from "../AppsBar/JackdawApp";
import { openApp } from "../AppsBar/selectedApp";
import { OAuth2Tab, oAuth2TabsOpen } from "../../logic/Auth/UI/OAuth2Tab";
import { appGlobal } from "../../logic/app";
import mailIcon from "lucide-svelte/icons/mail";
import EditIcon from "lucide-svelte/icons/pencil";
import AuthIcon from "lucide-svelte/icons/key-round";
import { derived } from "svelte/store";
import { gt } from "../../l10n/l10n";
import { openFloatingCompose, shouldOpenComposeInWindow } from "./Composer/composeFloating";
import { openNativeComposeWindow, supportsNativeComposeWindow } from "./Composer/composeNative";
import { applyComposeMailPayload } from "./Composer/composeWindow";
import type { ComposeWindowMail } from "../../logic/Mail/Composer/ComposeWindowProtocol";
import type { MessageWindowPayload, MessageWindowReplyMode } from "../../logic/Mail/MessageWindowProtocol";
import { resolveComposeRecipients } from "../../logic/Mail/composeResolveRecipients";
import { deserializeMessageWindowMail } from "./Message/messageWindow";
import { get } from "svelte/store";
import { selectedApp } from "../AppsBar/selectedApp";
import { assert } from "../../logic/util/util";

export class MailJackdawApp extends JackdawApp {
  id = "mail";
  name = gt`Mail`;
  icon = mailIcon;
  appURL = "/mail";

  writeMail(mail: EMail, options: { nativeWindowID?: string; forceMainWindow?: boolean } = {}) {
    let composerApp = new WriteMailJackdawApp();
    composerApp.title = derived(mail, () => mail.subject ?? composerApp.name);
    composerApp.windowParams = {
      mail: mail,
      ...(options.nativeWindowID ? { nativeComposeWindowID: options.nativeWindowID } : {}),
    };
    mailApp.subApps.add(composerApp);
    if (options.forceMainWindow) {
      openComposeInMainWindow(composerApp, mail);
      return;
    }
    if (shouldOpenComposeInWindow() || options.nativeWindowID) {
      if (supportsNativeComposeWindow()) {
        void openNativeComposeWindow(composerApp, mail)
          .catch(() => options.nativeWindowID
            ? openComposeInMainWindow(composerApp, mail)
            : openFloatingCompose(composerApp, mail));
      } else if (options.nativeWindowID) {
        openComposeInMainWindow(composerApp, mail);
      } else {
        openFloatingCompose(composerApp, mail);
      }
      if (get(selectedApp)?.id === "mail-write") {
        openApp(mailApp, {});
      }
      return;
    }
    openApp(composerApp, composerApp.windowParams);
  }

  login(tab: OAuth2Tab): LoginDialogJackdawApp {
    let loginApp = new LoginDialogJackdawApp();
    let account = tab.oAuth2.account;
    loginApp.title = derived(account, () => gt`Login to ${account.name}`);
    loginApp.windowParams = { dialog: tab };
    mailApp.subApps.add(loginApp);
    openApp(loginApp, loginApp.windowParams);
    return loginApp;
  }
}

export const mailApp = new MailJackdawApp();

export function handleNativeComposeWindowClosed(windowID: string): void {
  let composer = mailApp.subApps.find(app =>
    app instanceof WriteMailJackdawApp && app.windowParams?.nativeComposeWindowID === windowID);
  if (composer) {
    mailApp.subApps.remove(composer);
  }
}

/** Sends detached-composer edits through the already logged-in main renderer. */
export async function sendNativeComposeWindow(windowID: string, payload: ComposeWindowMail): Promise<void> {
  let composer = mailApp.subApps.find(app =>
    app instanceof WriteMailJackdawApp && app.windowParams?.nativeComposeWindowID === windowID) as WriteMailJackdawApp | undefined;
  assert(composer, "Compose window is no longer available");
  let mail = composer.windowParams?.mail as EMail | undefined;
  assert(mail, "Compose window message is no longer available");
  applyComposeMailPayload(mail, payload);
  await resolveComposeRecipients(mail);
  await mail.compose.send();
}

/** Открывает штатную форму ответа в текущем окне просмотра, если оно передано. */
export function handleNativeMessageWindowReply(
  mode: MessageWindowReplyMode,
  payload: MessageWindowPayload,
  messageWindowID?: string,
): void {
  let account = appGlobal.emailAccounts.find(candidate => candidate.id === payload.mail.accountID);
  assert(account, "Message window account is no longer available");
  let message = deserializeMessageWindowMail(payload, account);
  let reply = mode == "replyAll"
    ? message.compose.replyAll()
    : message.compose.replyToAuthor();
  mailApp.writeMail(reply, messageWindowID ? { nativeWindowID: messageWindowID } : {});
}

export class WriteMailJackdawApp extends JackdawApp {
  id = "mail-write";
  name = gt`Compose`;
  icon = EditIcon;
  appURL = "/mail/compose";
}

/** Открывает тот же редактор в основном окне, если системное окно не удалось создать. */
export function openComposeInMainWindow(composerApp: WriteMailJackdawApp, mail: EMail): void {
  composerApp.windowParams = {
    ...(composerApp.windowParams ?? {}),
    mail,
    forceMainCompose: true,
  };
  openApp(composerApp, composerApp.windowParams);
}

export class LoginDialogJackdawApp extends JackdawApp {
  id = "auth-login";
  name = gt`Login`;
  icon = AuthIcon;
  appURL = "/login";
}

const tabsObserver = {
  added(tabs: OAuth2Tab[]) {
    for (let tab of tabs) {
      // TODO simplify, using URLs? But remove correctly.
      tab.launcherApp = mailApp.login(tab);
    }
  },
  removed(tabs: OAuth2Tab[]) {
    for (let tab of tabs) {
      mailApp.subApps.remove(tab.launcherApp);
    }
    openApp(mailApp, {});
  },
};
oAuth2TabsOpen.registerObserver(tabsObserver);
(appGlobal as any)._oAuth2TabsObserver = tabsObserver; // HACK to keep it alive
