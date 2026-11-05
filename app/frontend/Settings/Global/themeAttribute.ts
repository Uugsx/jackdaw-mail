/** Серая тема включается атрибутом data-theme="gray" на <html>; остальные темы его снимают. */
export function applyThemeAttribute(theme: string) {
  if (theme == "gray") {
    document.documentElement.dataset.theme = "gray";
  } else {
    delete document.documentElement.dataset.theme;
  }
}
