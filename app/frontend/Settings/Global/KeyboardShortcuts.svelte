<vbox class="keyboard-shortcuts-settings">
  <HeaderGroupBox>
    <hbox slot="header">
      {$t`Keyboard shortcuts`}
    </hbox>
    <hbox class="subtitle">
      {$t`Assign your own key combinations to mail actions. Custom shortcuts work while Mail is active and are ignored while typing.`}
    </hbox>

    {#if captureActionId}
      <hbox class="capture-status" role="status" aria-live="polite">
        <span>{$t`Waiting for a key for`} <strong>{actionLabel(captureActionId)}</strong></span>
        <hbox flex />
        <Button
          label={$t`Cancel`}
          onClick={cancelCapture}
          classes="small plain"
          />
      </hbox>
    {/if}

    <vbox class="shortcut-list">
      {#each configurableKeyboardActions as action (action.id + ":" + shortcutRevision)}
        {@const assignedShortcut = getKeyboardShortcut(action.id)}
        <hbox class="shortcut-row">
          <hbox class="action-name">
            <span>{action.label}</span>
          </hbox>
          <hbox flex />
          {#if assignedShortcut}
            <kbd>{formatKeyboardShortcut(assignedShortcut)}</kbd>
          {:else if action.defaultShortcut}
            <span class="default-shortcut">{$t`Built-in: ${formatKeyboardShortcut(action.defaultShortcut)}`}</span>
          {:else}
            <span class="unassigned">{$t`Not assigned`}</span>
          {/if}
          <Button
            label={isCapturing(action.id) ? $t`Press a key…` : $t`Assign`}
            tooltip={$t`Assign a keyboard shortcut`}
            selected={isCapturing(action.id)}
            disabled={!!captureActionId && !isCapturing(action.id)}
            onClick={() => startCapture(action.id)}
            classes="small"
            />
          {#if assignedShortcut}
            <Button
              label={$t`Clear`}
              tooltip={$t`Remove this shortcut`}
              onClick={() => clearShortcut(action.id)}
              classes="small plain"
              />
          {/if}
        </hbox>
      {/each}
    </vbox>
  </HeaderGroupBox>

  {#if notice}
    <hbox class="notice" role="status" aria-live="polite">{notice}</hbox>
  {/if}
</vbox>

<svelte:window on:keydown={onCaptureKeydown} on:keyup={onCaptureKeyup} />

<script lang="ts">
  import HeaderGroupBox from "../../Shared/HeaderGroupBox.svelte";
  import Button from "../../Shared/Button.svelte";
  import { t } from "../../../l10n/l10n";
  import {
    assignKeyboardShortcut,
    clearKeyboardShortcut,
    formatKeyboardShortcut,
    getKeyboardShortcut,
    isModifierKey,
    isModifierOnlyKeyboardShortcut,
    isReservedKeyboardShortcut,
    keyboardShortcutFromEvent,
    keyboardShortcutsChanged,
    type KeyboardShortcut,
  } from "../../Keyboard/KeyboardShortcuts";
  import {
    configurableKeyboardActions,
    getConfigurableKeyboardAction,
    type ConfigurableKeyboardActionId,
  } from "../../Keyboard/KeyboardActions";
  import { findCategoryShortcut } from "../../Mail/CategoryShortcuts";

  let captureActionId: ConfigurableKeyboardActionId | null = null;
  let pendingModifier: { code: string; key: string } | null = null;
  let notice = "";

  $: shortcutRevision = $keyboardShortcutsChanged;

  function actionLabel(actionId: string): string {
    return getConfigurableKeyboardAction(actionId)?.label ?? actionId;
  }

  function isCapturing(actionId: ConfigurableKeyboardActionId): boolean {
    return captureActionId == actionId;
  }

  function startCapture(actionId: ConfigurableKeyboardActionId): void {
    captureActionId = actionId;
    pendingModifier = null;
    notice = "";
  }

  function cancelCapture(): void {
    captureActionId = null;
    pendingModifier = null;
  }

  function onCaptureKeydown(event: KeyboardEvent): void {
    if (!captureActionId) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.key == "Escape") {
      cancelCapture();
      return;
    }
    if (isModifierKey(event)) {
      pendingModifier = { code: event.code || event.key, key: event.key || event.code };
      return;
    }
    const shortcut = keyboardShortcutFromEvent(event);
    if (shortcut) {
      saveCapturedShortcut(shortcut);
    }
  }

  function onCaptureKeyup(event: KeyboardEvent): void {
    if (!captureActionId || !pendingModifier || !isModifierKey(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.code != pendingModifier.code && event.key != pendingModifier.key) {
      return;
    }
    const shortcut = keyboardShortcutFromEvent(event);
    if (shortcut) {
      saveCapturedShortcut(shortcut);
    }
  }

  function saveCapturedShortcut(shortcut: KeyboardShortcut): void {
    if (!captureActionId) {
      return;
    }
    if (isModifierOnlyKeyboardShortcut(shortcut)) {
      notice = $t`Choose a key together with an optional modifier.`;
      pendingModifier = null;
      return;
    }
    if (isReservedKeyboardShortcut(shortcut)) {
      notice = $t`This shortcut is reserved by the system or application menu. Choose another one.`;
      pendingModifier = null;
      return;
    }
    if (findCategoryShortcut(shortcut)) {
      notice = $t`This shortcut is already assigned to a category. Choose another one.`;
      pendingModifier = null;
      return;
    }
    const actionId = captureActionId;
    const displaced = assignKeyboardShortcut(actionId, shortcut);
    notice = displaced
      ? $t`The shortcut was moved from ${actionLabel(displaced)}.`
      : $t`Assigned ${formatKeyboardShortcut(shortcut)} to ${actionLabel(actionId)}.`;
    cancelCapture();
  }

  function clearShortcut(actionId: ConfigurableKeyboardActionId): void {
    clearKeyboardShortcut(actionId);
    notice = $t`Shortcut cleared for ${actionLabel(actionId)}.`;
  }
</script>

<style>
  .keyboard-shortcuts-settings {
    max-width: 56em;
  }
  .subtitle {
    margin-block-end: 12px;
  }
  .capture-status,
  .notice {
    align-items: center;
    gap: 8px;
    margin-block-end: 12px;
    padding: 8px 10px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--selected-bg) 45%, transparent);
  }
  .shortcut-list {
    gap: 4px;
  }
  .shortcut-row {
    min-height: 32px;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    padding: 4px 0;
  }
  .action-name {
    flex: 1 1 16em;
    min-width: 16em;
    max-width: 100%;
  }
  kbd,
  .default-shortcut,
  .unassigned {
    min-width: 8em;
    padding: 3px 7px;
    text-align: center;
    white-space: nowrap;
  }
  kbd {
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--main-bg);
    color: var(--main-fg);
    font: inherit;
    font-size: 0.9em;
  }
  .default-shortcut,
  .unassigned {
    opacity: 0.65;
  }
  .shortcut-row :global(button) {
    white-space: nowrap;
  }
</style>
