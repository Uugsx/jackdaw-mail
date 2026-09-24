<!-- TODO Jail content into an iframe -->

<div bind:this={rootEl} class="html-editor" class:fixed-image-size={fixedImageSize} lang={getUILocale()} />

<script lang="ts">
  import { Editor } from '@tiptap/core';
  import StarterKit from '@tiptap/starter-kit';
  import LinkFeature from '@tiptap/extension-link';
  import CodeWordFeature from '@tiptap/extension-code';
  import ImageResize from 'tiptap-extension-resize-image';
  import { SplitBlockquote } from './SplitBlockquote';
  import { Footer } from './Footer';
  import { BoldStar, ItalicSlash, StrikeDoubleTidle } from './StdConventions';
  import { ParagraphNewLine } from './ParagraphNewLine';
  import { TabIndent } from './TabIndent';
  // import CodeBlockLowlightFeature from '@tiptap/extension-code-block-lowlight';
  // import { common as lowlightCommon, createLowlight } from 'lowlight'
  import { onMount, onDestroy } from 'svelte';
  import { createEventDispatcher } from 'svelte';
  import { getUILocale } from '../../../l10n/l10n';
  import { backgroundError } from '../../Util/error';
  const dispatchEvent = createEventDispatcher<{ change: string }>();

  /** in/out */
  export let html: string;
  /** out only */
  export let editor: Editor;
  export let tabindex = null;
  /** Additional TipTap extensions to include alongside the defaults */
  export let extraExtensions: any[] = [];
  /** Сохранять для изображений сохранённую или исходную ширину. */
  export let fixedImageSize = false;
  /** Обработать вставку файла изображения из системного буфера. */
  export let onImagePaste: ((file: File, displayWidth: number) => Promise<void> | void) | null = null;

  let rootEl: HTMLDivElement;
  let lastHTML: string = null;

  onMount(onLoad);

  function onLoad() {
    editorElementCreatedMutationObserver.observe(rootEl, {childList: true});
    createEditor();
  }

  function createEditor() {
    editor = new Editor({
      element: rootEl,
      extensions: [
        // Disable some extensions because you cannot override the default
        // input/mark rules
        StarterKit.configure({
          bold: false,
          italic: false,
          strike: false,
        }),
        LinkFeature,
        CodeWordFeature,
        SplitBlockquote,
        Footer,
        ImageResize.configure({
          allowBase64: true,
          inline: false,
          HTMLAttributes: {
            style: fixedImageSize
              ? "height: auto; margin: 0; display: block;"
              : "max-width: 100%; height: auto; margin: 0; display: block;"
          },
        }),
        BoldStar,
        ItalicSlash,
        StrikeDoubleTidle,
        ParagraphNewLine,
        TabIndent,
        // CodeBlockLowlightFeature.configure({
        //  lowlight: createLowlight(lowlightCommon),
        // }),
        ...extraExtensions,
      ],
      editorProps: fixedImageSize && onImagePaste ? {
        handlePaste: (view, event) => {
          const clipboardItem = Array.from(event.clipboardData?.items ?? [])
            .find(item => item.kind == "file" && item.type.startsWith("image/"));
          const file = clipboardItem?.getAsFile();
          if (!file) {
            return false;
          }
          const displayWidth = view.dom.clientWidth || rootEl.clientWidth;
          if (!displayWidth) {
            return false;
          }
          void Promise.resolve(onImagePaste(file, displayWidth)).catch(backgroundError);
          return true;
        },
      } : undefined,
      content: html,
      onTransaction: () => {
        // force re-render so `editor.isActive` works as expected
        editor = editor;
      },
      onUpdate: ({ editor }) => {
        html = lastHTML = editor.getHTML();
        dispatchEvent("change", html);
      },
    });
    lastHTML = editor.getHTML();
    html = lastHTML;
  }

  export function forceReload() {
    if (editor) {
      editor.destroy();
    }
    createEditor();
  }

  /** Push latest editor HTML into the bound `html` prop (call before save). */
  export function syncContent() {
    if (!editor) {
      return;
    }
    html = lastHTML = editor.getHTML();
  }

  onDestroy(() => {
    if (editor) {
      editor.destroy();
    }
    editorElementCreatedMutationObserver.disconnect();
  });

  const editorElementCreatedMutationObserver = new MutationObserver((mutationList, observer) => {
    for (let mutation of mutationList) {
      for (let element of mutation.addedNodes) {
        onEditorElementCreated(element as HTMLDivElement);
      }
    }
  });
  function onEditorElementCreated(el: HTMLDivElement) {
    if (tabindex) {
      el.tabIndex = tabindex;
    }
  }
</script>

<style>
  @import url(../../Mail/Message/content.css);

  /** Fix app.css, see .value */
  .html-editor :global(*) {
    user-select: text;
  }
  .html-editor {
    min-height: 100%;
    min-width: 0;
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
  }
  .html-editor :global(.ProseMirror) {
    min-height: 100%;
    height: auto;
    min-width: 0;
    max-width: 100%;
    box-sizing: border-box;
  }
  .html-editor :global(.ProseMirror:focus-visible) {
    outline: none;
  }
  .html-editor :global(mark) {
    padding: 0;
    border: none;
    border-radius: 0;
    text-decoration: inherit;
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
  }

  .html-editor :global(blockquote) {
    border-left: 3px solid var(--selected-bg);
    padding-inline-start: 20px;
    margin-inline-start: 0px;
  }
  .html-editor :global(blockquote table) {
    width: auto;
    max-width: 100%;
  }
  .html-editor :global(img) {
    max-width: 100%;
    height: auto;
  }
  .html-editor.fixed-image-size :global(img) {
    max-width: none !important;
  }
  /* ImageResize строит изображение как wrapper > container > img. Убираем
     адаптивные ограничения у обоих контейнеров, чтобы узкое окно композера
     незаметно не меняло сохранённую ширину изображения. */
  .html-editor.fixed-image-size :global(.ProseMirror > div:has(> div > img)) {
    max-width: none !important;
  }
  .html-editor.fixed-image-size :global(.ProseMirror > div > div:has(> img)) {
    max-width: none !important;
    flex-shrink: 0;
  }
  .html-editor :global(table) {
    border-collapse: collapse;
  }
  .html-editor :global(.tiptap > table) {
    width: 100%;
  }
  .html-editor :global(footer.signature table),
  .html-editor :global(footer table) {
    width: auto;
    max-width: none;
  }
  .html-editor :global(td),
  .html-editor :global(th) {
    border: 1px solid var(--border);
    padding: 4px 8px;
    vertical-align: top;
  }
  .html-editor :global(blockquote td),
  .html-editor :global(blockquote th) {
    border: none;
    padding: 0;
  }

  /** Undo the default margin of first/last <p> */
  .html-editor :global(.tiptap) {
    margin-top: -1em;
    margin-bottom: -1em;
  }
  .html-editor :global(.ProseMirror span[style*="font-size"]) {
    line-height: inherit;
  }
</style>
