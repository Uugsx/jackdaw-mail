import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ArrayColl } from "svelte-collections";
import { get } from "svelte/store";
import type { EMail } from "../../../logic/Mail/EMail";
import type { Folder } from "../../../logic/Mail/Folder";
import {
  buildAlertIncidentRows,
  findMailListRowShowingMessage,
  findMailListRowsShowingMessages,
  mailListRowMessages,
  mailListRowSelectable,
  MailListRows,
  type MailListIncidentRow,
  type MailListMessageRow,
} from "../../../frontend/Mail/mailListRows";

const values = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  },
});

const {
  filterAlertIncidentNotifications,
  isAlertIncidentFolder,
  markAlertIncidentClosed,
  readAlertIncidentFolderSettings,
  alertIncidentFolderSetting,
  alertFolderNameRulesSetting,
  alertIncidentsEnabledSetting,
  canGroupAlertFolder,
  updateAlertIncidentFolderSettings,
} = await import("../../../frontend/Mail/alertIncidentSettings");

const minute = 60 * 1000;
const hour = 60 * minute;
const base = new Date(2026, 9, 20, 9, 0).getTime();

let nextID = 0;
function mail(subject: string, at: number, folder?: Folder, extra: Partial<EMail> = {}): EMail {
  return {
    dbID: ++nextID,
    subject,
    received: new Date(at),
    sent: new Date(at),
    isRead: false,
    folder,
    from: { emailAddress: "zabbix@corp.example", name: "Zabbix" },
    contact: null,
    ...extra,
  } as unknown as EMail;
}

function fakeFolder(name = "Мониторинг ИПОЛ", specialFolder = "normal"): Folder {
  return {
    id: `folder-${++nextID}`,
    name,
    specialFolder,
    account: { id: "account-1" },
    messages: new ArrayColl<EMail>(),
  } as unknown as Folder;
}

function incidentRows(rows: ArrayColl<any>): MailListIncidentRow[] {
  return rows.contents.filter((row): row is MailListIncidentRow => row.kind == "incident");
}

const mode = { quietMs: hour, activeOnly: false, now: () => base + 30 * minute };

beforeEach(() => {
  values.clear();
  vi.useFakeTimers();
  vi.setSystemTime(base + 30 * minute);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("incident rows", () => {
  test("ordinary folder keeps the plain list", () => {
    let messages = new ArrayColl<EMail>([mail("Problem: Disk", base), mail("Problem: Disk", base + minute)]);
    let model = new MailListRows();
    model.setSource(messages, "date-desc");
    expect(model.rows.contents.some(row => row.kind == "incident")).toBe(false);
    expect(get(model.incidentSummary)).toBeNull();
    model.dispose();
  });

  test("alert folder shows one card per incident and expands into messages", () => {
    let messages = new ArrayColl<EMail>([
      mail("Problem: Disk full on db01", base),
      mail("Problem: Disk full on db02", base + 5 * minute),
      mail("Resolved in 3m: Queue stuck", base + 8 * minute),
      mail("Problem: Queue stuck", base + 4 * minute),
    ]);
    let model = new MailListRows();
    model.setIncidentMode(mode);
    model.setSource(messages, "date-desc");
    let cards = incidentRows(model.rows);
    expect(cards.map(row => [row.incident.label, row.incident.firingCount, row.incident.status])).toEqual([
      ["Queue stuck", 1, "resolved"],
      ["Disk full on db…", 2, "active"],
    ]);
    expect(model.rows.length).toBe(2);
    expect(get(model.incidentSummary)).toEqual({ total: 2, active: 1 });

    model.toggleGroup(cards[1].id);
    let expanded = model.rows.contents;
    expect(expanded).toHaveLength(4);
    expect((expanded[2] as MailListMessageRow).message.subject).toBe("Problem: Disk full on db02");
    expect((expanded[2] as MailListMessageRow).incidentID).toBe(cards[1].id);

    // Новое письмо попадает в существующую карточку
    messages.add(mail("Problem: Disk full on db03", base + 20 * minute));
    let disk = incidentRows(model.rows).find(row => row.incident.label.startsWith("Disk"))!;
    expect(disk.incident.firingCount).toBe(3);
    expect(disk.expanded).toBe(true);

    model.setIncidentMode(null);
    expect(model.rows.contents.some(row => row.kind == "incident")).toBe(false);
    expect(get(model.incidentSummary)).toBeNull();
    model.dispose();
  });

  test("active only hides quiet and resolved incidents", () => {
    let messages = [
      mail("Ошибка: WB", base + 25 * minute),
      mail("[FIRING:1] Old", base - 5 * hour),
      mail("[FIRING:1] Fixed", base),
      mail("[RESOLVED] Fixed", base + minute),
    ];
    let { rows, summary } = buildAlertIncidentRows(messages, { ...mode, activeOnly: true });
    expect(rows.map(row => (row as MailListIncidentRow).incident.label)).toEqual(["WB"]);
    expect(summary).toEqual({ total: 3, active: 1 });
  });

  test("status turns quiet by itself after the quiet period", () => {
    let model = new MailListRows();
    model.setIncidentMode({ quietMs: hour, activeOnly: false });
    model.setSource(new ArrayColl<EMail>([mail("Ошибка: WB", base + 20 * minute)]), "date-desc");
    expect(incidentRows(model.rows)[0].incident.status).toBe("active");
    vi.advanceTimersByTime(hour);
    expect(incidentRows(model.rows)[0].incident.status).toBe("quiet");
    model.dispose();
  });

  test("card selection maps to all messages of the incident and back", () => {
    let first = mail("Ошибка: WB", base);
    let second = mail("Ошибка: WB", base + minute);
    let other = mail("Ошибка: ИПОЛ", base + 2 * minute);
    let model = new MailListRows();
    model.setIncidentMode(mode);
    model.setSource(new ArrayColl<EMail>([first, second, other]), "date-desc");
    let wb = incidentRows(model.rows).find(row => row.incident.label == "WB")!;
    expect(mailListRowSelectable(wb)).toBe(true);
    expect(mailListRowMessages(wb)).toEqual([second, first]);
    expect(findMailListRowShowingMessage(model.rows, first)).toBe(wb);
    expect(findMailListRowsShowingMessages(new ArrayColl([second, first, other]), model.rows).map(row => row.id))
      .toEqual([wb.id, incidentRows(model.rows).find(row => row.incident.label == "ИПОЛ")!.id]);

    model.toggleGroup(wb.id);
    let row = findMailListRowShowingMessage(model.rows, first);
    expect(row?.kind).toBe("message");
    model.dispose();
  });

  test("a 50 000 message alert folder builds quickly", () => {
    let messages: EMail[] = [];
    for (let i = 0; i < 50_000; i++) {
      messages.push(mail(`Problem: Check ${String.fromCharCode(65 + i % 25)} on host-${i}.corp.local`, base - i * 1000));
    }
    let collection = new ArrayColl<EMail>(messages);
    let model = new MailListRows();
    model.setIncidentMode(mode);
    let started = performance.now();
    model.setSource(collection, "date-desc");
    let elapsed = performance.now() - started;
    expect(model.rows.length).toBe(25);
    expect(incidentRows(model.rows).reduce((total, row) => total + row.incident.firingCount, 0)).toBe(50_000);
    expect(elapsed).toBeLessThan(5000);

    let selection = findMailListRowsShowingMessages(new ArrayColl(messages.slice(0, 20_000)), model.rows);
    expect(selection).toHaveLength(25);
    model.dispose();
  });
});

describe("alert folder settings", () => {
  test("explicit choice wins over the folder name rule; special folders are excluded", () => {
    let folder = fakeFolder("Ошибки серверов");
    expect(isAlertIncidentFolder(folder)).toBe(false);
    alertFolderNameRulesSetting.value = ["ошибки"];
    expect(isAlertIncidentFolder(folder)).toBe(true);
    updateAlertIncidentFolderSettings(folder, { enabled: false });
    expect(isAlertIncidentFolder(folder)).toBe(false);
    updateAlertIncidentFolderSettings(folder, { enabled: true });
    expect(isAlertIncidentFolder(folder)).toBe(true);
    expect(isAlertIncidentFolder(fakeFolder("Ошибки", "sent"))).toBe(false);
    alertFolderNameRulesSetting.value = [];
  });

  test("closing is remembered per incident", () => {
    let folder = fakeFolder();
    markAlertIncidentClosed(folder, "a", base);
    markAlertIncidentClosed(folder, "b", base + minute);
    let settings = readAlertIncidentFolderSettings(alertIncidentFolderSetting(folder).value);
    expect(settings.closed).toEqual({ a: base, b: base + minute });
  });

  test("notifies only about a new incident or a resumption", () => {
    let folder = fakeFolder();
    updateAlertIncidentFolderSettings(folder, { enabled: true });
    let old = mail("Ошибка: WB", base, folder, { isRead: true });
    (folder.messages as ArrayColl<EMail>).add(old);

    let repeat = mail("Ошибка: WB", base + 10 * minute, folder);
    let fresh1 = mail("Ошибка: ИПОЛ", base + 10 * minute, folder);
    let fresh2 = mail("Ошибка: ИПОЛ", base + 11 * minute, folder);
    let resolved = mail("Восстановлено: склад", base + 11 * minute, folder);
    let ordinaryFolder = fakeFolder("Входящие");
    let ordinary = mail("Ошибка: WB", base + 10 * minute, ordinaryFolder);
    (folder.messages as ArrayColl<EMail>).addAll([repeat, fresh1, fresh2, resolved]);

    expect(filterAlertIncidentNotifications([repeat, fresh1, fresh2, resolved, ordinary]))
      .toEqual([fresh1, ordinary]);

    let resumed = mail("Ошибка: WB", base + 3 * hour, folder);
    (folder.messages as ArrayColl<EMail>).add(resumed);
    expect(filterAlertIncidentNotifications([resumed])).toEqual([resumed]);
  });

  test("the global switch turns off cards, suggestions and notification filtering", () => {
    let folder = fakeFolder();
    updateAlertIncidentFolderSettings(folder, { enabled: true });
    let first = mail("Ошибка: WB", base, folder);
    let repeat = mail("Ошибка: WB", base + minute, folder);
    (folder.messages as ArrayColl<EMail>).addAll([first, repeat]);
    expect(filterAlertIncidentNotifications([first, repeat])).toEqual([first]);

    alertIncidentsEnabledSetting.value = false;
    try {
      expect(canGroupAlertFolder(folder)).toBe(false);
      expect(isAlertIncidentFolder(folder)).toBe(false);
      expect(filterAlertIncidentNotifications([first, repeat])).toEqual([first, repeat]);
      // Выбор по папке сохраняется и снова действует после включения
      expect(readAlertIncidentFolderSettings(alertIncidentFolderSetting(folder).value).enabled).toBe(true);
    } finally {
      alertIncidentsEnabledSetting.value = true;
    }
    expect(isAlertIncidentFolder(folder)).toBe(true);
  });
});
