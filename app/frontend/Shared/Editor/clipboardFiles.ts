/**
 * Разбор файлов из буфера обмена при вставке (⌘V / Ctrl+V).
 *
 * Если в Finder скопировать файл, macOS кладёт в буфер сам файл и ещё картинку-иконку
 * (image/png без своего имени, в Chromium — «image.png»). Раньше редактор брал первую
 * картинку из буфера и вставлял иконку в текст. Здесь файлы и снимки экрана разделяются:
 * - файлы, не являющиеся картинками (PDF, Word, архивы…), — вложениями;
 * - картинка с настоящим именем (скопирована как файл) — вложением, как в Outlook;
 * - картинка без имени («image.png») — снимок экрана или картинка из браузера: в текст,
 *   но только если рядом нет настоящих файлов (тогда это иконка-превью, её отбрасываем).
 */

export type PastedFiles = {
  /** Прикрепить к письму */
  attach: File[];
  /** Вставить в текст как изображение */
  inline: File[];
};

/** Универсальные имена, которые система даёт данным картинки из буфера, а не файлу. */
function isGenericImageName(name: string): boolean {
  return !name || /^image\.(png|jpe?g|gif|tiff?)$/i.test(name);
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

/** Одинаковый файл не прикрепляем дважды (Finder отдаёт его и в items, и в files) */
function uniqueFiles(files: File[]): File[] {
  let seen = new Set<string>();
  return files.filter(file => {
    let key = `${file.name}\u0000${file.size}\u0000${file.type}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function classifyPastedFiles(files: File[]): PastedFiles {
  files = uniqueFiles(files);
  let realFiles = files.filter(file => !isImageFile(file) || !isGenericImageName(file.name));
  if (realFiles.length) {
    // Рядом с настоящими файлами безымянная картинка — иконка-превью от системы
    return { attach: realFiles, inline: [] };
  }
  return { attach: [], inline: files.filter(isImageFile).slice(0, 1) };
}

/** Файлы из события вставки: и `items`, и `files` (на разных ОС заполнено что-то одно) */
export function filesFromClipboard(data: DataTransfer | null | undefined): File[] {
  if (!data) {
    return [];
  }
  let files: File[] = [];
  for (let item of Array.from(data.items ?? [])) {
    if (item.kind == "file") {
      let file = item.getAsFile();
      if (file) {
        files.push(file);
      }
    }
  }
  if (!files.length) {
    files = Array.from(data.files ?? []);
  }
  return files;
}
