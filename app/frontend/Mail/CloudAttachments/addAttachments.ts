import type { EMail } from "../../../logic/Mail/EMail";
import type { Editor } from "@tiptap/core";
import { addFilesAsAttachments } from "../../../logic/Abstract/Attachment";
import {
  cloudAccountsForAttachments, cloudLinksHTML, cloudThresholdBytes, isTooBigToAttach, uploadCloudAttachment, type CloudLink,
} from "../../../logic/Mail/CloudAttachments/CloudAttachments";
import { showConfirmDialog } from "../../Shared/askConfirm";
import { fileSize } from "../../Files/file";
import { showError } from "../../Util/error";
import { gt } from "../../../l10n/l10n";

/**
 * Добавляет файлы к письму. Слишком большие, если подключено облако, Outlook предлагает
 * отправить ссылкой — так и здесь: «Отправить ссылку» загружает файл и вставляет ссылку в текст,
 * «Прикрепить» оставляет обычное вложение.
 */
export async function addAttachmentsOrCloudLinks(mail: EMail, files: File[], editor: Editor | null): Promise<void> {
  let threshold = cloudThresholdBytes();
  let big = files.filter(file => isTooBigToAttach(file.size, threshold));
  let account = big.length && editor ? cloudAccountsForAttachments()[0] : undefined;
  if (!account) {
    addFilesAsAttachments(mail, files);
    return;
  }
  let names = big.map(file => `${file.name} (${fileSize(file.size)})`).join(", ");
  let choice = await showConfirmDialog({
    title: big.length == 1 ? gt`Send a link instead of the file?` : gt`Send links instead of the files?`,
    message: gt`${names} is larger than ${fileSize(threshold)}. Many mail servers reject such messages. Upload to ${account.name} and insert a link into the message instead?`,
    confirmLabel: gt`Send link`,
    cancelLabel: gt`Attach file`,
  });
  if (choice != "confirm") {
    addFilesAsAttachments(mail, files);
    return;
  }
  addFilesAsAttachments(mail, files.filter(file => !big.includes(file)));
  let links: CloudLink[] = [];
  for (let file of big) {
    try {
      links.push(await uploadCloudAttachment(account, file, file.name));
    } catch (ex) {
      // Загрузить не вышло — файл всё равно не должен потеряться
      showError(ex);
      addFilesAsAttachments(mail, [file]);
    }
  }
  if (links.length) {
    editor.chain().focus("end").insertContent(cloudLinksHTML(links, fileSize)).run();
  }
}
