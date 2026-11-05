// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";
import {
  chunkSegments,
  extractSegments,
  translateHTML,
  translatePlainText,
  type TranslateBatch,
} from "../../../../logic/Mail/Translate/translateHTML";

/** «Перевод»: текст вне тегов — заглавными, теги как есть */
const upper: TranslateBatch = async texts =>
  texts.map(text => text.replace(/(^|>)([^<]*)/g, (_m, close, body) => close + body.toUpperCase()));

function body(html: string): HTMLElement {
  return new DOMParser().parseFromString(html, "text/html").body;
}

describe("разбиение HTML на части", () => {
  test("каждый абзац, пункт и ячейка — отдельная часть, строчные теги внутри", () => {
    let segments = extractSegments(body(
      "<p>Hello <b>dear</b> team,</p><ul><li>First</li><li>Second</li></ul>" +
      "<table><tr><td>Cell one</td><td>Cell two</td></tr></table>"));
    expect(segments.map(s => s.source)).toEqual([
      'Hello <b data-jt="1">dear</b> team,',
      "First",
      "Second",
      "Cell one",
      "Cell two",
    ]);
    expect(segments.every(s => s.isHTML)).toBe(true);
  });

  test("в движок не уходят адреса ссылок, стили и атрибуты картинок", () => {
    let [segment] = extractSegments(body(
      '<p>Open <a href="https://secret.example/token=abc" style="color:red" title="t">the portal</a> ' +
      '<img src="cid:logo" alt="Logo"> now</p>'));
    expect(segment.source).toBe('Open <a data-jt="1">the portal</a> <img data-jt="2"> now');
    expect(segment.source).not.toContain("secret.example");
    expect(segment.source).not.toContain("color");
  });

  test("стили, код и translate=no не переводятся", () => {
    let segments = extractSegments(body(
      "<style>p { color: red }</style><p>Run <code>npm install</code> now</p>" +
      '<div translate="no">Product Name</div><p class="notranslate">ID-42 Brand</p><p>12 345</p>'));
    expect(segments.map(s => s.source)).toEqual(['Run <code data-jt="1">npm install</code> now']);
  });

  test("длинный абзац делится по <br>", () => {
    let line = "This is a long line of a plain text email that was converted to HTML. ";
    let html = `<div>${Array.from({ length: 6 }, () => line.repeat(5)).join("<br>")}</div>`;
    let segments = extractSegments(body(html), 1000);
    expect(segments.length).toBe(6);
    expect(segments.every(s => !s.source.includes("<br"))).toBe(true);
  });

  test("строки <pre> переводятся по отдельности", () => {
    let segments = extractSegments(body("<pre>First line\n\nSecond line\n  > quoted</pre>"));
    expect(segments.map(s => [s.source, s.isHTML])).toEqual([
      ["First line", false],
      ["Second line", false],
      ["quoted", false],
    ]);
  });

  test("в <pre> переносы строк и знаки цитаты остаются", async () => {
    let result = await translateHTML('<pre class="moz-quote-pre">First line\n\n  > quoted text</pre>', upper);
    let doc = new DOMParser().parseFromString(result, "text/html");
    expect(doc.querySelector("pre.moz-quote-pre").textContent).toBe("FIRST LINE\n\n  > QUOTED TEXT");
  });

  test("части группируются в запросы по размеру, числу и виду", () => {
    let segments = extractSegments(body("<p>One</p><p>Two</p><p>Three</p><pre>Four</pre><p>Five</p>"));
    let chunks = chunkSegments(segments, 8, 10);
    expect(chunks.map(chunk => chunk.map(s => s.source))).toEqual([
      ["One", "Two"], ["Three"], ["Four"], ["Five"],
    ]);
    expect(chunkSegments(segments, 1000, 2).map(chunk => chunk.length)).toEqual([2, 1, 1, 1]);
  });
});

describe("сборка перевода без потери разметки", () => {
  test("текст переведён, ссылки, картинки, стили и цитата — как в оригинале", async () => {
    let html = '<html><head><style>.x { color: red }</style></head><body>' +
      '<p class="x" style="margin:0">Hello <a href="https://example.com/a?b=1" target="_blank">our site</a>' +
      ' <img src="cid:logo" alt="Logo" width="20"></p>' +
      '<blockquote type="cite"><p>Old <b>message</b></p></blockquote></body></html>';
    let result = await translateHTML(html, upper);
    let doc = new DOMParser().parseFromString(result, "text/html");
    expect(doc.querySelector("style").textContent).toBe(".x { color: red }");
    let p = doc.querySelector("p.x");
    expect(p.getAttribute("style")).toBe("margin:0");
    expect(p.textContent).toBe("HELLO OUR SITE ");
    let link = doc.querySelector("a");
    expect(link.getAttribute("href")).toBe("https://example.com/a?b=1");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.textContent).toBe("OUR SITE");
    let img = doc.querySelector("img");
    expect(img.getAttribute("src")).toBe("cid:logo");
    expect(img.getAttribute("width")).toBe("20");
    expect(doc.querySelector('blockquote[type="cite"] p b').textContent).toBe("MESSAGE");
    expect(result).not.toContain("data-jt");
  });

  test("движок переставил теги — атрибуты остаются у своих элементов", async () => {
    let html = '<p><a href="https://a.test">Terms</a> and <a href="https://b.test">Privacy</a></p>';
    let swap: TranslateBatch = async texts => texts.map(() =>
      '<a data-jt="2">Конфиденциальность</a> и <a data-jt="1">Условия</a>');
    let doc = new DOMParser().parseFromString(await translateHTML(html, swap), "text/html");
    let links = [...doc.querySelectorAll("a")].map(a => [a.textContent, a.getAttribute("href")]);
    expect(links).toEqual([["Конфиденциальность", "https://b.test"], ["Условия", "https://a.test"]]);
  });

  test("из ответа движка не попадают ни новые теги, ни атрибуты", async () => {
    let html = '<p>Click <a href="https://good.test">here</a></p>';
    let evil: TranslateBatch = async (texts, isHTML) => texts.map(() => isHTML
      ? 'Нажмите <a data-jt="1" href="javascript:alert(1)" onclick="x()">здесь</a><img src=x onerror="alert(1)">'
      : "ПЕРЕВОД");
    let result = await translateHTML(html, evil);
    let doc = new DOMParser().parseFromString(result, "text/html");
    // Лишний тег — часть переведена заново по текстовым узлам, разметка исходная
    expect(doc.querySelectorAll("img").length).toBe(0);
    expect(result).not.toContain("javascript:");
    expect(result).not.toContain("onclick");
    expect(result).not.toContain("onerror");
    expect(doc.querySelector("a").getAttribute("href")).toBe("https://good.test");
    expect(doc.querySelector("p").textContent).toBe("ПЕРЕВОД ПЕРЕВОД");
  });

  test("движок потерял тег — перевод по текстовым узлам, картинка на месте", async () => {
    let html = '<p>See <img src="cid:chart"> the <b>chart</b> below</p>';
    let lossy: TranslateBatch = async (texts, isHTML) => isHTML
      ? texts.map(() => "Смотрите график ниже")
      : texts.map(text => `[${text}]`);
    let doc = new DOMParser().parseFromString(await translateHTML(html, lossy), "text/html");
    expect(doc.querySelector("img").getAttribute("src")).toBe("cid:chart");
    expect(doc.querySelector("b").textContent).toBe("[chart]");
    expect(doc.querySelector("p").innerHTML).toBe('[See] <img src="cid:chart"> [the] <b>[chart]</b> [below]');
  });

  test("код внутри предложения остаётся как в оригинале", async () => {
    let html = "<p>Run <code>npm install</code> please</p>";
    let doc = new DOMParser().parseFromString(await translateHTML(html, upper), "text/html");
    expect(doc.querySelector("code").textContent).toBe("npm install");
    expect(doc.querySelector("p").textContent).toBe("RUN npm install PLEASE");
  });

  test("Outlook: <o:p>, пробелы и &nbsp; не ломают разметку", async () => {
    let html = '<p class="MsoNormal"><span lang="EN-US">Hello team,<o:p></o:p></span></p>' +
      '<p class="MsoNormal"><o:p>&nbsp;</o:p></p>';
    let result = await translateHTML(html, upper);
    let doc = new DOMParser().parseFromString(result, "text/html");
    expect(doc.querySelectorAll("p.MsoNormal").length).toBe(2);
    expect(doc.querySelector("span[lang='EN-US']").textContent).toBe("HELLO TEAM,");
  });

  test("длинное письмо переводится частями, ход виден", async () => {
    let paragraphs = Array.from({ length: 120 }, (_, i) => `<p>Paragraph number ${i} about the delivery.</p>`);
    let calls = 0;
    let progress: [number, number][] = [];
    let counted: TranslateBatch = async texts => {
      calls++;
      return upper(texts, true);
    };
    let result = await translateHTML(paragraphs.join(""), counted, {
      maxChunkItems: 40,
      onProgress: (done, total) => progress.push([done, total]),
    });
    expect(calls).toBe(3);
    expect(progress.at(-1)).toEqual([120, 120]);
    expect(result).toContain("PARAGRAPH NUMBER 119 ABOUT THE DELIVERY.");
  });

  test("отмена останавливает перевод между частями", async () => {
    let abort = new AbortController();
    let html = Array.from({ length: 10 }, (_, i) => `<p>Text ${i}</p>`).join("");
    let first: TranslateBatch = async texts => {
      abort.abort();
      return texts;
    };
    await expect(translateHTML(html, first, { maxChunkItems: 2, signal: abort.signal })).rejects.toThrow();
  });

  test("нечего переводить — HTML без изменений", async () => {
    let html = '<p><img src="cid:a"></p><p>2024-10-21</p>';
    expect(await translateHTML(html, upper)).toBe(html);
  });

  test("неверное число ответов — ошибка, а не перепутанный текст", async () => {
    let broken: TranslateBatch = async () => ["only one"];
    await expect(translateHTML("<p>One</p><p>Two</p>", broken)).rejects.toThrow();
  });
});

describe("перевод обычного текста", () => {
  test("знаки цитаты и пустые строки сохраняются", async () => {
    let result = await translatePlainText("Hello,\n\n> old reply\n>> older\n-- \nJohn", upper);
    expect(result).toBe("HELLO,\n\n> OLD REPLY\n>> OLDER\n-- \nJOHN");
  });
});
