import { beforeEach, expect, test, vi } from "vitest";
import { writable } from "svelte/store";

const nav = vi.hoisted(() => ({
  selected: null as any,
  location: { pathname: "/chat", state: { id: 7 } },
  goTo: vi.fn(),
}));

vi.mock("../../../frontend/AppsBar/selectedApp", () => {
  nav.selected = writable(null);
  return {
    selectedApp: nav.selected,
    history: { get location() { return nav.location; } },
    getParams: (state: any) => state?.id == 7 ? { room: "room-1" } : {},
    goTo: nav.goTo,
  };
});

import { rememberReturnPoint, returnAfterCall } from "../../../frontend/Meet/returnAfterCall";

const chatApp = { appURL: "/chat" } as any;
const mailApp = { appURL: "/mail" } as any;
const meetApp = { appURL: "/meet" } as any;

beforeEach(() => {
  nav.goTo.mockReset();
  nav.location = { pathname: "/chat", state: { id: 7 } };
  returnAfterCall(meetApp); // сброс запомненного экрана между тестами
  nav.goTo.mockReset();
});

test("после звонка из чата возвращается в чат", () => {
  nav.selected.set(chatApp);
  rememberReturnPoint(meetApp);
  nav.selected.set(meetApp);
  returnAfterCall(meetApp);
  expect(nav.goTo).toHaveBeenCalledWith("/chat", { room: "room-1" });
  let current: any;
  nav.selected.subscribe((value: any) => current = value)();
  expect(current).toBe(chatApp);
});

test("если пользователь сам ушёл из «Встречи», никуда не переключает", () => {
  nav.selected.set(chatApp);
  rememberReturnPoint(meetApp);
  nav.selected.set(mailApp);
  returnAfterCall(meetApp);
  expect(nav.goTo).not.toHaveBeenCalled();
});

test("звонок, начатый во «Встрече», оставляет «Встречу»", () => {
  nav.selected.set(meetApp);
  rememberReturnPoint(meetApp);
  returnAfterCall(meetApp);
  expect(nav.goTo).not.toHaveBeenCalled();
});

test("второе открытие во время звонка не затирает исходный экран", () => {
  nav.selected.set(chatApp);
  rememberReturnPoint(meetApp);
  nav.selected.set(meetApp);
  nav.location = { pathname: "/meet", state: { id: 8 } };
  rememberReturnPoint(meetApp);
  returnAfterCall(meetApp);
  expect(nav.goTo).toHaveBeenCalledWith("/chat", { room: "room-1" });
});
