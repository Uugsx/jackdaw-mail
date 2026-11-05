import type { NativeConfirmRequest, NativeDialogLabels } from "../../logic/util/nativeDialogs";
import { gt, locale } from "../../l10n/l10n";

type NativeDialogAPI = {
  setNativeDialogLabels?: (labels: NativeDialogLabels) => void;
  showNativeConfirm?: (request: NativeConfirmRequest) => boolean;
};

function nativeDialogAPI(): NativeDialogAPI | undefined {
  return (globalThis as typeof globalThis & { api?: NativeDialogAPI }).api;
}

/** Имя файла подставляет основной процесс: в рендерере его ещё нет */
const kFileNamePlaceholder = "{name}";

/** Подписи системных диалогов основного процесса на текущем языке интерфейса */
export function nativeDialogLabelsForLocale(): NativeDialogLabels {
  return {
    ok: gt`OK`,
    cancel: gt`Cancel`,
    callInProgress: gt`A call is in progress.`,
    callCloseDetail: gt`Closing the window will end the call.`,
    endCallAndClose: gt`End call and close`,
    stayInCall: gt`Stay in call`,
    executableTitle: gt`"${kFileNamePlaceholder}" is a program or script`,
    executableDetail: gt`Opening it runs it on this computer. Open it only if you expected this file and trust the sender.`,
    openAnyway: gt`Open anyway`,
    showInFolder: gt`Show in folder`,
  };
}

/**
 * В настольном приложении `confirm()` и `alert()` показываются с кнопками на языке интерфейса:
 * Electron сам подписывает их по-английски («OK / Cancel»). Подписи окон основного процесса
 * (закрытие окна во время звонка, запуск программы из вложения) обновляются при смене языка.
 */
export function installNativeDialogs(): void {
  let api = nativeDialogAPI();
  if (typeof api?.setNativeDialogLabels == "function") {
    locale.subscribe(() => api.setNativeDialogLabels(nativeDialogLabelsForLocale()));
  }
  if (typeof api?.showNativeConfirm != "function") {
    return;
  }
  window.confirm = (message?: string) => api.showNativeConfirm({ kind: "confirm", message: String(message ?? "") });
  window.alert = (message?: unknown) => {
    api.showNativeConfirm({ kind: "alert", message: String(message ?? "") });
  };
}
