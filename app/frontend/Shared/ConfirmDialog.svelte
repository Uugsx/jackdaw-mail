<script context="module" lang="ts">
  let nextDialogId = 0;
</script>

{#if open}
  <div class="confirm-backdrop" use:portalToBody>
    <div
      class="confirm-dialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={messageId}
      tabindex="-1"
      bind:this={dialogElement}
      on:keydown={onKeydown}>
      <h2 id={titleId}>{title}</h2>
      <p id={messageId}>{message}</p>
      <slot />
      <div class="actions">
        {#if showCancel}
          <Button
            label={resolvedCancelLabel}
            plain
            bind:buttonEl={cancelButton}
            onClick={cancel} />
        {/if}
        {#if extraLabel}
          <Button
            label={extraLabel}
            classes="secondary"
            bind:buttonEl={extraButton}
            onClick={extra} />
        {/if}
        <Button
          label={resolvedConfirmLabel}
          classes="filled"
          bind:buttonEl={confirmButton}
          onClick={confirm} />
      </div>
    </div>
  </div>
{/if}

<script lang="ts">
  import { createEventDispatcher, tick } from "svelte";
  import { t } from "../../l10n/l10n";
  import Button from "./Button.svelte";

  export let open = false;
  export let title = "";
  export let message = "";
  export let confirmLabel: string = null;
  export let cancelLabel: string = null;
  /** Третий вариант между отменой и подтверждением; null — кнопки нет */
  export let extraLabel: string = null;
  /** false — только сообщение с одной кнопкой «OK» */
  export let showCancel = true;

  const dispatch = createEventDispatcher<{ confirm: void; cancel: void; extra: void }>();
  const dialogNumber = ++nextDialogId;
  const titleId = `confirm-dialog-title-${dialogNumber}`;
  const messageId = `confirm-dialog-message-${dialogNumber}`;

  let dialogElement: HTMLElement;
  let cancelButton: HTMLButtonElement;
  let confirmButton: HTMLButtonElement;
  let extraButton: HTMLButtonElement;
  let previouslyFocused: HTMLElement = null;
  let wasOpen = false;

  $: resolvedConfirmLabel = confirmLabel ?? $t`OK`;
  $: resolvedCancelLabel = cancelLabel ?? $t`Cancel`;

  $: if (open != wasOpen) {
    wasOpen = open;
    if (open) {
      previouslyFocused = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      void focusConfirmButton();
    } else {
      let focusTarget = previouslyFocused;
      previouslyFocused = null;
      if (focusTarget?.isConnected) {
        focusTarget.focus();
      }
    }
  }

  async function focusConfirmButton() {
    await tick();
    if (open) {
      confirmButton?.focus();
    }
  }

  function cancel() {
    open = false;
    dispatch("cancel");
  }

  function confirm() {
    open = false;
    dispatch("confirm");
  }

  function extra() {
    open = false;
    dispatch("extra");
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key == "Escape") {
      event.preventDefault();
      cancel();
      return;
    }
    if (event.key != "Tab") {
      return;
    }

    let buttons = [cancelButton, extraLabel ? extraButton : null, confirmButton].filter(
      (button): button is HTMLButtonElement => !!button,
    );
    if (!buttons.length) {
      event.preventDefault();
      dialogElement?.focus();
      return;
    }

    let firstButton = buttons[0];
    let lastButton = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement == firstButton) {
      event.preventDefault();
      lastButton.focus();
    } else if (!event.shiftKey && document.activeElement == lastButton) {
      event.preventDefault();
      firstButton.focus();
    }
  }

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
  .confirm-backdrop {
    position: fixed;
    inset: 0;
    z-index: 11001;
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    padding: 24px;
    background: rgba(var(--shadow-color), 0.36);
  }
  .confirm-dialog {
    width: min(100%, 440px);
    box-sizing: border-box;
    padding: 20px;
    border: 1px solid var(--border);
    border-radius: var(--border-radius);
    background: var(--main-bg);
    color: var(--main-fg);
    box-shadow: 0 14px 40px rgba(var(--shadow-color), 0.24);
  }
  h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    line-height: 1.3;
  }
  p {
    margin: 12px 0 0;
    line-height: 1.45;
    overflow-wrap: anywhere;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 20px;
  }
  @media (max-width: 480px) {
    .confirm-backdrop {
      padding: 16px;
    }
    .confirm-dialog {
      padding: 16px;
    }
    .actions {
      flex-wrap: wrap;
    }
  }
</style>
