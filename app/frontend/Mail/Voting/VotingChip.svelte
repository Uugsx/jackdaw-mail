<!-- Лента редактора: «Голосование» — варианты ответа для получателей, как кнопки голосования в Outlook -->
<button type="button" class="ribbon-btn option-chip"
  class:on={options.length > 0}
  title={options.length ? $t`Voting buttons` + ": " + options.join("; ") : $t`Use voting buttons`}
  aria-haspopup="menu"
  aria-expanded={menuOpen}
  bind:this={anchor}
  on:click={() => menuOpen = !menuOpen}>
  <VoteIcon size="16px" />
  <span>{$t`Voting buttons`}</span>
</button>

{#if anchor}
  <Menu bind:isMenuOpen={menuOpen} anchor={anchor} boundaryElSel=".mail-composer-window">
    {#each kVotingPresets as preset}
      <MenuItem
        label={votingPresetOptions(preset).join("; ")}
        selected={sameOptions(options, votingPresetOptions(preset))}
        onClick={() => setOptions(votingPresetOptions(preset))} />
    {/each}
    <MenuDivider />
    <MenuLabel label={$t`Custom, separated by semicolons`} />
    <hbox class="custom">
      <input type="text" class="font-small"
        placeholder={$t`For example: Monday; Tuesday; Wednesday`}
        bind:value={custom}
        on:keydown={event => { if (event.key == "Enter") { event.preventDefault(); applyCustom(); } }} />
      <Button plain label={$t`OK`} disabled={!parseVotingOptions(custom).length} onClick={applyCustom} />
    </hbox>
    {#if options.length}
      <MenuDivider />
      <MenuItem label={$t`Remove voting buttons`} icon={RemoveIcon} onClick={() => setOptions([])} />
    {/if}
  </Menu>
{/if}

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import {
    kVotingHeader, kVotingPresets, parseVotingOptions, votingHeaderValue, votingPresetOptions,
  } from "../../../logic/Mail/Voting/Voting";
  import { outgoingVotingOptions } from "../../../logic/Mail/Voting/VotingExchange";
  import Menu from "../../Shared/Menu/Menu.svelte";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import MenuLabel from "../../Shared/Menu/MenuLabel.svelte";
  import MenuDivider from "../../Shared/Menu/MenuDivider.svelte";
  import Button from "../../Shared/Button.svelte";
  import VoteIcon from "lucide-svelte/icons/vote";
  import RemoveIcon from "lucide-svelte/icons/x";
  import { t } from "../../../l10n/l10n";

  export let mail: EMail;

  let anchor: HTMLButtonElement;
  let menuOpen = false;
  let custom = "";
  let version = 0;

  $: options = (version, mail ? outgoingVotingOptions(mail) : []);

  function sameOptions(a: string[], b: string[]): boolean {
    return a.length == b.length && a.every((option, i) => option == b[i]);
  }

  function setOptions(list: string[]) {
    for (let key of [...mail.headers.keys()]) {
      if (key.toLowerCase() == kVotingHeader) {
        mail.headers.removeKey(key);
      }
    }
    let parsed = parseVotingOptions(list);
    if (parsed.length) {
      mail.headers.set("X-Jackdaw-Voting", votingHeaderValue(parsed));
    }
    version++;
    menuOpen = false;
  }

  function applyCustom() {
    let parsed = parseVotingOptions(custom);
    if (parsed.length) {
      setOptions(parsed);
      custom = "";
    }
  }
</script>

<style>
  /* Как чипы ленты редактора (ComposeRibbon.svelte): её стили сюда не доходят */
  .ribbon-btn.option-chip {
    display: inline-flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    gap: 4px;
    height: 28px;
    padding: 4px 10px;
    border: 1px solid var(--toolbar-control-border);
    border-radius: 6px;
    background: var(--toolbar-control-bg);
    color: var(--headerbar-fg);
    font: inherit;
    font-size: 10px;
    line-height: 1;
    cursor: default;
    flex-shrink: 0;
    transition: background-color 160ms ease, color 160ms ease, border-color 160ms ease;
  }
  .ribbon-btn.option-chip:hover {
    background: var(--hover-bg);
    color: var(--hover-fg);
  }
  .ribbon-btn.option-chip.on {
    background: var(--selected-bg);
    color: var(--selected-fg);
    border-color: transparent;
  }
  .ribbon-btn :global(svg) {
    display: block;
    flex-shrink: 0;
  }
  .custom {
    align-items: center;
    gap: 4px;
    padding: 4px 12px 8px;
  }
  .custom input {
    flex: 1 1 auto;
    min-width: 16em;
  }
</style>
