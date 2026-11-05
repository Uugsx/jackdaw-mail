<!-- Окно предпросмотра вложения поверх приложения: заголовок с действиями, панель инструментов и содержимое.
  Картинки одного сообщения листаются стрелками, увеличиваются, перетаскиваются и поворачиваются.
  PDF показывает просмотрщик Chromium (страницы, масштаб); поиск и печать — через <webview>. -->
<svelte:window on:keydown|capture={onKeydown} />
<svelte:document on:fullscreenchange={onFullscreenChange} on:copy={onCopyEvent} />
<div class="preview-backdrop" on:click|self={close}>
  <vbox class="preview-dialog" class:fullscreen role="dialog" aria-modal="true" aria-label={attachment.filename}
    tabindex="-1" bind:this={dialogElement}>
    <hbox class="header">
      <hbox class="filename font-normal" flex title={attachment.filename}>{attachment.filename}</hbox>
      {#if gallery.length > 1}
        <Button plain iconOnly icon={PreviousIcon} iconSize="16px" label={$t`Previous image`} shortCutInfo="←" onClick={() => go(-1)} />
        <hbox class="counter font-small">{index + 1} / {gallery.length}</hbox>
        <Button plain iconOnly icon={NextIcon} iconSize="16px" label={$t`Next image`} shortCutInfo="→" onClick={() => go(1)} />
      {/if}
      <Button plain icon={OpenIcon} iconSize="16px" label={$t`Open in external app`} onClick={openExternal} />
      <Button plain icon={SaveIcon} iconSize="16px" label={$t`Save as`}
        tooltip={withShortcut($t`Save as`, modKey + "S")} onClick={save} />
      <Button plain iconOnly icon={CloseIcon} iconSize="16px" label={$t`Close`} shortCutInfo="Esc" onClick={close} />
    </hbox>
    {#if !loading && blobURL}
      <hbox class="toolbar" role="toolbar" aria-label={attachment.filename}>
        {#if kind == "pdf"}
          <hbox class="find">
            <SearchIcon size="14px" aria-hidden="true" />
            <input type="search" class="find-input font-small" bind:this={findInput} bind:value={findText}
              placeholder={$t`Find in document`} aria-label={$t`Find in document`}
              title={withShortcut($t`Find in document`, modKey + "F")}
              on:input={() => find()} on:keydown={onFindKeydown} />
            {#if findText}
              <hbox class="find-result font-small" role="status">
                {findResult?.matches ? $t`${findResult.activeMatchOrdinal} of ${findResult.matches}` : findResult ? $t`No matches` : ""}
              </hbox>
            {/if}
            <Button plain iconOnly icon={UpIcon} iconSize="14px" label={$t`Previous match`} shortCutInfo="Shift+Enter"
              disabled={!findResult?.matches} onClick={() => find(false)} />
            <Button plain iconOnly icon={DownIcon} iconSize="14px" label={$t`Next match`} shortCutInfo="Enter"
              disabled={!findResult?.matches} onClick={() => find(true)} />
          </hbox>
          <hbox flex />
          <Button plain iconOnly icon={PrintIcon} iconSize="16px" label={$t`Print`} shortCutInfo={modKey + "P"} onClick={print} />
        {:else}
          <Button plain iconOnly icon={ZoomOutIcon} iconSize="16px" label={$t`Zoom out`} shortCutInfo={"−, " + zoomOutHint}
            disabled={scale <= kMinZoom} onClick={() => zoomBy(-1)} />
          <hbox class="percent font-small" role="status">{zoomPercent(scale)}</hbox>
          <Button plain iconOnly icon={ZoomInIcon} iconSize="16px" label={$t`Zoom in`} shortCutInfo={"+, " + zoomInHint}
            disabled={scale >= kMaxZoom} onClick={() => zoomBy(1)} />
          {#if kind == "image"}
            <Button plain iconOnly icon={FitIcon} iconSize="16px" label={$t`Fit to window`} selected={fitMode}
              shortCutInfo={$t`${"0"} or double-click`} onClick={fit} />
          {/if}
          <Button plain iconOnly icon={ActualSizeIcon} iconSize="16px" label={$t`Actual size`}
            selected={!fitMode && Math.abs(scale - 1) < 0.005}
            shortCutInfo={kind == "image" ? $t`${"1"} or double-click` : "0"} onClick={() => setZoom(1)} />
          {#if kind == "image"}
            <hbox class="separator" />
            <Button plain iconOnly icon={RotateIcon} iconSize="16px" label={$t`Rotate`} shortCutInfo="R" onClick={rotate} />
            <Button plain iconOnly icon={copied ? CopiedIcon : CopyIcon} iconSize="16px" label={copied ? $t`Copied` : $t`Copy image`}
              shortCutInfo={modKey + "C"} onClick={copyImage} />
          {/if}
          <hbox flex />
        {/if}
        <Button plain iconOnly icon={fullscreen ? ExitFullscreenIcon : FullscreenIcon} iconSize="16px"
          label={fullscreen ? $t`Exit full screen` : $t`Full screen`} shortCutInfo="F" onClick={toggleFullscreen} />
      </hbox>
    {/if}
    <vbox class="content" flex>
      {#if loading}
        <hbox class="message font-small">{$t`Loading…`}</hbox>
      {:else if !blobURL}
        <vbox class="message font-small">
          {#if !attachment.content}
            <hbox>{$t`Attachment file is missing`}</hbox>
          {:else if !kind}
            <hbox>{$t`This file cannot be shown here.`}</hbox>
            <Button plain icon={OpenIcon} iconSize="16px" label={$t`Open in external app`} onClick={openExternal} />
          {:else}
            <hbox>{$t`This file cannot be shown here.`}</hbox>
          {/if}
        </vbox>
      {:else if tooLarge}
        <vbox class="message font-small">
          <hbox>{$t`This file is too large to preview.`}</hbox>
          <Button plain icon={OpenIcon} iconSize="16px" label={$t`Open in external app`} onClick={openExternal} />
        </vbox>
      {:else if kind == "pdf"}
        <!-- Отдельная страница: поиск ищет только в PDF, печать печатает PDF, а не окно приложения -->
// #if [!WEBMAIL && !MOBILE]
        <webview bind:this={pdfView} src={blobURL} title={attachment.filename} plugins class="pdf" />
// #else
        <iframe src={blobURL} title={attachment.filename} />
// #endif
      {:else if kind == "image"}
        <div class="image-area" class:pannable class:panning bind:this={imageArea}
          bind:clientWidth={areaWidth} bind:clientHeight={areaHeight}
          use:wheelZoom on:pointerdown={onPanStart} on:pointermove={onPanMove}
          on:pointerup={onPanEnd} on:pointercancel={onPanEnd} on:dblclick={onDoubleClick}>
          <div class="image-frame" style:width="{frameWidth}px" style:height="{frameHeight}px">
            <img src={blobURL} alt={attachment.filename} draggable="false" on:load={onImageLoad}
              style:width="{naturalWidth * scale}px" style:height="{naturalHeight * scale}px"
              style:transform="translate(-50%, -50%) rotate({rotation}deg)" />
          </div>
        </div>
      {:else}
        {#await previewHTML(kind, attachment.filename, attachment.content)}
          <hbox class="message font-small">{$t`Loading…`}</hbox>
        {:then html}
          <!-- Без allow-scripts: в документе не выполняется ничего -->
          <iframe srcdoc={documentZoomHTML(html, scale)} sandbox="" title={attachment.filename} />
        {:catch ex}
          <vbox class="message font-small">
            <hbox>{$t`This file cannot be shown here.`}</hbox>
            <hbox class="error">{ex?.message ?? ex}</hbox>
          </vbox>
        {/await}
      {/if}
    </vbox>
  </vbox>
</div>

<script lang="ts">
  import type { Attachment } from "../../../logic/Abstract/Attachment";
  import { kMaxHTMLPreviewBytes, copyImageToClipboard, documentZoomHTML, loadAttachmentContent, previewHTML, previewKind, type PreviewKind } from "./attachmentPreview";
  import {
    clampZoom, fitZoom, isSideways, kMaxZoom, kMinZoom, normalizeRotation, previewShortcut,
    scrollToKeepPoint, wheelZoom as wheelZoomStep, zoomIn, zoomOut, zoomPercent,
  } from "./previewZoom";
  import { isMacPlatform } from "../Message/messageZoom";
  import Button from "../../Shared/Button.svelte";
  import OpenIcon from "lucide-svelte/icons/external-link";
  import SaveIcon from "lucide-svelte/icons/save";
  import CloseIcon from "lucide-svelte/icons/x";
  import PreviousIcon from "lucide-svelte/icons/chevron-left";
  import NextIcon from "lucide-svelte/icons/chevron-right";
  import UpIcon from "lucide-svelte/icons/chevron-up";
  import DownIcon from "lucide-svelte/icons/chevron-down";
  import ZoomInIcon from "lucide-svelte/icons/zoom-in";
  import ZoomOutIcon from "lucide-svelte/icons/zoom-out";
  import FitIcon from "lucide-svelte/icons/shrink";
  import ActualSizeIcon from "lucide-svelte/icons/scan";
  import RotateIcon from "lucide-svelte/icons/rotate-cw";
  import CopyIcon from "lucide-svelte/icons/copy";
  import CopiedIcon from "lucide-svelte/icons/check";
  import PrintIcon from "lucide-svelte/icons/printer";
  import SearchIcon from "lucide-svelte/icons/search";
  import FullscreenIcon from "lucide-svelte/icons/maximize";
  import ExitFullscreenIcon from "lucide-svelte/icons/minimize";
  import { backgroundError, catchErrors } from "../../Util/error";
  import { t, translateString } from "../../../l10n/l10n";
  import { onDestroy, onMount, tick } from "svelte";

  export let attachment: Attachment;
  export let kind: PreviewKind | null;
  /** Вложения, между которыми листаем; `attachment` среди них */
  export let gallery: Attachment[] = [attachment];
  export let onClose: () => void;

  /** Отступ картинки от краёв в режиме «Вписать» */
  const kFitPadding = 32;
  const kCopiedFeedbackMs = 1500;

  let dialogElement: HTMLElement;
  let previouslyFocused: HTMLElement | null = null;
  let index = Math.max(0, gallery.indexOf(attachment));
  let loading = false;
  let blobURL: string | null = null;
  $: tooLarge = (kind == "document" || kind == "text") && attachment?.content?.size > kMaxHTMLPreviewBytes;
  $: setBlobURL(attachment, kind);

  const modKey = isMacPlatform() ? "⌘" : "Ctrl+";
  $: zoomInHint = isMacPlatform()
    ? translateString({ id: "ZeMPGkMac", defaultMessage: "⌘ + scroll up" }, {})
    : translateString({ id: "ZeMPGk", defaultMessage: "Ctrl + scroll up" }, {});
  $: zoomOutHint = isMacPlatform()
    ? translateString({ id: "twQNl4Mac", defaultMessage: "⌘ + scroll down" }, {})
    : translateString({ id: "twQNl4", defaultMessage: "Ctrl + scroll down" }, {});

  // Свой адрес: у PDF указываем тип, иначе Chromium предложит скачать файл
  function setBlobURL(current: Attachment, currentKind: PreviewKind | null) {
    if (blobURL) {
      URL.revokeObjectURL(blobURL);
    }
    blobURL = !current?.content || !currentKind ? null : URL.createObjectURL(currentKind == "pdf" && current.content.type != "application/pdf"
      ? new Blob([current.content], { type: "application/pdf" })
      : current.content);
    resetView();
  }

  /** Соседнее вложение по кругу; байты догружаются при переходе */
  async function go(step: number) {
    if (gallery.length < 2) {
      return;
    }
    index = (index + step + gallery.length) % gallery.length;
    let wanted = index;
    loading = true;
    try {
      let loaded = await loadAttachmentContent(gallery[wanted]);
      if (wanted != index) {
        return; // уже листнули дальше
      }
      gallery[wanted] = loaded;
      kind = previewKind(loaded.filename, loaded.mimeType);
      attachment = loaded;
    } catch (ex) {
      backgroundError(ex);
      attachment = gallery[wanted];
    } finally {
      if (wanted == index) {
        loading = false;
      }
    }
  }

  // Масштаб. «Вписать» пересчитывается при изменении окна, ручной масштаб — нет.

  let fitMode = true;
  let zoom = 1;
  let rotation = 0;
  let naturalWidth = 0;
  let naturalHeight = 0;
  let areaWidth = 0;
  let areaHeight = 0;
  let imageArea: HTMLElement;
  $: scale = currentScale(kind, fitMode, zoom, naturalWidth, naturalHeight, rotation, areaWidth, areaHeight);

  /** Масштаб сейчас, без ожидания перерисовки: клавишу могут нажать дважды подряд */
  function currentScale(..._dependencies: unknown[]): number {
    return kind == "image" && fitMode
      ? fitZoom(naturalWidth, naturalHeight, rotation, areaWidth - kFitPadding, areaHeight - kFitPadding)
      : zoom;
  }
  $: frameWidth = (isSideways(rotation) ? naturalHeight : naturalWidth) * scale;
  $: frameHeight = (isSideways(rotation) ? naturalWidth : naturalHeight) * scale;
  $: pannable = !!imageArea && (frameWidth > areaWidth || frameHeight > areaHeight);

  function resetView() {
    fitMode = kind == "image";
    zoom = 1;
    rotation = 0;
    naturalWidth = naturalHeight = 0;
    copied = false;
    findResult = null;
  }

  function onImageLoad(event: Event) {
    let img = event.target as HTMLImageElement;
    naturalWidth = img.naturalWidth;
    naturalHeight = img.naturalHeight;
  }

  /** @param point Точка, которая остаётся на месте, относительно области картинки; по умолчанию — центр */
  async function setZoom(newZoom: number, point?: { x: number, y: number }) {
    let oldScale = currentScale();
    newZoom = clampZoom(newZoom);
    let area = imageArea;
    let scrollLeft = area?.scrollLeft ?? 0;
    let scrollTop = area?.scrollTop ?? 0;
    let oldOffset = frameOffset(area);
    fitMode = false;
    zoom = newZoom;
    if (!area || !oldScale) {
      return;
    }
    point ??= { x: area.clientWidth / 2, y: area.clientHeight / 2 };
    await tick();
    let newOffset = frameOffset(area);
    area.scrollLeft = scrollToKeepPoint(scrollLeft, point.x, oldScale, newZoom, oldOffset.x, newOffset.x);
    area.scrollTop = scrollToKeepPoint(scrollTop, point.y, oldScale, newZoom, oldOffset.y, newOffset.y);
  }

  /** Отступ картинки от начала прокручиваемой области: у мелкой — поля центрирования */
  function frameOffset(area: HTMLElement | null) {
    let frame = area?.firstElementChild;
    if (!frame) {
      return { x: 0, y: 0 };
    }
    let frameRect = frame.getBoundingClientRect();
    let areaRect = area.getBoundingClientRect();
    return {
      x: frameRect.left - areaRect.left - area.clientLeft + area.scrollLeft,
      y: frameRect.top - areaRect.top - area.clientTop + area.scrollTop,
    };
  }

  function zoomBy(direction: 1 | -1) {
    let current = currentScale();
    void setZoom(direction > 0 ? zoomIn(current) : zoomOut(current));
  }

  function fit() {
    fitMode = true;
  }

  function rotate() {
    rotation = normalizeRotation(rotation + 90);
  }

  function pointIn(event: MouseEvent) {
    let rect = imageArea.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  /** Ctrl/⌘ + колесо и щипок на тачпаде; без модификатора колесо прокручивает картинку */
  function wheelZoom(element: HTMLElement) {
    function onWheel(event: WheelEvent) {
      if (!(event.ctrlKey || event.metaKey)) {
        return;
      }
      event.preventDefault();
      let pixels = event.deltaMode == WheelEvent.DOM_DELTA_LINE ? event.deltaY * 16 : event.deltaY;
      void setZoom(wheelZoomStep(currentScale(), pixels), pointIn(event));
    }
    element.addEventListener("wheel", onWheel, { passive: false });
    return { destroy: () => element.removeEventListener("wheel", onWheel) };
  }

  function onDoubleClick(event: MouseEvent) {
    if (fitMode) {
      void setZoom(1, pointIn(event));
    } else {
      fit();
    }
  }

  // Перетаскивание увеличенной картинки

  let panning = false;
  let panStart = { x: 0, y: 0, scrollLeft: 0, scrollTop: 0 };

  function onPanStart(event: PointerEvent) {
    if (!pannable || event.button != 0) {
      return;
    }
    panning = true;
    panStart = { x: event.clientX, y: event.clientY, scrollLeft: imageArea.scrollLeft, scrollTop: imageArea.scrollTop };
    imageArea.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function onPanMove(event: PointerEvent) {
    if (!panning) {
      return;
    }
    imageArea.scrollLeft = panStart.scrollLeft - (event.clientX - panStart.x);
    imageArea.scrollTop = panStart.scrollTop - (event.clientY - panStart.y);
  }

  function onPanEnd(event: PointerEvent) {
    if (!panning) {
      return;
    }
    panning = false;
    if (imageArea.hasPointerCapture?.(event.pointerId)) {
      imageArea.releasePointerCapture(event.pointerId);
    }
  }

  // Копирование, полный экран, поиск и печать

  let copied = false;
  let copiedTimer: ReturnType<typeof setTimeout>;
  async function copyImage() {
    await copyImageToClipboard(attachment.content);
    copied = true;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => copied = false, kCopiedFeedbackMs);
  }

  /** ⌘C приходит пунктом меню «Правка → Копировать», а не нажатием клавиши */
  function onCopyEvent(event: ClipboardEvent) {
    if (kind != "image" || !blobURL || hasTextSelection()) {
      return;
    }
    event.preventDefault();
    catchErrors(copyImage);
  }

  function hasTextSelection(): boolean {
    let active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
      return active.selectionStart != active.selectionEnd;
    }
    return !!document.getSelection()?.toString();
  }

  let fullscreen = false;
  async function toggleFullscreen() {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await dialogElement.requestFullscreen();
    }
  }

  function onFullscreenChange() {
    fullscreen = !!dialogElement && document.fullscreenElement == dialogElement;
  }

  interface FindResult { matches: number, activeMatchOrdinal: number }
  /** Методы <webview> Electron, которые нужны просмотру PDF */
  interface PDFWebView extends HTMLElement {
    findInPage(text: string, options?: { forward?: boolean, findNext?: boolean }): number;
    stopFindInPage(action: "clearSelection" | "keepSelection" | "activateSelection"): void;
    print(): Promise<void>;
  }
  let pdfView: PDFWebView;
  let findInput: HTMLInputElement;
  let findText = "";
  let findResult: FindResult | null = null;

  $: pdfView?.addEventListener("found-in-page", onFoundInPage);

  function onFoundInPage(event: Event) {
    findResult = (event as Event & { result: FindResult }).result;
  }

  /** @param forward undefined — новый поиск с начала, true/false — следующее/предыдущее совпадение */
  function find(forward?: boolean) {
    if (!pdfView) {
      return;
    }
    if (!findText) {
      pdfView.stopFindInPage("clearSelection");
      findResult = null;
      return;
    }
    pdfView.findInPage(findText, forward == undefined ? {} : { forward, findNext: true });
  }

  function onFindKeydown(event: KeyboardEvent) {
    if (event.key == "Enter") {
      event.preventDefault();
      find(!event.shiftKey);
    } else if (event.key == "Escape" && findText) {
      // Первый Esc очищает поиск, второй закрывает просмотр
      event.preventDefault();
      event.stopPropagation();
      findText = "";
      find();
    }
  }

  function focusFind() {
    findInput?.focus();
    findInput?.select();
  }

  async function print() {
    await pdfView?.print();
  }

  onMount(async () => {
    previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    await tick();
    dialogElement?.focus();
  });
  onDestroy(() => {
    blobURL && URL.revokeObjectURL(blobURL);
    clearTimeout(copiedTimer);
    pdfView?.removeEventListener("found-in-page", onFoundInPage);
  });

  function close() {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(backgroundError);
    }
    if (previouslyFocused?.isConnected) {
      previouslyFocused.focus();
    }
    onClose();
  }

  /** Перехватываем до остальных обработчиков окна: Esc закрывает только просмотр, а не панель под ним */
  function onKeydown(event: KeyboardEvent) {
    let target = event.target as HTMLElement;
    let inTextField = target?.tagName == "INPUT" || target?.tagName == "TEXTAREA" || !!target?.isContentEditable;
    if (inTextField && target == findInput && event.key == "Escape" && findText) {
      return; // onFindKeydown очистит поиск
    }
    let action = previewShortcut(event, kind, inTextField);
    if (!action || (action == "copy") || ((action == "previous" || action == "next") && gallery.length < 2)) {
      return; // копирование — через событие copy, чтобы не мешать копированию выделенного текста
    }
    if (loading && action != "close" && action != "previous" && action != "next") {
      return;
    }
    if (action == "close" && document.fullscreenElement) {
      event.preventDefault();
      event.stopPropagation();
      void document.exitFullscreen().catch(backgroundError);
      return;
    }
    if (event.target instanceof HTMLButtonElement && event.key == "Enter") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    runAction(action);
  }

  function runAction(action: string) {
    switch (action) {
      case "close": return close();
      case "previous": return void go(-1);
      case "next": return void go(1);
      case "zoomIn": return zoomBy(1);
      case "zoomOut": return zoomBy(-1);
      case "fit": return fit();
      case "actualSize": return void setZoom(1);
      case "rotate": return rotate();
      case "fullscreen": return catchErrors(toggleFullscreen);
      case "save": return save();
      case "print": return catchErrors(print);
      case "find": return focusFind();
    }
  }

  function withShortcut(label: string, shortCutInfo: string): string {
    return label + "\n\n" + $t`Shortcut: ${shortCutInfo}`;
  }

  function openExternal() {
    catchErrors(() => attachment.openOSApp());
  }

  function save() {
    catchErrors(() => attachment.saveFile());
  }
</script>

<style>
  .preview-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.45);
  }
  .preview-dialog {
    width: min(1100px, calc(100vw - 64px));
    height: calc(100vh - 64px);
    background: var(--main-bg);
    color: var(--main-fg);
    border-radius: 8px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
    overflow: hidden;
    outline: none;
  }
  .preview-dialog.fullscreen {
    width: 100vw;
    height: 100vh;
    border-radius: 0;
  }
  .header {
    align-items: center;
    gap: 4px;
    padding: 6px 8px 6px 16px;
    border-bottom: 1px solid var(--border);
  }
  .toolbar {
    align-items: center;
    gap: 2px;
    min-height: 36px;
    padding: 2px 8px;
    border-bottom: 1px solid var(--border);
    background: var(--headerbar-bg);
    color: var(--headerbar-fg);
  }
  .toolbar :global(button.plain) {
    min-width: 0;
    padding: 4px;
  }
  .toolbar :global(button.plain.selected) {
    background: var(--hover-bg);
    color: var(--hover-fg);
  }
  .toolbar :global(button:focus-visible),
  .header :global(button:focus-visible) {
    outline: 2px solid var(--input-focus);
    outline-offset: 1px;
  }
  .percent {
    min-width: 52px;
    justify-content: center;
    font-variant-numeric: tabular-nums;
  }
  .separator {
    width: 1px;
    height: 18px;
    margin: 0 6px;
    background: var(--border);
  }
  .find {
    align-items: center;
    gap: 4px;
    padding-inline-start: 4px;
  }
  .find-input {
    width: 220px;
    padding: 3px 6px;
    background: var(--input-bg);
    color: var(--input-fg);
    border: 1px solid var(--input-line);
    border-radius: 4px;
  }
  .find-input:focus {
    outline: none;
    border-color: var(--input-focus);
    box-shadow: 0 0 0 1px var(--input-focus);
  }
  .find-result {
    min-width: 64px;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
    opacity: 0.8;
  }
  .counter {
    min-width: 40px;
    justify-content: center;
    color: var(--main-fg);
    opacity: 0.7;
    font-variant-numeric: tabular-nums;
  }
  .filename {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .content {
    min-height: 0;
    background: #fff;
    overflow: hidden;
  }
  iframe, .pdf {
    border: none;
    width: 100%;
    height: 100%;
    flex: 1 1 auto;
  }
  .pdf {
    display: flex;
  }
  .image-area {
    display: flex;
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    background: var(--main-bg);
  }
  .image-area.pannable {
    cursor: grab;
  }
  .image-area.panning {
    cursor: grabbing;
  }
  .image-frame {
    position: relative;
    flex: none;
    margin: auto; /* по центру, а увеличенная — с прокруткой от левого края */
  }
  .image-frame img {
    position: absolute;
    left: 50%;
    top: 50%;
    max-width: none;
    user-select: none;
  }
  .message {
    padding: 24px;
    gap: 8px;
    color: #333;
  }
  .error {
    color: var(--error-fg, #c62828);
  }
</style>
