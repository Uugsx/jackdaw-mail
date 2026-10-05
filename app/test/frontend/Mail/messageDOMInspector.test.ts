// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { openMessageDOMInspector } from "../../../frontend/Mail/Message/messageDOMInspector";

describe("инспектор DOM письма", () => {
  it("не падает, если документ или webview ещё не готовы", () => {
    expect(openMessageDOMInspector(null)).toBe(false);
    expect(openMessageDOMInspector(document)).toBe(false);

    let body = document.createElement("div");
    body.className = "message-body";
    document.body.append(body);

    expect(openMessageDOMInspector(document)).toBe(false);
    body.remove();
  });

  it("открывает DevTools только у доступного webview", () => {
    let body = document.createElement("div");
    body.className = "message-body";
    let webview = document.createElement("webview") as HTMLElement & {
      openDevTools: () => void;
    };
    webview.openDevTools = vi.fn();
    body.append(webview);
    document.body.append(body);

    expect(openMessageDOMInspector(document)).toBe(true);
    expect(webview.openDevTools).toHaveBeenCalledOnce();

    body.remove();
  });
});
