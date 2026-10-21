import { describe, expect, test } from "vitest";

let localStorageValues = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => localStorageValues.get(key) ?? null,
    setItem: (key: string, value: string) => localStorageValues.set(key, value),
    removeItem: (key: string) => localStorageValues.delete(key),
  },
});

const {
  defaultMailListColumnOrder,
  defaultMailListColumnPrefs,
  kMailListTableMinWidth,
  mailListColumnsSetting,
  mailListGridTemplate,
  mailListTableFits,
  mailListSortColumn,
  mailListSortFor,
  mailSizeLabel,
  moveMailListColumn,
  moveMailListColumnBefore,
  nextMailListSort,
  normalizeMailListColumnPrefs,
  normalizeMailListDividers,
  normalizeMailListLayout,
  resetMailListColumns,
  resolveMailListLayout,
  setMailListColumnVisible,
  setMailListColumnWidth,
  updateMailListColumns,
  visibleMailListColumns,
} = await import("../../../frontend/Mail/mailListColumns");
const { allMailListSorts } = await import("../../../frontend/Mail/LeftPane/quickFilters");

describe("сортировка щелчком по заголовку", () => {
  test("первый щелчок — направление столбца по умолчанию, повторный — обратное", () => {
    expect(nextMailListSort("date-desc", "from")).toBe("sender");
    expect(nextMailListSort("sender", "from")).toBe("sender-desc");
    expect(nextMailListSort("sender-desc", "from")).toBe("sender");
    expect(nextMailListSort("sender", "size")).toBe("size-desc");
    expect(nextMailListSort("size-desc", "size")).toBe("size-asc");
    expect(nextMailListSort("date-desc", "received")).toBe("date-asc");
    expect(nextMailListSort("date-asc", "received")).toBe("date-desc");
    expect(nextMailListSort("date-desc", "flag")).toBe("flag-desc");
    expect(nextMailListSort("date-desc", "categories")).toBe("categories");
    expect(nextMailListSort("date-desc", "importance")).toBe("importance-desc");
    expect(nextMailListSort("date-desc", "attachment")).toBe("attachment-desc");
    expect(nextMailListSort("date-desc", "subject")).toBe("subject");
  });

  test("каждая сортировка показывает свой столбец и направление", () => {
    for (let sort of allMailListSorts) {
      let { column, direction } = mailListSortColumn(sort);
      expect(mailListSortFor(column, direction)).toBe(sort);
    }
    expect(mailListSortColumn("subject")).toEqual({ column: "subject", direction: "asc" });
    expect(mailListSortColumn("date-desc")).toEqual({ column: "received", direction: "desc" });
  });
});

describe("настройки столбцов", () => {
  test("испорченное или старое значение дополняется до полного набора столбцов", () => {
    expect(normalizeMailListColumnPrefs(null)).toEqual(defaultMailListColumnPrefs());
    expect(normalizeMailListColumnPrefs("garbage")).toEqual(defaultMailListColumnPrefs());
    let prefs = normalizeMailListColumnPrefs({
      order: ["subject", "from", "unknown", "subject"],
      hidden: ["size", "subject", "nope", "size"],
      widths: { from: 10, received: 5000, flag: 300, subject: "wide" },
    });
    expect(prefs.order[0]).toBe("subject");
    expect(prefs.order.filter(id => id == "subject" || id == "from")).toEqual(["subject", "from"]);
    expect([...prefs.order].sort()).toEqual([...defaultMailListColumnOrder].sort());
    // Тему скрыть нельзя
    expect(prefs.hidden).toEqual(["size"]);
    // Ширина в допустимых пределах, у значков ширины нет
    expect(prefs.widths.from).toBe(60);
    expect(prefs.widths.received).toBe(800);
    expect(prefs.widths.flag).toBeUndefined();
    expect(prefs.widths.subject).toBeUndefined();
  });

  test("новый столбец встаёт на место по умолчанию", () => {
    let prefs = normalizeMailListColumnPrefs({ order: ["from", "subject", "received", "flag"] });
    expect(prefs.order.indexOf("size")).toBe(prefs.order.indexOf("received") + 1);
    expect(prefs.order.indexOf("importance")).toBeLessThan(prefs.order.indexOf("from"));
  });

  test("скрытие, порядок и ширина", () => {
    let prefs = defaultMailListColumnPrefs();
    prefs = setMailListColumnVisible(prefs, "size", false);
    expect(visibleMailListColumns(prefs)).not.toContain("size");
    expect(setMailListColumnVisible(prefs, "subject", false)).toBe(prefs);
    prefs = setMailListColumnVisible(prefs, "size", true);
    expect(visibleMailListColumns(prefs)).toContain("size");

    prefs = moveMailListColumnBefore(prefs, "received", "from");
    expect(prefs.order.indexOf("received")).toBe(prefs.order.indexOf("from") - 1);
    prefs = moveMailListColumnBefore(prefs, "importance", null);
    expect(prefs.order.at(-1)).toBe("importance");
    prefs = moveMailListColumn(prefs, "importance", -1);
    expect(prefs.order.at(-2)).toBe("importance");
    expect(moveMailListColumn(prefs, prefs.order[0], -1)).toBe(prefs);

    prefs = setMailListColumnWidth(prefs, "from", 260.4);
    expect(prefs.widths.from).toBe(260);
    expect(setMailListColumnWidth(prefs, "flag", 300)).toBe(prefs);
    prefs = setMailListColumnWidth(prefs, "from", null);
    expect(prefs.widths.from).toBeUndefined();
  });

  test("сетка столбцов сжимается, а тема занимает остаток", () => {
    let prefs = setMailListColumnWidth(defaultMailListColumnPrefs(), "from", 250);
    prefs = setMailListColumnVisible(prefs, "categories", false);
    let template = mailListGridTemplate(prefs);
    // Значки — постоянная ширина, текстовые столбцы — minmax
    expect(template.match(/minmax\(/g)?.length).toBe(4);
    expect(template.match(/(?:^| )\d+px(?= |$)/g)?.length).toBe(visibleMailListColumns(prefs).length - 4);
    expect(template).toContain("minmax(60px, 250px)");
    expect(template).toContain("minmax(max(120px, 30%), 1fr)");
    expect(template).not.toContain("180px");
  });

  test("по ширине списка: заданные ширины соблюдаются, а при нехватке места сжимаются", () => {
    let prefs = setMailListColumnWidth(defaultMailListColumnPrefs(), "from", 300);
    let px = (template: string) => template.split(" ").filter(part => /^\d+px$/.test(part)).map(part => parseInt(part));
    // Широкий список: «От» ровно 300px, тема — остаток
    let wide = mailListGridTemplate(prefs, 1600);
    expect(wide).toContain(" 300px ");
    expect(wide).toContain("minmax(0, 1fr)");
    // Узкий список: столбцы сжаты, но не меньше минимума, и теме остаётся 30 %
    let narrow = mailListGridTemplate(prefs, 700);
    let widths = px(narrow);
    let gaps = 8 * (visibleMailListColumns(prefs).length - 1) + 16 + 8;
    expect(widths.reduce((sum, width) => sum + width, 0) + gaps).toBeLessThanOrEqual(700 * 0.7);
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(24);
    expect(narrow).not.toContain(" 300px ");
    // Самый узкий: все текстовые столбцы на минимуме
    expect(mailListGridTemplate(prefs, 400)).toContain(" 60px ");
  });

  test("выбор сохраняется в localStorage и сбрасывается", () => {
    updateMailListColumns(prefs => setMailListColumnVisible(prefs, "size", false));
    expect(JSON.parse(localStorageValues.get("mail.list.columns")!).hidden).toEqual(["size"]);
    expect(normalizeMailListColumnPrefs(mailListColumnsSetting.value).hidden).toEqual(["size"]);
    resetMailListColumns();
    expect(normalizeMailListColumnPrefs(mailListColumnsSetting.value)).toEqual(defaultMailListColumnPrefs());
  });

  test("вид списка и разделители: неизвестные значения — по умолчанию", () => {
    expect(normalizeMailListLayout("table")).toBe("table");
    expect(normalizeMailListLayout("grid")).toBe("auto");
    expect(normalizeMailListDividers(false)).toBe(false);
    expect(normalizeMailListDividers("no")).toBe(true);
  });
});

describe("таблица или карточки", () => {
  test("«Авто» зависит от ширины списка", () => {
    expect(resolveMailListLayout("auto", kMailListTableMinWidth)).toBe("table");
    expect(resolveMailListLayout("auto", kMailListTableMinWidth - 1)).toBe("cards");
    expect(resolveMailListLayout("table", 620)).toBe("table");
    expect(resolveMailListLayout("cards", 2000)).toBe("cards");
  });

  test("«Таблица» на слишком узком списке — карточки, а не обрезанные столбцы", () => {
    let prefs = defaultMailListColumnPrefs();
    expect(mailListTableFits(prefs, 500)).toBe(false);
    expect(resolveMailListLayout("table", 500, { prefs })).toBe("cards");
    // Меньше столбцов — таблица помещается в более узкий список
    for (let id of ["categories", "size", "received", "importance", "status"] as const) {
      prefs = setMailListColumnVisible(prefs, id, false);
    }
    expect(mailListTableFits(prefs, 500)).toBe(true);
    expect(resolveMailListLayout("table", 500, { prefs })).toBe("table");
    expect(resolveMailListLayout("auto", 500, { prefs })).toBe("cards");
  });

  test("мобильный вид и карточки инцидентов всегда двухстрочные", () => {
    expect(resolveMailListLayout("table", 2000, { mobile: true })).toBe("cards");
    expect(resolveMailListLayout("table", 2000, { incidents: true })).toBe("cards");
  });
});

test("размер письма", () => {
  expect(mailSizeLabel(0)).toBe("");
  expect(mailSizeLabel(undefined)).toBe("");
  expect(mailSizeLabel(-1)).toBe("");
  expect(mailSizeLabel(500)).toMatch(/^500 /);
  expect(mailSizeLabel(182 * 1024)).toMatch(/^182 /);
  expect(mailSizeLabel(1024 * 1024)).toMatch(/^1 /);
});
