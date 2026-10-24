type TooltipTarget = HTMLElement;
type TooltipTimer = number;

const tooltipId = "jackdaw-tooltip";
const interactiveSelector = "button, a, select, [role=\"button\"]";
const showDelayMs = 420;
const hideAnimationMs = 140;
const edgeGapPx = 8;
/** Длиннее — это уже не подпись кнопки, а содержимое; такое не подсказываем. */
const maxAutoTooltipLength = 200;
const installedTooltipHiders = new Set<() => void>();

/** Скрывает открытые делегированные подсказки после программного действия. */
export function hideTooltips(): void {
  for (let hideTooltip of installedTooltipHiders) {
    hideTooltip();
  }
}

/**
 * Installs one delegated tooltip for the whole renderer window.
 * Нативные подсказки `title` в Electron зависят от таймингов и перерисовки,
 * поэтому видимая подсказка рендерится в `document.body` с фиксированной позицией.
 */
export function installTooltips(doc: Document = document): () => void {
  const body = doc.body;
  const view = doc.defaultView;
  if (!body || !view) {
    return () => {};
  }

  const tooltip = doc.createElement("div");
  tooltip.id = tooltipId;
  tooltip.className = "jackdaw-tooltip";
  tooltip.setAttribute("role", "tooltip");
  tooltip.dataset.visible = "false";
  tooltip.hidden = true;
  body.append(tooltip);

  let currentTarget: TooltipTarget = null;
  let hoveredTarget: TooltipTarget = null;
  let focusedTarget: TooltipTarget = null;
  let showTimer: TooltipTimer = null;
  let hideTimer: TooltipTimer = null;
  let transitionTimer: TooltipTimer = null;
  let previousTitle: string = null;
  let previousDescribedBy: string = null;
  let removedNativeTitle = false;
  let addedInternalTooltip = false;
  let disposed = false;
  /** Элемент, на котором нажали мышью: подсказка не возвращается, пока мышь на нём. */
  let dismissedTarget: TooltipTarget = null;
  /** Фокус пришёл от нажатия мыши, а не с клавиатуры. Такой фокус подсказку
   * не держит: иначе она висела бы, пока строка в фокусе, хотя мышь давно
   * ушла, например в контекстное меню. */
  let pointerInitiatedFocus = false;

  function clearShowTimer(): void {
    if (showTimer != null) {
      view.clearTimeout(showTimer);
      showTimer = null;
    }
  }

  function clearHideTimer(): void {
    if (hideTimer != null) {
      view.clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  function clearTransitionTimer(): void {
    if (transitionTimer != null) {
      view.clearTimeout(transitionTimer);
      transitionTimer = null;
    }
  }

  function textValue(value: string | null): string | null {
    return value != null && value.trim() ? value : null;
  }

  function isInteractive(element: Element): boolean {
    return element.matches(interactiveSelector);
  }

  function hasExplicitTooltip(element: Element): boolean {
    // `data-jackdaw-tooltip` is added internally while a native title is suppressed.
    return element.hasAttribute("data-tooltip");
  }

  function isTooltipEligible(element: Element): boolean {
    // Значения title у метаданных и содержимого письма намеренно игнорируются.
    // Нестандартные элементы управления могут явно включить подсказку через data-*.
    return isInteractive(element) || hasExplicitTooltip(element);
  }

  function getTooltipText(element: Element): string | null {
    let text = textValue(element.getAttribute("data-tooltip"));
    if (text) {
      return text;
    }
    text = textValue(element.getAttribute("data-jackdaw-tooltip"));
    if (text) {
      return text;
    }
    text = textValue(element.getAttribute("title"));
    if (text) {
      return text;
    }
    if (!isInteractive(element)) {
      return null;
    }
    text = textValue(element.getAttribute("aria-label"));
    if (text) {
      return text;
    }
    // Подпись кнопки обрезана узкой панелью: показываем её целиком. Только для
    // самих кнопок: у строк списков с role="button" текст складывался бы из всех ячеек.
    if (element.tagName != "BUTTON" || !isTextTruncated(element)) {
      return null;
    }
    const visibleText = normalizedText(element.textContent);
    return visibleText && visibleText.length <= maxAutoTooltipLength ? visibleText : null;
  }

  /**
   * Есть ли внутри элемента текст, обрезанный многоточием, ограничением строк
   * или переполнением. Прокручиваемые области обрезкой не считаются.
   */
  function isTextTruncated(element: Element): boolean {
    const candidates = [element, ...element.querySelectorAll("*")];
    for (const candidate of candidates) {
      if (!(candidate instanceof view.HTMLElement) || !candidate.textContent?.trim()) {
        continue;
      }
      const overflowsX = candidate.scrollWidth > candidate.clientWidth + 1;
      const overflowsY = candidate.scrollHeight > candidate.clientHeight + 1;
      if (!overflowsX && !overflowsY) {
        continue;
      }
      const style = view.getComputedStyle(candidate);
      const clips = (value: string) => value == "hidden" || value == "clip";
      const clipsX = overflowsX && clips(style.overflowX || style.overflow);
      const clipsY = overflowsY && clips(style.overflowY || style.overflow);
      if (clipsX || clipsY) {
        return true;
      }
    }
    return false;
  }

  function normalizedText(value: string | null): string | null {
    const text = textValue(value);
    return text ? text.replace(/\s+/g, " ").trim() : null;
  }

  function isRedundantTooltip(element: Element, text: string): boolean {
    if (hasExplicitTooltip(element)) {
      return false;
    }
    const visibleText = normalizedText(element.textContent);
    // Обрезанная подпись не дублирует подсказку: видна только её часть.
    return visibleText != null && visibleText == normalizedText(text) &&
      !isTextTruncated(element);
  }

  function findTooltipTarget(eventTarget: EventTarget | null): TooltipTarget {
    if (!(eventTarget instanceof Element)) {
      return null;
    }
    let element: Element | null = eventTarget;
    while (element) {
      if (element.getAttribute("aria-hidden") != "true" &&
          isTooltipEligible(element) && getTooltipText(element)) {
        return element as TooltipTarget;
      }
      element = element.parentElement;
    }
    return null;
  }

  function suppressNativeTitle(target: TooltipTarget, text: string): void {
    if (target.hasAttribute("title")) {
      if (!removedNativeTitle) {
        previousTitle = target.getAttribute("title");
      }
      target.removeAttribute("title");
      removedNativeTitle = true;
    }
    if (!target.hasAttribute("data-tooltip") && !target.hasAttribute("data-jackdaw-tooltip")) {
      target.setAttribute("data-jackdaw-tooltip", text);
      addedInternalTooltip = true;
    }
  }

  function setDescribedBy(target: TooltipTarget): void {
    previousDescribedBy = target.getAttribute("aria-describedby");
    const values = (previousDescribedBy ?? "").split(/\s+/).filter(Boolean);
    if (!values.includes(tooltipId)) {
      values.push(tooltipId);
    }
    target.setAttribute("aria-describedby", values.join(" "));
  }

  function restoreTargetAttributes(target: TooltipTarget): void {
    if (removedNativeTitle && target.isConnected && !target.hasAttribute("title") && previousTitle != null) {
      target.setAttribute("title", previousTitle);
    }
    if (addedInternalTooltip && target.isConnected) {
      target.removeAttribute("data-jackdaw-tooltip");
    }
    if (target.isConnected) {
      if (previousDescribedBy == null) {
        target.removeAttribute("aria-describedby");
      } else {
        target.setAttribute("aria-describedby", previousDescribedBy);
      }
    }
    previousTitle = null;
    previousDescribedBy = null;
    removedNativeTitle = false;
    addedInternalTooltip = false;
  }

  function positionTooltip(target: TooltipTarget): void {
    if (!tooltip || tooltip.hidden || !target.isConnected) {
      return;
    }
    const anchorRect = target.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const viewportWidth = view.innerWidth;
    const viewportHeight = view.innerHeight;
    const shouldPlaceAbove = anchorRect.bottom + edgeGapPx + tooltipRect.height > viewportHeight - edgeGapPx &&
      anchorRect.top - edgeGapPx - tooltipRect.height >= edgeGapPx;
    const top = shouldPlaceAbove
      ? anchorRect.top - tooltipRect.height - edgeGapPx
      : anchorRect.bottom + edgeGapPx;
    const maxLeft = Math.max(edgeGapPx, viewportWidth - tooltipRect.width - edgeGapPx);
    const centeredLeft = anchorRect.left + (anchorRect.width - tooltipRect.width) / 2;
    const left = Math.min(Math.max(edgeGapPx, centeredLeft), maxLeft);

    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(Math.max(edgeGapPx, top))}px`;
  }

  function hideTooltip(): void {
    clearShowTimer();
    clearHideTimer();
    clearTransitionTimer();
    const target = currentTarget;
    currentTarget = null;
    if (target) {
      restoreTargetAttributes(target);
    }
    tooltip.dataset.visible = "false";
    transitionTimer = view.setTimeout(() => {
      transitionTimer = null;
      if (!currentTarget) {
        tooltip.hidden = true;
        tooltip.textContent = "";
      }
    }, hideAnimationMs);
  }

  function showTooltip(target: TooltipTarget, text: string): void {
    if (disposed || currentTarget != target || !target.isConnected) {
      return;
    }
    clearHideTimer();
    clearTransitionTimer();
    tooltip.textContent = text;
    tooltip.hidden = false;
    positionTooltip(target);
    tooltip.dataset.visible = "true";
    setDescribedBy(target);
  }

  function hasActivePointerOrFocus(target: TooltipTarget): boolean {
    return hoveredTarget == target || focusedTarget == target;
  }

  function scheduleTooltip(target: TooltipTarget, delay = showDelayMs): void {
    if (target == dismissedTarget) {
      return;
    }
    const text = getTooltipText(target);
    if (!text) {
      return;
    }
    if (isRedundantTooltip(target, text)) {
      if (currentTarget) {
        hideTooltip();
      }
      currentTarget = target;
      clearShowTimer();
      clearHideTimer();
      clearTransitionTimer();
      tooltip.hidden = true;
      tooltip.dataset.visible = "false";
      tooltip.textContent = "";
      // Keep the target tracked so the native title cannot flash while hovered
      // and nested icons do not restart the tooltip lifecycle.
      suppressNativeTitle(target, text);
      return;
    }
    if (currentTarget == target && (showTimer != null || tooltip.dataset.visible == "true")) {
      return;
    }
    if (currentTarget != target) {
      hideTooltip();
      currentTarget = target;
    }
    suppressNativeTitle(target, text);
    clearShowTimer();
    clearHideTimer();
    showTimer = view.setTimeout(() => {
      showTimer = null;
      if (hasActivePointerOrFocus(target)) {
        showTooltip(target, getTooltipText(target) ?? text);
      } else if (currentTarget == target) {
        hideTooltip();
      }
    }, delay);
  }

  /** Наведённый элемент сменился: снятие подсказки нажатием больше не действует. */
  function setHoveredTarget(target: TooltipTarget): void {
    if (target != dismissedTarget) {
      dismissedTarget = null;
    }
    hoveredTarget = target;
  }

  /** Закрывает подсказку до ухода мыши с элемента. Системный title при этом
   * остаётся снятым, чтобы вместо нашей подсказки не всплыла нативная. */
  function dismissTooltip(target: TooltipTarget): void {
    hideTooltip();
    clearTransitionTimer();
    tooltip.hidden = true;
    tooltip.textContent = "";
    dismissedTarget = target;
    const text = target ? getTooltipText(target) : null;
    if (target && text) {
      currentTarget = target;
      suppressNativeTitle(target, text);
    }
  }

  function onPointerDown(event: PointerEvent): void {
    pointerInitiatedFocus = true;
    focusedTarget = null;
    dismissTooltip(findTooltipTarget(event.target));
  }

  function onContextMenu(event: MouseEvent): void {
    focusedTarget = null;
    dismissTooltip(findTooltipTarget(event.target) ?? currentTarget);
  }

  function onKeyDown(): void {
    pointerInitiatedFocus = false;
  }

  function maybeHideTooltip(): void {
    if (currentTarget && !hasActivePointerOrFocus(currentTarget)) {
      hideTooltip();
    }
  }

  function onPointerOver(event: PointerEvent): void {
    if (isMailWebViewPointerDown()) {
      return;
    }
    const target = findTooltipTarget(event.target);
    if (!target) {
      return;
    }
    if (event.relatedTarget instanceof Node && target.contains(event.relatedTarget) && hoveredTarget == target) {
      return;
    }
    if (hoveredTarget == target) {
      return;
    }
    setHoveredTarget(target);
    scheduleTooltip(target);
  }

  function onPointerMove(event: PointerEvent): void {
    if (isMailWebViewPointerDown()) {
      return;
    }
    const target = findTooltipTarget(event.target);
    if (target == hoveredTarget) {
      return;
    }
    setHoveredTarget(target);
    if (target) {
      scheduleTooltip(target);
    } else {
      maybeHideTooltip();
    }
  }

  function onPointerOut(event: PointerEvent): void {
    if (isMailWebViewPointerDown()) {
      return;
    }
    const eventTarget = event.target instanceof Element ? event.target : null;
    const target = findTooltipTarget(event.target) ?? hoveredTarget;
    if (!target || target != hoveredTarget || !eventTarget || !target.contains(eventTarget)) {
      return;
    }
    const relatedTarget = event.relatedTarget;
    if (relatedTarget instanceof Node && target.contains(relatedTarget)) {
      return;
    }
    const relatedTooltipTarget = findTooltipTarget(relatedTarget);
    if (relatedTooltipTarget) {
      setHoveredTarget(relatedTooltipTarget);
      scheduleTooltip(relatedTooltipTarget);
    } else {
      setHoveredTarget(null);
      maybeHideTooltip();
    }
  }

  function onFocusIn(event: FocusEvent): void {
    if (isMailWebViewPointerDown()) {
      return;
    }
    if (pointerInitiatedFocus) {
      return;
    }
    const target = findTooltipTarget(event.target);
    if (!target) {
      return;
    }
    focusedTarget = target;
    scheduleTooltip(target, 260);
  }

  function onFocusOut(event: FocusEvent): void {
    const target = focusedTarget;
    if (!target) {
      return;
    }
    const relatedTarget = event.relatedTarget;
    if (relatedTarget instanceof Node && target.contains(relatedTarget)) {
      return;
    }
    focusedTarget = null;
    maybeHideTooltip();
  }

  function onViewportChange(): void {
    if (currentTarget && tooltip.dataset.visible == "true") {
      positionTooltip(currentTarget);
    }
  }

  function onWindowBlur(): void {
    hoveredTarget = null;
    focusedTarget = null;
    hideTooltip();
  }

  function isMailWebViewPointerDown(): boolean {
    if (!body.classList.contains("mail-webview-pointer-active")) {
      return false;
    }
    let hasTooltipState = hoveredTarget != null || focusedTarget != null || currentTarget != null
      || showTimer != null || hideTimer != null;
    hoveredTarget = null;
    focusedTarget = null;
    if (hasTooltipState) {
      hideTooltip();
    }
    return true;
  }

  installedTooltipHiders.add(hideTooltip);
  doc.addEventListener("pointerover", onPointerOver);
  doc.addEventListener("pointermove", onPointerMove);
  doc.addEventListener("pointerout", onPointerOut);
  doc.addEventListener("focusin", onFocusIn);
  doc.addEventListener("focusout", onFocusOut);
  doc.addEventListener("pointerdown", onPointerDown, true);
  doc.addEventListener("contextmenu", onContextMenu, true);
  doc.addEventListener("keydown", onKeyDown, true);
  view.addEventListener("resize", onViewportChange);
  view.addEventListener("scroll", onViewportChange, true);
  view.addEventListener("blur", onWindowBlur);

  return () => {
    disposed = true;
    doc.removeEventListener("pointerover", onPointerOver);
    doc.removeEventListener("pointermove", onPointerMove);
    doc.removeEventListener("pointerout", onPointerOut);
    doc.removeEventListener("focusin", onFocusIn);
    doc.removeEventListener("focusout", onFocusOut);
    doc.removeEventListener("pointerdown", onPointerDown, true);
    doc.removeEventListener("contextmenu", onContextMenu, true);
    doc.removeEventListener("keydown", onKeyDown, true);
    view.removeEventListener("resize", onViewportChange);
    view.removeEventListener("scroll", onViewportChange, true);
    view.removeEventListener("blur", onWindowBlur);
    clearShowTimer();
    clearHideTimer();
    clearTransitionTimer();
    installedTooltipHiders.delete(hideTooltip);
    if (currentTarget) {
      restoreTargetAttributes(currentTarget);
    }
    tooltip.remove();
  };
}
