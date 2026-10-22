/**
 * Поддерживает ли системный шрифт смайлик. Новые смайлики (Unicode 15+) и составные последовательности
 * в старой системе рисуются пустыми квадратами или распадаются на несколько значков — такие не показываем.
 */
const kSize = 24;
const cache = new Map<string, boolean>();
let context: CanvasRenderingContext2D | null | undefined;
let referenceWidth = 0;

function getContext(): CanvasRenderingContext2D | null {
  if (context !== undefined) {
    return context;
  }
  try {
    let canvas = document.createElement("canvas");
    canvas.width = kSize * 2;
    canvas.height = kSize;
    context = canvas.getContext("2d", { willReadFrequently: true });
    if (context) {
      context.font = `${kSize - 4}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
      context.textBaseline = "top";
      context.fillStyle = "#000";
      referenceWidth = context.measureText("😀").width;
    }
  } catch {
    context = null;
  }
  return context;
}

/** Цветной значок одной ширины с обычным смайликом. Без canvas считаем, что поддерживается. */
export function isEmojiSupported(emoji: string): boolean {
  let known = cache.get(emoji);
  if (known !== undefined) {
    return known;
  }
  let ctx = getContext();
  if (!ctx || !referenceWidth) {
    return true;
  }
  // Распавшаяся последовательность заметно шире одного значка
  let supported = ctx.measureText(emoji).width < referenceWidth * 1.4;
  if (supported) {
    ctx.clearRect(0, 0, kSize * 2, kSize);
    ctx.fillText(emoji, 0, 0);
    let pixels = ctx.getImageData(0, 0, kSize * 2, kSize).data;
    // Пустой квадрат и буквы флагов рисуются цветом текста (чёрным), настоящий смайлик — цветной
    supported = false;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] > 0 && (pixels[i] != pixels[i + 1] || pixels[i + 1] != pixels[i + 2])) {
        supported = true;
        break;
      }
    }
  }
  cache.set(emoji, supported);
  return supported;
}
