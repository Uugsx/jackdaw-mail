import { applyThemeAttribute } from "../../../frontend/Settings/Global/themeAttribute";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

let root: { dataset: Record<string, string> };
beforeEach(() => {
  root = { dataset: {} };
  vi.stubGlobal("document", { documentElement: root });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("серая тема ставит data-theme=gray", () => {
  applyThemeAttribute("gray");
  expect(root.dataset.theme).toBe("gray");
});

test("остальные темы снимают атрибут", () => {
  for (const theme of ["system", "light", "dark"]) {
    applyThemeAttribute("gray");
    applyThemeAttribute(theme);
    expect(root.dataset.theme).toBeUndefined();
  }
});
