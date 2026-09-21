import { session as Session, net as Net } from "electron";
import { text as textFromStream } from 'node:stream/consumers';
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

function logOWADiagnostic(message: string): void {
  if (!process.env.JACKDAW_OWA_DEBUG) {
    return;
  }
  try {
    const logFile = path.join(os.tmpdir(), "jackdaw-owa-debug.log");
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${message}\n`);
  } catch {
  }
}

function summarizeNotification(value: any): any {
  if (Array.isArray(value)) {
    return {
      type: "array",
      length: value.length,
      items: value.slice(0, 5).map(summarizeNotification),
    };
  }
  if (!value || typeof value != "object") {
    return { type: typeof value };
  }
  let subscriptionID = value.SubscriptionId ?? value.subscriptionId;
  return {
    type: "object",
    keys: Object.keys(value).slice(0, 20),
    id: typeof value.id == "string" ? value.id : typeof value.Id == "string" ? value.Id : "",
    notificationType: typeof value.NotificationType == "string" ? value.NotificationType : "",
    eventType: typeof value.EventType == "string" ? value.EventType : typeof value.eventType == "string" ? value.eventType : "",
    subscriptionPrefix: typeof subscriptionID == "string" ? subscriptionID.slice(0, 80) : "",
    hasItemID: Boolean(value.ItemId ?? value.itemId ?? value.Item?.ItemId ?? value.item?.ItemId ?? value.RowId ?? value.rowId),
  };
}

const kCanaryName = "X-OWA-CANARY";
const kHotmailServer = "outlook.live.com";
/**
 * OWA keeps the PendingNotificationRequest open and sends an "alive"
 * heartbeat about every 40 s. If we stop receiving anything for this long,
 * the channel is dead (e.g. the subscription expired server-side), so abort
 * and let the caller reconnect and re-subscribe instead of waiting forever.
 */
const kStreamIdleTimeoutMs = 90_000;

/**
 * To log in to Hotmail or Office 365 environments, we need to
 * scrape the Authorization header from the startupdata request.
 *
 * Cookie partition name -> HTTP `Authentication` header
 */
let scrapedAuth: Record<string, string> = {};

/**
 * Used by the front end to tell whether this is Hotmail or Office 365.
 * @returns HTTP `Authentication` header
 */
export function getAnyScrapedAuth(partition: string): string {
  return scrapedAuth[partition];
}

/**
 * Used by the front end to start watching for startupdata requests.
 */
export function scrapeStartupDataAuth(partition: string) {
  let session = Session.fromPartition(partition);
  session.webRequest.onSendHeaders({
    urls: ["https://*/*startupdata*"],
  }, async (details: { requestHeaders: Record<string, string>, frame: { executeJavaScript: (code : string) => Promise<any> } }) => {
    // Note: this differs from the browser.webRequest.onSendHeaders API!
    for (let name in details.requestHeaders) {
      if (/^Authorization$/i.test(name)) {
        scrapedAuth[partition] = details.requestHeaders[name];
        // We need to notify the front end. It's already listening for
        // load events, so this is the easiest way.
        await details.frame.executeJavaScript("document.location = 'about:blank';");
      }
    }
  });
}

export function extractJsonFromHtmlOrScript(text: string): any | null {
  if (!text || typeof text !== "string") {
    return null;
  }
  let trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {}

  // Strip HTML / script tags
  let matches = trimmed.match(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi);
  if (matches) {
    for (let match of matches) {
      let script = match.replace(/^<script(?:\s[^>]*)?>/i, "").replace(/<\/script>$/i, "").trim();
      let extracted = extractJsonFromScript(script);
      if (extracted != null) {
        return extracted;
      }
    }
  }
  return extractJsonFromScript(trimmed);
}

function extractJsonFromScript(script: string): any | null {
  let trimmed = script.trim();
  if (!trimmed) {
    return null;
  }

  let unescapeJsString = (quote: string, rawContent: string): string | null => {
    if (quote === '"') {
      try {
        let unquoted = JSON.parse('"' + rawContent + '"');
        return typeof unquoted === "string" ? unquoted : JSON.stringify(unquoted);
      } catch {
        return rawContent.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      }
    } else {
      return rawContent.replace(/\\'/g, "'").replace(/\\\\/g, "\\");
    }
  };

  let parseResult = (val: string): any | null => {
    let t = val.trim();
    if (!t) return null;
    if (t === "alive" || t === "reinitSubscription") {
      return t;
    }
    try {
      return JSON.parse(t);
    } catch {
      let firstBrace = t.indexOf("{");
      let lastBrace = t.lastIndexOf("}");
      let firstBracket = t.indexOf("[");
      let lastBracket = t.lastIndexOf("]");
      if (firstBracket !== -1 && lastBracket > firstBracket) {
        try { return JSON.parse(t.slice(firstBracket, lastBracket + 1)); } catch {}
      }
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        try { return JSON.parse(t.slice(firstBrace, lastBrace + 1)); } catch {}
      }
      return null;
    }
  };

  // 1. Check for OWA parent.pR / x(...) / pR(...) / s(...) invocation with string literal argument
  let owaCalls = [
    /(?:(?:var\s+x\s*=\s*[a-zA-Z0-9_$.]+\s*;\s*)?if\s*\(\s*x\s*\)\s*)?x\s*\(\s*(['"])((?:\\.|(?!\1)[\s\S])*)\1\s*\)/i,
    /(?:\.pR|parent\.pR|w\.pR|pR)\s*\(\s*(['"])((?:\\.|(?!\1)[\s\S])*)\1\s*\)/i,
    /(?:\.s|parent\.s|w\.s|s)\s*\(\s*(['"])((?:\\.|(?!\1)[\s\S])*)\1\s*\)/i,
  ];

  for (let regex of owaCalls) {
    let match = trimmed.match(regex);
    if (match) {
      let unquoted = unescapeJsString(match[1], match[2]);
      if (unquoted) {
        let res = parseResult(unquoted);
        if (res != null) {
          return res;
        }
      }
    }
  }

  // 2. Direct JSON parse
  try {
    return JSON.parse(trimmed);
  } catch {}

  // 3. Quoted JSON string anywhere in script: "([{...}])"
  let quotedJsonMatch = trimmed.match(/(['"])((?:\\.|(?!\1)[\s\S])*?(?:\[|\{)[\s\S]*?(?:\]|\})(?:\\.|(?!\1)[\s\S])*?)\1/);
  if (quotedJsonMatch) {
    let unquoted = unescapeJsString(quotedJsonMatch[1], quotedJsonMatch[2]);
    if (unquoted) {
      let res = parseResult(unquoted);
      if (res != null) {
        return res;
      }
    }
  }

  // 4. Raw unescaped JSON brackets/braces extraction
  let firstBracket = trimmed.indexOf("[");
  let lastBracket = trimmed.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    let slice = trimmed.slice(firstBracket, lastBracket + 1);
    try {
      return JSON.parse(slice);
    } catch {
      try {
        return JSON.parse(slice.replace(/\\"/g, '"'));
      } catch {}
    }
  }

  let firstBrace = trimmed.indexOf("{");
  let lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    let slice = trimmed.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(slice);
    } catch {
      try {
        return JSON.parse(slice.replace(/\\"/g, '"'));
      } catch {}
    }
  }

  // 5. Special token keywords
  if (trimmed.includes("alive")) return "alive";
  if (trimmed.includes("reinitSubscription")) return "reinitSubscription";

  return null;
}

async function getCanaryCookie(session: Electron.Session): Promise<string | null> {
  let allCookies = await session.cookies.get({});
  let canary = allCookies.find(c => c.name.toUpperCase() === "X-OWA-CANARY");
  if (canary?.value) {
    return canary.value;
  }
  let alt = allCookies.find(c => c.name.toUpperCase().includes("CANARY") || c.name === "userContext" || c.name === "cadata");
  return alt?.value ?? null;
}

export async function getNotificationCID(partition: string, url: string): Promise<string> {
  let session = Session.fromPartition(partition);
  let canary = await getCanaryCookie(session);
  if (!canary) {
    throw new Error("No OWA Canary cookie found in partition");
  }
  let fullUrl = url;
  if (fullUrl.endsWith("X-OWA-CANARY=")) {
    fullUrl += encodeURIComponent(canary);
  } else if (!fullUrl.includes(kCanaryName)) {
    fullUrl += (fullUrl.includes("?") ? "&" : "?") + `X-OWA-CANARY=${encodeURIComponent(canary)}`;
  }

  let allCookies = await session.cookies.get({ url: fullUrl });
  let cookieHeader = allCookies.map(c => `${c.name}=${c.value}`).join("; ");

  return new Promise((resolve, reject) => {
    let request = Net.request({
      method: "POST",
      url: fullUrl,
      partition: partition,
      credentials: "include",
      redirect: "manual",
    });
    request.setHeader(kCanaryName, canary);
    if (cookieHeader) {
      request.setHeader("Cookie", cookieHeader);
    }
    request.setHeader("Accept", "*/*");
    request.setHeader("Accept-Encoding", "identity");
    request.setHeader("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");

    let text = "";
    request.on("response", response => {
      response.on("data", chunk => {
        text += chunk.toString("utf8");
      });
      response.on("end", () => {
        let json = extractJsonFromHtmlOrScript(text);
        let cid: string | null = json?.cid ?? (typeof json === "string" ? json : null);
        if (!cid && typeof json === "object" && json) {
          cid = json.Cid ?? json.CID ?? json.connectionId ?? json.ConnectionId;
        }
        if (!cid) {
          let match = text.match(/["']?cid["']?\s*:\s*["']([^"']+)["']/i);
          if (match) {
            cid = match[1];
          }
        }
        if (typeof cid != "string" || !cid) {
          let errMsg = `OWA notification channel did not return a connection ID. Server response (${response.statusCode}): ${text.slice(0, 200)}`;
          reject(new Error(errMsg));
          return;
        }
        resolve(cid);
      });
      response.on("error", err => {
        reject(err);
      });
    });
    request.on("error", err => {
      reject(err);
    });
    request.end();
  });
}

const activeStreams = new Map<string, Electron.ClientRequest>();
const owaSessionUrls = new Map<string, string>();

function trackOWASession(partition: string, url: string): void {
  let base = url.match(/^(https?:\/\/[^/]+\/owa\/)/i)?.[1];
  if (base) {
    owaSessionUrls.set(partition, base);
  }
}

export async function stopAllNotificationStreams(): Promise<void> {
  for (let partition of [...activeStreams.keys()]) {
    await stopNotificationStream(partition);
  }
}

/** End OWA server sessions. Call on application quit so Exchange does not accumulate connections. */
export async function shutdownAllOWASessions(): Promise<void> {
  for (let [partition, owaUrl] of owaSessionUrls) {
    await serverLogoff(partition, owaUrl);
  }
  owaSessionUrls.clear();
}

export async function stopNotificationStream(partition: string): Promise<void> {
  let existing = activeStreams.get(partition);
  if (existing) {
    activeStreams.delete(partition);
    logOWADiagnostic(`stopNotificationStream partition=${partition}`);
    try {
      existing.abort();
    } catch {}
  }
}

export async function serverLogoff(partition: string, owaUrl: string): Promise<void> {
  trackOWASession(partition, owaUrl);
  await stopNotificationStream(partition);
  let session = Session.fromPartition(partition);
  let logoffUrl = owaUrl.replace(/\/owa\/?.*$/i, "/owa/logoff.owa");
  logOWADiagnostic(`serverLogoff url=${logoffUrl}`);
  try {
    let canary = await getCanaryCookie(session);
    let options: any = { method: "POST", headers: {} };
    if (canary) {
      options.headers[kCanaryName] = canary;
    }
    await session.fetch(logoffUrl, options);
  } catch {}
}

export async function listenNotificationStream(
  partition: string,
  url: string,
  onMessage: (messages: any[]) => Promise<void> | void
): Promise<void> {
  trackOWASession(partition, url);
  await stopNotificationStream(partition);
  let session = Session.fromPartition(partition);
  let canary = await getCanaryCookie(session);
  if (!canary) {
    throw new Error("No OWA Canary cookie found in partition");
  }
  let fullUrl = url;
  if (fullUrl.endsWith("X-OWA-CANARY=")) {
    fullUrl += encodeURIComponent(canary);
  } else if (!fullUrl.includes(kCanaryName)) {
    fullUrl += (fullUrl.includes("?") ? "&" : "?") + `X-OWA-CANARY=${encodeURIComponent(canary)}`;
  }

  let allCookies = await session.cookies.get({ url: fullUrl });
  let cookieHeader = allCookies.map(c => `${c.name}=${c.value}`).join("; ");

  return new Promise((resolve, reject) => {
    let request = Net.request({
      method: "GET",
      url: fullUrl,
      partition: partition,
      credentials: "include",
      redirect: "manual",
    });
    activeStreams.set(partition, request);
    request.setHeader(kCanaryName, canary);
    if (cookieHeader) {
      request.setHeader("Cookie", cookieHeader);
    }
    request.setHeader("Accept", "*/*");
    request.setHeader("Cache-Control", "no-cache");
    request.setHeader("Pragma", "no-cache");
    request.setHeader("x-req-source", "Mail");
    request.setHeader("x-owa-actionsource", "Mail");
    let referer = new URL(fullUrl);
    referer.pathname = referer.pathname.replace(/\/ev\.owa2$/, "/");
    referer.search = "";
    referer.hash = "";
    request.setHeader("Referer", referer.toString());

    let buffer = "";
    let settled = false;
    let lastDataAt = Date.now();
    let finish = (err?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      activeStreams.delete(partition);
      clearInterval(watchdog);
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    };
    let watchdog = setInterval(() => {
      if (Date.now() - lastDataAt > kStreamIdleTimeoutMs) {
        request.abort();
        finish(new Error(`PendingNotificationRequest idle for ${kStreamIdleTimeoutMs}ms`));
      }
    }, 10_000);

    request.on("response", response => {
      lastDataAt = Date.now();
      logOWADiagnostic(`request=PendingNotificationRequest method=GET status=${response.statusCode} contentType=${response.headers["content-type"] ?? ""}`);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        let err = new Error(`PendingNotificationRequest stream failed with HTTP ${response.statusCode} ${response.statusMessage}`);
        finish(err);
        return;
      }
      response.on("data", async chunk => {
        lastDataAt = Date.now();
        let chunkStr = chunk.toString("utf8");
        buffer += chunkStr;
        let matches = buffer.match(/<script(?:\s[^>]*)?>[\s\S]*?<\/script>/gi);
        logOWADiagnostic(`pendingChunk bytes=${chunk.length} scripts=${matches?.length ?? 0}`);
        if (matches) {
          let lastMatch = matches[matches.length - 1];
          let lastMatchEnd = buffer.lastIndexOf(lastMatch) + lastMatch.length;
          buffer = buffer.slice(lastMatchEnd);
          let messages: any[] = [];
          for (let match of matches) {
            let script = match.replace(/^<script(?:\s[^>]*)?>/i, "").replace(/<\/script>$/i, "").trim();
            let parsed = extractJsonFromScript(script);
            if (parsed === "alive" || script.includes("alive")) {
              // keep-alive heartbeat frame, stream is active
            } else if (parsed === "reinitSubscription" || script.includes("reinitSubscription")) {
              logOWADiagnostic("pendingFrame reinitSubscription");
              messages.push({ id: "reinitSubscription" });
            } else if (parsed != null) {
              logOWADiagnostic(`pendingFrame ${JSON.stringify(summarizeNotification(parsed))}`);
              messages.push(parsed);
            } else if (script.trim().length > 0) {
              logOWADiagnostic(`pendingScriptUnparsed len=${script.length} head=${JSON.stringify(script.slice(0, 500))}`);
            }
          }
          if (messages.length > 0) {
            try {
              await onMessage(messages);
            } catch {
            }
          }
        }
      });
      response.on("end", () => {
        finish();
      });
      response.on("error", err => {
        finish(err);
      });
    });

    request.on("error", err => {
      finish(err);
    });

    request.end();
  });
}

export async function fetchJSON(partition: string, url: string, options: any) {
  trackOWASession(partition, url);
  let result = {
    ok: false,
    status: 0,
    statusText: '',
    url: '',
    contentType: '',
    json: null as any,
    text: '',
    body: null as any,
  };
  let session = Session.fromPartition(partition);
  let canary = await getCanaryCookie(session);
  let requestOptions = options ?? { credentials: "include" };
  requestOptions.credentials ??= "include";
  if (options) {
    requestOptions.headers ??= {};
    if (canary) {
      requestOptions.headers[kCanaryName] = canary;
    }
  } else if (canary) {
    url += encodeURIComponent(canary);
  }
  let response = await session.fetch(url, requestOptions);
  let requestAction = requestOptions.headers?.Action ?? new URL(url).searchParams.get("action") ??
    new URL(url).searchParams.get("ev");
  if (requestAction == "FinishNotificationRequest" || requestAction == "SubscribeToNotification" || requestAction == "PendingNotificationRequest") {
    logOWADiagnostic(`request=${requestAction} method=${requestOptions.method ?? "GET"} status=${response.status} contentType=${response.headers.get("Content-Type") ?? ""}`);
  }
  if (requestAction == "SubscribeToNotification" && typeof requestOptions.body == "string") {
    try {
      let requestBody = JSON.parse(requestOptions.body);
      let subscriptions = Array.isArray(requestBody.subscriptionData) ? requestBody.subscriptionData : [];
      let rowSubscriptions = subscriptions.filter((item: any) => item?.Parameters?.NotificationType == "RowNotification");
      let folderKinds = [...new Set(rowSubscriptions.map((item: any) => typeof item?.Parameters?.FolderId))].join(",");
      let channelsPresent = rowSubscriptions.filter((item: any) => typeof item?.Parameters?.ChannelId == "string" && item.Parameters.ChannelId).length;
      let sampleSubId = rowSubscriptions[0]?.SubscriptionId ?? "";
      logOWADiagnostic(`subscribeRequest subscriptions=${subscriptions.length} rows=${rowSubscriptions.length} folderKinds=${folderKinds} channelsPresent=${channelsPresent} sampleSubId=${sampleSubId}`);
    } catch {
    }
  }
  result.ok = response.ok;
  result.status = response.status;
  result.statusText = response.statusText;
  result.url = response.url;
  result.contentType = response.headers.get('Content-Type');
  if (options) {
    result.text = await response.text();
    try {
      result.json = JSON.parse(result.text);
    } catch (ex) {
      let extracted = extractJsonFromHtmlOrScript(result.text);
      if (extracted != null) {
        result.json = extracted;
      } else {
        result.ok = false;
        result.statusText = ex.message;
      }
    }
    if (requestAction == "FinishNotificationRequest" && result.json) {
      logOWADiagnostic(`finishResponse keys=${Object.keys(result.json).join(",")} cid=${typeof result.json.cid == "string" ? result.json.cid : ""} fault=${typeof result.json.FaultMessage == "string" ? result.json.FaultMessage.slice(0, 180) : ""}`);
    }
    if (requestAction == "SubscribeToNotification" && result.json) {
      let responseBody = result.json.Body ?? result.json;
      let responseKeys = responseBody && typeof responseBody == "object" ? Object.keys(responseBody).join(",") : typeof responseBody;
      let responseMessageKeys = responseBody?.ResponseMessages?.Items?.map((item: any) => Object.keys(item).join(",")).join("|") ?? "";
      let responseItems = Array.isArray(responseBody) ? responseBody : responseBody?.Items ?? [];
      let responseSummary = responseItems.slice(0, 3).map((item: any) => ({
        keys: Object.keys(item ?? {}).join(","),
        responseClass: item?.ResponseClass ?? "",
        responseCode: item?.ResponseCode ?? "",
        subscriptionId: typeof item?.SubscriptionId == "string" ? item.SubscriptionId.startsWith("RowNotification") ? "row" : item.SubscriptionId : "",
        successfullyCreated: item?.SuccessfullyCreated ?? "",
        subscriptionExists: item?.SubscriptionExists ?? "",
        hasErrorInfo: !!item?.ErrorInfo,
        errorInfo: item?.ErrorInfo ? JSON.stringify(item.ErrorInfo).slice(0, 300) : "",
        messageText: typeof item?.MessageText == "string" ? item.MessageText.slice(0, 120) : "",
      }));
      logOWADiagnostic(`subscribeResponse keys=${responseKeys} responseMessageKeys=${responseMessageKeys} fault=${typeof responseBody?.FaultMessage == "string" ? responseBody.FaultMessage.slice(0, 180) : ""} exception=${typeof responseBody?.ExceptionName == "string" ? responseBody.ExceptionName : ""} items=${JSON.stringify(responseSummary)}`);
    }
  } else {
    result.body = response.body.pipeThrough(new TextDecoderStream());
  }
  return result;
}

/**
 * Fetches an HTTPS URL using a specific electron partition.
 * @param partition {string}
 * @param url       {string}
 * @param data?     {Dict<string>}
 *
 * TODO: Use options parameter, which can contain:
 * - body {Dict<string>|Buffer|string}
 * - cache {'default'|'no-store'|'reload'|'no-cache'|'force-cache'}
 * - credentials {'include'|'omit'|'same-origin'} [currently always 'include']
 * - headers {Dict<string>}
 * - method {string} [currently autodetects 'GET' or 'POST']
 * - origin {string}
 * - redirect {'follow'|'manual'|'error'} [currently always 'follow']
 * - result {'text'|'bytes'|'json'|'stream'} [currently always 'text']
 */
export async function fetchText(partition: string, url: string, data?: Dict<string>, redirectsLeft = 10) {
  //console.log("fetchText partition", partition, "URL", url, "Data", data);
  return new Promise((resolve, reject) => {
    let currentURL = url;
    let options = {
      method: data ? 'POST' : 'GET',
      url: url,
      partition: partition,
      credentials: 'include',
      redirect: 'manual',
    };
    let request = Net.request(options);
    let followed = false;
    let finish = (message: Electron.IncomingMessage, text: string) => {
      resolve({
        ok: (message.statusCode >= 200 && message.statusCode <= 299),
        status: message.statusCode,
        statusText: message.statusMessage,
        text,
        url: currentURL,
      });
    };
    request.on('response', message => {
      let locationHeader = message.headers.location;
      let location = Array.isArray(locationHeader) ? locationHeader[0] : locationHeader;
      if (!followed && [301, 302, 303, 307, 308].includes(message.statusCode) && location && redirectsLeft > 0) {
        let nextURL = new URL(location, currentURL).toString();
        let drain = [101, 204, 205, 304].includes(message.statusCode)
          ? Promise.resolve()
          : textFromStream(message).then(() => undefined).catch(() => undefined);
        drain.finally(() => {
          // After a login POST, follow the 302 with GET.
          fetchText(partition, nextURL, undefined, redirectsLeft - 1).then(resolve, reject);
        });
        return;
      }
      if ([101, 204, 205, 304].includes(message.statusCode)) {
        finish(message, '');
      } else {
        textFromStream(message).then(text => finish(message, text)).catch(reject);
      }
    });
    request.on('error', reject);
    request.on('redirect', (statusCode, method, redirectUrl, responseHeaders) => {
      followed = true;
      currentURL = redirectUrl;
      request.followRedirect();
    });
    request.setHeader('Accept', 'text/html,application/xhtml+xml');
    if (data) {
      request.setHeader('Content-Type', 'application/x-www-form-urlencoded');
    }
    request.end(data ? new URLSearchParams(data).toString() : '');
  });
}

export async function clearStorageData(partition: string) {
  delete scrapedAuth[partition];
  let session = Session.fromPartition(partition);
  session.webRequest.onSendHeaders(null);
  await session.clearStorageData();
}
