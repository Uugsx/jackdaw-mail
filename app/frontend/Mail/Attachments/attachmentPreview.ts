import type { Attachment } from "../../../logic/Abstract/Attachment";
import { docxToHTML } from "../../../logic/Files/FileType/MSWord";
import { odtToHTML } from "../../../logic/Files/FileType/ODT";
import { xlsxToHTML } from "../../../logic/Files/FileType/MSExcel";
import { escapeHTML } from "../../../logic/Files/FileType/htmlHelper";
import AttachmentPreview from "./AttachmentPreview.svelte";
import { mount, unmount } from "svelte";

/**
 * Предпросмотр вложения в приложении, как в Outlook: PDF, Word, Excel, OpenDocument,
 * текст и картинки — без внешних программ. HTML и SVG сюда не входят: в них может быть скрипт.
 */
export type PreviewKind = "pdf" | "image" | "document" | "text";

const kImageExt = ["png", "gif", "jpg", "jpeg", "jpe", "webp", "bmp"];
/** Для файлов без расширения, например картинки из буфера обмена в чате */
const kImageMIMETypes = ["image/png", "image/gif", "image/jpeg", "image/webp", "image/bmp"];
const kDocumentExt = ["docx", "odt", "xlsx"];
const kTextExt = ["txt", "md", "csv", "log"];

export function previewKind(filename: string | null | undefined, mimeType?: string | null): PreviewKind | null {
  let ext = (filename ?? "").split(".").pop().toLowerCase();
  if (ext == "pdf" || mimeType == "application/pdf") {
    return "pdf";
  }
  if (kImageExt.includes(ext) || kImageMIMETypes.includes(mimeType?.toLowerCase())) {
    return "image";
  }
  if (kDocumentExt.includes(ext)) {
    return "document";
  }
  if (kTextExt.includes(ext) || mimeType == "text/plain") {
    return "text";
  }
  return null;
}

export function canPreviewAttachment(attachment: Attachment): boolean {
  return !!previewKind(attachment.filename, attachment.mimeType);
}

const kDocumentStyle = `<style>
  body { font: 14px system-ui, -apple-system, "Segoe UI", sans-serif; margin: 24px; color: #111; background: #fff; }
  table { border-collapse: collapse; margin-bottom: 16px; }
  td, th { border: 1px solid #ccc; padding: 2px 6px; vertical-align: top; white-space: pre-wrap; }
  h2 { font-size: 15px; margin: 16px 0 8px; }
  pre { white-space: pre-wrap; word-break: break-word; font: 13px ui-monospace, Menlo, monospace; }
</style>`;

/** HTML для документа или текста; показывается в iframe без скриптов */
export async function previewHTML(kind: PreviewKind, filename: string, content: Blob): Promise<string> {
  let ext = filename.split(".").pop().toLowerCase();
  let body: string;
  if (kind == "text") {
    body = `<pre>${escapeHTML(await content.text())}</pre>`;
  } else if (ext == "docx") {
    body = await docxToHTML(content);
  } else if (ext == "odt") {
    body = await odtToHTML(content);
  } else {
    body = await xlsxToHTML(content);
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8">${kDocumentStyle}</head><body>${body}</body></html>`;
}

/** Байты вложения: из письма, с диска или уже в памяти. Без байтов — `content` пуст. */
export async function loadAttachmentContent(attachment: Attachment): Promise<Attachment> {
  let loaded = await attachment.load();
  if (!loaded.content && loaded.storage) {
    await loaded.read(); // файл чата уже на диске
  }
  return loaded;
}

/** Картинки того же письма или сообщения чата, между которыми листает просмотр.
 * Скрытые (cid-картинки текста письма, подписи) не входят, открытая входит всегда. */
export function imageGallery(attachment: Attachment): Attachment[] {
  if (previewKind(attachment.filename, attachment.mimeType) != "image") {
    return [attachment];
  }
  let all = attachment.message?.attachments?.contents ?? [];
  let images = all.filter(other => other == attachment ||
    (!other.hidden && previewKind(other.filename, other.mimeType) == "image"));
  return images.includes(attachment) ? images : [attachment];
}

/** Открывает окно предпросмотра над приложением.
 * @param gallery Вложения, между которыми можно листать; по умолчанию — картинки того же сообщения */
export async function previewAttachment(attachment: Attachment, gallery?: Attachment[]): Promise<void> {
  let loaded = await loadAttachmentContent(attachment);
  let kind = previewKind(loaded.filename, loaded.mimeType);
  if (!kind || !loaded.content) {
    await loaded.openOSApp();
    return;
  }
  gallery = (gallery ?? imageGallery(attachment)).map(item => item == attachment ? loaded : item);
  let dialog: Record<string, any>;
  dialog = mount(AttachmentPreview, {
    target: document.body,
    props: {
      attachment: loaded,
      kind,
      gallery,
      onClose: () => queueMicrotask(() => unmount(dialog)),
    },
  });
}
