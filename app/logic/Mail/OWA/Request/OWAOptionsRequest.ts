/**
 * Команды настроек OWA (как PowerShell `Get-InboxRule`, `Set-InboxRule` и т. п.).
 * В отличие от `OWARequest`, у них нет `Body`: параметры лежат рядом с `Header`.
 * Сервер меняет только те параметры, которые мы прислали.
 */
export class OWAOptionsRequest {
  [Symbol.toStringTag]: string;
  readonly __type: string;
  readonly Header = {
    __type: "JsonRequestHeaders:#Exchange",
    RequestServerVersion: "Exchange2013",
  };

  constructor(action: string, parameters?: Record<string, any>) {
    this[Symbol.toStringTag] = action;
    this.__type = action + "Request:#Exchange";
    Object.assign(this, parameters);
  }

  get action() {
    return this[Symbol.toStringTag];
  }
}
