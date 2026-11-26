import { kMaxColumns, kMaxRows, kMaxSheets, rowsToHTML } from "./MSExcel";
import { escapeHTML } from "./htmlHelper";

/**
 * Предпросмотр старого формата Excel (.xls, Excel 97–2003 и Excel 5/95).
 * Файл — контейнер OLE (Compound File), внутри поток «Workbook» (или «Book») с записями BIFF.
 * Читаются только значения ячеек: текст, числа, даты, логические значения и результаты формул.
 */
export async function xlsToHTML(blob: Blob): Promise<string> {
  let stream = readCompoundStream(new Uint8Array(await blob.arrayBuffer()), ["Workbook", "Book"]);
  if (!stream) {
    throw new Error("Not an Excel 97–2003 workbook");
  }
  let html = "";
  for (let sheet of parseBIFFWorkbook(stream)) {
    html += `<h2>${escapeHTML(sheet.name)}</h2>`;
    html += rowsToHTML(sheet.rows);
  }
  return html;
}

// ---------------------------------------------------------------------------
// Compound File (OLE2)

const kFreeSector = 0xFFFFFFFF;
const kEndOfChain = 0xFFFFFFFE;
const kSignature = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
/** Защита от зацикленной цепочки секторов в повреждённом файле */
const kMaxChainLength = 1 << 20;

/** Содержимое потока с одним из имён `names` из корня контейнера, или null */
export function readCompoundStream(bytes: Uint8Array, names: string[]): Uint8Array | null {
  if (bytes.length < 512 || kSignature.some((byte, i) => bytes[i] != byte)) {
    return null;
  }
  let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let sectorSize = 1 << view.getUint16(0x1E, true);
  let miniSectorSize = 1 << view.getUint16(0x20, true);
  let firstDirSector = view.getUint32(0x30, true);
  let miniStreamCutoff = view.getUint32(0x38, true);
  let firstMiniFATSector = view.getUint32(0x3C, true);
  let firstDIFATSector = view.getUint32(0x44, true);
  let difatSectorCount = view.getUint32(0x48, true);
  if (sectorSize < 128 || sectorSize > 65536) {
    return null;
  }
  let sectorOffset = (sector: number) => (sector + 1) * sectorSize;
  let readSector = (sector: number) => {
    let start = sectorOffset(sector);
    return start + sectorSize <= bytes.length ? bytes.subarray(start, start + sectorSize) : null;
  };

  // Сектора FAT: первые 109 — в заголовке, остальные — в цепочке DIFAT
  let fatSectors: number[] = [];
  for (let i = 0; i < 109; i++) {
    let sector = view.getUint32(0x4C + i * 4, true);
    if (sector != kFreeSector) {
      fatSectors.push(sector);
    }
  }
  let difat = firstDIFATSector;
  for (let i = 0; i < difatSectorCount && difat < kEndOfChain; i++) {
    let data = readSector(difat);
    if (!data) {
      break;
    }
    let dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let perSector = sectorSize / 4 - 1;
    for (let j = 0; j < perSector; j++) {
      let sector = dv.getUint32(j * 4, true);
      if (sector != kFreeSector) {
        fatSectors.push(sector);
      }
    }
    difat = dv.getUint32(perSector * 4, true);
  }
  let fat = readUint32Table(fatSectors.map(readSector));

  let chain = (start: number, table: Uint32Array): number[] => {
    let result: number[] = [];
    for (let sector = start; sector < kEndOfChain && sector < table.length; sector = table[sector]) {
      result.push(sector);
      if (result.length > kMaxChainLength) {
        break;
      }
    }
    return result;
  };
  let readChain = (start: number, size?: number): Uint8Array => {
    let parts = chain(start, fat).map(readSector).filter(Boolean) as Uint8Array[];
    let data = concat(parts);
    return size === undefined ? data : data.subarray(0, Math.min(size, data.length));
  };

  // Каталог: записи по 128 байт
  let directory = readChain(firstDirSector);
  let entries: { name: string, type: number, start: number, size: number }[] = [];
  let dirView = new DataView(directory.buffer, directory.byteOffset, directory.byteLength);
  for (let offset = 0; offset + 128 <= directory.length; offset += 128) {
    let nameLength = Math.min(dirView.getUint16(offset + 64, true), 64);
    let name = new TextDecoder("utf-16le").decode(directory.subarray(offset, offset + Math.max(nameLength - 2, 0)));
    entries.push({
      name,
      type: directory[offset + 66],
      start: dirView.getUint32(offset + 116, true),
      size: dirView.getUint32(offset + 120, true),
    });
  }
  let root = entries[0];
  let entry = names.map(wanted => entries.find(e => e.type == 2 && e.name.toLowerCase() == wanted.toLowerCase()))
    .find(Boolean);
  if (!root || !entry) {
    return null;
  }
  if (entry.size >= miniStreamCutoff) {
    return readChain(entry.start, entry.size);
  }
  // Маленький поток — в мини-потоке корня, по мини-секторам
  let miniStream = readChain(root.start, root.size);
  let miniFAT = readUint32Table(chain(firstMiniFATSector, fat).map(readSector));
  let parts = chain(entry.start, miniFAT).map(sector =>
    miniStream.subarray(sector * miniSectorSize, (sector + 1) * miniSectorSize));
  return concat(parts).subarray(0, entry.size);
}

function readUint32Table(sectors: (Uint8Array | null)[]): Uint32Array {
  let data = concat(sectors.filter(Boolean) as Uint8Array[]);
  let table = new Uint32Array(Math.floor(data.length / 4));
  let view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 0; i < table.length; i++) {
    table[i] = view.getUint32(i * 4, true);
  }
  return table;
}

function concat(parts: Uint8Array[]): Uint8Array {
  let length = parts.reduce((sum, part) => sum + part.length, 0);
  let result = new Uint8Array(length);
  let offset = 0;
  for (let part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

// ---------------------------------------------------------------------------
// BIFF

export interface BIFFSheet {
  name: string;
  rows: string[][];
}

const kBOF = 0x0809;
const kEOF = 0x000A;
const kBoundSheet = 0x0085;
const kSST = 0x00FC;
const kContinue = 0x003C;
const kCodePage = 0x0042;
const kDate1904 = 0x0022;
const kFormat = 0x041E;
const kXF = 0x00E0;
const kLabelSST = 0x00FD;
const kLabel = 0x0204;
const kRString = 0x00D6;
const kNumber = 0x0203;
const kRK = 0x027E;
const kMulRK = 0x00BD;
const kBoolErr = 0x0205;
const kFormula = 0x0006;
const kString = 0x0207;

const kBIFF8 = 0x0600;
/** Встроенные форматы Excel с датой */
const kBuiltInDateFormats = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

interface BIFFRecord {
  type: number;
  data: Uint8Array;
  offset: number;
}

function readRecords(stream: Uint8Array): BIFFRecord[] {
  let records: BIFFRecord[] = [];
  let view = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
  for (let offset = 0; offset + 4 <= stream.length;) {
    let type = view.getUint16(offset, true);
    let length = view.getUint16(offset + 2, true);
    records.push({ type, data: stream.subarray(offset + 4, offset + 4 + length), offset });
    offset += 4 + length;
  }
  return records;
}

/** Листы книги: имя и значения ячеек (не больше kMaxSheets × kMaxRows × kMaxColumns) */
export function parseBIFFWorkbook(stream: Uint8Array): BIFFSheet[] {
  let records = readRecords(stream);
  let version = kBIFF8;
  let codePage = "windows-1252";
  let date1904 = false;
  let sst: string[] = [];
  let formats = new Map<number, string>();
  let xfFormats: number[] = [];
  let sheets: { name: string, offset: number }[] = [];

  // Глобальные записи книги — до первого EOF
  let i = 0;
  for (; i < records.length; i++) {
    let { type, data } = records[i];
    let dv = view(data);
    if (type == kBOF && i == 0) {
      version = data.length >= 2 ? dv.getUint16(0, true) : kBIFF8;
    } else if (type == kEOF) {
      break;
    } else if (type == kCodePage && data.length >= 2) {
      codePage = codePageName(dv.getUint16(0, true));
    } else if (type == kDate1904 && data.length >= 2) {
      date1904 = dv.getUint16(0, true) == 1;
    } else if (type == kFormat && data.length >= 4) {
      let id = dv.getUint16(0, true);
      formats.set(id, version >= kBIFF8
        ? readUnicodeString(data, 2, 2).text
        : decodeBytes(data.subarray(3, 3 + data[2]), codePage));
    } else if (type == kXF && data.length >= 4) {
      xfFormats.push(dv.getUint16(2, true));
    } else if (type == kBoundSheet && data.length >= 8) {
      let offset = dv.getUint32(0, true);
      let sheetType = data[5];
      let name = version >= kBIFF8
        ? readUnicodeString(data, 6, 1).text
        : decodeBytes(data.subarray(7, 7 + data[6]), codePage);
      if (sheetType == 0) {
        sheets.push({ name, offset });
      }
    } else if (type == kSST) {
      let parts = [data];
      while (records[i + 1]?.type == kContinue) {
        parts.push(records[++i].data);
      }
      sst = readSST(parts);
    }
  }

  let isDate = (xf: number) => {
    let format = xfFormats[xf];
    if (format === undefined) {
      return false;
    }
    if (kBuiltInDateFormats.has(format)) {
      return true;
    }
    let code = formats.get(format);
    if (!code) {
      return false;
    }
    // Без текста в кавычках, цветов и условий в скобках
    let bare = code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, "");
    return /[dmy]/i.test(bare) && !/[#0]/.test(bare);
  };
  let formatNumber = (value: number, xf: number) => isDate(xf) ? formatExcelDate(value, date1904) : formatNumberValue(value);

  let result: BIFFSheet[] = [];
  for (let sheet of sheets.slice(0, kMaxSheets)) {
    let start = records.findIndex(record => record.offset == sheet.offset);
    if (start < 0) {
      continue;
    }
    let rows: string[][] = [];
    let set = (row: number, column: number, text: string) => {
      if (row >= kMaxRows || column >= kMaxColumns) {
        return;
      }
      (rows[row] ??= [])[column] = text;
    };
    let pendingFormula: { row: number, column: number } | null = null;
    for (let j = start + 1; j < records.length; j++) {
      let { type, data } = records[j];
      if (type == kEOF) {
        break;
      }
      if (data.length < 6 && type != kString) {
        continue;
      }
      let dv = view(data);
      let row = data.length >= 4 ? dv.getUint16(0, true) : 0;
      let column = data.length >= 4 ? dv.getUint16(2, true) : 0;
      let xf = data.length >= 6 ? dv.getUint16(4, true) : 0;
      if (type == kLabelSST && data.length >= 10) {
        set(row, column, sst[dv.getUint32(6, true)] ?? "");
      } else if (type == kLabel || type == kRString) {
        set(row, column, version >= kBIFF8
          ? readUnicodeString(data, 6, 2).text
          : decodeBytes(data.subarray(8, 8 + dv.getUint16(6, true)), codePage));
      } else if (type == kNumber && data.length >= 14) {
        set(row, column, formatNumber(dv.getFloat64(6, true), xf));
      } else if (type == kRK && data.length >= 10) {
        set(row, column, formatNumber(decodeRK(dv.getUint32(6, true)), xf));
      } else if (type == kMulRK && data.length >= 6) {
        let count = Math.floor((data.length - 6) / 6);
        for (let k = 0; k < count; k++) {
          let cellXF = dv.getUint16(4 + k * 6, true);
          set(row, column + k, formatNumber(decodeRK(dv.getUint32(6 + k * 6, true)), cellXF));
        }
      } else if (type == kBoolErr && data.length >= 8) {
        set(row, column, data[7] ? errorText(data[6]) : data[6] ? "TRUE" : "FALSE");
      } else if (type == kFormula && data.length >= 14) {
        if (dv.getUint16(12, true) == 0xFFFF) {
          let kind = data[6];
          if (kind == 0) {
            pendingFormula = { row, column };
          } else if (kind == 1) {
            set(row, column, data[8] ? "TRUE" : "FALSE");
          } else if (kind == 2) {
            set(row, column, errorText(data[8]));
          }
        } else {
          set(row, column, formatNumber(dv.getFloat64(6, true), xf));
        }
      } else if (type == kString && pendingFormula) {
        let text = version >= kBIFF8
          ? readUnicodeString(data, 0, 2).text
          : decodeBytes(data.subarray(2, 2 + dv.getUint16(0, true)), codePage);
        set(pendingFormula.row, pendingFormula.column, text);
        pendingFormula = null;
      }
    }
    result.push({ name: sheet.name, rows: Array.from(rows, cells => cells ?? []) });
  }
  return result;
}

function view(data: Uint8Array): DataView {
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

/** Строка BIFF8: длина (1 или 2 байта), флаги, символы в UTF-16 или «сжатые» (Latin-1) */
export function readUnicodeString(data: Uint8Array, offset: number, lengthSize: 1 | 2): { text: string, end: number } {
  if (offset + lengthSize >= data.length) {
    return { text: "", end: data.length };
  }
  let length = lengthSize == 1 ? data[offset] : data[offset] | (data[offset + 1] << 8);
  let flags = data[offset + lengthSize];
  let position = offset + lengthSize + 1;
  let runs = 0;
  let extLength = 0;
  if (flags & 0x08) {
    runs = data[position] | (data[position + 1] << 8);
    position += 2;
  }
  if (flags & 0x04) {
    extLength = view(data).getUint32(position, true);
    position += 4;
  }
  let wide = (flags & 0x01) != 0;
  let byteLength = wide ? length * 2 : length;
  let chars = data.subarray(position, Math.min(position + byteLength, data.length));
  let text = wide ? new TextDecoder("utf-16le").decode(chars) : latin1(chars);
  return { text, end: position + byteLength + runs * 4 + extLength };
}

/** Таблица строк SST; строки переходят через границу записей CONTINUE, где заново указан флаг ширины */
export function readSST(parts: Uint8Array[]): string[] {
  let first = parts[0];
  if (!first || first.length < 8) {
    return [];
  }
  let count = view(first).getUint32(4, true);
  let strings: string[] = [];
  let part = 0;
  let data = first;
  let position = 8;
  let nextPart = () => {
    part++;
    data = parts[part];
    position = 0;
    return !!data;
  };
  let readBytes = (n: number) => {
    // Служебные байты (длины, флаги, оформление) тоже могут переходить в CONTINUE
    let result = new Uint8Array(n);
    let filled = 0;
    while (filled < n) {
      if (position >= data.length && !nextPart()) {
        break;
      }
      let take = Math.min(n - filled, data.length - position);
      result.set(data.subarray(position, position + take), filled);
      filled += take;
      position += take;
    }
    return result;
  };
  let skip = (n: number) => {
    readBytes(n);
  };
  while (strings.length < count && data) {
    if (position >= data.length && !nextPart()) {
      break;
    }
    let header = readBytes(3);
    let length = header[0] | (header[1] << 8);
    let flags = header[2];
    let runs = 0;
    let extLength = 0;
    if (flags & 0x08) {
      let r = readBytes(2);
      runs = r[0] | (r[1] << 8);
    }
    if (flags & 0x04) {
      let e = readBytes(4);
      extLength = view(e).getUint32(0, true);
    }
    let wide = (flags & 0x01) != 0;
    let text = "";
    let remaining = length;
    while (remaining > 0) {
      if (position >= data.length) {
        if (!nextPart()) {
          break;
        }
        // В начале CONTINUE посреди строки — новый флаг ширины символов
        wide = (data[0] & 0x01) != 0;
        position = 1;
      }
      let available = wide ? Math.floor((data.length - position) / 2) : data.length - position;
      let take = Math.min(remaining, available);
      let chars = data.subarray(position, position + (wide ? take * 2 : take));
      text += wide ? new TextDecoder("utf-16le").decode(chars) : latin1(chars);
      position += wide ? take * 2 : take;
      remaining -= take;
      if (take == 0) {
        position = data.length;
      }
    }
    skip(runs * 4 + extLength);
    strings.push(text);
  }
  return strings;
}

function latin1(bytes: Uint8Array): string {
  let text = "";
  for (let byte of bytes) {
    text += String.fromCharCode(byte);
  }
  return text;
}

function decodeBytes(bytes: Uint8Array, codePage: string): string {
  try {
    return new TextDecoder(codePage).decode(bytes);
  } catch {
    return latin1(bytes);
  }
}

function codePageName(id: number): string {
  if (id == 1200) {
    return "utf-16le";
  }
  if (id >= 874 && id <= 1258) {
    return `windows-${id}`;
  }
  if (id == 866) {
    return "ibm866";
  }
  if (id == 10007) {
    return "x-mac-cyrillic";
  }
  return "windows-1252";
}

/** Число в сжатом виде RK */
export function decodeRK(rk: number): number {
  let value: number;
  if (rk & 0x02) {
    value = rk >> 2;
  } else {
    let buffer = new DataView(new ArrayBuffer(8));
    buffer.setUint32(0, 0, true);
    buffer.setUint32(4, rk & 0xFFFFFFFC, true);
    value = buffer.getFloat64(0, true);
  }
  return rk & 0x01 ? value / 100 : value;
}

function formatNumberValue(value: number): string {
  // 1.6320000000000003 → 1.632
  return String(Number(value.toPrecision(15)));
}

/** Порядковый номер дня Excel → «13.11.2026» (со временем, если оно есть) */
export function formatExcelDate(serial: number, date1904 = false): string {
  if (!isFinite(serial) || serial < 0) {
    return formatNumberValue(serial);
  }
  let days = Math.floor(serial);
  // В системе 1900 Excel считает несуществующее 29.02.1900
  let epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, days >= 60 ? 30 : 31);
  let date = new Date(epoch + days * 86400000);
  let pad = (n: number) => String(n).padStart(2, "0");
  let text = `${pad(date.getUTCDate())}.${pad(date.getUTCMonth() + 1)}.${date.getUTCFullYear()}`;
  let seconds = Math.round((serial - days) * 86400);
  if (seconds > 0 && seconds < 86400) {
    text += ` ${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}`;
  }
  return text;
}

function errorText(code: number): string {
  return ({ 0x00: "#NULL!", 0x07: "#DIV/0!", 0x0F: "#VALUE!", 0x17: "#REF!", 0x1D: "#NAME?", 0x24: "#NUM!", 0x2A: "#N/A" } as Record<number, string>)[code] ?? "#ERROR";
}
