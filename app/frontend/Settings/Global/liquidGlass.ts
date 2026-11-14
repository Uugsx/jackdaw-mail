import { getLocalStorage } from "../../Util/LocalStorage";

/** Опциональное оформление «Liquid Glass». По умолчанию выключено. */
export const liquidGlassSetting = getLocalStorage<boolean>("appearance.liquidGlass", false);

export function normalizeLiquidGlass(value: unknown): boolean {
  return value === true;
}

/** Включает оформление атрибутом data-glass="on" на <html>; выключенный режим атрибут снимает. */
export function applyGlassAttribute(on: boolean) {
  if (on && glassSupported()) {
    document.documentElement.dataset.glass = "on";
  } else {
    delete document.documentElement.dataset.glass;
  }
}

/** Без нативной прозрачности окна (не macOS или отказ) стекло рисуется только CSS. */
export function applyGlassNativeAttribute(native: boolean) {
  if (native) {
    document.documentElement.dataset.glassNative = "on";
  } else {
    delete document.documentElement.dataset.glassNative;
  }
}

/** Нет backdrop-filter или включено «уменьшить прозрачность» — обычный непрозрачный вид. */
export function glassSupported(): boolean {
  try {
    const blur = CSS.supports("backdrop-filter", "blur(1px)") || CSS.supports("-webkit-backdrop-filter", "blur(1px)");
    return blur && !window.matchMedia("(prefers-reduced-transparency: reduce)").matches;
  } catch (ex) {
    return false;
  }
}
