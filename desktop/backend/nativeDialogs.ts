import { app, BrowserWindow, dialog, ipcMain, type MessageBoxSyncOptions } from "electron";
import {
  isNativeConfirmRequest,
  isNativeDialogLabels,
  nativeConfirmChannel,
  nativeDialogLabelsChannel,
  type NativeDialogLabels,
} from "../../app/logic/util/nativeDialogs";

/** Подписи системных диалогов на языке интерфейса. До первой передачи из рендерера —
 * русский или английский по языку системы, как было раньше. */
function systemLanguageLabels(): NativeDialogLabels {
  const russian = app.getLocale().toLowerCase().startsWith("ru");
  return russian
    ? {
      ok: "OK",
      cancel: "Отмена",
      callInProgress: "Идёт звонок.",
      callCloseDetail: "Если закрыть окно, звонок завершится.",
      endCallAndClose: "Завершить звонок и закрыть",
      stayInCall: "Остаться в звонке",
      executableTitle: "«{name}» — программа или скрипт",
      executableDetail: "При открытии файл запустится на этом компьютере. Открывайте его, только если ждали этот файл и доверяете отправителю.",
      openAnyway: "Всё равно открыть",
      showInFolder: "Показать в папке",
    }
    : {
      ok: "OK",
      cancel: "Cancel",
      callInProgress: "A call is in progress.",
      callCloseDetail: "Closing the window will end the call.",
      endCallAndClose: "End call and close",
      stayInCall: "Stay in call",
      executableTitle: "\"{name}\" is a program or script",
      executableDetail: "Opening it runs it on this computer. Open it only if you expected this file and trust the sender.",
      openAnyway: "Open anyway",
      showInFolder: "Show in folder",
    };
}

let currentLabels: NativeDialogLabels | null = null;

export function nativeDialogLabels(): NativeDialogLabels {
  return currentLabels ?? systemLanguageLabels();
}

/** Принимает подписи от рендерера и показывает его `confirm()`/`alert()` с переведёнными кнопками. */
export function registerNativeDialogHandlers(): void {
  ipcMain.on(nativeDialogLabelsChannel, (_event, labels: unknown) => {
    if (isNativeDialogLabels(labels)) {
      currentLabels = labels;
    }
  });
  ipcMain.on(nativeConfirmChannel, (event, request: unknown) => {
    if (!isNativeConfirmRequest(request)) {
      event.returnValue = false;
      return;
    }
    const labels = nativeDialogLabels();
    const confirm = request.kind == "confirm";
    const options: MessageBoxSyncOptions = {
      type: confirm ? "question" : "info",
      message: request.message,
      buttons: confirm ? [labels.ok, labels.cancel] : [labels.ok],
      defaultId: 0,
      cancelId: confirm ? 1 : 0,
      noLink: true,
      title: "Jackdaw Mail",
    };
    const parent = BrowserWindow.fromWebContents(event.sender);
    const response = parent
      ? dialog.showMessageBoxSync(parent, options)
      : dialog.showMessageBoxSync(options);
    event.returnValue = confirm ? response == 0 : true;
  });
}
