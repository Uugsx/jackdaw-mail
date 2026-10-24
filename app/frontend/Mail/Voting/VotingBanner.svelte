<!-- Плашка голосования над письмом: у получателя — кнопки вариантов, у отправителя — сводка ответов -->
{#if options.length}
  <hbox class="voting font-small" role="status">
    <hbox class="icon"><VoteIcon size="16px" /></hbox>
    <vbox class="text" flex>
      {#if message.outgoing}
        <span>{$t`Voting responses`}: {tallyText(tally)}</span>
      {:else if voted}
        <span>{$t`You voted: ${voted}`}</span>
      {:else}
        <span>{$t`${senderName} asks you to vote.`}</span>
      {/if}
      {#if error}
        <span class="error" role="alert">{error}</span>
      {/if}
    </vbox>
    {#if !message.outgoing && !readOnly}
      <hbox class="actions">
        {#each options as option}
          <Button label={option} classes="small" plain={voted != null && voted != option}
            disabled={busy} onClick={() => vote(option)} />
        {/each}
      </hbox>
    {/if}
  </hbox>
{/if}

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import type { VotingTally } from "../../../logic/Mail/Voting/Voting";
  import { myVoteOn, sendVote, tallyForSent, tallyText, votingOptionsOf } from "./votingMessage";
  import Button from "../../Shared/Button.svelte";
  import VoteIcon from "lucide-svelte/icons/vote";
  import { t } from "../../../l10n/l10n";

  export let message: EMail;
  export let readOnly = false;

  let options: string[] = [];
  let tally: VotingTally[] = [];
  let voted: string | null = null;
  let busy = false;
  let error = "";
  let loadedFor: EMail | null = null;

  $: senderName = message.from?.name || message.from?.emailAddress || "";
  // Заголовки появляются после загрузки MIME — пересчитываем при изменении письма
  $: $message, load(message);

  async function load(current: EMail) {
    if (loadedFor != current) {
      loadedFor = current;
      options = [];
      error = "";
      busy = false;
    }
    let found = await votingOptionsOf(current);
    if (loadedFor != current) {
      return;
    }
    options = found;
    voted = myVoteOn(current);
    tally = current.outgoing && found.length ? tallyForSent(current, found) : [];
  }

  async function vote(option: string) {
    busy = true;
    error = "";
    try {
      await sendVote(message, option);
      voted = option;
    } catch (ex) {
      error = ex?.message ?? String(ex);
    } finally {
      busy = false;
    }
  }
</script>

<style>
  .voting {
    align-items: center;
    gap: 0.5rem;
    margin-block: 0.5rem 0.25rem;
    padding: 0.375rem 0.625rem;
    border-radius: 6px;
    background-color: var(--surface-subtle, color-mix(in srgb, var(--border) 18%, transparent));
    border: 1px solid var(--border);
    max-width: 100%;
  }
  .icon {
    flex: none;
    opacity: 0.75;
  }
  .actions {
    gap: 6px;
    flex-wrap: wrap;
  }
  .error {
    color: var(--danger-fg);
  }
</style>
