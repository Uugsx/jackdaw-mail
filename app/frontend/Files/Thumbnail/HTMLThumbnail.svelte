<!-- Чужой HTML-файл без sandbox получил бы origin окна приложения (blob:) и доступ к нему.
  PDF-просмотрщику Chromium sandbox мешает, а скриптов страниц в нём нет. -->
<iframe
  src={$file.url}
  sandbox={isPDF ? undefined : ""}
  title={$file.name}
  class:preview
  scrolling={preview ? "no" : null}
  />

<script lang="ts">
  import { File } from "../../../logic/Files/File";

  export let file: File;
  export let preview: boolean;

  $: isPDF = $file.name?.toLowerCase().endsWith(".pdf") || $file.mimetype == "application/pdf";
</script>

<script lang="ts" context="module">
  export const kSupportedExt = ["html", "htm", "shtml", "pdf", "md", "txt"];
</script>

<style>
  iframe {
    border: none;
    width: 100%;
    height: 100%;
  }
  iframe.preview {
    pointer-events: none;
  }
</style>
