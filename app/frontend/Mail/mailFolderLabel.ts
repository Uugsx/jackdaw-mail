import type { Folder } from "../../logic/Mail/Folder";

const kPathSeparator = " › ";

/** Короткое имя папки письма для столбца «Папка» и подписи в результатах поиска */
export function mailFolderName(folder: Folder | null | undefined): string {
  return folder?.name ?? "";
}

/** Полный путь папки: «Входящие › Клиенты › DPD»; с несколькими ящиками — с именем ящика впереди */
export function mailFolderTitle(folder: Folder | null | undefined, withAccount = false): string {
  if (!folder) {
    return "";
  }
  let parts: string[] = [];
  for (let current: Folder | null = folder; current; current = current.parent) {
    parts.unshift(current.name ?? "");
  }
  let accountName = withAccount ? folder.account?.name : "";
  if (accountName) {
    parts.unshift(accountName);
  }
  return parts.filter(Boolean).join(kPathSeparator);
}

/** Ключ сортировки по папке: имя папки, затем ящик и полный путь — одинаковые имена не перемешиваются */
export function mailFolderSortKey(folder: Folder | null | undefined): string {
  if (!folder) {
    return "";
  }
  return [mailFolderName(folder), folder.account?.name ?? "", mailFolderTitle(folder)]
    .join("\u0000").toLowerCase();
}
