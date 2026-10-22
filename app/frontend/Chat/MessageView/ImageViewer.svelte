<!-- Просмотр картинки из чата во весь экран: по клику на превью. Закрывается Escape, кликом по фону или крестиком. -->
<svelte:window on:keydown={onKey} />
<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="viewer" use:portalToBody on:click|self={close} role="dialog" aria-modal="true" aria-label={filename}>
  <img src={url} alt={filename} />
  <hbox class="bar">
    <span class="name" title={filename}>{filename}</span>
    <Button label={$t`Save`} icon={SaveIcon} iconSize="16px" classes="secondary" onClick={onSave} />
    <RoundButton label={$t`Close`} icon={XIcon} iconSize="16px" padding="6px" classes="secondary" onClick={close} />
  </hbox>
</div>

<script lang="ts">
  import Button from "../../Shared/Button.svelte";
  import RoundButton from "../../Shared/RoundButton.svelte";
  import SaveIcon from "lucide-svelte/icons/download";
  import XIcon from "lucide-svelte/icons/x";
  import { t } from "../../../l10n/l10n";

  export let url: string;
  export let filename: string;
  export let onSave: () => Promise<void> | void;
  export let close: () => void;

  function onKey(event: KeyboardEvent) {
    if (event.key == "Escape") {
      event.stopPropagation();
      close();
    }
  }

  /** Поверх всего окна: внутри ленты сообщений fixed-позиционирование обрезалось бы прокруткой */
  function portalToBody(node: HTMLElement) {
    document.body.append(node);
    return {
      destroy() {
        node.remove();
      },
    };
  }
</script>

<style>
  .viewer {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: rgba(0, 0, 0, 0.78);
    cursor: zoom-out;
  }
  img {
    max-width: calc(100vw - 64px);
    max-height: calc(100vh - 120px);
    object-fit: contain;
    border-radius: 6px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    cursor: default;
  }
  .bar {
    position: absolute;
    top: 16px;
    inset-inline: 16px;
    align-items: center;
    gap: 8px;
    color: white;
    cursor: default;
  }
  .name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }
</style>
