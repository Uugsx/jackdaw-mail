import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../logic/app", () => ({ appGlobal: { emailAccounts: { contents: [] } } }));
vi.mock("../../../../logic/Mail/Tasks/ExchangeTasks", () => ({}));
vi.mock("../../../../logic/Mail/Tasks/ExchangeTaskData", () => ({}));
vi.mock("../../../../frontend/Mail/openPendingResponse", () => ({}));
vi.mock("../../../../l10n/l10n", () => ({ gt: (text: string) => text }));

import { isItemInWorkspace, type TaskListItem } from "../../../../frontend/Mail/Tasks/tasksStore";

function item(workspace: unknown): TaskListItem {
  return { kind: "mail", key: "m:1", account: workspace === null ? null : { workspace } as any, mail: {} as any, dueDay: null };
}

describe("isItemInWorkspace", () => {
  const ws = { id: "a" } as any;
  const other = { id: "b" } as any;
  it("без пространства — все ящики", () => {
    expect(isItemInWorkspace(item(other), null)).toBe(true);
    expect(isItemInWorkspace(item(other), undefined)).toBe(true);
  });
  it("только ящики выбранного пространства", () => {
    expect(isItemInWorkspace(item(ws), ws)).toBe(true);
    expect(isItemInWorkspace(item(other), ws)).toBe(false);
    expect(isItemInWorkspace(item(null), ws)).toBe(false);
  });
});
