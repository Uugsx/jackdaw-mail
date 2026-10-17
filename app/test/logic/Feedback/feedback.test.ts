import { describe, expect, test, afterEach, vi } from "vitest";
import {
  detectPlatform,
  feedbackServiceURL,
  isValidContactEmail,
  kFeedbackMaxChars,
  sendFeedback,
  FeedbackError,
  deviceFingerprint,
} from "../../../logic/Feedback/Feedback";

function mockFetch(status: number, body: any) {
  let fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("feedbackServiceURL", () => {
  test("строится от сервиса лицензий и только по HTTPS", () => {
    expect(feedbackServiceURL("https://license.jackdaw-mail.pro")).toBe("https://license.jackdaw-mail.pro/v1/feedback");
    expect(feedbackServiceURL("https://license.jackdaw-mail.pro/some/path?x=1")).toBe("https://license.jackdaw-mail.pro/v1/feedback");
    expect(feedbackServiceURL("http://license.jackdaw-mail.pro")).toBeNull();
    expect(feedbackServiceURL("not a url")).toBeNull();
    expect(feedbackServiceURL(null)).toBeNull();
  });
});

describe("detectPlatform", () => {
  test("распознаёт основные платформы", () => {
    expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("macOS");
    expect(detectPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("Windows");
    expect(detectPlatform("Mozilla/5.0 (X11; Linux x86_64)")).toBe("Linux");
    expect(detectPlatform("Mozilla/5.0 (Linux; Android 14)")).toBe("Android");
    expect(detectPlatform("")).toBeUndefined();
  });
});

describe("isValidContactEmail", () => {
  test("принимает обычные адреса и отклоняет инъекции", () => {
    expect(isValidContactEmail("user@example.com")).toBe(true);
    expect(isValidContactEmail("no-at-sign")).toBe(false);
    expect(isValidContactEmail("a@b.c\r\nBcc: x@y.z")).toBe(false);
    expect(isValidContactEmail("a<b>@c.io")).toBe(false);
  });
});

describe("deviceFingerprint", () => {
  test("стабильный хеш, а не сам ID устройства", async () => {
    let first = await deviceFingerprint("device-12345678");
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toContain("device-12345678");
    expect(await deviceFingerprint("device-12345678")).toBe(first);
    expect(await deviceFingerprint("device-87654321")).not.toBe(first);
  });
});

describe("sendFeedback", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("отправляет только поля формы и возвращает номер", async () => {
    let fetchMock = mockFetch(202, { ok: true, id: "a1b2c3d4" });
    let id = await sendFeedback({ kind: "bug", message: "  Падает при открытии  ", contactEmail: "user@example.com", includeDiagnostics: false });
    expect(id).toBe("a1b2c3d4");
    let [url, init] = fetchMock.mock.calls[0] as any;
    expect(url).toMatch(/^https:\/\/.+\/v1\/feedback$/);
    expect(init.method).toBe("POST");
    let body = JSON.parse(init.body);
    expect(body.device).toMatch(/^[0-9a-f]{64}$/);
    delete body.device;
    expect(body).toEqual({ kind: "bug", message: "Падает при открытии", contactEmail: "user@example.com" });
  });

  test("прикладывает сведения о системе только по согласию", async () => {
    let fetchMock = mockFetch(202, { ok: true, id: "a1b2c3d4" });
    await sendFeedback({ kind: "idea", message: "Добавьте тёмную тему", includeDiagnostics: true }, "1.2.3-dev.20261017061649");
    let body = JSON.parse((fetchMock.mock.calls[0] as any)[1].body);
    expect(body.diagnostics.appVersion).toBe("1.2.3-dev.20261017061649");
    expect(body.contactEmail).toBeUndefined();
  });

  test("проверяет текст и адрес до отправки", async () => {
    let fetchMock = mockFetch(202, { ok: true, id: "a1b2c3d4" });
    await expect(sendFeedback({ kind: "bug", message: "ой", includeDiagnostics: false })).rejects.toMatchObject({ code: "message_too_short" });
    await expect(sendFeedback({ kind: "bug", message: "x".repeat(kFeedbackMaxChars + 1), includeDiagnostics: false })).rejects.toMatchObject({ code: "message_too_long" });
    await expect(sendFeedback({ kind: "bug", message: "Нормальный текст", contactEmail: "bad", includeDiagnostics: false })).rejects.toMatchObject({ code: "invalid_email" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("переводит отказ сервера в понятную ошибку", async () => {
    mockFetch(429, { ok: false, error: "rate_limited" });
    let error = await sendFeedback({ kind: "other", message: "Просто спасибо", includeDiagnostics: false }).catch(e => e);
    expect(error).toBeInstanceOf(FeedbackError);
    expect(error.code).toBe("rate_limited");
  });

  test("сетевую ошибку сообщает отдельно", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(sendFeedback({ kind: "other", message: "Просто спасибо", includeDiagnostics: false })).rejects.toMatchObject({ code: "network" });
  });

  test("не доверяет произвольному номеру из ответа", async () => {
    mockFetch(202, { ok: true, id: "<script>" });
    expect(await sendFeedback({ kind: "other", message: "Просто спасибо", includeDiagnostics: false })).toBe("");
  });
});
