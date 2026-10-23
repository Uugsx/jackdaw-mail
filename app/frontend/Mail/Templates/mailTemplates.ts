import { mount, unmount } from "svelte";
import type { Editor } from "@tiptap/core";
import type { EMail } from "../../../logic/Mail/EMail";
import { ContentDisposition } from "../../../logic/Abstract/Attachment";
import type { ComposeWindowAttachment } from "../../../logic/Mail/Composer/ComposeWindowProtocol";
import {
  inlineImageDataURLs, kMaxTemplateBytes, newTemplateAttachments, subjectAfterTemplate,
  templateBodyFromEditor, type MailTemplate, type MailTemplateSummary,
} from "../../../logic/Mail/Templates/MailTemplate";
import {
  getMailTemplate, insertMailTemplate, listMailTemplates, markMailTemplateUsed,
  MailTemplateTooLargeError, updateMailTemplate,
} from "../../../logic/Mail/Templates/MailTemplateData";
import { addComposeAttachment, serializeAttachment } from "../Composer/composeWindow";
import SaveTemplateDialog from "./SaveTemplateDialog.svelte";
import { Notification, NotificationSeverity, notifications } from "../../MainWindow/Notification";
import { base64ToUint8Array, UserError } from "../../../logic/util/util";
import { backgroundError } from "../../Util/error";
import { gt } from "../../../l10n/l10n";

const kSavedNoticeSeconds = 4;

export interface SaveTemplateChoice {
  name: string;
  includeAttachments: boolean;
  /** Заменить шаблон с тем же названием */
  replaceID: number | null;
}

/** Вложения, которые человек прикрепил сам: без встроенных картинок и служебных частей */
export function userAttachments(mail: EMail) {
  return mail.attachments.contents.filter(attachment => !attachment.hidden && !attachment.related);
}

/** Спрашивает название шаблона. null — отменили. */
export function askTemplateName(initialName: string, existing: MailTemplateSummary[], attachmentCount: number): Promise<SaveTemplateChoice | null> {
  return new Promise(resolve => {
    let target = document.createElement("div");
    document.body.append(target);
    let instance: ReturnType<typeof mount> | null = null;
    let done = (choice: SaveTemplateChoice | null) => {
      if (instance) {
        void unmount(instance);
        instance = null;
      }
      target.remove();
      resolve(choice);
    };
    instance = mount(SaveTemplateDialog, {
      target,
      props: { initialName, existing, attachmentCount, onDone: done },
    });
  });
}

function tooLargeError(): UserError {
  return new UserError(gt`The template is larger than ${Math.round(kMaxTemplateBytes / 1_000_000)} MB. Remove some attachments or images and try again.`);
}

/**
 * Сохраняет письмо из редактора как шаблон.
 * @param editorHTML тело из редактора, без цитаты исходного письма
 * @returns false — человек отменил
 */
export async function saveComposeAsTemplate(mail: EMail, editorHTML: string, initialName: string): Promise<boolean> {
  let existing = await listMailTemplates();
  let attachments = userAttachments(mail);
  let choice = await askTemplateName(initialName, existing, attachments.length);
  if (!choice) {
    return false;
  }
  let serialized: ComposeWindowAttachment[] = [];
  if (choice.includeAttachments) {
    try {
      for (let attachment of attachments) {
        serialized.push(await serializeAttachment(attachment, true));
      }
    } catch (ex) {
      backgroundError(ex);
      throw tooLargeError();
    }
  }
  let content = {
    name: choice.name,
    subject: mail.subject ?? "",
    html: templateBodyFromEditor(editorHTML),
    attachments: serialized.filter(attachment => attachment.contentBase64 != null || attachment.filepathLocal),
  };
  try {
    if (choice.replaceID == null || !await updateMailTemplate(choice.replaceID, content)) {
      await insertMailTemplate(content);
    }
  } catch (ex) {
    if (ex instanceof MailTemplateTooLargeError) {
      throw tooLargeError();
    }
    throw ex;
  }
  let notice = new Notification(gt`Template “${content.name}” saved`, NotificationSeverity.Info);
  notifications.add(notice);
  setTimeout(() => notifications.remove(notice), kSavedNoticeSeconds * 1000);
  return true;
}

function dataURLToFile(url: string, index: number): File | null {
  let match = url.match(/^data:(image\/[\w.+-]+);base64,(.*)$/s);
  if (!match) {
    return null;
  }
  let extension = match[1].split("/")[1].replace("svg+xml", "svg").replace("jpeg", "jpg");
  return new File([base64ToUint8Array(match[2])], `image-${index + 1}.${extension}`, { type: match[1] });
}

/** Встроенные картинки шаблона становятся вложениями письма, как при вставке картинки */
function addInlineImages(mail: EMail, html: string) {
  let present = new Set(mail.attachments.contents.map(attachment => attachment.dataURL).filter(Boolean));
  inlineImageDataURLs(html).forEach((url, index) => {
    if (present.has(url)) {
      return;
    }
    let file = dataURLToFile(url, index);
    if (!file) {
      return;
    }
    let attachment = mail.newAttachment();
    attachment.fromFile(file);
    attachment.disposition = ContentDisposition.inline;
    attachment.related = true;
    attachment.dataURL = url;
    mail.attachments.add(attachment);
  });
}

/**
 * Вставляет шаблон в письмо: тело — в место курсора, тема — только в пустую,
 * вложения — те, которых в письме ещё нет.
 */
export function applyTemplateToCompose(mail: EMail, editor: Editor, template: MailTemplate) {
  mail.subject = subjectAfterTemplate(mail.subject, template.subject);
  if (template.html) {
    editor.chain().focus().insertContent(template.html).run();
    addInlineImages(mail, template.html);
  }
  for (let item of newTemplateAttachments(template.attachments, mail.attachments.contents)) {
    addComposeAttachment(mail, item);
  }
  void markMailTemplateUsed(template.id).catch(backgroundError);
}

export async function loadTemplateForInsert(id: number): Promise<MailTemplate> {
  let template = await getMailTemplate(id);
  if (!template) {
    throw new UserError(gt`This template no longer exists.`);
  }
  return template;
}
