/**
 * Облачные вложения, как в Outlook: большой файл не прикрепляется к письму, а загружается
 * в облако пользователя (Nextcloud, openCloud), и в текст письма вставляется ссылка на него.
 *
 * Облако — любое подключённое файловое хранилище, файлы которого умеют давать публичную
 * ссылку (`canShareLink`). Файлы ложатся в папку «Вложения почты» в корне хранилища.
 */
import type { FileSharingAccount } from "../../Files/FileSharingAccount";
import type { Directory } from "../../Files/Directory";
import type { File as CloudFile } from "../../Files/File";
import { appGlobal } from "../../app";
import { escapeAttr, escapeHTML } from "../../Files/FileType/htmlHelper";
import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
import { UserError } from "../../util/util";
import { gt } from "../../../l10n/l10n";

/** Порог в МБ: многие почтовые серверы (Exchange по умолчанию, Gmail) не принимают письма больше 20–25 МБ */
export const kCloudThresholdKey = "mail.cloudAttachments.thresholdMB";
export const kDefaultCloudThresholdMB = 20;
const kBytesPerMB = 1024 * 1024;

export function cloudThresholdBytes(): number {
  let value = Number(getLocalStorage<number>(kCloudThresholdKey, kDefaultCloudThresholdMB).value);
  return (Number.isFinite(value) && value > 0 ? value : kDefaultCloudThresholdMB) * kBytesPerMB;
}

/** Файл больше порога: предложить ссылку вместо вложения */
export function isTooBigToAttach(size: number, threshold = cloudThresholdBytes()): boolean {
  return size > threshold;
}

/** Корень хранилища, если файлы в нём умеют давать ссылку */
function shareableRoot(account: FileSharingAccount): Directory | null {
  let root = account.rootDirs.first;
  if (!root) {
    return null;
  }
  try {
    return root.newFile("probe").canShareLink ? root : null;
  } catch {
    return null;
  }
}

/** Хранилища, в которые можно загрузить вложение и получить ссылку */
export function cloudAccountsForAttachments(accounts: Iterable<FileSharingAccount> = appGlobal.fileSharingAccounts): FileSharingAccount[] {
  return [...accounts].filter(account => !!shareableRoot(account));
}

/** Имя, которого ещё нет среди `existing`: «отчёт.pdf» → «отчёт (2).pdf» */
export function uniqueFileName(name: string, existing: Iterable<string>): string {
  let taken = new Set([...existing].map(other => other.toLowerCase()));
  if (!taken.has(name.toLowerCase())) {
    return name;
  }
  let dot = name.lastIndexOf(".");
  let base = dot > 0 ? name.slice(0, dot) : name;
  let ext = dot > 0 ? name.slice(dot) : "";
  for (let i = 2; ; i++) {
    let candidate = `${base} (${i})${ext}`;
    if (!taken.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
}

export interface CloudLink {
  name: string;
  size: number;
  url: string;
}

/** Файл WebDAV-хранилища (Nextcloud, openCloud): умеет записать содержимое на сервер */
type UploadableFile = CloudFile & { saveContents(contents: Blob): Promise<void> };

async function attachmentsDirectory(root: Directory): Promise<Directory> {
  let name = gt`Email attachments`;
  await root.listContents();
  return root.subDirs.find(dir => dir.name == name) ?? await root.createSubDirectory(name);
}

/** Загружает файл в облако и возвращает публичную ссылку на него */
export async function uploadCloudAttachment(account: FileSharingAccount, file: Blob, filename: string): Promise<CloudLink> {
  let root = shareableRoot(account);
  if (!root) {
    throw new UserError(gt`${account.name} cannot share links to files`);
  }
  let dir = await attachmentsDirectory(root);
  await dir.listContents();
  let name = uniqueFileName(filename || "file", dir.files.contents.map(other => other.name));
  let cloudFile = dir.newFile(name) as UploadableFile;
  if (typeof cloudFile.saveContents != "function") {
    throw new UserError(gt`${account.name} cannot share links to files`);
  }
  cloudFile.mimetype = file.type || "application/octet-stream";
  cloudFile.size = file.size;
  cloudFile.lastMod = new Date();
  await cloudFile.saveContents(file);
  dir.files.add(cloudFile);
  let url = await cloudFile.shareLink();
  if (!url) {
    throw new UserError(gt`${account.name} did not return a link for ${name}`);
  }
  return { name, size: file.size, url };
}

/** Блок со ссылками для текста письма */
export function cloudLinksHTML(links: CloudLink[], formatSize: (bytes: number) => string): string {
  return links.map(link =>
    `<p>📎 <a href="${escapeAttr(link.url)}">${escapeHTML(link.name)}</a> (${escapeHTML(formatSize(link.size))})</p>`)
    .join("");
}
