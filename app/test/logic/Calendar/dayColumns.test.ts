import { describe, expect, it } from "vitest";
import { layoutDayColumns } from "../../../logic/Calendar/dayColumns";

function ev(name: string, from: string, to: string) {
  return { name, startTime: new Date(`2026-11-07T${from}:00`), endTime: new Date(`2026-11-07T${to}:00`) };
}

describe("layoutDayColumns", () => {
  it("событие остаётся в своей колонке весь день (демо: 4:36, 5:20, 6:48)", () => {
    // Раньше в 6:00 событие 5:20 перескакивало из правой колонки в левую и наезжало на 6:48
    let a = ev("a", "04:36", "06:00");
    let b = ev("b", "05:20", "07:00");
    let c = ev("c", "06:48", "07:30");
    let layout = layoutDayColumns([c, b, a]);
    expect(layout.get(a)).toEqual({ column: 0, columns: 2 });
    expect(layout.get(b)).toEqual({ column: 1, columns: 2 });
    // a уже кончилось: c встаёт в освободившуюся левую колонку, не поверх b
    expect(layout.get(c)).toEqual({ column: 0, columns: 2 });
  });

  it("непересекающиеся события занимают всю ширину", () => {
    let a = ev("a", "09:00", "10:00");
    let b = ev("b", "10:00", "11:00");
    let layout = layoutDayColumns([a, b]);
    expect(layout.get(a)).toEqual({ column: 0, columns: 1 });
    expect(layout.get(b)).toEqual({ column: 0, columns: 1 });
  });

  it("три одновременных события — три колонки, отдельная группа не сужается", () => {
    let a = ev("a", "09:00", "10:00");
    let b = ev("b", "09:00", "10:00");
    let c = ev("c", "09:30", "10:30");
    let d = ev("d", "12:00", "13:00");
    let layout = layoutDayColumns([a, b, c, d]);
    expect(new Set([a, b, c].map(e => layout.get(e).column))).toEqual(new Set([0, 1, 2]));
    expect(layout.get(c).columns).toBe(3);
    expect(layout.get(d)).toEqual({ column: 0, columns: 1 });
  });

  it("событие нулевой длины не ломает раскладку", () => {
    let a = ev("a", "09:00", "09:00");
    let b = ev("b", "09:00", "10:00");
    let layout = layoutDayColumns([a, b]);
    expect(layout.get(a).columns).toBe(layout.get(b).columns);
  });
});
