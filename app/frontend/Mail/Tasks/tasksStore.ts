import { writable, get } from "svelte/store";
import { appGlobal } from "../../../logic/app";
import { MailAccount } from "../../../logic/Mail/MailAccount";
import type { EMail } from "../../../logic/Mail/EMail";
import {
  canUseExchangeTasks, createTask, deleteTask, loadCachedTasks, setTaskCompleted, syncTasks, updateTask,
} from "../../../logic/Mail/Tasks/ExchangeTasks";
import { loadFlaggedEMails, type FlaggedEMailRow } from "../../../logic/Mail/Tasks/ExchangeTaskData";
import {
  isTaskCompleted, taskDueGroup, type ExchangeTask, type ExchangeTaskInput, type FlagDueChoice, type TaskDueGroup,
} from "../../../logic/Mail/Tasks/ExchangeTask";
import { openPendingResponseMessage } from "../openPendingResponse";
import { gt } from "../../../l10n/l10n";

/** Страница «Задачи» вместо списка писем */
export const tasksViewOpen = writable(false);

/** Строка списка: задача Exchange или письмо с флажком */
export type TaskListItem =
  | { kind: "task", key: string, account: MailAccount, task: ExchangeTask, dueDay: string | null }
  | { kind: "mail", key: string, account: MailAccount | null, mail: FlaggedEMailRow, dueDay: string | null };

export interface TasksState {
  /** Первая загрузка ещё идёт: показываем заготовку */
  loading: boolean;
  /** Идёт обновление с сервера поверх уже показанного */
  refreshing: boolean;
  /** Ящики, где не удалось прочитать задачи */
  errors: { account: MailAccount, error: Error }[];
  items: TaskListItem[];
}

export const tasksState = writable<TasksState>({ loading: true, refreshing: false, errors: [], items: [] });

/** Ящики Exchange с папкой «Задачи» */
export function taskAccounts(): MailAccount[] {
  return appGlobal.emailAccounts.contents
    .filter((account): account is MailAccount => account instanceof MailAccount && canUseExchangeTasks(account));
}

let tasksByAccount = new Map<MailAccount, ExchangeTask[]>();
let flaggedRows: FlaggedEMailRow[] = [];
let refreshGeneration = 0;

function accountByDBID(id: number): MailAccount | null {
  return appGlobal.emailAccounts.contents
    .find((account): account is MailAccount => account instanceof MailAccount && String(account.dbID) == String(id)) ?? null;
}

function publish(patch: Partial<TasksState> = {}) {
  let items: TaskListItem[] = [];
  for (let [account, tasks] of tasksByAccount) {
    for (let task of tasks) {
      items.push({ kind: "task", key: `t:${account.id}:${task.itemID}`, account, task, dueDay: task.dueDay });
    }
  }
  for (let mail of flaggedRows) {
    items.push({ kind: "mail", key: `m:${mail.emailId}`, account: accountByDBID(mail.accountId), mail, dueDay: mail.dueDay });
  }
  tasksState.update(state => ({ ...state, ...patch, items }));
}

/** Сначала база (сразу), затем сервер. Ошибка одного ящика не скрывает остальные. */
export async function refreshTasks(): Promise<void> {
  let generation = ++refreshGeneration;
  let accounts = taskAccounts();
  tasksState.update(state => ({ ...state, refreshing: true }));
  let cached = new Map<MailAccount, ExchangeTask[]>();
  for (let account of accounts) {
    cached.set(account, await loadCachedTasks(account).catch(() => []));
  }
  let flagged = await loadFlaggedEMails().catch(() => [] as FlaggedEMailRow[]);
  if (generation != refreshGeneration) {
    return;
  }
  tasksByAccount = cached;
  flaggedRows = flagged;
  // Заготовку показываем, только пока показать нечего
  let hasCached = flagged.length > 0 || [...cached.values()].some(list => list.length > 0);
  publish({ loading: get(tasksState).loading && !hasCached && accounts.length > 0 });

  let errors: TasksState["errors"] = [];
  await Promise.all(accounts.map(async account => {
    try {
      let tasks = await syncTasks(account);
      if (generation == refreshGeneration) {
        tasksByAccount.set(account, tasks);
      }
    } catch (ex) {
      errors.push({ account, error: ex instanceof Error ? ex : new Error(String(ex)) });
    }
  }));
  if (generation != refreshGeneration) {
    return;
  }
  publish({ loading: false, refreshing: false, errors });
}

/** Письма с флажком заново из базы — после флажка в меню письма. Без сервера. */
export async function refreshFlaggedEMails(): Promise<void> {
  if (get(tasksState).loading) {
    // Страницу ещё не открывали: прочитает всё при открытии
    return;
  }
  flaggedRows = await loadFlaggedEMails();
  publish();
}

function replaceTask(account: MailAccount, task: ExchangeTask) {
  let list = (tasksByAccount.get(account) ?? []).filter(item => item.itemID != task.itemID);
  tasksByAccount.set(account, [...list, task]);
  publish();
}

export async function addTask(account: MailAccount, input: ExchangeTaskInput): Promise<ExchangeTask> {
  let task = await createTask(account, input);
  replaceTask(account, task);
  return task;
}

export async function saveTask(account: MailAccount, task: ExchangeTask, input: ExchangeTaskInput): Promise<ExchangeTask> {
  let updated = await updateTask(account, task, input);
  replaceTask(account, updated);
  return updated;
}

export async function toggleTaskCompleted(account: MailAccount, task: ExchangeTask): Promise<void> {
  replaceTask(account, await setTaskCompleted(account, task, !isTaskCompleted(task)));
}

export async function removeTask(account: MailAccount, task: ExchangeTask): Promise<void> {
  await deleteTask(account, task);
  tasksByAccount.set(account, (tasksByAccount.get(account) ?? []).filter(item => item.itemID != task.itemID));
  publish();
}

/** Письмо по строке списка: из открытой папки или из базы */
export async function resolveFlaggedEMail(row: FlaggedEMailRow): Promise<EMail> {
  let account = accountByDBID(row.accountId);
  if (!account) {
    throw new Error(gt`The mailbox for this request is not available.`);
  }
  await account.readFromDB();
  let folder = account.findFolder(item => String(item.dbID) == String(row.folderId));
  if (!folder) {
    throw new Error(gt`The folder for this request is not available.`);
  }
  let email = folder.messages.find(item => String(item.dbID) == String(row.emailId));
  if (!email) {
    email = folder.newEMail();
    email.dbID = row.emailId;
    await email.storage.readMessage(email);
    folder.messages.add(email);
  }
  return email;
}

export async function openFlaggedEMail(row: FlaggedEMailRow): Promise<void> {
  tasksViewOpen.set(false);
  await openPendingResponseMessage({ accountId: row.accountId, folderId: row.folderId, emailId: row.emailId });
}

async function updateFlaggedRow(row: FlaggedEMailRow, action: (email: EMail) => Promise<void>): Promise<void> {
  let email = await resolveFlaggedEMail(row);
  await action(email);
  if (email.isStarred) {
    flaggedRows = flaggedRows.map(item => item.emailId == row.emailId
      ? { ...item, startDay: email.flagStartDay, dueDay: email.flagDueDay }
      : item);
  } else {
    flaggedRows = flaggedRows.filter(item => item.emailId != row.emailId);
  }
  publish();
}

export async function setFlaggedDue(row: FlaggedEMailRow, choice: FlagDueChoice): Promise<void> {
  await updateFlaggedRow(row, email => email.setFlagDue(choice));
}

export async function completeFlagged(row: FlaggedEMailRow): Promise<void> {
  await updateFlaggedRow(row, email => email.markFlagComplete());
}

export async function clearFlagged(row: FlaggedEMailRow): Promise<void> {
  await updateFlaggedRow(row, email => email.clearFlag());
}

export const kDueGroupOrder: TaskDueGroup[] = ["overdue", "today", "tomorrow", "later", "no-date"];

/** Открытые задачи и письма по группам срока, внутри — по сроку, затем по теме */
export function groupOpenItems(items: TaskListItem[], now = new Date()): { group: TaskDueGroup, items: TaskListItem[] }[] {
  let open = items.filter(item => item.kind == "mail" || !isTaskCompleted(item.task));
  return kDueGroupOrder
    .map(group => ({
      group,
      items: open
        .filter(item => taskDueGroup(item.dueDay, now) == group)
        .sort((a, b) => (a.dueDay ?? "").localeCompare(b.dueDay ?? "") || itemTitle(a).localeCompare(itemTitle(b))),
    }))
    .filter(section => section.items.length);
}

/** Выполненные задачи, недавние сверху */
export function completedItems(items: TaskListItem[]): TaskListItem[] {
  return items
    .filter((item): item is Extract<TaskListItem, { kind: "task" }> => item.kind == "task" && isTaskCompleted(item.task))
    .sort((a, b) => (b.task.completedAt?.getTime() ?? 0) - (a.task.completedAt?.getTime() ?? 0));
}

export function itemTitle(item: TaskListItem): string {
  return item.kind == "task" ? item.task.subject : item.mail.subject;
}
