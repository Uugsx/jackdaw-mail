/**
 * «Быстрые действия», как Quick Steps в Outlook: именованная цепочка шагов,
 * которая выполняется над выбранными письмами одним щелчком.
 *
 * Шаги: прочитано/непрочитано, флажок, важное, категория, переместить, удалить,
 * переслать (открывает письмо с заполненным «Кому»), ответить шаблоном (открывает ответ).
 * Хранятся здесь (`mail.quickSteps.v1`); папка — по ящику и ID.
 */
import type { EMail } from "../EMail";
import type { MailAccount } from "../MailAccount";
import type { Folder } from "../Folder";
import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
import { UserError } from "../../util/util";
import { gt } from "../../../l10n/l10n";
import { writable } from "svelte/store";
import { ArrayColl } from "svelte-collections";

export type QuickStepActionType =
  | "mark-read" | "mark-unread" | "flag" | "unflag" | "important" | "category"
  | "move" | "delete" | "forward" | "reply-template";

export interface QuickStepAction {
  type: QuickStepActionType;
  /** move: `ящик\tID папки`; forward: адреса через запятую; reply-template: ID шаблона; category: имя */
  value?: string;
}

export interface QuickStep {
  id: string;
  name: string;
  actions: QuickStepAction[];
}

export const kQuickStepsKey = "mail.quickSteps.v1";
export const kQuickStepActionTypes: QuickStepActionType[] = [
  "move", "mark-read", "mark-unread", "flag", "unflag", "important", "category", "delete", "forward", "reply-template",
];
/** Шаги, которым нужен параметр */
export const kActionsWithValue: QuickStepActionType[] = ["move", "category", "forward", "reply-template"];
/** После этих шагов письма в папке больше нет — дальше по цепочке идти нельзя */
const kFinalActions: QuickStepActionType[] = ["move", "delete"];

export const quickStepsChanged = writable(0);

export function sanitizeQuickSteps(value: any): QuickStep[] {
  if (!Array.isArray(value)) {
    return [];
  }
  let steps: QuickStep[] = [];
  for (let step of value) {
    let name = typeof step?.name == "string" ? step.name.trim() : "";
    let actions = (Array.isArray(step?.actions) ? step.actions : [])
      .filter((action: any) => kQuickStepActionTypes.includes(action?.type))
      .map((action: any) => ({ type: action.type, value: typeof action.value == "string" ? action.value : undefined }));
    if (!name || !actions.length) {
      continue;
    }
    steps.push({ id: typeof step.id == "string" && step.id ? step.id : newQuickStepID(), name, actions });
  }
  return steps;
}

export function newQuickStepID(): string {
  return "qs-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

export function getQuickSteps(): QuickStep[] {
  return sanitizeQuickSteps(getLocalStorage<QuickStep[]>(kQuickStepsKey, []).value);
}

export function saveQuickSteps(steps: QuickStep[]): void {
  getLocalStorage<QuickStep[]>(kQuickStepsKey, []).value = sanitizeQuickSteps(steps);
  quickStepsChanged.update(count => count + 1);
}

/** Что не так с шагом; `null` — можно сохранить */
export function quickStepProblem(step: QuickStep): string | null {
  if (!step.name.trim()) {
    return gt`Please enter a name`;
  }
  if (!step.actions.length) {
    return gt`Please add at least one action`;
  }
  for (let [index, action] of step.actions.entries()) {
    if (kActionsWithValue.includes(action.type) && !action.value?.trim()) {
      return gt`Please fill out action ${index + 1}`;
    }
    if (kFinalActions.includes(action.type) && index < step.actions.length - 1) {
      return gt`Moving or deleting must be the last action`;
    }
  }
  return null;
}

export function folderKey(folder: Folder): string {
  return folder.account.id + "\t" + folder.id;
}

export function findFolderByKey(accounts: Iterable<MailAccount>, key: string | undefined): Folder | null {
  let [accountID, folderID] = (key ?? "").split("\t");
  for (let account of accounts) {
    if (account.id == accountID) {
      return account.findFolder(folder => folder.id == folderID);
    }
  }
  return null;
}

export function parseAddresses(value: string | undefined): string[] {
  return (value ?? "").split(/[,;\s]+/).map(address => address.trim()).filter(address => /^[^\s@]+@[^\s@]+$/.test(address));
}

/** Что умеет приложение вокруг: открыть письмо в редакторе, найти шаблон, категорию */
export interface QuickStepHost {
  accounts: Iterable<MailAccount>;
  /** Пересылка: письмо с адресами в «Кому», открыть в редакторе */
  forward(email: EMail, to: string[]): Promise<void>;
  /** Ответ автору с текстом шаблона, открыть в редакторе */
  replyWithTemplate(email: EMail, templateID: number): Promise<void>;
  /** Поставить категорию по имени */
  addCategory(emails: EMail[], name: string): Promise<void>;
}

/** Выполняет шаги по порядку над письмами одной папки */
export async function runQuickStep(step: QuickStep, emails: EMail[], host: QuickStepHost): Promise<void> {
  let problem = quickStepProblem(step);
  if (problem) {
    throw new UserError(problem);
  }
  if (!emails.length) {
    return;
  }
  for (let action of step.actions) {
    switch (action.type) {
      case "mark-read":
      case "mark-unread":
        for (let email of emails) {
          await email.markRead(action.type == "mark-read");
        }
        break;
      case "flag":
      case "unflag":
        for (let email of emails) {
          await email.markStarred(action.type == "flag");
        }
        break;
      case "important":
        for (let email of emails) {
          await email.markImportant(true);
        }
        break;
      case "category":
        await host.addCategory(emails, action.value.trim());
        break;
      case "forward": {
        let to = parseAddresses(action.value);
        if (!to.length) {
          throw new UserError(gt`Quick step ${step.name}: no valid address to forward to`);
        }
        for (let email of emails) {
          await host.forward(email, to);
        }
        break;
      }
      case "reply-template":
        for (let email of emails) {
          await host.replyWithTemplate(email, Number(action.value));
        }
        break;
      case "move": {
        let target = findFolderByKey(host.accounts, action.value);
        if (!target) {
          throw new UserError(gt`Quick step ${step.name}: the folder no longer exists`);
        }
        let bySource = new Map<Folder, EMail[]>();
        for (let email of emails) {
          if (email.folder != target) {
            bySource.set(email.folder, [...(bySource.get(email.folder) ?? []), email]);
          }
        }
        for (let list of bySource.values()) {
          await target.moveMessagesHere(new ArrayColl(list));
        }
        break;
      }
      case "delete":
        for (let email of emails) {
          await email.deleteMessage();
        }
        break;
    }
  }
}
