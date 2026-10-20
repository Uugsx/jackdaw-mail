<HeaderGroupBox>
  <hbox slot="header">
    {$t`Category shortcuts`}
  </hbox>
  <hbox class="subtitle">
    {$t`Click Assign, then press any key or mouse button. The shortcut applies the category to the selected messages.`}
  </hbox>

  {#if captureTarget}
    <hbox class="capture-status" role="status" aria-live="polite">
      <span>{$t`Waiting for a key or mouse button for`} <strong>{targetLabel(captureTarget)}</strong></span>
      <hbox flex />
      <Button
        label={$t`Cancel`}
        onClick={cancelCapture}
        classes="small plain"
        />
    </hbox>
  {/if}

  {#if shortcutRows.length}
    <vbox class="shortcut-list">
      {#each shortcutRows as row (row.target.type + ":" + row.target.id)}
        <hbox class="shortcut-row">
          <hbox class="target-name">
            {#if row.color}
              <span class="tag-dot" style="--tag-color: {row.color}" aria-hidden="true" />
            {/if}
            <span class="target-kind">{row.kind == "tag" ? $t`Category` : $t`Combination`}</span>
            <span class="target-label" title={row.label}>{row.label}</span>
          </hbox>
          <hbox flex />
          {#if row.shortcut}
            <kbd>{formatCategoryShortcut(row.shortcut)}</kbd>
          {:else}
            <span class="unassigned">{$t`Not assigned`}</span>
          {/if}
          <Button
            label={isCapturing(row.target) ? $t`Press a key…` : $t`Assign`}
            tooltip={$t`Assign a keyboard key or mouse button`}
            selected={isCapturing(row.target)}
            disabled={!!captureTarget && !isCapturing(row.target)}
            onClick={() => startCapture(row.target)}
            classes="small"
            />
          {#if row.shortcut}
            <Button
              label={$t`Clear`}
              tooltip={$t`Remove this shortcut`}
              onClick={() => clearShortcut(row.target)}
              classes="small plain"
              />
          {/if}
        </hbox>
      {/each}
    </vbox>
  {:else}
    <hbox class="empty-state">{$t`Add a category or category combination first.`}</hbox>
  {/if}

  {#if notice}
    <hbox class="notice" role="status" aria-live="polite">{notice}</hbox>
  {/if}
</HeaderGroupBox>

<svelte:window on:keydown={onCaptureKeydown} on:keyup={onCaptureKeyup} on:mousedown={onCaptureMouseDown} />

<script lang="ts">
  import HeaderGroupBox from "../../Shared/HeaderGroupBox.svelte";
  import Button from "../../Shared/Button.svelte";
  import { t } from "../../../l10n/l10n";
  import { availableTags, sortedTagList, type Tag } from "../../../logic/Abstract/Tag";
  import {
    tagCombinations,
    usableTagCombinations,
    type TagCombination,
  } from "../../../logic/Abstract/TagCombination";
  import {
    assignCategoryShortcut,
    categoryShortcutsChanged,
    clearCategoryShortcut,
    formatCategoryShortcut,
    getCategoryShortcut,
    keyboardCategoryShortcutFromEvent,
    mouseCategoryShortcutFromEvent,
    type CategoryShortcut,
    type CategoryShortcutTarget,
  } from "../../Mail/CategoryShortcuts";

  type ShortcutRow = {
    target: CategoryShortcutTarget;
    kind: "tag" | "combination";
    label: string;
    color?: string;
    shortcut: CategoryShortcut | null;
  };

  let captureTarget: CategoryShortcutTarget | null = null;
  let pendingModifier: { code: string; key: string } | null = null;
  let notice = "";

  $: shortcutRows = buildShortcutRows($availableTags.contents, $tagCombinations.contents, $categoryShortcutsChanged);

  function buildShortcutRows(
    tags: readonly Tag[],
    combinations: readonly TagCombination[],
    _revision: number,
  ): ShortcutRow[] {
    let rows: ShortcutRow[] = sortedTagList(tags).map(tag => {
      let target: CategoryShortcutTarget = { type: "tag", id: tag.name };
      return {
        target,
        kind: "tag",
        label: tag.name,
        color: tag.color,
        shortcut: getCategoryShortcut(target),
      };
    });
    rows.push(...usableTagCombinations(combinations).map(combination => {
      let target: CategoryShortcutTarget = { type: "combination", id: combination.id };
      return {
        target,
        kind: "combination" as const,
        label: combination.name,
        shortcut: getCategoryShortcut(target),
      };
    }));
    return rows;
  }

  function isCapturing(target: CategoryShortcutTarget): boolean {
    return !!captureTarget && captureTarget.type == target.type && captureTarget.id == target.id;
  }

  function targetLabel(target: CategoryShortcutTarget): string {
    if (target.type == "tag") {
      return target.id;
    }
    return tagCombinations.find(combination => combination.id == target.id)?.name ?? target.id;
  }

  function startCapture(target: CategoryShortcutTarget): void {
    captureTarget = target;
    pendingModifier = null;
    notice = "";
  }

  function cancelCapture(): void {
    captureTarget = null;
    pendingModifier = null;
  }

  function onCaptureKeydown(event: KeyboardEvent): void {
    if (!captureTarget) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (isModifierKey(event)) {
      pendingModifier = { code: event.code || event.key, key: event.key || event.code };
      return;
    }
    let shortcut = keyboardCategoryShortcutFromEvent(event);
    if (shortcut) {
      saveCapturedShortcut(shortcut);
    }
  }

  function onCaptureKeyup(event: KeyboardEvent): void {
    if (!captureTarget || !pendingModifier || !isModifierKey(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.code != pendingModifier.code && event.key != pendingModifier.key) {
      return;
    }
    let shortcut = keyboardCategoryShortcutFromEvent(event);
    if (shortcut) {
      saveCapturedShortcut(shortcut);
    }
  }

  function onCaptureMouseDown(event: MouseEvent): void {
    if (!captureTarget || isShortcutControl(event.target)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    let shortcut = mouseCategoryShortcutFromEvent(event);
    if (shortcut) {
      saveCapturedShortcut(shortcut);
    }
  }

  function isShortcutControl(target: EventTarget | null): boolean {
    return target instanceof Element && !!target.closest("button, input, select, textarea, a");
  }

  function isModifierKey(event: KeyboardEvent): boolean {
    return ["Control", "Shift", "Alt", "Meta"].includes(event.key);
  }

  function saveCapturedShortcut(shortcut: CategoryShortcut): void {
    if (!captureTarget) {
      return;
    }
    let target = captureTarget;
    let displaced = assignCategoryShortcut(target, shortcut);
    notice = displaced
      ? $t`The shortcut was moved from ${targetLabel(displaced)}.`
      : $t`Assigned ${formatCategoryShortcut(shortcut)} to ${targetLabel(target)}.`;
    cancelCapture();
  }

  function clearShortcut(target: CategoryShortcutTarget): void {
    clearCategoryShortcut(target);
    notice = $t`Shortcut cleared for ${targetLabel(target)}.`;
  }
</script>

<style>
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
  .target-name {
    flex: 1 1 12em;
    min-width: 12em;
    max-width: 100%;
    align-items: center;
    gap: 6px;
  }
  .target-kind {
    flex-shrink: 0;
    opacity: 0.65;
    font-size: 0.8em;
  }
  .target-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tag-dot {
    width: 10px;
    height: 10px;
    flex-shrink: 0;
    border-radius: 50%;
    background: var(--tag-color);
  }
  kbd {
    min-width: 4em;
    padding: 3px 7px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--main-bg);
    color: var(--main-fg);
    font: inherit;
    font-size: 0.9em;
    text-align: center;
    white-space: nowrap;
  }
  .shortcut-row :global(button) {
    white-space: nowrap;
  }
  .unassigned,
  .empty-state {
    opacity: 0.65;
  }
  .unassigned {
    min-width: 4em;
    text-align: center;
  }
</style>
