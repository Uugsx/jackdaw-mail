import { vi } from "vitest";
import type { EMail } from "../../../logic/Mail/EMail";
import { hoverMessageRow } from "../../../frontend/Mail/hoveredMessage";

/**
 * Ставит курсор над строкой письма. happy-dom не ведёт состояние :hover,
 * поэтому ответ на запрос `:hover` подменяется найденной строкой.
 */
export function hoverRow(message: EMail) {
  let row = document.createElement("div");
  document.body.append(row);
  let action = hoverMessageRow(row, message);
  let original = document.querySelectorAll.bind(document);
  let spy = vi.spyOn(document, "querySelectorAll").mockImplementation(((selector: string) =>
    selector.includes(":hover") ? [row] : original(selector)) as typeof document.querySelectorAll);
  document.dispatchEvent(new Event("pointermove"));
  return {
    row,
    action,
    leave() {
      spy.mockRestore();
      action.destroy();
      row.remove();
    },
  };
}
