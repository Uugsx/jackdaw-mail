import { readZipEntry } from "./ZIP";
import { parseXML, escapeHTML, getAttrLocal } from "./htmlHelper";

/** Сколько листов, строк и столбцов показывать: предпросмотр, а не редактор таблиц */
export const kMaxSheets = 10;
export const kMaxRows = 1000;
export const kMaxColumns = 50;

/** Потомки с этим локальным именем, в любом пространстве имён */
function descendants(root: Document | Element, localName: string): Element[] {
  return Array.from(root.getElementsByTagName("*")).filter(element => element.localName == localName);
}

/** «B12» → номер столбца с нуля (1) */
export function columnIndex(cellRef: string): number {
  let letters = /^[A-Z]+/i.exec(cellRef ?? "")?.[0]?.toUpperCase() ?? "";
  let index = 0;
  for (let letter of letters) {
    index = index * 26 + (letter.charCodeAt(0) - 64);
  }
  return index - 1;
}

/** Convert Microsoft Excel OOXML .xlsx to basic HTML: one table per sheet, cell values as text.
 * Ignores formatting, formulas (shows the cached value), merged cells, charts.
 * Minimal, no dependencies, browser-only. */
export async function xlsxToHTML(blob: Blob): Promise<string> {
  let buffer = await blob.arrayBuffer();
  let workbook = parseXML(await readZipEntry(buffer, "xl/workbook.xml"));
  let rels = parseXML(await readZipEntry(buffer, "xl/_rels/workbook.xml.rels"));
  let targets = new Map<string, string>();
  for (let rel of descendants(rels, "Relationship")) {
    targets.set(rel.getAttribute("Id"), rel.getAttribute("Target"));
  }
  let sharedStrings: string[] = [];
  try {
    sharedStrings = parseSharedStrings(parseXML(await readZipEntry(buffer, "xl/sharedStrings.xml")));
  } catch {
    // В книге без текста файла sharedStrings.xml нет
  }
  let html = "";
  let sheets = descendants(workbook, "sheet").slice(0, kMaxSheets);
  for (let sheet of sheets) {
    // r:id; запасной вариант — для разборщиков, которые не выделяют локальное имя у атрибута с префиксом
    let relID = getAttrLocal(sheet, "id") ?? Array.from(sheet.attributes).find(attr => attr.name.endsWith(":id"))?.value;
    let target = targets.get(relID);
    if (!target) {
      continue;
    }
    let path = target.startsWith("/") ? target.slice(1) : "xl/" + target;
    let sheetXML: string;
    try {
      sheetXML = await readZipEntry(buffer, path);
    } catch {
      continue;
    }
    html += `<h2>${escapeHTML(sheet.getAttribute("name") ?? "")}</h2>`;
    html += sheetToHTML(parseXML(sheetXML), sharedStrings);
  }
  return html;
}

function parseSharedStrings(doc: Document): string[] {
  return descendants(doc, "si").map(item =>
    descendants(item, "t").map(text => text.textContent).join(""));
}

function cellText(cell: Element, sharedStrings: string[]): string {
  let type = cell.getAttribute("t");
  if (type == "inlineStr") {
    return descendants(cell, "t").map(text => text.textContent).join("");
  }
  let value = descendants(cell, "v")[0]?.textContent ?? "";
  if (type == "s") {
    return sharedStrings[Number(value)] ?? "";
  }
  if (type == "b") {
    return value == "1" ? "TRUE" : "FALSE";
  }
  return value;
}

export function sheetToHTML(doc: Document, sharedStrings: string[]): string {
  let rows: string[][] = [];
  let width = 0;
  for (let row of descendants(doc, "row").slice(0, kMaxRows)) {
    let cells: string[] = [];
    for (let [position, cell] of descendants(row, "c").entries()) {
      let ref = cell.getAttribute("r");
      let index = ref ? columnIndex(ref) : position;
      if (index < 0 || index >= kMaxColumns) {
        continue;
      }
      cells[index] = cellText(cell, sharedStrings);
    }
    width = Math.max(width, cells.length);
    rows.push(cells);
  }
  // Пустые строки в конце листа не показываем
  while (rows.length && !rows[rows.length - 1].some(text => text)) {
    rows.pop();
  }
  if (!rows.length) {
    return "<p></p>";
  }
  return "<table>" + rows.map(cells =>
    "<tr>" + Array.from({ length: width }, (_, i) => `<td>${escapeHTML(cells[i] ?? "")}</td>`).join("") + "</tr>")
    .join("") + "</table>";
}
