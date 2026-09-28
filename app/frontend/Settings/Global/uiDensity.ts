import { getLocalStorage } from "../../Util/LocalStorage";

export type UIDensity = "extra-compact" | "compact" | "normal" | "large";

export const uiDensitySetting = getLocalStorage<unknown>("appearance.density", "normal");

export function normalizeUIDensity(value: unknown): UIDensity {
  if (value == "extra-compact" || value == "compact" || value == "normal" || value == "large") {
    return value as UIDensity;
  }
  return "normal";
}
