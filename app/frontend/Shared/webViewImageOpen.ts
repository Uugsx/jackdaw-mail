/** Сообщение гостевой страницы письма о клике по картинке: `jackdaw-image-open:<x>,<y>`.
 * Координаты — CSS-пиксели окна письма, как их ждёт `document.elementFromPoint()`. */
export const kImageOpenConsolePrefix = "jackdaw-image-open:";

/** Скрипт для документа письма. Документ новый после каждой смены письма,
 * поэтому скрипт внедряется на каждый `dom-ready`; флаг на `window` не даёт навесить его дважды.
 *
 * Клик определяется внутри письма, а не по `input-event` webContents: координаты `input-event`
 * не учитывают масштаб письма и плотность экрана, и `elementFromPoint` промахивался мимо картинки. */
export function imageOpenGuestScript(): string {
  return `
    (() => {
      if (window.__jackdawImageOpenListener) {
        return;
      }
      window.__jackdawImageOpenListener = true;
      document.addEventListener("click", event => {
        const target = event.target;
        if (!(target instanceof Element) || !target.closest("img")) {
          return;
        }
        // Картинка внутри ссылки не должна открывать ссылку
        event.preventDefault();
        // Двойной клик открыл бы картинку второй раз
        if (event.button != 0 || event.detail > 1) {
          return;
        }
        console.log(${JSON.stringify(kImageOpenConsolePrefix)} + Math.round(event.clientX) + "," + Math.round(event.clientY));
      }, true);
    })()
  `;
}

/** Точка клика из сообщения консоли гостевой страницы или `null` для чужих сообщений. */
export function parseImageOpenMessage(message: string | null | undefined): { x: number; y: number } | null {
  if (!message?.startsWith(kImageOpenConsolePrefix)) {
    return null;
  }
  let match = /^(-?\d+),(-?\d+)$/.exec(message.slice(kImageOpenConsolePrefix.length));
  if (!match) {
    return null;
  }
  return { x: Number(match[1]), y: Number(match[2]) };
}
