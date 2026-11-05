// @vitest-environment happy-dom

// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import {
  cloudAccountsForAttachments, cloudLinksHTML, cloudThresholdBytes, isTooBigToAttach, kCloudThresholdKey,
  uniqueFileName, uploadCloudAttachment,
} from "../../../../logic/Mail/CloudAttachments/CloudAttachments";
import { columnIndex, xlsxToHTML } from "../../../../logic/Files/FileType/MSExcel";
import { previewHTML, previewKind } from "../../../../frontend/Mail/Attachments/attachmentPreview";
import { ArrayColl } from "svelte-collections";
import { beforeEach, describe, expect, test, vi } from "vitest";

beforeEach(() => {
  let store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => { store.set(key, value); },
    removeItem: key => { store.delete(key); },
    clear: () => { store.clear(); },
    key: () => null,
    length: 0,
  } as Storage;
});

/** Архив ZIP без сжатия (STORE) — этого достаточно для readZipEntry */
function storeZip(entries: Record<string, string>): Blob {
  let encoder = new TextEncoder();
  let local: Uint8Array[] = [];
  let central: Uint8Array[] = [];
  let offset = 0;
  for (let [name, text] of Object.entries(entries)) {
    let nameBytes = encoder.encode(name);
    let data = encoder.encode(text);
    let header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034b50, true);
    header.setUint32(18, data.length, true);
    header.setUint32(22, data.length, true);
    header.setUint16(26, nameBytes.length, true);
    local.push(new Uint8Array(header.buffer), nameBytes, data);
    let entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, nameBytes.length, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  let centralSize = central.reduce((sum, part) => sum + part.length, 0);
  let end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, Object.keys(entries).length, true);
  end.setUint16(10, Object.keys(entries).length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...local, ...central, new Uint8Array(end.buffer)] as BlobPart[]);
}

describe("Облачные вложения", () => {
  test("Порог по умолчанию 20 МБ, настраивается", () => {
    expect(cloudThresholdBytes()).toBe(20 * 1024 * 1024);
    expect(isTooBigToAttach(21 * 1024 * 1024)).toBe(true);
    expect(isTooBigToAttach(19 * 1024 * 1024)).toBe(false);
    localStorage.setItem(kCloudThresholdKey, "5");
    expect(cloudThresholdBytes()).toBe(5 * 1024 * 1024);
    localStorage.setItem(kCloudThresholdKey, "-1");
    expect(cloudThresholdBytes()).toBe(20 * 1024 * 1024);
  });

  test("Уникальное имя файла", () => {
    expect(uniqueFileName("отчёт.pdf", ["другой.pdf"])).toBe("отчёт.pdf");
    expect(uniqueFileName("отчёт.pdf", ["ОТЧЁТ.pdf", "отчёт (2).pdf"])).toBe("отчёт (3).pdf");
    expect(uniqueFileName("README", ["README"])).toBe("README (2)");
  });

  test("Ссылки экранируются", () => {
    let html = cloudLinksHTML([{ name: "<b>x</b>.zip", size: 5, url: "https://cloud.test/s/a\"b" }], () => "5 Б");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;.zip");
    expect(html).toContain('href="https://cloud.test/s/a&quot;b"');
  });

  function fakeCloud(canShareLink = true) {
    let files = new ArrayColl<any>();
    let saved: Blob[] = [];
    let attachmentsDir: any = {
      name: "Email attachments", files, subDirs: new ArrayColl(),
      listContents: vi.fn(async () => {}),
      newFile: (name: string) => ({
        name, canShareLink,
        saveContents: vi.fn(async (blob: Blob) => { saved.push(blob); }),
        shareLink: vi.fn(async () => "https://cloud.test/s/" + encodeURIComponent(name)),
      }),
    };
    let root: any = {
      subDirs: new ArrayColl<any>(),
      listContents: vi.fn(async () => {}),
      createSubDirectory: vi.fn(async () => { root.subDirs.add(attachmentsDir); return attachmentsDir; }),
      newFile: (name: string) => attachmentsDir.newFile(name),
    };
    let account: any = { name: "Nextcloud", rootDirs: new ArrayColl([root]) };
    return { account, root, files, saved };
  }

  test("Только хранилища со ссылками", () => {
    expect(cloudAccountsForAttachments([fakeCloud(true).account, fakeCloud(false).account]).length).toBe(1);
    expect(cloudAccountsForAttachments([{ rootDirs: new ArrayColl() } as any])).toEqual([]);
  });

  test("Загрузка: папка создаётся, имя не затирает чужой файл", async () => {
    let { account, root, files, saved } = fakeCloud();
    files.add({ name: "big.zip" });
    let link = await uploadCloudAttachment(account, new Blob(["12345"], { type: "application/zip" }), "big.zip");
    expect(root.createSubDirectory).toHaveBeenCalledTimes(1);
    expect(link).toEqual({ name: "big (2).zip", size: 5, url: "https://cloud.test/s/big%20(2).zip" });
    expect(saved.length).toBe(1);
    expect(files.contents.map(file => file.name)).toEqual(["big.zip", "big (2).zip"]);
    // Второй раз папка уже есть
    await uploadCloudAttachment(account, new Blob(["1"]), "small.txt");
    expect(root.createSubDirectory).toHaveBeenCalledTimes(1);
  });

  test("Хранилище без ссылок — понятная ошибка", async () => {
    await expect(uploadCloudAttachment(fakeCloud(false).account, new Blob(["1"]), "a.txt")).rejects.toThrow();
  });
});

describe("Предпросмотр вложений", () => {
  test("Что показываем в приложении", () => {
    expect(previewKind("Счёт.PDF")).toBe("pdf");
    expect(previewKind("scan", "application/pdf")).toBe("pdf");
    expect(previewKind("фото.jpg")).toBe("image");
    expect(previewKind("договор.docx")).toBe("document");
    expect(previewKind("таблица.xlsx")).toBe("document");
    expect(previewKind("notes.txt")).toBe("text");
    expect(previewKind("page.html")).toBeNull();
    expect(previewKind("logo.svg")).toBeNull();
    expect(previewKind("setup.exe")).toBeNull();
  });

  test("Текст экранируется", async () => {
    let html = await previewHTML("text", "a.txt", new Blob(["<script>alert(1)</script>"]));
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert");
  });

  test("Столбцы Excel", () => {
    expect(columnIndex("A1")).toBe(0);
    expect(columnIndex("Z9")).toBe(25);
    expect(columnIndex("AA10")).toBe(26);
  });

  test("Excel: листы, общие строки, пропуски столбцов", async () => {
    let ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
    let blob = storeZip({
      "xl/workbook.xml": `<workbook ${ns}><sheets><sheet name="Итоги" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      "xl/_rels/workbook.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
      "xl/sharedStrings.xml": `<sst ${ns}><si><t>Отдел</t></si><si><r><t>Сум</t></r><r><t>ма &lt;руб&gt;</t></r></si></sst>`,
      "xl/worksheets/sheet1.xml": `<worksheet ${ns}><sheetData>` +
        `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>` +
        `<row r="2"><c r="A2" t="inlineStr"><is><t>Продажи</t></is></c><c r="C2"><v>1500</v></c></row>` +
        `<row r="3"><c r="B3" t="b"><v>1</v></c></row>` +
        `</sheetData></worksheet>`,
    });
    let html = await xlsxToHTML(blob);
    expect(html).toContain("<h2>Итоги</h2>");
    expect(html).toContain("<tr><td>Отдел</td><td></td><td>Сумма &lt;руб&gt;</td></tr>");
    expect(html).toContain("<tr><td>Продажи</td><td></td><td>1500</td></tr>");
    expect(html).toContain("<tr><td></td><td>TRUE</td><td></td></tr>");
  });
});
