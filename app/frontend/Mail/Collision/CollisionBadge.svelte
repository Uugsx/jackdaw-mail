{#if label}
  {#if compact}
    <span class="collision compact {label.kind}" title={details}>
      <svelte:component this={icons[label.kind]} size={12} aria-hidden="true" />
      <span class="text">{label.text}</span>
    </span>
  {:else}
    <hbox class="collision {label.kind}" title={details}>
      <svelte:component this={icons[label.kind]} size={14} aria-hidden="true" />
      <span class="text" role="status" aria-live="polite">{label.text}</span>
      {#if colleague}
        <Button
          label={$t`Open chat`}
          icon={ChatIcon}
          iconSize="14px"
          classes="secondary"
          onClick={() => openColleagueChat(colleague)}
          />
      {/if}
    </hbox>
  {/if}
{/if}

<script lang="ts">
  /**
   * «Читает: Имя», «Отвечает: Имя» или «Ответил: Имя, 12:34» для письма общего ящика.
   * Пересчитывается только при изменении состояния коллег (`presence.revision`).
   */
  import type { EMail } from "../../../logic/Mail/EMail";
  import {
    chatColleague,
    collisionDetails,
    collisionLabel,
    collisionStatusFor,
    getSharedMailboxPresence,
    openColleagueChat,
  } from "./collisionPresence";
  import Button from "../../Shared/Button.svelte";
  import ViewingIcon from "lucide-svelte/icons/eye";
  import ReplyingIcon from "lucide-svelte/icons/pen-line";
  import RepliedIcon from "lucide-svelte/icons/reply";
  import ChatIcon from "lucide-svelte/icons/message-circle";
  import { t } from "../../../l10n/l10n";

  export let message: EMail;
  /** Строка списка писем: без кнопки и без объявлений для чтения с экрана */
  export let compact = false;

  const presence = getSharedMailboxPresence();
  const icons = { viewing: ViewingIcon, replying: ReplyingIcon, replied: RepliedIcon };

  $: status = ($presence.revision, $t, collisionStatusFor(message));
  $: label = status ? collisionLabel(status) : null;
  $: details = status ? collisionDetails(status) : "";
  $: colleague = compact ? null : chatColleague(status);
</script>

<style>
  .collision {
    align-items: center;
    gap: 6px;
    min-width: 0;
    color: var(--warning-fg, currentColor);
  }
  .collision.viewing {
    color: inherit;
    opacity: 0.8;
  }
  .collision.replied {
    color: var(--success-fg, currentColor);
  }
  .collision:not(.compact) {
    margin: 4px 0 0;
    padding: 4px 8px;
    border-radius: var(--border-radius);
    background: color-mix(in srgb, currentColor 10%, transparent);
    font-size: 13px;
  }
  .collision:not(.compact) .text {
    flex: 0 1 auto;
    min-width: 0;
  }
  .compact {
    display: inline-flex;
    flex: 0 1 auto;
    max-width: 45%;
    padding: 0 6px;
    border-radius: 999px;
    background: color-mix(in srgb, currentColor 12%, transparent);
    font-size: 11px;
    line-height: 16px;
    white-space: nowrap;
  }
  .text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .collision :global(svg) {
    flex: none;
  }
</style>
