<vbox class="contact-start" flex>
  <PersonHeader person={contact} showChatButton={false} explainCall={true} />
  <vbox class="body">
    {#if state == "checking"}
      <p class="status" role="status">{$t`Checking whether ${contact.name} uses Jackdaw chat…`}</p>
    {:else if state == "offline"}
      <p class="status">{$t`Jackdaw chat is not connected on this device. Confirm your address for calls and chat in the settings.`}</p>
      <hbox class="actions">
        <Button label={$t`Open settings`} classes="filled" onClick={() => openSettingsCategoryByID("jackdaw-calls")} />
        <a class="mail-link" href="mailto:{mailAddress}">{$t`Send mail instead`}</a>
      </hbox>
    {:else if state == "own"}
      <p class="status">{$t`This is your own address. To chat, choose another contact.`}</p>
    {:else if state == "available"}
      <p class="status">{$t`${contact.name} uses Jackdaw chat. Messages are end-to-end encrypted.`}</p>
      <hbox class="actions">
        <Button label={$t`Write in Jackdaw chat`} classes="filled" onClick={openChat} />
      </hbox>
    {:else if state == "unavailable"}
      <p class="status">{$t`${contact.name} does not use Jackdaw chat yet, or has not confirmed this address. You can send an email.`}</p>
      <hbox class="actions">
        <a class="mail-link button-like" href="mailto:{mailAddress}">{$t`Send mail`}</a>
      </hbox>
    {:else if state == "error"}
      <p class="status error" role="alert">{errorText}</p>
      <hbox class="actions">
        <Button label={$t`Try again`} classes="secondary" onClick={check} />
      </hbox>
    {/if}
  </vbox>
</vbox>

<script lang="ts">
  /**
   * Контакт из адресной книги, с которым ещё нет чата: найден поиском в списке чатов.
   * Объясняет, можно ли написать и позвонить, и открывает чат Jackdaw одним нажатием.
   */
  import type { Person } from "../../logic/Abstract/Person";
  import { JACKDAW_CHAT_PROTOCOL, type JackdawChatAccount } from "../../logic/Chat/Jackdaw/JackdawChatAccount";
  import { callTargetEmails, getJackdawCallClient } from "../../logic/Meet/Jackdaw/JackdawCalls";
  import { appGlobal } from "../../logic/app";
  import { openSettingsCategoryByID } from "../Settings/Window/CategoriesUtils";
  import { selectedRoom } from "./selected";
  import PersonHeader from "./PersonHeader.svelte";
  import Button from "../Shared/Button.svelte";
  import { t } from "../../l10n/l10n";

  export let contact: Person;

  type State = "checking" | "offline" | "own" | "available" | "unavailable" | "error";
  let state: State = "checking";
  let errorText = "";
  /** Адрес, на который можно написать в чат Jackdaw */
  let chatEmail: string | null = null;

  const chatAccounts = appGlobal.chatAccounts;
  const callClient = getJackdawCallClient();
  $: chatAccount = $chatAccounts.find(acc => acc.protocol == JACKDAW_CHAT_PROTOCOL) as JackdawChatAccount | undefined;
  $: emails = callTargetEmails(contact);
  $: mailAddress = emails[0] ?? "";

  /* Перепроверка при смене контакта, подключении/отключении чата и смене своих адресов.
   * Примитивы: обновления справочника присутствия сами по себе проверку не повторяют. */
  $: chatOnline = !!($chatAccount && chatAccount?.isOnline);
  $: ownEmails = $callClient ? callClient.verifiedEmails.join(",") : "";
  $: contact, chatOnline, ownEmails, void check();
  let checkID = 0;
  async function check() {
    let id = ++checkID;
    chatEmail = null;
    errorText = "";
    if (emails.length && emails.every(email => callClient.verifiedEmails.includes(email))) {
      state = "own";
      return;
    }
    if (!chatOnline) {
      state = "offline";
      return;
    }
    state = "checking";
    try {
      for (let email of emails) {
        if (await chatAccount.canChatWith(email)) {
          if (id == checkID) {
            chatEmail = email;
            state = "available";
          }
          return;
        }
      }
      if (id == checkID) {
        state = "unavailable";
      }
    } catch (ex) {
      if (id == checkID) {
        errorText = ex?.message ?? String(ex);
        state = "error";
      }
    }
  }

  async function openChat() {
    if (!chatAccount || !chatEmail) {
      return;
    }
    $selectedRoom = await chatAccount.getDirectRoom(chatEmail);
  }
</script>

<style>
  .contact-start {
    min-width: 0;
  }
  .body {
    max-width: 36em;
    margin: 8px 15px 0;
  }
  .status {
    margin: 0;
    line-height: 1.45;
  }
  .status.error {
    color: var(--danger-fg, #b84e3b);
  }
  .actions {
    margin-block-start: 12px;
    gap: 12px;
    align-items: center;
  }
  .mail-link {
    color: var(--link-fg, var(--icon-primary));
  }
  .mail-link.button-like {
    padding: 6px 12px;
    border: 1px solid var(--border);
    border-radius: 6px;
    text-decoration: none;
    color: var(--main-fg);
  }
  .mail-link.button-like:hover {
    background: color-mix(in srgb, var(--main-fg) 6%, transparent);
  }
  .mail-link:focus-visible {
    outline: 2px solid var(--selected-border, var(--icon-primary));
    outline-offset: 2px;
  }
</style>
