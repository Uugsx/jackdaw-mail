import { UserError } from "../../util/util";
import { gt } from "../../../l10n/l10n";

/** MOVE/COPY без перезаписи: по умолчанию WebDAV шлёт `Overwrite: T`
 * и молча заменяет одноимённый файл в целевой папке. */
export const kNoOverwrite = { overwrite: false } as const;

/** Выполняет MOVE/COPY и превращает ответ 412 (цель уже существует)
 * в понятную пользователю ошибку. */
export async function runWithoutOverwrite(operation: () => Promise<void>): Promise<void> {
  try {
    await operation();
  } catch (ex) {
    if (isTargetExistsError(ex)) {
      throw new UserError(gt`A file or folder with this name already exists`);
    }
    throw ex;
  }
}

export function isTargetExistsError(ex: any): boolean {
  return ex?.status == 412 || ex?.response?.status == 412 ||
    /\b412\b/.test(String(ex?.message ?? ""));
}
