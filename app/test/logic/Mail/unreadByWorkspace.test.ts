import "../../../logic/app";
import { appGlobal } from "../../../logic/app";
import { OWAAccount } from "../../../logic/Mail/OWA/OWAAccount";
import { SpecialFolder } from "../../../logic/Mail/Folder";
import { Workspace } from "../../../logic/Abstract/Workspace";
import { unreadByWorkspace, workspaceUnreadCount } from "../../../logic/Mail/MailUnreadBadge";
import { expect, test } from "vitest";

function account(name: string, unread: number, workspace: Workspace | null) {
  appGlobal.remoteApp = { OWA: {} };
  let mailAccount = new OWAAccount();
  mailAccount.name = name;
  mailAccount.workspace = workspace;
  let inbox = mailAccount.newFolder();
  inbox.id = `${name}-inbox`;
  inbox.specialFolder = SpecialFolder.Inbox;
  inbox.countUnread = unread;
  mailAccount.rootFolders.add(inbox);
  return mailAccount;
}

const work = new Workspace("РАБОТА", "#a33", null, "work");
const home = new Workspace("НЕ РАБОТА", "#3a3", null, "home");
const empty = new Workspace("Пусто", "#33a", null, "empty");

test("считает непрочитанные по пространствам и всего", () => {
  let accounts = [account("smartds", 3, work), account("integrators", 1, work), account("gmail", 2, home)];
  expect(workspaceUnreadCount(accounts, work)).toBe(4);
  expect(workspaceUnreadCount(accounts, home)).toBe(2);
  expect(workspaceUnreadCount(accounts, empty)).toBe(0);
  expect(workspaceUnreadCount(accounts, null)).toBe(6);
});

test("группирует ящики в порядке пространств, без пространства — в конце, пустые пропускает", () => {
  let accounts = [account("gmail", 2, home), account("smartds", 3, work), account("local", 0, null)];
  let groups = unreadByWorkspace(accounts, [work, empty, home]);
  expect(groups.map(group => group.workspace?.name ?? null)).toEqual(["РАБОТА", "НЕ РАБОТА", null]);
  expect(groups.map(group => group.unread)).toEqual([3, 2, 0]);
  expect(groups[0].accounts.map(entry => [entry.account.name, entry.unread])).toEqual([["smartds", 3]]);
});

test("ящик из удалённого пространства попадает в группу без пространства", () => {
  let gone = new Workspace("Старое", "#999", null, "gone");
  let groups = unreadByWorkspace([account("old", 5, gone)], [work]);
  expect(groups).toHaveLength(1);
  expect(groups[0].workspace).toBeNull();
  expect(groups[0].unread).toBe(5);
});
