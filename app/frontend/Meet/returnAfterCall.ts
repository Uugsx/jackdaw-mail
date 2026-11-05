import { get } from "svelte/store";
import { selectedApp, history, getParams, goTo, type PageParams } from "../AppsBar/selectedApp";
import type { JackdawApp } from "../AppsBar/JackdawApp";

/** Где был пользователь, когда звонок сам открыл «Встречу» */
let returnPoint: { app: JackdawApp, url: string, params: PageParams } | null = null;

/** Звонок открывает «Встречу»: запоминаем текущий экран (чат, почту…), чтобы вернуться после звонка. */
export function rememberReturnPoint(meetApp: JackdawApp): void {
  let app = get(selectedApp);
  if (returnPoint || !app || app == meetApp) {
    return;
  }
  returnPoint = { app, url: history.location.pathname, params: getParams(history.location.state) };
}

/** Звонок закончился. Если «Встреча» всё ещё открыта, возвращаемся туда, откуда звонили,
 * а не оставляем пустой экран новой встречи. Ушёл сам на другой экран — не трогаем. */
export function returnAfterCall(meetApp: JackdawApp): void {
  let point = returnPoint;
  returnPoint = null;
  if (!point || get(selectedApp) != meetApp) {
    return;
  }
  selectedApp.set(point.app);
  goTo(point.url, point.params);
}
