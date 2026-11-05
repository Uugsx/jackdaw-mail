/**
 * «Отвечает»: пока открыт черновик ответа на письмо общего ящика — в главном окне,
 * плавающий или в отдельном окне. Все они живут в `mailApp.subApps` главного окна.
 */
import type { EMail } from "../../../logic/Mail/EMail";
import type { JackdawApp } from "../../AppsBar/JackdawApp";
import { onMailSent } from "../../../logic/Mail/Collision/mailSent";
import { mailApp, WriteMailJackdawApp } from "../MailJackdawApp";
import { getSharedMailboxPresence, markCollisionReplied, replySource } from "./collisionPresence";

/** @returns остановка */
export function watchReplyComposers(): () => void {
  let releases = new Map<JackdawApp, () => void>();
  let sync = () => {
    let composers = new Set<JackdawApp>(mailApp.subApps.contents.filter(app => app instanceof WriteMailJackdawApp));
    for (let [app, release] of releases) {
      if (!composers.has(app)) {
        release();
        releases.delete(app);
      }
    }
    for (let app of composers) {
      if (releases.has(app)) continue;
      let mail = app.windowParams?.mail as EMail | undefined;
      let source = mail ? replySource(mail) : null;
      releases.set(app, source ? getSharedMailboxPresence().begin(source.mailbox, source.messageID, "replying") : () => {});
    }
  };
  let unsubscribe = mailApp.subApps.subscribe(sync);
  let stopSent = onMailSent(markCollisionReplied);
  return () => {
    unsubscribe();
    stopSent();
    releases.forEach(release => release());
    releases.clear();
  };
}
