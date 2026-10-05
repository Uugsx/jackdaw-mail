type DevToolsWebview = HTMLElement & {
  openDevTools?: () => void;
};

export function openMessageDOMInspector(
  ownerDocument: Document | null | undefined,
): boolean {
  let webview = ownerDocument?.querySelector(
    ".message-body webview",
  ) as DevToolsWebview | null;
  if (typeof webview?.openDevTools != "function") {
    return false;
  }
  webview.openDevTools();
  return true;
}
