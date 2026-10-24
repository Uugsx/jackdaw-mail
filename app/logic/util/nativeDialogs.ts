/** Системные диалоги настольного приложения на языке интерфейса.
 * Electron рисует `confirm()`/`alert()` и свои окна с английскими кнопками «OK / Cancel»,
 * а основной процесс не знает выбранного в приложении языка: подписи передаёт рендерер. */
export const nativeDialogLabelsChannel = "jackdaw:native-dialog-labels";
export const nativeConfirmChannel = "jackdaw:native-confirm";

export type NativeDialogLabels = {
  ok: string;
  cancel: string;
  /** Закрытие окна во время звонка */
  callInProgress: string;
  callCloseDetail: string;
  endCallAndClose: string;
  stayInCall: string;
  /** Открытие программы или скрипта из вложения. `{name}` — имя файла. */
  executableTitle: string;
  executableDetail: string;
  openAnyway: string;
  showInFolder: string;
};

export type NativeConfirmRequest = {
  kind: "confirm" | "alert";
  message: string;
};

const kMaxLabelLength = 300;
const kMaxMessageLength = 4000;

export function isNativeDialogLabels(value: unknown): value is NativeDialogLabels {
  if (!value || typeof value != "object") {
    return false;
  }
  let labels = value as Record<string, unknown>;
  const keys: (keyof NativeDialogLabels)[] = ["ok", "cancel", "callInProgress", "callCloseDetail",
    "endCallAndClose", "stayInCall", "executableTitle", "executableDetail", "openAnyway", "showInFolder"];
  return keys.every(key => typeof labels[key] == "string" && !!(labels[key] as string).trim()
    && (labels[key] as string).length <= kMaxLabelLength);
}

export function isNativeConfirmRequest(value: unknown): value is NativeConfirmRequest {
  if (!value || typeof value != "object") {
    return false;
  }
  let request = value as Record<string, unknown>;
  return (request.kind == "confirm" || request.kind == "alert")
    && typeof request.message == "string" && request.message.length <= kMaxMessageLength;
}
