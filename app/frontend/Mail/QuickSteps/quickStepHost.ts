import type { EMail } from "../../../logic/Mail/EMail";
import { runQuickStep, type QuickStep, type QuickStepHost } from "../../../logic/Mail/QuickSteps/QuickSteps";
import { PersonUID } from "../../../logic/Abstract/PersonUID";
import { getTagByName } from "../../../logic/Abstract/Tag";
import { appGlobal } from "../../../logic/app";
import { applyTemplateToMail, loadTemplateForInsert } from "../Templates/mailTemplates";
import { mailApp } from "../MailJackdawApp";

/** Быстрое действие в приложении: пересылка и ответ открываются в редакторе */
export const quickStepHost: QuickStepHost = {
  accounts: appGlobal.emailAccounts,
  async forward(email: EMail, to: string[]) {
    let forward = await email.compose.forward();
    for (let address of to) {
      forward.to.add(new PersonUID(address));
    }
    mailApp.writeMail(forward);
  },
  async replyWithTemplate(email: EMail, templateID: number) {
    let template = await loadTemplateForInsert(templateID);
    let reply = email.compose.replyToAuthor();
    applyTemplateToMail(reply, template);
    mailApp.writeMail(reply);
  },
  async addCategory(emails: EMail[], name: string) {
    let tag = getTagByName(name);
    for (let email of emails) {
      await email.addTags([tag]);
    }
  },
};

export async function runQuickStepInApp(step: QuickStep, emails: EMail[]): Promise<void> {
  await runQuickStep(step, emails, quickStepHost);
}
