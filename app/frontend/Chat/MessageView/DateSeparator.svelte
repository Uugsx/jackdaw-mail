{#if message.sent.toDateString() != previousMessage?.sent.toDateString() }
  <hbox class="date-separator font-small value">
    {longDayFormat.format(message.sent)}
  </hbox>
{/if}

<script lang="ts">
  import type { Message } from "../../../logic/Abstract/Message";
  import { getDateTimeLocale } from "../../../l10n/l10n";

  export let message: Message;
  export let previousMessage: Message = null;

  // Язык дат приложения, а не системы: иначе в арабском интерфейсе дата по-русски
  const longDayFormat = Intl.DateTimeFormat(getDateTimeLocale(), {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
</script>

<style>
  .date-separator {
    width: 40%;
    align-self: center;
    justify-content: center;
    margin: 20px 20px 0px 20px;
    padding: 5px;
    color: var(--offset-fg);
    opacity: 60%; /* TODO Should change only text color */
  }
</style>
