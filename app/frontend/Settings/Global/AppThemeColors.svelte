<vbox class="colors">
  <hbox class="hint font-small">{$t`These colors override the current theme. Clear restores the default.`}</hbox>
  {#key clearVersion}
    {#each Object.keys(cssVars) as cssVar}
      {@const label = cssVars[cssVar]}
      {@const custom = !!colors[cssVar]}
      <grid class="color-setting">
        <hbox class="label">{label}</hbox>
        <label class="swatch">
          <input type="color"
            value={swatchHex(cssVar, colors, computed)}
            on:input={(event) => onPick(cssVar, event.currentTarget.value)}
            />
          <hbox class="swatch-face" style:background={swatchHex(cssVar, colors, computed)} />
        </label>
        <Button
          label={$t`Clear`}
          icon={XIcon}
          iconSize="16px"
          plain
          onClick={() => onClear(cssVar)}
          disabled={!custom}
          />
      </grid>
    {/each}
  {/key}
</vbox>

<script lang="ts">
  import { getLocalStorage } from "../../Util/LocalStorage";
  import { applyColors, contrastTextColor, cssColorToHex } from "./AppThemeColors";
  import Button from "../../Shared/Button.svelte";
  import XIcon from "lucide-svelte/icons/x";
  import { t } from "../../../l10n/l10n";
  import { onDestroy, onMount } from "svelte";

  let themeSetting = getLocalStorage("appearance.theme", "system");
  let colorsSetting = getLocalStorage("appearance.colors", {});
  let colors = (colorsSetting.value ?? {}) as Record<string, string>;
  let theme = themeSetting.value;
  let clearVersion = 0;
  let isMounted = false;
  let computedRefreshFrame: number | null = null;
  let computedRefreshVersion = 0;
  let computed: Record<string, string> = {};

  // ObservableLocalStorageSetting не является стандартным Svelte store:
  // реактивное чтение `$setting.value` может увидеть старое значение до
  // следующего обновления компонента. Подписка синхронно обновляет и UI,
  // и CSS-переменные сразу после нажатия на цвет или «Очистить».
  let unsubscribeColors = colorsSetting.subscribe(setting => {
    colors = (setting.value ?? {}) as Record<string, string>;
    applyColors(colors);
  });
  let unsubscribeTheme = themeSetting.subscribe(setting => {
    theme = setting.value;
    scheduleComputedRefresh();
  });
  onMount(() => {
    isMounted = true;
    let colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
    let onColorSchemeChange = (): void => {
      // Нативная тема может измениться, пока обновление уже запланировано.
      // Инвалидируем вычисленные цвета напрямую, чтобы событие media query
      // не объединилось со старым кадром и не потерялось.
      computedRefreshVersion += 1;
    };
    colorScheme.addEventListener("change", onColorSchemeChange);
    scheduleComputedRefresh();
    return () => {
      isMounted = false;
      colorScheme.removeEventListener("change", onColorSchemeChange);
      if (computedRefreshFrame !== null) {
        cancelAnimationFrame(computedRefreshFrame);
        computedRefreshFrame = null;
      }
    };
  });
  onDestroy(() => {
    unsubscribeColors();
    unsubscribeTheme();
  });

  /**
   * Defines which colors (css vars) the user can modify.
   *
   * Key: The CSS var in `app.css` `:root {`
   * Value: User-readable label for the key.
   *
   * List only the "-bg" CSS var.
   * The corresponding "-fg" will be set automatically to the contrast color.
   */
  const cssVars = {
    "bg": $t`Background`,
    "main-bg": $t`Center`,
    "leftbar-bg": $t`Left bar`,
    "appbar-bg": $t`App bar`,
    "windowheader-bg": $t`Title bar`,
    "selected-bg": $t`Selection`,
  };

  $: computed = readComputed(theme, colors, computedRefreshVersion);

  function scheduleComputedRefresh(): void {
    if (!isMounted || computedRefreshFrame !== null) {
      return;
    }
    computedRefreshFrame = requestAnimationFrame(() => {
      computedRefreshFrame = requestAnimationFrame(() => {
        computedRefreshFrame = null;
        computedRefreshVersion += 1;
      });
    });
  }

  function readComputed(
    themeValue: string,
    colorValues: Record<string, string>,
    refreshVersion: number,
  ): Record<string, string> {
    if (
      typeof document == "undefined"
      || !["system", "light", "dark"].includes(themeValue)
      || colorValues == null
      || refreshVersion < 0
    ) {
      return {};
    }
    // В desktop-теме значения по умолчанию задаются на оболочке окна, а не
    // только на `:root`; иначе в тёмном режиме свотчи показывают светлые
    // базовые цвета.
    let themeRoot = document.querySelector<HTMLElement>(".main-window") ?? document.documentElement;
    let style = getComputedStyle(themeRoot);
    let result: Record<string, string> = {};
    for (let cssVar of Object.keys(cssVars)) {
      result[cssVar] = cssColorToHex(style.getPropertyValue("--" + cssVar))
        || cssColorToHex(colorValues[cssVar] ?? "")
        || "#000000";
    }
    return result;
  }

  function swatchHex(
    cssVar: string,
    colorValues: Record<string, string>,
    computedValues: Record<string, string>,
  ): string {
    return colorValues[cssVar] || computedValues[cssVar] || "#000000";
  }

  function saveColors(next: Record<string, string>) {
    colors = next;
    colorsSetting.value = next;
    applyColors(next);
  }

  function onPick(cssVar: string, color: string) {
    let next = { ...colors, [cssVar]: color };
    if (cssVar.endsWith("bg")) {
      let fgVar = cssVar.substring(0, cssVar.length - 2) + "fg";
      let textColor = contrastTextColor(color);
      next[fgVar] = textColor;
      if (cssVar == "bg") {
        themeSetting.value = textColor == "#ffffff" ? "dark" : "light";
      }
    }
    saveColors(next);
  }

  function onClear(cssVar: string) {
    let next = { ...colors };
    delete next[cssVar];
    if (cssVar.endsWith("bg")) {
      delete next[cssVar.substring(0, cssVar.length - 2) + "fg"];
    }
    saveColors(next);
    // Нативный color input может удерживать старое значение после очистки.
    // Пересоздаём только эту небольшую группу контролов, чтобы сразу
    // обновились свотчи, значения input и состояние кнопок.
    clearVersion += 1;
  }
</script>

<style>
  .hint {
    opacity: 0.7;
    margin-block-end: 12px;
    max-width: 40em;
    line-height: 1.4;
  }
  grid.color-setting {
    grid-template-columns: 10em 3.5em auto 1fr;
    align-items: center;
    gap: 12px 16px;
    min-height: 32px;
  }
  .label {
    align-items: center;
  }
  .swatch {
    position: relative;
    width: 3.5em;
    height: 24px;
    cursor: pointer;
  }
  .swatch input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
    width: 100%;
    height: 100%;
  }
  .swatch-face {
    width: 100%;
    height: 100%;
    border-radius: 6px;
    border: 1px solid var(--border);
    box-sizing: border-box;
    pointer-events: none;
  }
</style>
