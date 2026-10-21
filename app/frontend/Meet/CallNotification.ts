import { NotificationKinds, SystemNotification } from "../Shared/SystemNotification";
import { appGlobal } from "../../logic/app";
import { backgroundError } from "../Util/error";

/** Уведомление ОС о звонке, которое можно убрать: входящий уже принят, отклонён или отменён,
 * и висящее «Входящий звонок» только сбивает с толку.
 * Показывает только всплывающее окно, без звука и значка на иконке приложения: звонит рингтон экрана вызова. */
export class CallNotification extends SystemNotification {
  /** Окно ОС (объект Electron через JPC) или веб-уведомление */
  protected popup: { close(): unknown } | null = null;
  protected closed = false;

  constructor(title: string, body: string, id: string) {
    super(new NotificationKinds(["popup"]), title, body, id);
    this.updatesTaskbarBadge = false;
  }

  protected async showOSPopup(): Promise<void> {
    let popup = await appGlobal.remoteApp.newOSNotification({
      title: this.title,
      body: this.body,
      urgency: this.urgency,
      // Звонит рингтон экрана вызова, сигнал ОС поверх него не нужен
      silent: true,
    });
    if (this.onClick) {
      popup.on("click", event => this.onClick(event));
    }
    popup.on("failed", (_event, error) => {
      backgroundError(new Error("Failed to show the OS popup notification: " + error));
    });
    popup.show();
    this.keepPopup(popup);
  }

  protected async showWebPopup(): Promise<void> {
    if (typeof (Notification) == "undefined") { // например, Android WebView
      return;
    }
    if (Notification.permission != "granted" &&
        await Notification.requestPermission() != "granted") {
      return;
    }
    let popup = new Notification(this.title, { body: this.body, tag: this.id });
    if (this.onClick) {
      popup.onclick = event => this.onClick(event);
    }
    this.keepPopup(popup);
  }

  /** Окно могло появиться уже после `close()`: показ асинхронный. Тогда закрываем сразу. */
  protected keepPopup(popup: { close(): unknown }): void {
    this.popup = popup;
    if (this.closed) {
      this.close();
    }
  }

  close(): void {
    this.closed = true;
    let popup = this.popup;
    this.popup = null;
    if (!popup) {
      return;
    }
    try {
      Promise.resolve(popup.close()).catch(backgroundError);
    } catch (ex) {
      backgroundError(ex);
    }
  }
}
