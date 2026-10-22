<!-- Письмо или событие в сообщении чата: по клику открывается своя копия, если она есть -->
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
    {#if notFound}
      <span class="not-found font-smallest" role="status">{notFound}</span>
    {/if}
  </vbox>
</button>

<script lang="ts">
  import type { ChatLinkRef } from "../../../logic/Chat/Jackdaw/JackdawChatProtocol";
  import { findLinkedEmail, findLinkedEvent } from "../../../logic/Chat/Jackdaw/chatLinks";
  import { openEMailMessage } from "../../Mail/open";
  import { openEvent } from "../../Calendar/open";
  import { getDateTimeString } from "../../Util/date";
  import { catchErrors } from "../../Util/error";
  import MailIcon from "lucide-svelte/icons/mail";
  import CalendarIcon from "lucide-svelte/icons/calendar";
  import { t } from "../../../l10n/l10n";

  export let link: ChatLinkRef;

  let notFound = "";
  $: hint = link.type == "email" ? $t`Open the email` : $t`Open the event`;
  $: details = link.type == "email"
    ? [link.from, getDateTimeString(new Date(link.date))].filter(Boolean).join(" · ")
    : [getDateTimeString(new Date(link.start)), link.location].filter(Boolean).join(" · ");

  async function open() {
    notFound = "";
    if (link.type == "email") {
      let email = await findLinkedEmail(link);
      if (email) {
        await openEMailMessage(email);
      } else {
        notFound = $t`This email is not in your mailbox.`;
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
