<!-- Письмо или событие в сообщении чата. Письмо открывается из вложенного .eml в просмотрщике Jackdaw,
  у сообщений старых версий (только ссылка) — своя копия, если она есть. -->
<button type="button" class="link-card" on:click={() => catchErrors(open)} title={notFound || hint}>
  <hbox class="icon">
    {#if link.type == "email"}
      <MailIcon size="18" />
    {:else}
      <CalendarIcon size="18" />
    {/if}
  </hbox>
  <vbox class="info">
    <span class="title">{link.type == "email" ? link.subject : link.title}</span>
    <span class="details font-smallest">{details}</span>
    {#if emlState}
      <span class="details font-smallest" role="status">{emlState}</span>
    {/if}
    {#if notFound}
      <span class="not-found font-smallest" role="status">{notFound}</span>
    {/if}
  </vbox>
</button>

<script lang="ts">
  import type { ChatLinkRef } from "../../../logic/Chat/Jackdaw/JackdawChatProtocol";
  import { findLinkedEmail, findLinkedEvent, linkedEmailAttachment } from "../../../logic/Chat/Jackdaw/chatLinks";
  import type { Message } from "../../../logic/Abstract/Message";
  import { JackdawChatAttachment } from "../../../logic/Chat/Jackdaw/JackdawChatMessage";
  import { openFileInternally } from "../../Files/open";
  import { openEMailMessage } from "../../Mail/open";
  import { openEvent } from "../../Calendar/open";
  import { getDateTimeString } from "../../Util/date";
  import { catchErrors } from "../../Util/error";
  import MailIcon from "lucide-svelte/icons/mail";
  import CalendarIcon from "lucide-svelte/icons/calendar";
  import { t } from "../../../l10n/l10n";

  export let link: ChatLinkRef;
  /** Сообщение с карточкой: в его вложениях — само письмо (.eml). Нет — только ссылка. */
  export let message: Message | null = null;

  $: emlAttachment = message ? linkedEmailAttachment(message, link) : undefined;
  /** Письмо ещё грузится на сервер или скачивается: видно на карточке, ведь файл-чип скрыт */
  $: emlState = emlAttachment && $emlAttachment instanceof JackdawChatAttachment
    ? $emlAttachment.uploadProgress != null
      ? $t`Uploading ${Math.round($emlAttachment.uploadProgress * 100)} %`
      : $emlAttachment.downloadError
        ? $t`Download failed`
        : !$emlAttachment.content && !$emlAttachment.filepathLocal ? $t`Downloading…` : ""
    : "";

  let notFound = "";
  $: hint = link.type == "email" ? $t`Open the email` : $t`Open the event`;
  $: details = link.type == "email"
    ? [link.from, getDateTimeString(new Date(link.date))].filter(Boolean).join(" · ")
    : [getDateTimeString(new Date(link.start)), link.location].filter(Boolean).join(" · ");

  async function open() {
    notFound = "";
    if (link.type == "email") {
      if (emlAttachment) {
        if (!emlAttachment.content) {
          await emlAttachment.read(); // файл уже на диске
        }
        if (!emlAttachment.content && emlAttachment instanceof JackdawChatAttachment && emlAttachment.downloadError) {
          await emlAttachment.retryDownload();
        }
        if (emlAttachment.content) {
          // Как открытие .eml: письмо и его вложения в просмотрщике, HTML очищается как обычно
          await openFileInternally(new Uint8Array(await emlAttachment.content.arrayBuffer()), "message/rfc822");
        } else {
          notFound = $t`The email is still downloading. Try again in a moment.`;
        }
        return;
      }
      let email = await findLinkedEmail(link);
      if (email) {
        await openEMailMessage(email);
      } else {
        notFound = message?.outgoing
          ? $t`This email is not in your mailbox anymore.`
          : $t`Only a link to this email was sent, from an older version of Jackdaw Mail. Ask the sender to send it to the chat again.`;
      }
    } else {
      let event = findLinkedEvent(link);
      if (event) {
        openEvent(event, false);
      } else {
        notFound = $t`This event is not in your calendar.`;
      }
    }
  }
</script>

<style>
  .link-card {
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: 320px;
    margin-block: 4px;
    padding: 8px 12px;
    border: 1px solid var(--border);
    border-inline-start: 3px solid var(--selected-border, var(--icon-primary));
    border-radius: 8px;
    background-color: var(--main-bg);
    color: var(--main-fg);
    text-align: start;
    cursor: pointer;
  }
  .link-card:hover {
    background-color: var(--hover-bg);
  }
  .link-card:focus-visible {
    outline: 2px solid var(--selected-border);
    outline-offset: 2px;
  }
  .icon {
    flex: none;
    opacity: 0.8;
  }
  .info {
    min-width: 0;
    gap: 2px;
  }
  .title,
  .details {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .title {
    font-weight: 600;
  }
  .details {
    opacity: 0.75;
  }
  .not-found {
    color: var(--error-fg, #b00020);
  }
</style>
