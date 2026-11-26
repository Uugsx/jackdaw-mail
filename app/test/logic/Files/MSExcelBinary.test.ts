import { describe, expect, test } from "vitest";
import {
  decodeRK, formatExcelDate, parseBIFFWorkbook, readCompoundStream, readSST,
} from "../../../logic/Files/FileType/MSExcelBinary";

function record(type: number, data: number[]): number[] {
  return [type & 0xFF, type >> 8, data.length & 0xFF, data.length >> 8, ...data];
}
const u16 = (n: number) => [n & 0xFF, n >> 8];
const u32 = (n: number) => [n & 0xFF, (n >> 8) & 0xFF, (n >> 16) & 0xFF, n >>> 24];
function f64(n: number): number[] {
  let view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, n, true);
  return Array.from(new Uint8Array(view.buffer));
}
/** Строка BIFF8 в UTF-16 */
function wide(text: string, lengthSize: 1 | 2): number[] {
  let chars = Array.from(text).flatMap(char => u16(char.charCodeAt(0)));
  return [...(lengthSize == 1 ? [text.length] : u16(text.length)), 1, ...chars];
}

function workbook(): Uint8Array {
  let globals = [
    ...record(0x0809, [...u16(0x0600), ...u16(5), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    ...record(0x00E0, [0, 0, ...u16(0), ...Array(16).fill(0)]), // XF 0: общий формат
    ...record(0x00E0, [0, 0, ...u16(14), ...Array(16).fill(0)]), // XF 1: дата
  ];
  let sst = record(0x00FC, [...u32(2), ...u32(2), ...wide("Москва", 2), ...wide("Заказ", 2)]);
  let boundSheetLength = 4 + 6 + wide("Лист1", 1).length;
  let sheetOffset = globals.length + sst.length + boundSheetLength + 4; // + EOF
  let boundSheet = record(0x0085, [...u32(sheetOffset), 0, 0, ...wide("Лист1", 1)]);
  let sheet = [
    ...record(0x0809, [...u16(0x0600), ...u16(0x10), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    ...record(0x00FD, [...u16(0), ...u16(0), ...u16(0), ...u32(1)]),
    ...record(0x00FD, [...u16(0), ...u16(1), ...u16(0), ...u32(0)]),
    ...record(0x0203, [...u16(1), ...u16(0), ...u16(0), ...f64(1.6320000000000003)]),
    ...record(0x027E, [...u16(1), ...u16(1), ...u16(1), ...u32((46339 << 2) | 2)]),
    ...record(0x000A, []),
  ];
  return new Uint8Array([...globals, ...sst, ...boundSheet, ...record(0x000A, []), ...sheet]);
}

describe("xls: записи BIFF", () => {
  test("лист, строки SST, числа и дата", () => {
    let sheets = parseBIFFWorkbook(workbook());
    expect(sheets).toEqual([{ name: "Лист1", rows: [["Заказ", "Москва"], ["1.632", "13.11.2026"]] }]);
  });

  test("строка SST переходит в CONTINUE и меняет ширину символов", () => {
    let first = [...u32(1), ...u32(1), ...u16(4), 0, 0x41, 0x42];
    let continuation = [1, ...u16(0x0416), ...u16(0x0416)]; // флаг «UTF-16», «ЖЖ»
    expect(readSST([new Uint8Array(first), new Uint8Array(continuation)])).toEqual(["ABЖЖ"]);
  });

  test("RK: целое, со сдвигом /100, дробное", () => {
    expect(decodeRK((25 << 2) | 2)).toBe(25);
    expect(decodeRK((12345 << 2) | 3)).toBe(123.45);
    let view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, 0.5, true);
    expect(decodeRK(view.getUint32(4, true))).toBe(0.5);
  });

  test("даты Excel", () => {
    expect(formatExcelDate(1)).toBe("01.01.1900");
    expect(formatExcelDate(61)).toBe("01.03.1900");
    expect(formatExcelDate(46339.5)).toBe("13.11.2026 12:00");
    expect(formatExcelDate(0, true)).toBe("01.01.1904");
  });
});

describe("xls: контейнер Compound File", () => {
  /** Контейнер с сектором 512 байт: FAT, каталог, поток «Workbook» на 8 секторов (не мини-поток) */
  function container(stream: Uint8Array): Uint8Array {
    let sectorSize = 512;
    let streamSectors = Math.ceil(Math.max(stream.length, 4096) / sectorSize);
    let total = 2 + streamSectors; // 0 — FAT, 1 — каталог, дальше поток
    let bytes = new Uint8Array((total + 1) * sectorSize);
    let view = new DataView(bytes.buffer);
    bytes.set([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]);
    view.setUint16(0x1E, 9, true);
    view.setUint16(0x20, 6, true);
    view.setUint32(0x2C, 1, true);
    view.setUint32(0x30, 1, true);
    view.setUint32(0x38, 4096, true);
    view.setUint32(0x3C, 0xFFFFFFFE, true);
    view.setUint32(0x44, 0xFFFFFFFE, true);
    for (let i = 0; i < 109; i++) {
      view.setUint32(0x4C + i * 4, i == 0 ? 0 : 0xFFFFFFFF, true);
    }
    let fat = sectorSize;
    for (let i = 0; i < sectorSize / 4; i++) {
      view.setUint32(fat + i * 4, 0xFFFFFFFF, true);
    }
    view.setUint32(fat, 0xFFFFFFFD, true);
    view.setUint32(fat + 4, 0xFFFFFFFE, true);
    for (let i = 0; i < streamSectors; i++) {
      view.setUint32(fat + (2 + i) * 4, i == streamSectors - 1 ? 0xFFFFFFFE : 3 + i, true);
    }
    let dir = 2 * sectorSize;
    let entry = (index: number, name: string, type: number, start: number, size: number) => {
      let offset = dir + index * 128;
      for (let i = 0; i < name.length; i++) {
        view.setUint16(offset + i * 2, name.charCodeAt(i), true);
      }
      view.setUint16(offset + 64, (name.length + 1) * 2, true);
      bytes[offset + 66] = type;
      view.setUint32(offset + 116, start, true);
      view.setUint32(offset + 120, size, true);
    };
    entry(0, "Root Entry", 5, 0xFFFFFFFE, 0);
    entry(1, "Workbook", 2, 2, Math.max(stream.length, 4096));
    bytes.set(stream, 3 * sectorSize);
    return bytes;
  }

  test("поток Workbook читается и разбирается", () => {
    let book = workbook();
    let stream = readCompoundStream(container(book), ["Workbook", "Book"]);
    expect(stream?.subarray(0, book.length)).toEqual(book);
    expect(parseBIFFWorkbook(stream!)[0].rows[0]).toEqual(["Заказ", "Москва"]);
  });

  test("не контейнер — null", () => {
    expect(readCompoundStream(new Uint8Array(1024), ["Workbook"])).toBeNull();
  });
});
