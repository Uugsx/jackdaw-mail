import type { Editor } from "@tiptap/core";
import type { Message } from "../../../logic/Abstract/Message";
import { Attachment, ContentDisposition } from "../../../logic/Abstract/Attachment";
import { blobToDataURL } from "../../../logic/util/util";

const kDefaultInsertedImageWidth = 192;
const kMinimumInsertedImageWidth = 1;
const kMaximumInsertedImageWidth = 1024;
const kInsertedImageWrapperStyle = "display: block; margin: 0;";

type InsertedImageAttributes = {
  src: string;
  alt: string;
  width: number;
  containerStyle: string;
  wrapperStyle: string;
};

type HorizontalScrollPosition = {
  element: HTMLElement;
  left: number;
};

function captureHorizontalScroll(editor: Editor): HorizontalScrollPosition[] {
  let positions: HorizontalScrollPosition[] = [];
  let element: HTMLElement | null = editor.view.dom as HTMLElement;
  while (element) {
    if (typeof element.scrollLeft == "number") {
      positions.push({ element, left: element.scrollLeft });
    }
    element = element.parentElement;
  }
  return positions;
}

function restoreHorizontalScroll(positions: HorizontalScrollPosition[]): void {
  for (let { element, left } of positions) {
    element.scrollLeft = left;
  }
}

function restoreHorizontalScrollAfterLayout(positions: HorizontalScrollPosition[]): void {
  restoreHorizontalScroll(positions);
  if (typeof requestAnimationFrame == "function") {
    requestAnimationFrame(() => {
      restoreHorizontalScroll(positions);
      requestAnimationFrame(() => restoreHorizontalScroll(positions));
    });
  }
}

export async function insertImage(
  editor: Editor,
  file: File,
  message: Message,
  displayWidth = kDefaultInsertedImageWidth,
  maximumDisplayWidth = kMaximumInsertedImageWidth,
) {
  // let url = URL.createObjectURL(file);
  let url = await blobToDataURL(file);
  let horizontalScroll = captureHorizontalScroll(editor);
  // TipTap удаляет blob-URL из image-узлов, поэтому сохраняем data URL в редакторе.
  const maximumWidth = Number.isFinite(maximumDisplayWidth)
    ? Math.max(kMinimumInsertedImageWidth, Math.round(maximumDisplayWidth))
    : kMaximumInsertedImageWidth;
  const width = Number.isFinite(displayWidth)
    ? Math.min(maximumWidth, Math.max(kMinimumInsertedImageWidth, Math.round(displayWidth)))
    : kDefaultInsertedImageWidth;
  // Расширение resize строит изображение как wrapper > container > img. Задаём
  // контейнеру фактическую ширину вставки без max-width: 100%: это сохраняет
  // размер изображения при изменении ширины окна редактора.
  // ImageResize заменяет базовый image-узел на `imageResize`. Его команда
  // setImage использует фактическое имя узла расширения и сохраняет атрибуты
  // изменения размера. Жёстко заданный JSON-узел `image` может считаться
  // успешно вставленным, хотя ProseMirror отбросит его как неизвестный узел.
  let inserted = editor.chain().setImage({
    src: url,
    alt: file.name,
    width,
    containerStyle: `width: ${width}px; height: auto;`,
    wrapperStyle: kInsertedImageWrapperStyle,
  } as InsertedImageAttributes)
    .run();
  if (!inserted) {
    throw new Error("Could not insert the image into the editor");
  }
  // Команда focus в TipTap всё равно вызывает нативный focus. После этого
  // Chromium прокручивает ближайший горизонтальный контейнер к изображению,
  // и левый отступ редактора визуально исчезает. Оставляем редактор в фокусе,
  // явно запрещая браузеру прокручивать контейнер.
  editor.view.dom.focus({ preventScroll: true });
  // При отправке или сохранении изображение нужно преобразовать в обычное
  // вложение и cid-URL.
  let attachment = message.newAttachment();
  attachment.fromFile(file);
  attachment.disposition = ContentDisposition.inline;
  attachment.related = true;
  // attachment.blobURL = url;
  attachment.dataURL = url;
  message.attachments.add(attachment);
  restoreHorizontalScrollAfterLayout(horizontalScroll);
}

/** Удаляет все встроенные изображения, созданные из выбранного вложения. */
export function removeImageForAttachment(editor: Editor | undefined, attachment: Attachment): boolean {
  if (!editor || !attachment) {
    return false;
  }
  let positions: number[] = [];
  editor.state.doc.descendants((node, position) => {
    if (isImageNode(node) && imageBelongsToAttachment(node.attrs?.src, attachment)) {
      positions.push(position);
    }
    return true;
  });
  if (!positions.length) {
    return false;
  }

  // Удаляем с конца, чтобы позиции документа оставались корректными.
  let transaction = editor.state.tr;
  for (let position of positions.reverse()) {
    let node = editor.state.doc.nodeAt(position);
    if (node) {
      transaction.delete(position, position + node.nodeSize);
    }
  }
  editor.view.dispatch(transaction);
  return true;
}

/** Удаляет встроенные вложения, чьи data URL больше нет в редакторе. */
export function removeOrphanedInlineAttachments(editor: Editor | undefined, message: Message): void {
  if (!editor || !message) {
    return;
  }
  let imageSources = new Set<string>();
  editor.state.doc.descendants(node => {
    if (isImageNode(node) && typeof node.attrs?.src == "string") {
      imageSources.add(node.attrs.src);
    }
    return true;
  });
  for (let attachment of message.attachments.contents.slice()) {
    if (attachment.disposition == ContentDisposition.inline &&
        attachment.related && attachment.dataURL &&
        ![...imageSources].some(src => imageBelongsToAttachment(src, attachment))) {
      message.attachments.remove(attachment);
    }
  }
}

function isImageNode(node: { type?: { name?: string } }): boolean {
  return node.type?.name == "imageResize" || node.type?.name == "image";
}

function imageBelongsToAttachment(src: unknown, attachment: Attachment): boolean {
  if (typeof src != "string") {
    return false;
  }
  if (src == attachment.dataURL) {
    return true;
  }
  let contentID = attachment.contentID?.replace(/^<|>$/g, "");
  return !!contentID && (src == `cid:${contentID}` || src == contentID);
}

export function isImageMimetype(type: string) {
  return type == "image/png" ||
    type == "image/jpeg" ||
    type == "image/gif";
}
