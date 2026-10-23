import { OWARequest } from "../OWA/Request/OWARequest";

/** Автоответ «Нет на месте» (Out of Office) в Exchange. */
export type OutOfOfficeState = "Disabled" | "Enabled" | "Scheduled";
/** Кому за пределами организации отвечать: никому, только контактам или всем */
export type OutOfOfficeAudience = "None" | "Known" | "All";

export interface OutOfOfficeSettings {
  state: OutOfOfficeState;
  externalAudience: OutOfOfficeAudience;
  /** Начало и конец для `Scheduled` */
  start: Date | null;
  end: Date | null;
  /** HTML ответа для своей организации */
  internalReply: string;
  /** HTML ответа для внешних отправителей */
  externalReply: string;
  /** Что разрешил администратор для внешних ответов */
  allowExternal: OutOfOfficeAudience;
}

const kStates: OutOfOfficeState[] = ["Disabled", "Enabled", "Scheduled"];
const kAudiences: OutOfOfficeAudience[] = ["None", "Known", "All"];

export function newOutOfOfficeSettings(): OutOfOfficeSettings {
  return {
    state: "Disabled",
    externalAudience: "All",
    start: null,
    end: null,
    internalReply: "",
    externalReply: "",
    allowExternal: "All",
  };
}

/** Автоответ сейчас отправляется: включён или действует расписание */
export function isOutOfOfficeActive(settings: OutOfOfficeSettings | null, now = new Date()): boolean {
  if (!settings) {
    return false;
  }
  if (settings.state == "Enabled") {
    return true;
  }
  if (settings.state != "Scheduled" || !settings.start || !settings.end) {
    return false;
  }
  return settings.start <= now && now < settings.end;
}

/** Текст из поля ввода → HTML для сервера. Разметку пользователя не толкуем. */
export function outOfOfficeTextToHTML(text: string): string {
  if (!text?.trim()) {
    return "";
  }
  let escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\r?\n/g, "<br>");
  return `<html><body><div>${escaped}</div></body></html>`;
}

/** HTML с сервера → текст для поля ввода */
export function outOfOfficeHTMLToText(html: string): string {
  if (!html) {
    return "";
  }
  if (!/<[a-z!/][\s\S]*>/i.test(html)) {
    return html;
  }
  let doc = new DOMParser().parseFromString(html, "text/html");
  for (let hidden of doc.querySelectorAll("style, script, head, title")) {
    hidden.remove();
  }
  for (let br of doc.querySelectorAll("br")) {
    br.replaceWith("\n");
  }
  for (let block of doc.querySelectorAll("p, div, li, tr, h1, h2, h3, h4, h5, h6")) {
    block.append("\n");
  }
  return (doc.body?.textContent ?? "")
    .replace(/ /g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Дата Exchange: ISO-строка (без зоны — это UTC, мы шлём `TimeZoneContext` UTC) или `/Date(ms)/` */
export function parseExchangeDate(value: any): Date | null {
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }
  if (typeof value != "string" || !value.trim()) {
    return null;
  }
  let msDate = /^\/Date\((-?\d+)/.exec(value);
  if (msDate) {
    return new Date(Number(msDate[1]));
  }
  let iso = value.trim();
  if (/T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(iso)) {
    iso += "Z";
  }
  let date = new Date(iso);
  return isNaN(date.getTime()) ? null : date;
}

function exchangeDateString(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function textValue(value: any): string {
  if (value == null) {
    return "";
  }
  if (typeof value == "object") {
    // XML2JSON: элемент с атрибутами кладёт текст в `Value`
    return textValue(value.Value ?? value.Message ?? "");
  }
  return String(value);
}

function enumValue<T extends string>(value: any, allowed: T[], fallback: T): T {
  let text = textValue(value).trim().toLowerCase();
  return allowed.find(entry => entry.toLowerCase() == text) ?? fallback;
}

/**
 * Разбирает `OofSettings` из ответа `GetUserOofSettings`.
 * Подходит и для EWS (XML2JSON), и для OWA (JSON): поля называются одинаково.
 */
export function parseOutOfOfficeResponse(response: any): OutOfOfficeSettings {
  let body = response?.Body ?? response;
  let oof = body?.OofSettings ?? body?.UserOofSettings;
  if (!oof || typeof oof != "object") {
    throw new Error("GetUserOofSettings: no OofSettings in the response");
  }
  return {
    state: enumValue(oof.OofState, kStates, "Disabled"),
    externalAudience: enumValue(oof.ExternalAudience, kAudiences, "None"),
    start: parseExchangeDate(textValue(oof.Duration?.StartTime)),
    end: parseExchangeDate(textValue(oof.Duration?.EndTime)),
    internalReply: textValue(oof.InternalReply?.Message ?? oof.InternalReply),
    externalReply: textValue(oof.ExternalReply?.Message ?? oof.ExternalReply),
    allowExternal: enumValue(body.AllowExternalOof, kAudiences, "All"),
  };
}

/** Ошибку `GetUserOofSettings`/`SetUserOofSettings` сервер кладёт во вложенный `ResponseMessage` */
export function checkOutOfOfficeResponse(response: any): void {
  let message = (response?.Body ?? response)?.ResponseMessage;
  if (textValue(message?.ResponseClass) == "Error") {
    let error = new Error(textValue(message.MessageText) || textValue(message.ResponseCode) || "Out of Office request failed");
    (error as any).code = textValue(message.ResponseCode);
    throw error;
  }
}

function checkSchedule(settings: OutOfOfficeSettings): void {
  if (settings.state == "Scheduled" && (!settings.start || !settings.end || settings.start >= settings.end)) {
    throw new RangeError("Out of Office: the end must be after the start");
  }
}

export function ewsGetOutOfOfficeRequest(emailAddress: string) {
  return {
    m$GetUserOofSettingsRequest: {
      t$Mailbox: {
        t$Address: emailAddress,
      },
    },
  };
}

export function ewsSetOutOfOfficeRequest(emailAddress: string, settings: OutOfOfficeSettings) {
  checkSchedule(settings);
  // Порядок элементов задан схемой EWS
  let oof: Record<string, any> = {
    t$OofState: settings.state,
    t$ExternalAudience: settings.externalAudience,
  };
  if (settings.start && settings.end && settings.start < settings.end) {
    oof.t$Duration = {
      t$StartTime: exchangeDateString(settings.start),
      t$EndTime: exchangeDateString(settings.end),
    };
  }
  oof.t$InternalReply = { t$Message: settings.internalReply ?? "" };
  oof.t$ExternalReply = { t$Message: settings.externalReply ?? "" };
  return {
    m$SetUserOofSettingsRequest: {
      t$Mailbox: {
        t$Address: emailAddress,
      },
      t$UserOofSettings: oof,
    },
  };
}

export function owaGetOutOfOfficeRequest(emailAddress: string): OWARequest {
  return new OWARequest("GetUserOofSettings", {
    __type: "GetUserOofSettingsRequest:#Exchange",
    Mailbox: {
      __type: "EmailAddress:#Exchange",
      Address: emailAddress,
    },
  });
}

export function owaSetOutOfOfficeRequest(emailAddress: string, settings: OutOfOfficeSettings): OWARequest {
  checkSchedule(settings);
  let oof: Record<string, any> = {
    __type: "UserOofSettings:#Exchange",
    OofState: settings.state,
    ExternalAudience: settings.externalAudience,
  };
  if (settings.start && settings.end && settings.start < settings.end) {
    oof.Duration = {
      __type: "Duration:#Exchange",
      StartTime: exchangeDateString(settings.start),
      EndTime: exchangeDateString(settings.end),
    };
  }
  oof.InternalReply = {
    __type: "ReplyBody:#Exchange",
    Message: settings.internalReply ?? "",
  };
  oof.ExternalReply = {
    __type: "ReplyBody:#Exchange",
    Message: settings.externalReply ?? "",
  };
  return new OWARequest("SetUserOofSettings", {
    __type: "SetUserOofSettingsRequest:#Exchange",
    Mailbox: {
      __type: "EmailAddress:#Exchange",
      Address: emailAddress,
    },
    UserOofSettings: oof,
  });
}
