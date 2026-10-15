import { getFilesDir } from "../../../logic/util/backend-wrapper";
import { appGlobal } from "../../../logic/app";
import { openOSAppForFile } from "../../../logic/util/os-integration";
import { dataURLToBlob, UserError, type URLString } from "../../../logic/util/util";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { backgroundError, showUserError } from "../../Util/error";
import { fileExtensionForMIMEType } from "../../../logic/Files/FileType/MIMETypes";
import { gt } from "../../../l10n/l10n";
import { kMailImageSourceAttribute } from "../../../logic/Mail/mailImage";

type WebviewGuest = HTMLIFrameElement & {
  getWebContentsId?: () => number;
  executeJavaScript?: (code: string) => Promise<unknown>;
};

async function waitForImageElement(img: HTMLImageElement): Promise<void> {
  if (img.complete) {
    if (img.naturalWidth > 0) {
      return;
    }
    throw new Error("image failed to load");
  }
  await new Promise<void>((resolve, reject) => {
    img.addEventListener("load", () => resolve(), { once: true });
    img.addEventListener("error", () => reject(new Error("load failed")), { once: true });
  });
}

function imageSource(img: HTMLImageElement): URLString | null {
  let sourceAttribute = img.getAttribute("src")?.trim();
  if (sourceAttribute) {
    return img.currentSrc || img.src || sourceAttribute;
  }
  return img.getAttribute(kMailImageSourceAttribute)?.trim() || null;
}

/** Read pixels from an inline `<img>` in the main document or a guest webview. */
export async function imageElementToDataURL(img: HTMLImageElement): Promise<string | null> {
  let srcURL = img ? imageSource(img) : null;
  if (!srcURL) {
    return null;
  }
  if (srcURL.startsWith("data:")) {
    return srcURL;
  }
  // У заблокированной картинки нет загруженных пикселей. Вызывающий код
  // запросит сохранённый адрес, если эта функция вернёт null.
  if (!img.getAttribute("src")?.trim()) {
    return null;
  }
  try {
    await waitForImageElement(img);
    let canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    if (!canvas.width || !canvas.height) {
      return null;
    }
    canvas.getContext("2d")?.drawImage(img, 0, 0);
    return canvas.toDataURL("image/png");
  } catch {
    try {
      let response = await fetch(img.src);
      if (!response.ok) {
        return null;
      }
      let blob = await response.blob();
      return await new Promise<string | null>((resolve, reject) => {
        let reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result == "string" ? reader.result : null);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  }
}

/** Open an inline image from a DOM `<img>` (compose quote, etc.). */
export async function openMailImageFromElement(
  img: HTMLImageElement,
  suggestedFilename?: string,
): Promise<void> {
  let dataURL = await imageElementToDataURL(img);
  if (dataURL) {
    let blob = await dataURLToBlob(dataURL);
    await saveAndOpenBlob(blob, imageSource(img) ?? undefined, suggestedFilename);
    return;
  }
  let srcURL = imageSource(img);
  let blob = srcURL ? await fetchMailImageBlob(srcURL) : null;
  if (!blob) {
    throw new UserError(gt`Could not read the image`);
  }
  await saveAndOpenBlob(blob, srcURL, suggestedFilename);
}

/** Open an inline email image in the default OS image viewer. */
export async function openMailImageAtPoint(
  webview: WebviewGuest | null | undefined,
  x: number,
  y: number,
  srcURL?: URLString,
  suggestedFilename?: string,
): Promise<void> {
  if (!webview?.executeJavaScript) {
    throw new UserError(gt`Cannot open image in this view`);
  }
  let dataURL = await extractImageDataURLFromWebview(webview, x, y, srcURL);
  if (dataURL) {
    let blob = await dataURLToBlob(dataURL);
    await saveAndOpenBlob(blob, srcURL, suggestedFilename);
    return;
  }
  let imageURL = srcURL || await extractImageSourceFromWebview(webview, x, y);
  let blob = imageURL ? await fetchMailImageBlob(imageURL, webview) : null;
  if (!blob) {
    throw new UserError(gt`Could not read the image`);
  }
  await saveAndOpenBlob(blob, imageURL, suggestedFilename);
}

/** @deprecated Use openMailImageAtPoint — kept for callers with URL only. */
export async function openMailImageURL(
  srcURL: URLString,
  webview?: WebviewGuest | null,
  suggestedFilename?: string,
): Promise<void> {
  if (webview?.executeJavaScript) {
    await openMailImageAtPoint(webview, 0, 0, srcURL, suggestedFilename);
    return;
  }
  let blob = await fetchMailImageBlob(srcURL, webview);
  if (!blob) {
    throw new UserError(gt`Could not read the image`);
  }
  await saveAndOpenBlob(blob, srcURL, suggestedFilename);
}

/** Форматы, которые ОС откроет просмотрщиком картинок. Тип и имя файла задаёт отправитель письма,
 * поэтому расширение берётся только отсюда: иначе «картинка» invoice.exe запустилась бы как программа. */
const kOpenableImageTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp", "image/avif", "image/tiff", "image/heic", "image/heif"]);

async function saveAndOpenBlob(blob: Blob, srcURL?: URLString, suggestedFilename?: string) {
  let mimeType = blob.type.split(";")[0].trim().toLowerCase();
  if (!kOpenableImageTypes.has(mimeType)) {
    blob = await reencodeImageAsPNG(blob);
    mimeType = "image/png";
  }
  let ext = fileExtensionForMIMEType(mimeType) || "png";
  let baseName = sanitize.filename(suggestedFilename || guessImageFilename(srcURL, ext), "image").replace(/\.[^.]*$/, "") || "image";
  let filename = sanitize.filename(`${baseName}.${ext}`, `image.${ext}`);
  let filesDir = await getFilesDir();
  let tmpDir = `${filesDir}/tmp`;
  await appGlobal.remoteApp.fs.mkdir(tmpDir, { recursive: true, mode: 0o700 });
  let tempPath = `${tmpDir}/${crypto.randomUUID()}-${filename}`;
  await appGlobal.remoteApp.writeFile(tempPath, 0o644, new Uint8Array(await blob.arrayBuffer()));
  await openOSAppForFile(tempPath);
}

/** Декодирует данные как картинку и сохраняет пиксели в PNG. Не-картинка вызывает ошибку. */
async function reencodeImageAsPNG(blob: Blob): Promise<Blob> {
  let objectURL = URL.createObjectURL(blob);
  try {
    let img = new Image();
    img.src = objectURL;
    await img.decode();
    let canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    let context = canvas.getContext("2d");
    if (!canvas.width || !canvas.height || !context) {
      throw new Error("empty image");
    }
    context.drawImage(img, 0, 0);
    let png = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
    if (!png) {
      throw new Error("PNG encoding failed");
    }
    return png;
  } catch {
    throw new UserError(gt`Could not read the image`);
  } finally {
    URL.revokeObjectURL(objectURL);
  }
}

function guessImageFilename(srcURL: URLString | undefined, ext: string): string {
  if (!srcURL) {
    return `image.${ext}`;
  }
  try {
    if (/^https?:\/\//i.test(srcURL)) {
      let name = new URL(srcURL).pathname.split("/").pop();
      if (name && /\./.test(name)) {
        return name;
      }
    }
  } catch {
    // ignore malformed URLs (data:, blob:, etc.)
  }
  return `image.${ext}`;
}

/** Read pixels from the guest webview — works for blob:, data: and proxied https: images. */
export async function extractImageDataURLFromWebview(
  webview: WebviewGuest,
  x: number,
  y: number,
  srcURL?: URLString,
): Promise<string | null> {
  try {
    let result = await webview.executeJavaScript!(`
      (async () => {
        function waitForImage(img) {
          if (img.complete) {
            return img.naturalWidth > 0
              ? Promise.resolve()
              : Promise.reject(new Error("image failed to load"));
          }
          return new Promise((resolve, reject) => {
            img.addEventListener("load", () => resolve(undefined), { once: true });
            img.addEventListener("error", () => reject(new Error("load failed")), { once: true });
          });
        }
        async function imageToDataURL(img) {
          const sourceAttribute = img?.getAttribute("src")?.trim() || "";
          const sourceURL = sourceAttribute || img?.getAttribute(${JSON.stringify(kMailImageSourceAttribute)})?.trim() || "";
          if (!sourceURL) {
            return null;
          }
          if (sourceURL.startsWith("data:")) {
            return sourceURL;
          }
          if (!sourceAttribute) {
            try {
              const response = await fetch(sourceURL);
              if (!response.ok) {
                return null;
              }
              const blob = await response.blob();
              return await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(blob);
              });
            } catch {
              return null;
            }
          }
          try {
            await waitForImage(img);
            const canvas = document.createElement("canvas");
            canvas.width = img.naturalWidth || img.width;
            canvas.height = img.naturalHeight || img.height;
            if (!canvas.width || !canvas.height) {
              return null;
            }
            const context = canvas.getContext("2d");
            if (!context) {
              return null;
            }
            context.drawImage(img, 0, 0);
            return canvas.toDataURL("image/png");
          } catch {
            try {
              const response = await fetch(sourceURL);
              if (!response.ok) {
                return null;
              }
              const blob = await response.blob();
              return await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(blob);
              });
            } catch {
              return null;
            }
          }
        }
        let img = null;
        const px = ${Math.round(x)};
        const py = ${Math.round(y)};
        if (px > 0 || py > 0) {
          const el = document.elementFromPoint(px, py);
          img = el?.closest("img") ?? null;
        }
        const srcHint = ${JSON.stringify(srcURL ?? "")};
        if (!img && srcHint) {
          img = [...document.images].find(i =>
            i.src === srcHint || i.getAttribute(${JSON.stringify(kMailImageSourceAttribute)}) === srcHint
          ) ?? null;
        }
        if (!img && document.images.length === 1) {
          img = document.images[0];
        }
        return img ? await imageToDataURL(img) : null;
      })()
    `);
    return typeof result == "string" ? result : null;
  } catch (ex) {
    backgroundError(ex);
    return null;
  }
}

/** Найти исходный или уже загруженный адрес картинки под указанной точкой. */
export async function extractImageSourceFromWebview(
  webview: WebviewGuest,
  x: number,
  y: number,
  srcURL?: URLString,
): Promise<URLString | null> {
  try {
    let result = await webview.executeJavaScript!(`
      (() => {
        let img = null;
        const px = ${Math.round(x)};
        const py = ${Math.round(y)};
        if (px > 0 || py > 0) {
          const el = document.elementFromPoint(px, py);
          img = el?.closest("img") ?? null;
        }
        const srcHint = ${JSON.stringify(srcURL ?? "")};
        if (!img && srcHint) {
          img = [...document.images].find(i =>
            i.src === srcHint || i.getAttribute(${JSON.stringify(kMailImageSourceAttribute)}) === srcHint
          ) ?? null;
        }
        if (!img && document.images.length === 1) {
          img = document.images[0];
        }
        if (!img) {
          return null;
        }
        return img.getAttribute("src")?.trim() ||
          img.getAttribute(${JSON.stringify(kMailImageSourceAttribute)})?.trim() || null;
      })()
    `);
    return typeof result == "string" ? result : null;
  } catch (ex) {
    backgroundError(ex);
    return null;
  }
}

export async function fetchMailImageBlob(
  srcURL: URLString,
  webview?: WebviewGuest | null,
): Promise<Blob | null> {
  try {
    if (srcURL.startsWith("data:")) {
      return await dataURLToBlob(srcURL);
    }
    if (webview?.executeJavaScript) {
      let dataURL = await extractImageDataURLFromWebview(webview, 0, 0, srcURL);
      if (dataURL) {
        return await dataURLToBlob(dataURL);
      }
    }
    if (/^https?:\/\//i.test(srcURL)) {
      let desktopFetcher = appGlobal.remoteApp?.fetchMailImage;
      if (typeof desktopFetcher == "function") {
        let webContentsID = webview?.getWebContentsId?.();
        let result = await desktopFetcher(srcURL, webContentsID);
        if (result?.bytes) {
          return new Blob([result.bytes], { type: result.contentType || "" });
        }
      }
      let response = await fetch(srcURL);
      if (!response.ok) {
        return null;
      }
      return await response.blob();
    }
  } catch (ex) {
    backgroundError(ex);
  }
  return null;
}

export async function openMailImageFromContext(
  webview: WebviewGuest,
  x: number,
  y: number,
  srcURL?: URLString,
  suggestedFilename?: string,
): Promise<void> {
  try {
    await openMailImageAtPoint(webview, x, y, srcURL, suggestedFilename);
  } catch (ex) {
    showUserError(ex);
  }
}
