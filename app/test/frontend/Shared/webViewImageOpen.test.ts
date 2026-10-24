// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { mount, tick, unmount } from "svelte";
import {
  imageOpenGuestScript,
  kImageOpenConsolePrefix,
  parseImageOpenMessage,
} from "../../../frontend/Shared/webViewImageOpen";

const openMailImageFromContext = vi.fn(async (..._args: unknown[]) => {});
vi.mock("../../../frontend/Mail/Message/openMailImage", () => ({ openMailImageFromContext }));

let WebView: any;
let mounted: ReturnType<typeof mount> | null = null;

beforeAll(async () => {
  let { appGlobal } = await import("../../../logic/app");
  (appGlobal as any).remoteApp = {
    addEventListenerWebContents: vi.fn(async () => {}),
    containWebContentsNavigation: vi.fn(),
  };
  WebView = (await import("../../../frontend/Shared/WebView.svelte")).default;
}, 120_000);

afterEach(() => {
  if (mounted) {
    unmount(mounted);
    mounted = null;
  }
  document.body.replaceChildren();
  openMailImageFromContext.mockClear();
  vi.restoreAllMocks();
});

/** Как документ письма в webview: у каждого письма свои `window` и `document` */
function openGuestDocument(bodyHTML: string) {
  let guestDocument = document.implementation.createHTMLDocument();
  guestDocument.body.innerHTML = bodyHTML;
  let guestWindow = {};
  let runGuestScript = () => new Function("window", "document", imageOpenGuestScript())(guestWindow, guestDocument);
  runGuestScript();
  return { guestDocument, runGuestScript };
}

function click(target: Element, detail = 1): MouseEvent {
  let event = new MouseEvent("click", { bubbles: true, cancelable: true, clientX: 42.4, clientY: 17.6, detail });
  target.dispatchEvent(event);
  return event;
}

function imageOpenMessages(log: ReturnType<typeof vi.spyOn>): string[] {
  return log.mock.calls.map(call => String(call[0])).filter(message => message.startsWith(kImageOpenConsolePrefix));
}

describe("Клик по картинке внутри письма", () => {
  let log: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    log = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  test("сообщает точку клика в CSS-пикселях для картинки в ссылке, таблице и подписи", () => {
    let { guestDocument } = openGuestDocument(`
      <a href="https://example.com"><img id="linked" src="data:image/png;base64,AA=="></a>
      <table><tr><td><img id="screenshot" src="data:image/png;base64,AA=="></td></tr></table>
      <p><span><b><img id="signature" src="data:image/png;base64,AA=="></b></span></p>`);

    let linkClick = click(guestDocument.getElementById("linked")!);
    click(guestDocument.getElementById("screenshot")!);
    click(guestDocument.getElementById("signature")!);

    expect(linkClick.defaultPrevented).toBe(true);
    expect(imageOpenMessages(log)).toEqual(Array(3).fill(`${kImageOpenConsolePrefix}42,18`));
    expect(parseImageOpenMessage(imageOpenMessages(log)[0])).toEqual({ x: 42, y: 18 });
  });

  test("не открывает картинку по тексту и второму клику двойного щелчка", () => {
    let { guestDocument } = openGuestDocument(`<p id="text">Текст</p><img id="image" src="data:image/png;base64,AA==">`);

    click(guestDocument.getElementById("text")!);
    let second = click(guestDocument.getElementById("image")!, 2);

    expect(imageOpenMessages(log)).toEqual([]);
    expect(second.defaultPrevented).toBe(true);
  });

  test("повторное внедрение в тот же документ не открывает картинку дважды", () => {
    let { guestDocument, runGuestScript } = openGuestDocument(`<img id="image" src="data:image/png;base64,AA==">`);
    runGuestScript();

    click(guestDocument.getElementById("image")!);

    expect(imageOpenMessages(log)).toHaveLength(1);
  });

  test("игнорирует чужие и испорченные сообщения консоли", () => {
    expect(parseImageOpenMessage("jackdaw-zoom:1")).toBeNull();
    expect(parseImageOpenMessage(`${kImageOpenConsolePrefix}1,`)).toBeNull();
    expect(parseImageOpenMessage(undefined)).toBeNull();
  });
});

describe("WebView письма и смена документа", () => {
  async function mountWebView() {
    let target = document.createElement("div");
    document.body.append(target);
    mounted = mount(WebView, { target, props: { html: "<p>Письмо</p>", title: "", allowImageOpen: true } });
    let webview = target.querySelector("webview") as any;
    webview.getWebContentsId = () => 7;
    webview.executeJavaScript = vi.fn(async () => undefined);
    // Обработчики webview навешиваются эффектом после монтирования
    await tick();
    return webview;
  }

  async function domReady(webview: HTMLElement) {
    webview.dispatchEvent(new Event("dom-ready"));
    for (let i = 0; i < 5; i++) {
      await tick();
      await Promise.resolve();
    }
  }

  function injectedImageScripts(webview: any): number {
    return webview.executeJavaScript.mock.calls
      .filter((call: string[]) => call[0].includes("__jackdawImageOpenListener")).length;
  }

  test("внедряет обработчик картинок в каждый новый документ письма", async () => {
    let webview = await mountWebView();

    await domReady(webview);
    await domReady(webview);

    expect(injectedImageScripts(webview)).toBe(2);
  });

  test("сбой внедрения при быстрой перезагрузке документа восстанавливается на следующем dom-ready", async () => {
    let webview = await mountWebView();
    webview.executeJavaScript.mockRejectedValueOnce(new Error("Script failed to execute"));

    await domReady(webview);
    await domReady(webview);

    expect(webview.executeJavaScript).toHaveBeenCalledTimes(3);
    expect(injectedImageScripts(webview)).toBe(2);
  });

  test("сообщение о клике открывает картинку по точке из письма", async () => {
    let webview = await mountWebView();
    await domReady(webview);
    await domReady(webview);

    let event = new Event("console-message") as Event & { message?: string };
    event.message = `${kImageOpenConsolePrefix}120,64`;
    webview.dispatchEvent(event);
    await vi.waitFor(() => expect(openMailImageFromContext).toHaveBeenCalledTimes(1));

    expect(openMailImageFromContext).toHaveBeenCalledWith(webview, 120, 64);
  });
});
