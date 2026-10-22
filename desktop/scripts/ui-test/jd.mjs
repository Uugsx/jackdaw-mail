#!/usr/bin/env node
/**
 * Автопроверка интерфейса Jackdaw Mail: копия приложения с отдельным профилем, невидимая для пользователя
 * (см. backend/testProfile.ts), управляется через протокол отладки Chromium.
 *
 *   node jd.mjs launch <профиль> <порт> [--demo] [--app <путь к .app>] [-- ключи приложения]
 *   node jd.mjs shot <порт> <файл.png> [селектор]     снимок окна или элемента
 *   node jd.mjs text <порт> [селектор]                 видимый текст
 *   node jd.mjs eval <порт> <выражение JS>             результат выражения (await можно)
 *   node jd.mjs click <порт> <селектор>                клик мышью по центру элемента
 *   node jd.mjs type <порт> <текст>                    ввод текста в элемент с фокусом
 *   node jd.mjs key <порт> <клавиша>                   Enter, Escape, Tab, Backspace, ArrowDown…
 *   node jd.mjs wait <порт> <селектор> [мс]            дождаться элемента
 *   node jd.mjs size <порт> <ширина> <высота>          размер окна
 *   node jd.mjs stop <порт>                            закрыть копию
 *
 * Селектор: CSS, `text=Надпись` (кнопка, ссылка или пункт с этим текстом) или `label=Подпись`
 * (aria-label / title). Профили лежат в каталоге из JACKDAW_UI_TEST_DIR (по умолчанию ./ui-profiles).
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const kDefaultApp = path.resolve(here, "../../dist/mac-arm64/Jackdaw Mail.app");
const kProfilesDir = path.resolve(process.env.JACKDAW_UI_TEST_DIR ?? "ui-profiles");
const kLaunchTimeoutMs = 60_000;
const kPollMs = 250;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function json(port, route) {
  let response = await fetch(`http://127.0.0.1:${port}${route}`);
  return await response.json();
}

/** Главное окно приложения: страница index.html */
async function mainPage(port) {
  let targets = await json(port, "/json/list");
  let pages = targets.filter(t => t.type == "page" && !t.url.startsWith("devtools:"));
  let page = pages.find(t => /index\.html/.test(t.url)) ?? pages[0];
  if (!page) {
    throw new Error(`Нет окна приложения на порту ${port}`);
  }
  return page;
}

class CDP {
  static async open(url) {
    let cdp = new CDP();
    cdp.socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      cdp.socket.onopen = resolve;
      cdp.socket.onerror = () => reject(new Error(`Не удалось подключиться: ${url}`));
    });
    cdp.socket.onmessage = event => {
      let message = JSON.parse(event.data);
      let pending = cdp.pending.get(message.id);
      if (pending) {
        cdp.pending.delete(message.id);
        message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
      }
    };
    return cdp;
  }
  pending = new Map();
  nextID = 1;
  send(method, params = {}) {
    let id = this.nextID++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  close() {
    this.socket.close();
  }
}

async function withPage(port, action) {
  let page = await mainPage(port);
  let cdp = await CDP.open(page.webSocketDebuggerUrl);
  try {
    return await action(cdp);
  } finally {
    cdp.close();
  }
}

async function evaluate(cdp, expression) {
  let result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result.value;
}

/** Код поиска элемента в странице: возвращает прямоугольник видимого элемента или null */
function findScript(selector) {
  return `(() => {
    const selector = ${JSON.stringify(selector)};
    const visible = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility != "hidden" && s.display != "none"; };
    let candidates;
    if (selector.startsWith("text=")) {
      const text = selector.slice(5).trim();
      const all = [...document.querySelectorAll("button, a, [role=button], [role=menuitem], [role=tab], label, li, summary, input[type=button], input[type=submit]")];
      candidates = all.filter(el => el.innerText?.trim() == text || el.value == text);
      if (!candidates.length) candidates = all.filter(el => el.innerText?.includes(text));
      if (!candidates.length) candidates = [...document.querySelectorAll("body *")].filter(el => el.children.length == 0 && el.textContent.trim() == text);
    } else if (selector.startsWith("label=")) {
      const label = selector.slice(6).trim();
      candidates = [...document.querySelectorAll("[aria-label], [title], [placeholder]")]
        .filter(el => [el.getAttribute("aria-label"), el.getAttribute("title"), el.getAttribute("placeholder")].includes(label));
    } else {
      candidates = [...document.querySelectorAll(selector)];
    }
    const el = candidates.find(visible);
    if (!el) return null;
    el.scrollIntoView({ block: "center", inline: "center" });
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, tag: el.tagName, text: (el.innerText ?? "").slice(0, 80) };
  })()`;
}

async function waitFor(cdp, selector, timeoutMs = 10_000) {
  let deadline = Date.now() + timeoutMs;
  for (;;) {
    let box = await evaluate(cdp, findScript(selector));
    if (box) {
      return box;
    }
    if (Date.now() > deadline) {
      throw new Error(`Не найдено: ${selector}`);
    }
    await sleep(kPollMs);
  }
}

const keys = {
  Enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" },
  Escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
  Tab: { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
  Backspace: { key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 },
  Delete: { key: "Delete", code: "Delete", windowsVirtualKeyCode: 46 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 },
  Space: { key: " ", code: "Space", windowsVirtualKeyCode: 32, text: " " },
};

const commands = {
  async launch(name, port, ...rest) {
    let appArgs = [];
    let separator = rest.indexOf("--");
    if (separator >= 0) {
      appArgs = rest.slice(separator + 1);
      rest = rest.slice(0, separator);
    }
    let app = kDefaultApp;
    let appIndex = rest.indexOf("--app");
    if (appIndex >= 0) {
      app = path.resolve(rest[appIndex + 1]);
    }
    if (rest.includes("--demo")) {
      appArgs.push("--jackdaw-demo");
    }
    let profile = path.join(kProfilesDir, name);
    fs.mkdirSync(profile, { recursive: true });
    let log = fs.openSync(path.join(profile, "app.log"), "a");
    // Напрямую, не через `open`: переменная профиля должна дойти до приложения наверняка.
    // Без неё копия открыла бы обычный профиль пользователя.
    let binary = path.join(app, "Contents/MacOS", path.basename(app, ".app"));
    let child = spawn(binary, [`--remote-debugging-port=${port}`, "--remote-allow-origins=*", ...appArgs], {
      // Свой порт backend: обычный 5455 занят основным приложением
      env: { ...process.env, JACKDAW_TEST_PROFILE: profile, JACKDAW_TEST_JPC_PORT: String(Number(port) + 1000) },
      detached: true,
      stdio: ["ignore", log, log],
    });
    child.unref();
    let userData = path.join(profile, "userData");
    let deadline = Date.now() + kLaunchTimeoutMs;
    for (;;) {
      try {
        let page = await mainPage(port);
        if (!fs.existsSync(userData)) {
          process.kill(child.pid);
          throw new Error(`Профиль не применился (${userData} нет), копия закрыта`);
        }
        console.log(`Запущено: профиль ${profile}, порт ${port}, окно ${page.url.split("#")[0]}`);
        return;
      } catch (ex) {
        if (ex.message.startsWith("Профиль не применился")) {
          throw ex;
        }
        if (Date.now() > deadline) {
          process.kill(child.pid);
          throw new Error(`Окно не появилось за ${kLaunchTimeoutMs / 1000} с, журнал: ${path.join(profile, "app.log")}`);
        }
        await sleep(500);
      }
    }
  },

  async stop(port) {
    // Только процесс копии с этим портом отладки; основное приложение пользователя его не имеет
    let result = spawnSync("pkill", ["-TERM", "-f", `--remote-debugging-port=${Number(port)}( |$)`]);
    console.log(result.status == 0 ? `Закрыто: порт ${port}` : `Нет копии на порту ${port}`);
  },

  async shot(port, file, selector) {
    await withPage(port, async cdp => {
      let params = { format: "png" };
      if (selector) {
        let box = await waitFor(cdp, selector);
        params.clip = { ...box, scale: 1 };
      }
      let { data } = await cdp.send("Page.captureScreenshot", params);
      fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
      fs.writeFileSync(file, Buffer.from(data, "base64"));
      console.log(path.resolve(file));
    });
  },

  async text(port, selector = "body") {
    await withPage(port, async cdp => {
      console.log(await evaluate(cdp, `document.querySelector(${JSON.stringify(selector)})?.innerText ?? ""`));
    });
  },

  async eval(port, ...expression) {
    await withPage(port, async cdp => {
      let value = await evaluate(cdp, expression.join(" "));
      console.log(typeof value == "string" ? value : JSON.stringify(value, null, 2));
    });
  },

  async click(port, selector) {
    await withPage(port, async cdp => {
      let box = await waitFor(cdp, selector);
      let x = box.x + box.width / 2;
      let y = box.y + box.height / 2;
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
      console.log(`Клик: ${box.tag} «${box.text.split("\n")[0]}»`);
    });
  },

  async type(port, ...text) {
    await withPage(port, cdp => cdp.send("Input.insertText", { text: text.join(" ") }));
  },

  async key(port, name) {
    let key = keys[name] ?? { key: name, text: name };
    await withPage(port, async cdp => {
      await cdp.send("Input.dispatchKeyEvent", { type: key.text ? "keyDown" : "rawKeyDown", ...key });
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...key });
    });
  },

  async wait(port, selector, timeoutMs = "10000") {
    await withPage(port, async cdp => {
      let box = await waitFor(cdp, selector, Number(timeoutMs));
      console.log(`Есть: ${box.tag} «${box.text.split("\n")[0]}»`);
    });
  },

  async size(port, width, height) {
    let page = await mainPage(port);
    let version = await json(port, "/json/version");
    let browser = await CDP.open(version.webSocketDebuggerUrl);
    try {
      let { windowId } = await browser.send("Browser.getWindowForTarget", { targetId: page.id });
      await browser.send("Browser.setWindowBounds", { windowId, bounds: { width: Number(width), height: Number(height) } });
    } finally {
      browser.close();
    }
  },
};

let [command, ...args] = process.argv.slice(2);
if (!commands[command]) {
  console.error(`Команды: ${Object.keys(commands).join(", ")}`);
  process.exit(2);
}
try {
  await commands[command](...args);
} catch (ex) {
  console.error(ex.message);
  process.exit(1);
}
