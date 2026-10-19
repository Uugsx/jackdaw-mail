{#if notification}
  <vbox class="notification-bar"
    severity={$notification.severity}
    role={isUrgent($notification.severity) ? "alert" : "status"}
    aria-live={isUrgent($notification.severity) ? "assertive" : "polite"}
    style={notification.backgroundColor ? `background-color: ${notification.backgroundColor}; color: ${notification.textColor};` : ""}
    >
    <hbox class="row">
      <span class="icon" aria-hidden="true">
        <svelte:component this={iconFor($notification.severity)} size="16px" />
      </span>
      <div class="text">
        <span class="message value">{$notification.message}</span>
        {#if hint}
          <span class="hint">{hint}</span>
        {/if}
      </div>
      <hbox flex />
      {#each $notification.buttons.each as button}
        <Button
          classes="action small"
          label={button.label}
          onClick={() => {
            button.onClick() // close the bar right away, don't wait for the action
              .catch(showError);
            onClose(notification);
          }}
          />
      {/each}
      {#if technical}
        <button type="button" class="details-toggle"
          aria-expanded={detailsOpen}
          aria-controls="notification-details"
          on:click={() => detailsOpen = !detailsOpen}>
          {detailsOpen ? $t`Hide details` : $t`Details`}
        </button>
      {/if}
      <RoundButton
        icon={XIcon}
        classes="close small"
        label={$t`Remove this message`}
        onClick={() => onClose(notification)}
        />
    </hbox>
    {#if technical && detailsOpen}
      <vbox class="details" id="notification-details">
        <pre class="technical" tabindex="-1" bind:this={technicalEl}>{technical}</pre>
        <hbox>
          <button type="button" class="copy" on:click={copyDetails}>
            {copied ? $t`Copied` : $t`Copy details`}
          </button>
        </hbox>
      </vbox>
    {/if}
  </vbox>
{/if}

<script lang="ts">
  import { NotificationSeverity, type Notification } from "./Notification";
  import Button from "../Shared/Button.svelte";
  import RoundButton from "../Shared/RoundButton.svelte";
  import XIcon from "lucide-svelte/icons/x";
  import ErrorIcon from "lucide-svelte/icons/circle-alert";
  import WarningIcon from "lucide-svelte/icons/triangle-alert";
  import LoggedOutIcon from "lucide-svelte/icons/key-round";
  import InfoIcon from "lucide-svelte/icons/info";
  import { ArrayColl } from "svelte-collections";
  import { showError } from "../Util/error";
  import { describeError } from "../../logic/util/friendlyError";
  import { t } from "../../l10n/l10n";

  export let notifications: ArrayColl<Notification>;

  $: notification = notifications.sortBy(n => n.severity).first;
  $: ex = $notification?.ex as any;
  $: described = ex && !ex.isUserError ? describeError(ex) : null;
  // Подсказка нужна, только если текст на панели — наш понятный, а не свой текст вызывающего
  $: hint = described && $notification.message.endsWith(described.message) ? described.hint : null;
  $: technical = described ? technicalWithStack(described.technical, ex) : "";
  $: if (notification) {
    resetDetails(notification);
  }

  let detailsOpen = false;
  let copied = false;
  let technicalEl: HTMLPreElement;
  let shownNotification: Notification = null;

  function resetDetails(current: Notification) {
    if (current !== shownNotification) {
      shownNotification = current;
      detailsOpen = false;
      copied = false;
    }
  }

  /** Для поддержки нужен и стек: раньше он показывался в окне «Подробнее». */
  function technicalWithStack(technical: string, ex: any): string {
    let stack = typeof ex?.stack == "string" ? ex.stack : "";
    return [technical, stack].filter(Boolean).join("\n\n");
  }

  function onClose(notification: Notification) {
    notifications.remove(notification);
  }

  async function copyDetails() {
    try {
      await navigator.clipboard.writeText(technical);
      copied = true;
    } catch {
      if (technicalEl) {
        window.getSelection()?.selectAllChildren(technicalEl);
        technicalEl.focus();
      }
    }
  }

  function isUrgent(severity: NotificationSeverity): boolean {
    return severity == NotificationSeverity.UnexpectedError || severity == NotificationSeverity.Error;
  }

  function iconFor(severity: NotificationSeverity) {
    switch (severity) {
    case NotificationSeverity.UnexpectedError:
    case NotificationSeverity.Error:
      return ErrorIcon;
    case NotificationSeverity.Warning:
      return WarningIcon;
    case NotificationSeverity.LoggedOut:
      return LoggedOutIcon;
    default:
      return InfoIcon;
    }
  }
</script>

<style>
  /* Плоская полоса в тоне приложения: цвет состояния — только у иконки и
   * нижней границы, текст основным цветом (контраст WCAG AA в обеих темах). */
  .notification-bar {
    --bar-tone: var(--info-fg, #3C6E91);
    background-color: color-mix(in srgb, var(--bar-tone) 8%, var(--main-bg, Canvas));
    color: var(--main-fg, CanvasText);
    border-block-end: 1px solid color-mix(in srgb, var(--bar-tone) 40%, var(--border));
    font-size: 13px;
    line-height: 1.4;
    z-index: 3;
  }
  .notification-bar[severity="meltdown"] {
    --bar-tone: var(--danger-fg, #B84E3B);
    background-color: color-mix(in srgb, var(--bar-tone) 16%, var(--main-bg, Canvas));
  }
  .notification-bar[severity="error"] {
    --bar-tone: var(--danger-fg, #B84E3B);
  }
  .notification-bar[severity="warning"],
  .notification-bar[severity="logged-out"] {
    --bar-tone: var(--warning-fg, #8A5A00);
  }
  .row {
    align-items: center;
    gap: 8px;
    min-height: 36px;
    padding: 2px 8px 2px 14px;
  }
  .icon {
    display: flex;
    flex: none;
    color: var(--bar-tone);
  }
  .text {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    column-gap: 8px;
    padding-block: 6px;
    min-width: 0;
  }
  .message {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .hint {
    color: color-mix(in srgb, var(--main-fg, CanvasText) 75%, transparent);
    overflow-wrap: anywhere;
  }
  .details-toggle,
  .copy {
    flex: none;
    padding: 2px 4px;
    border: none;
    border-radius: 3px;
    background: none;
    color: var(--link-fg);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .details-toggle:hover,
  .copy:hover {
    color: var(--link-hover-fg, var(--link-fg));
    text-decoration: underline;
  }
  .details-toggle:focus-visible,
  .copy:focus-visible {
    outline: 2px solid var(--input-focus, Highlight);
    outline-offset: 1px;
  }
  .details {
    padding: 0 14px 8px 38px;
  }
  .technical {
    max-height: 9em;
    overflow: auto;
    margin: 0 0 4px;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: var(--border-radius, 6px);
    background-color: var(--main-bg, Canvas);
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 11px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    user-select: text;
  }
  .notification-bar :global(button.action) {
    padding: 4px 10px;
  }
</style>
