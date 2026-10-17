import { Directory } from "../../logic/Files/Directory";
import type { FileOrDirectory } from "../../logic/Files/FileOrDirectory";
import { gt } from "../../l10n/l10n";

/** Подтверждение удаления на сервере: корзины у WebDAV обычно нет,
 * а папка удаляется вместе со всем содержимым. */
export function confirmDeleteFileOrFolder(item: FileOrDirectory): boolean {
  let name = item?.name ?? "";
  let question = item instanceof Directory
    ? gt`Delete the folder "${name}" with all its contents from the server? This cannot be undone.`
    : gt`Delete the file "${name}" from the server? This cannot be undone.`;
  return confirm(question);
}
