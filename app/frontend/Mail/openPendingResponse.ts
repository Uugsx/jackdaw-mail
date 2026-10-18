import { appGlobal } from "../../logic/app";
import { MailAccount } from "../../logic/Mail/MailAccount";
import type { PendingResponseRequest } from "../../logic/Reports/ResponseReminder";
import { openEMailMessage } from "./open";
import { gt } from "../../l10n/l10n";

/** Открывает письмо из живого SLA-контроля, даже если оно ещё не загружено в список. */
export async function openPendingResponseMessage(
  candidate: Pick<PendingResponseRequest, "accountId" | "folderId" | "emailId">,
): Promise<void> {
  const account = appGlobal.emailAccounts.find(
    (item) =>
      item instanceof MailAccount &&
      String(item.dbID) == String(candidate.accountId),
  );
  if (!(account instanceof MailAccount)) {
    throw new Error(gt`The mailbox for this request is not available.`);
  }
  await account.readFromDB();
  const folder = account.findFolder(
    (item) => String(item.dbID) == String(candidate.folderId),
  );
  if (!folder) {
    throw new Error(gt`The folder for this request is not available.`);
  }
  let email = folder.messages.find(
    (item) => String(item.dbID) == String(candidate.emailId),
  );
  if (!email) {
    email = folder.newEMail();
    email.dbID = candidate.emailId;
  }
  await email.storage.readMessage(email);
  // The folder list may not have loaded this older message yet. Keep the
  // exact object that is displayed in the folder collection so the virtual
  // mail list can select and reveal it after the folder is opened.
  if (!folder.messages.contains(email)) {
    folder.messages.add(email);
  }
  await openEMailMessage(email);
}
