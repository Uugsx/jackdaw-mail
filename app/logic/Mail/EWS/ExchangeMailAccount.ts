import { MailAccount, DeleteStrategy } from "../MailAccount";
import { TLSSocketType } from "../../Abstract/TCPAccount";
import { Calendar } from "../../Calendar/Calendar";
import { ExchangeCalendar } from "../../Calendar/EWS/ExchangeCalendar";
import { appGlobal } from "../../app";
import type { Folder } from "../Folder";
import { notifyChangedProperty } from "../../util/Observable";
import { ArrayColl, Collection } from "svelte-collections";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";

export class ExchangeMailAccount extends MailAccount {
  readonly port: number = 443;
  readonly tls = TLSSocketType.TLS;
  readonly canSendOutgoingInvitations: boolean = false;
  deleteStrategy: DeleteStrategy = DeleteStrategy.MoveToTrash;
  /** Root of the optional Exchange Online Archive hierarchy. */
  @notifyChangedProperty
  archiveMailboxRoot: Folder | null = null;
  /** Адреса этого ящика по данным сервера: основной SMTP-адрес часто отличается от логина
   * (`nikita.galkin@` при входе как `ngalkin0179@`). Коллеги пишут на основной адрес. */
  serverEmailAddresses: string[] = [];

  /** Запоминает адреса ящика от сервера. @returns true, если список изменился */
  async setServerEmailAddresses(addresses: string[]): Promise<boolean> {
    let own = this.emailAddress?.toLowerCase();
    let found = [...new Set(addresses
      .map(address => sanitize.emailAddress(address, null)?.toLowerCase())
      .filter((address): address is string => !!address && address != own))].sort();
    if (found.join(" ") == this.serverEmailAddresses.join(" ")) {
      return false;
    }
    this.serverEmailAddresses = found;
    await this.save();
    return true;
  }

  fromConfigJSON(json: any) {
    super.fromConfigJSON(json);
    this.serverEmailAddresses = sanitize.array(json.serverEmailAddresses, [])
      .map(address => sanitize.emailAddress(address, null)?.toLowerCase())
      .filter((address): address is string => !!address);
  }

  toConfigJSON(): any {
    let json = super.toConfigJSON();
    json.serverEmailAddresses = this.serverEmailAddresses;
    return json;
  }

  getAllFolders(): ArrayColl<Folder> {
    let folders = super.getAllFolders();
    if (this.archiveMailboxRoot) {
      addFolderTree(folders, this.archiveMailboxRoot);
    }
    return folders;
  }

  findFolder(findFunc: (folder: Folder) => boolean): Folder | null {
    let folder = super.findFolder(findFunc);
    return folder ?? (this.archiveMailboxRoot
      ? findFolderInTree(this.archiveMailboxRoot, findFunc)
      : null);
  }

  get calendarsAvailable(): Collection<Calendar> {
    let mailboxCalendars = this.calendarsOfMailbox(this.username);
    if (mailboxCalendars.hasItems) {
      return mailboxCalendars;
    }
    if (this.isDependentAccount) {
      let delegateCalendars = this.calendarsOfMailbox(this.mainAccount.username);
      if (delegateCalendars.hasItems) {
        return delegateCalendars;
      }
    }
    return appGlobal.calendars.filterObservable(cal => cal.canAcceptAnyInvitation);
  }

  /** A mailbox shared with us and its calendars are siblings, not our dependent accounts. */
  protected calendarsOfMailbox(username: string): ArrayColl<Calendar> {
    return (this.mainAccount ?? this).dependentAccounts().filterObservable(acc =>
      acc instanceof ExchangeCalendar &&
      acc.useForInvitations &&
      acc.username == username) as ArrayColl<Calendar>;
  }

  async deleteIt(): Promise<void> {
    if (this.isDependentAccount) {
      let dependentOfDelegate = this.mainAccount.dependentAccounts()
        .filterOnce(acc => acc != this && acc.username == this.username);
      for (let sibling of dependentOfDelegate) {
        await sibling.deleteIt();
      }
    }
    await super.deleteIt();
  }
}

function addFolderTree(target: ArrayColl<Folder>, folder: Folder): void {
  target.add(folder);
  for (let child of folder.subFolders) {
    addFolderTree(target, child);
  }
}

function findFolderInTree(folder: Folder, findFunc: (folder: Folder) => boolean): Folder | null {
  if (findFunc(folder)) {
    return folder;
  }
  for (let child of folder.subFolders) {
    let found = findFolderInTree(child, findFunc);
    if (found) {
      return found;
    }
  }
  return null;
}
