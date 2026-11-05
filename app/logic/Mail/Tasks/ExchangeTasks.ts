import type { MailAccount } from "../MailAccount";
import { EWSAccount } from "../EWS/EWSAccount";
import { OWAAccount } from "../OWA/OWAAccount";
import { type ExchangeTask, type ExchangeTaskInput } from "./ExchangeTask";
import {
  ewsCompleteTaskRequest, ewsCreateTaskRequest, ewsDeleteTaskRequest, ewsFindTasksRequest, ewsGetTasksRequest,
  ewsUpdateTaskRequest, kMaxTasks, owaCompleteTaskRequest, owaCreateTaskRequest, owaDeleteTaskRequest,
  owaFindTasksRequest, owaGetTasksRequest, owaUpdateTaskRequest, parseEWSCreatedTaskID, parseEWSFindTasks,
  parseEWSGetTasks, parseOWACreatedTaskID, parseOWAFindTasks, parseOWAGetTasks,
} from "./ExchangeTaskRequests";
import { deleteExchangeTaskLocally, loadExchangeTasks, replaceExchangeTasks, saveExchangeTask } from "./ExchangeTaskData";
import { assert } from "../../util/util";

/** Задач в одном GetItem */
const kGetBatchSize = 50;

/** Запросы задач для одного протокола. Отдельно от аккаунта — для тестов. */
export interface ExchangeTaskProtocol {
  call(request: any): Promise<any>;
  findRequest(offset: number): any;
  parseFind(result: any): { ids: string[], nextOffset: number | null };
  getRequest(ids: string[]): any;
  parseGet(result: any): ExchangeTask[];
  createRequest(input: ExchangeTaskInput): any;
  parseCreatedID(result: any): string | null;
  updateRequest(itemID: string, input: ExchangeTaskInput): any;
  completeRequest(itemID: string, completed: boolean): any;
  deleteRequest(itemID: string): any;
}

export function ewsTaskProtocol(call: (request: any) => Promise<any>): ExchangeTaskProtocol {
  return {
    call,
    findRequest: ewsFindTasksRequest,
    parseFind: parseEWSFindTasks,
    getRequest: ewsGetTasksRequest,
    parseGet: parseEWSGetTasks,
    createRequest: ewsCreateTaskRequest,
    parseCreatedID: parseEWSCreatedTaskID,
    updateRequest: ewsUpdateTaskRequest,
    completeRequest: ewsCompleteTaskRequest,
    deleteRequest: ewsDeleteTaskRequest,
  };
}

export function owaTaskProtocol(call: (request: any) => Promise<any>): ExchangeTaskProtocol {
  return {
    call,
    findRequest: owaFindTasksRequest,
    parseFind: parseOWAFindTasks,
    getRequest: owaGetTasksRequest,
    parseGet: parseOWAGetTasks,
    createRequest: owaCreateTaskRequest,
    parseCreatedID: parseOWACreatedTaskID,
    updateRequest: owaUpdateTaskRequest,
    completeRequest: owaCompleteTaskRequest,
    deleteRequest: owaDeleteTaskRequest,
  };
}

/** Ящик, у которого есть папка «Задачи» Exchange: свой ящик EWS или OWA, не общий */
export function canUseExchangeTasks(account: MailAccount | null | undefined): boolean {
  return (account instanceof EWSAccount || account instanceof OWAAccount) && !account.isDependentAccount;
}

export function taskProtocolFor(account: MailAccount): ExchangeTaskProtocol {
  if (account instanceof EWSAccount && !account.isDependentAccount) {
    return ewsTaskProtocol(request => account.callEWS(request));
  }
  if (account instanceof OWAAccount && !account.isDependentAccount) {
    return owaTaskProtocol(request => account.callOWA(request));
  }
  throw new Error("Tasks need an Exchange (EWS or OWA) mailbox");
}

/** Все задачи с сервера: FindItem по страницам, затем GetItem пачками */
export async function fetchTasks(protocol: ExchangeTaskProtocol): Promise<ExchangeTask[]> {
  let ids: string[] = [];
  let offset: number | null = 0;
  while (offset != null && ids.length < kMaxTasks) {
    let page = protocol.parseFind(await protocol.call(protocol.findRequest(offset)));
    ids.push(...page.ids);
    offset = page.ids.length ? page.nextOffset : null;
  }
  ids = [...new Set(ids)].slice(0, kMaxTasks);
  let tasks: ExchangeTask[] = [];
  for (let i = 0; i < ids.length; i += kGetBatchSize) {
    tasks.push(...protocol.parseGet(await protocol.call(protocol.getRequest(ids.slice(i, i + kGetBatchSize)))));
  }
  return tasks;
}

/** Перечитывает одну задачу после записи: сервер сам ставит дату выполнения и ChangeKey */
async function fetchTask(protocol: ExchangeTaskProtocol, itemID: string): Promise<ExchangeTask> {
  let [task] = protocol.parseGet(await protocol.call(protocol.getRequest([itemID])));
  assert(task, "The server did not return the task");
  return task;
}

/** Задачи ящика в базе: сразу, до ответа сервера */
export async function loadCachedTasks(account: MailAccount): Promise<ExchangeTask[]> {
  if (!account.dbID) {
    return [];
  }
  return await loadExchangeTasks(Number(account.dbID));
}

/** Читает задачи с сервера и запоминает их в базе */
export async function syncTasks(account: MailAccount, protocol = taskProtocolFor(account)): Promise<ExchangeTask[]> {
  let tasks = await fetchTasks(protocol);
  if (account.dbID) {
    await replaceExchangeTasks(Number(account.dbID), tasks);
  }
  return tasks;
}

export async function createTask(account: MailAccount, input: ExchangeTaskInput, protocol = taskProtocolFor(account)): Promise<ExchangeTask> {
  let itemID = protocol.parseCreatedID(await protocol.call(protocol.createRequest(input)));
  assert(itemID, "The server did not return the new task");
  return await storeTask(account, await fetchTask(protocol, itemID));
}

export async function updateTask(account: MailAccount, task: ExchangeTask, input: ExchangeTaskInput, protocol = taskProtocolFor(account)): Promise<ExchangeTask> {
  await protocol.call(protocol.updateRequest(task.itemID, input));
  return await storeTask(account, await fetchTask(protocol, task.itemID));
}

export async function setTaskCompleted(account: MailAccount, task: ExchangeTask, completed: boolean, protocol = taskProtocolFor(account)): Promise<ExchangeTask> {
  await protocol.call(protocol.completeRequest(task.itemID, completed));
  return await storeTask(account, await fetchTask(protocol, task.itemID));
}

export async function deleteTask(account: MailAccount, task: ExchangeTask, protocol = taskProtocolFor(account)): Promise<void> {
  await protocol.call(protocol.deleteRequest(task.itemID));
  if (account.dbID) {
    await deleteExchangeTaskLocally(Number(account.dbID), task.itemID);
  }
}

async function storeTask(account: MailAccount, task: ExchangeTask): Promise<ExchangeTask> {
  if (account.dbID) {
    await saveExchangeTask(Number(account.dbID), task);
  }
  return task;
}
