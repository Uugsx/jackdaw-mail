<!-- Настройки → Почта → Внешний вид: вид списка писем, разделители и столбцы -->
<vbox class="message-list-appearance">
  <hbox class="subtitle">
    {$t`Column headers sort the list: click once, click again to reverse. Drag a header to move the column, drag its edge to change the width. Right-click the headers for these options.`}
  </hbox>
  <vbox class="options" role="radiogroup" aria-label={$t`Message list layout`}>
    <label class="radio">
      <input type="radio" value="auto" bind:group={layout} on:change={saveLayout} />
      {$t`Automatic: table when the list is wide, cards when it is narrow`}
    </label>
    <label class="radio">
      <input type="radio" value="table" bind:group={layout} on:change={saveLayout} />
      {$t`Table with columns`}
    </label>
    <label class="radio">
      <input type="radio" value="cards" bind:group={layout} on:change={saveLayout} />
      {$t`Two-line cards`}
    </label>
  </vbox>
  <label class="checkbox">
    <input type="checkbox" checked={dividers} on:change={toggleDividers} />
    {$t`Lines between messages`}
  </label>

  <hbox class="columns-title">{$t`Columns`}</hbox>
  <vbox class="columns" role="list">
    {#each prefs.order as id, index (id)}
      {@const def = mailListColumnDefs[id]}
      <hbox class="column-row" role="listitem">
        <label class="checkbox column-label" title={def.required ? $t`This column is always shown` : undefined}>
          <input type="checkbox"
            checked={!prefs.hidden.includes(id)}
            disabled={def.required}
            on:change={event => setVisible(id, event.currentTarget.checked)} />
          <span class="name">{def.label()}</span>
        </label>
        <button type="button" class="arrow-button"
          aria-label={$t`Move ${def.label()} up`}
          title={$t`Move up`}
          disabled={index == 0}
          on:click={() => move(id, index - 1)}>↑</button>
        <button type="button" class="arrow-button"
          aria-label={$t`Move ${def.label()} down`}
          title={$t`Move down`}
          disabled={index == prefs.order.length - 1}
          on:click={() => move(id, index + 2)}>↓</button>
      </hbox>
    {/each}
  </vbox>
  <hbox class="actions">
    <Button label={$t`Reset columns`} plain onClick={resetMailListColumns} />
  </hbox>
</vbox>

<script lang="ts">
  import Button from "../../Shared/Button.svelte";
  import {
    mailListColumnDefs,
    mailListColumnsSetting,
    mailListDividersSetting,
    mailListLayoutSetting,
    moveMailListColumnBefore,
    normalizeMailListColumnPrefs,
    normalizeMailListDividers,
    normalizeMailListLayout,
    resetMailListColumns,
    setMailListColumnVisible,
    updateMailListColumns,
    type MailListColumnId,
    type MailListLayout,
  } from "../../Mail/mailListColumns";
  import { t } from "../../../l10n/l10n";

  let layout: MailListLayout = normalizeMailListLayout($mailListLayoutSetting.value);
  $: prefs = normalizeMailListColumnPrefs($mailListColumnsSetting.value);
  $: dividers = normalizeMailListDividers($mailListDividersSetting.value);
  // Меню вида над списком может поменять вид, пока открыты настройки
  $: layout = normalizeMailListLayout($mailListLayoutSetting.value);

  function saveLayout() {
    mailListLayoutSetting.value = layout;
  }

  function toggleDividers() {
    mailListDividersSetting.value = !dividers;
  }

  function setVisible(id: MailListColumnId, visible: boolean) {
    updateMailListColumns(current => setMailListColumnVisible(current, id, visible));
  }

  /** Ставит столбец перед позицией `beforeIndex` в полном порядке столбцов */
  function move(id: MailListColumnId, beforeIndex: number) {
    updateMailListColumns(current => {
      let before = current.order[beforeIndex] ?? null;
      return moveMailListColumnBefore(current, id, before);
    });
  }
</script>

<style>
  .message-list-appearance {
    gap: 10px;
  }
  .subtitle {
    margin-block-end: 6px;
  }
  .options {
    gap: 8px;
  }
  .radio,
  .checkbox {
    align-items: center;
    gap: 8px;
  }
  .columns-title {
    margin-block-start: 8px;
    font-weight: 600;
  }
  .columns {
    gap: 2px;
    max-width: 360px;
  }
  .column-row {
    align-items: center;
    gap: 4px;
    min-height: 28px;
  }
  .column-label {
    flex: 1 1 auto;
    min-width: 0;
  }
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .arrow-button {
    width: 28px;
    height: 24px;
    border: 1px solid var(--border);
    border-radius: var(--border-radius);
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
  .arrow-button:hover:not(:disabled) {
    background-color: var(--hover-bg);
    color: var(--hover-fg);
  }
  .arrow-button:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .arrow-button:focus-visible {
    outline: 2px solid var(--input-focus);
    outline-offset: 1px;
  }
</style>
