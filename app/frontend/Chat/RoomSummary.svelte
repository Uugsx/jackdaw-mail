<!-- Время и текст последнего сообщения в строке списка чатов. Отдельный компонент ради `$room`:
  в слоте списка комната не наблюдается, и новое сообщение не появлялось в строке до перезапуска. -->
{#if part == "time"}
  {#if $room.lastMessage}
    {getDateTimeString($room.lastMessage.sent)}
  {/if}
  {#if $room.unreadCount > 0}
    <span class="unread" aria-label={$t`${$room.unreadCount} unread`}>{$room.unreadCount}</span>
  {/if}
{:else if $room.lastMessage}
  {$room.lastMessage.text?.trim().substring(0, kPreviewLength) || fileLabel($room.lastMessage)}
{/if}

<script lang="ts">
  import type { ChatRoom } from "../../logic/Chat/ChatRoom";
  import type { ChatLinkRef } from "../../logic/Chat/Jackdaw/JackdawChatProtocol";
  import { linkText } from "../../logic/Chat/Jackdaw/chatLinks";
  import { getDateTimeString } from "../Util/date";
  import { t } from "../../l10n/l10n";

  /** in */
  export let room: ChatRoom;
  /** in: "time" — время и счётчик непрочитанных, "text" — начало текста */
  export let part: "time" | "text";

  /** Строка всё равно обрезается многоточием по ширине; длиннее нет смысла */
  const kPreviewLength = 80;

  /** Сообщение только с файлом или ссылкой: в строке списка — «📎 имя файла» или «Письмо: тема», а не пустота */
  function fileLabel(message: ChatRoom["lastMessage"]): string {
    let link = (message as { links?: ChatLinkRef[] } | null)?.links?.[0];
    if (link) {
      return linkText(link);
    }
    let file = message?.attachments?.first;
    return file ? `📎 ${file.filename || $t`File`}` : "";
  }
</script>

<style>
  .unread {
    margin-inline-start: 6px;
    min-width: 18px;
    padding: 0 5px;
    border-radius: 9px;
    background: var(--icon-primary);
    color: var(--main-bg, white);
    font-size: 11px;
    font-weight: 600;
    line-height: 18px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
</style>
