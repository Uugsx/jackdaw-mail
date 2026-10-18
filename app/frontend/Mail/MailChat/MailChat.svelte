<Splitter name="persons-list" initialRightRatio={4}>
  <vbox class="left-pane" slot="left">
    <hbox class="buttons">
      <AccountDropDown
        bind:selectedAccount={$selectedAccount}
        accounts={accounts}
        filterByWorkspace={true}
        />
      <hbox flex class="spacer" />
      <WriteButton account={$selectedAccount} />
    </hbox>
    <PersonsList persons={persons as any} bind:selected={selectedPerson} bind:selectedPersons />
    <ViewSwitcher />
  </vbox>
  <vbox class="right-pane" slot="right">
    {#if chatMessages && selectedPerson && chatRoom}
      <Header person={selectedPerson as any} />
      <!-- Это почта, а не чат Jackdaw Pro: подсказываем, куда уйдёт ответ -->
      <hbox class="mode-note font-smallest" role="note">
        <MailOpenIcon size="14px" />
        <span>{$t`Emails with this person, shown as a conversation. Your reply is sent as a regular email.`}</span>
      </hbox>
      <vbox flex class="messages background-pattern">
        <MessageList messages={chatMessages}>
          <svelte:fragment slot="message" let:message let:previousMessage>
            {@const mail = message as EMail}
            <MailMessage message={mail} {previousMessage} {account} />
          </svelte:fragment>
        </MessageList>
      </vbox>
      <vbox class="editor">
        <MsgEditor to={chatRoom} />
      </vbox>
    {:else}
      <vbox flex class="empty-state">
        <MailOpenIcon size="32px" />
        <h3>{$t`Mail conversations`}</h3>
        <p>{$t`Pick a person on the left to see all emails with them as one conversation. For instant messages between app users, use Jackdaw Chat.`}</p>
      </vbox>
    {/if}
  </vbox>
</Splitter>

<script lang="ts">
  import { isConcreteMailAccount, mailChatContactForMessage, mailChatContactMatches, MailChatRoom, type MailChatContact } from "./MailChatRoom";
  import type { MailAccount } from "../../../logic/Mail/MailAccount";
  import { SpecialFolder, type Folder } from "../../../logic/Mail/Folder";
  import { OWAFolder } from "../../../logic/Mail/OWA/OWAFolder";
  import type { EMail } from "../../../logic/Mail/EMail";
  import type { PersonUID } from "../../../logic/Abstract/PersonUID";
  import { mailChatEntryMessage, selectedAccount } from "../Selected";
  import { globalSearchTerm } from "../../AppsBar/selectedApp";
  import PersonsList from "../../Contacts/Person/PersonsList.svelte";
  import Header from "../../Chat/PersonHeader.svelte";
  import MessageList from "../../Chat/MessageView/MessageList.svelte";
  import MailMessage from "./MailMessage.svelte";
  import MsgEditor from "../../Chat/MsgEditor.svelte";
  import ViewSwitcher from "../LeftPane/ViewSwitcher.svelte";
  import WriteButton from "../LeftPane/WriteButton.svelte";
  import AccountDropDown from "../../Shared/AccountDropDown.svelte";
  import Splitter from "../../Shared/Splitter.svelte";
  import { ArrayColl, Collection, mergeColls } from 'svelte-collections';
  import { onDestroy } from "svelte";
  import { releaseObservableFilter } from "../../Util/collections";
  import MailOpenIcon from "lucide-svelte/icons/mail-open";
  import { t } from "../../../l10n/l10n";

  export let accounts: Collection<MailAccount>; /** in */

  let selectedPerson: any;
  let selectedPersons = new ArrayColl<any>();
  $: realAccounts = accounts.filterObservable(isConcreteMailAccount);
  $: messageAccounts = isConcreteMailAccount($selectedAccount)
    ? new ArrayColl<MailAccount>([$selectedAccount])
    : realAccounts;
  $: folders = mergeColls<Folder>(messageAccounts.map(account => account.rootFolders));
  $: allMessages = mergeColls<EMail>(folders.map(folder => folder.messages)).sortBy(msg => -msg.sent.getTime());
  $: persons = allMessages.map(mailChatContactForMessage).filterObservable(Boolean).unique() as Collection<PersonUID>;
  /* Фильтр пересоздаётся при каждом выборе человека: старый надо отписать,
   * иначе он остаётся подписан на все письма всех папок. */
  let personMessages: Collection<EMail>;
  let personMessagesSource: Collection<EMail> | null = null;
  $: replacePersonMessages(allMessages, selectedPerson);
  function replacePersonMessages(source: Collection<EMail>, person: any): void {
    releaseObservableFilter(personMessagesSource, personMessages);
    personMessagesSource = source;
    personMessages = source.filterObservable(msg => mailChatContactMatches(msg, person));
  }
  $: applyChatEntryMessage($mailChatEntryMessage);
  $: $folders, loadMailChatFolders(messageAccounts);
  $: account = isConcreteMailAccount($selectedAccount)
    ? $selectedAccount
    : isConcreteMailAccount(personMessages.first?.folder?.account)
      ? personMessages.first.folder.account
      : realAccounts.first;
  let chatRoom: MailChatRoom | null = null;
  let chatRoomAccount: MailAccount | null | undefined;
  let chatRoomPerson: MailChatContact | null = null;
  let chatRoomMessages: Collection<EMail> | null = null;
  $: updateChatRoom(account, selectedPerson, personMessages);
  let chatMessages: Collection<EMail> | null = null;
  let searchedChatMessages: Collection<EMail> | null = null;
  let searchedChatSource: Collection<EMail> | null = null;
  $: replaceChatMessages(chatRoom, $globalSearchTerm);
  function replaceChatMessages(room: MailChatRoom | null, searchTerm: string): void {
    releaseObservableFilter(searchedChatSource, searchedChatMessages);
    searchedChatMessages = null;
    searchedChatSource = null;
    let messages = room?.messages as any as Collection<EMail> | undefined;
    if (messages && searchTerm) {
      searchedChatSource = messages;
      searchedChatMessages = messages.filterObservable(msg => msg.text?.toLowerCase().includes(searchTerm));
    }
    chatMessages = searchedChatMessages ?? messages ?? null;
  }

  function applyChatEntryMessage(message: EMail | null): void {
    if (!message) {
      return;
    }
    let contact = mailChatContactForMessage(message);
    if (contact) {
      selectedPerson = contact;
    }
  }

  let requestedChatFolders = new WeakSet<Folder>();
  let requestedChatAccounts = new WeakSet<MailAccount>();

  function loadMailChatFolders(accounts: Collection<MailAccount>): void {
    for (let account of accounts) {
      if (requestedChatAccounts.has(account)) {
        continue;
      }
      requestedChatAccounts.add(account);
      loadMailChatAccountFolders(account).catch(ex => {
        requestedChatAccounts.delete(account);
        account.errorCallback(ex);
      });
    }
  }

  async function loadMailChatAccountFolders(account: MailAccount): Promise<void> {
    // Chat can be opened before the account startup has finished rebuilding
    // its hierarchy. Read the cached hierarchy first so Sent is not missed
    // when the first reactive pass only sees Inbox.
    await account.readFromDB();
    let inbox = account.findSpecialFolder(SpecialFolder.Inbox);
    let sent = account.findSpecialFolder(SpecialFolder.Sent);
    if (!inbox || !sent) {
      await account.listFolders();
      inbox = account.findSpecialFolder(SpecialFolder.Inbox);
      sent = account.findSpecialFolder(SpecialFolder.Sent);
    }
    requestMailChatFolder(inbox);
    requestMailChatFolder(sent);
  }

  function requestMailChatFolder(folder: Folder | null): void {
    if (!folder || requestedChatFolders.has(folder)) {
      return;
    }
    requestedChatFolders.add(folder);
    loadMailChatFolder(folder).catch(ex => {
      requestedChatFolders.delete(folder);
      folder.account.errorCallback(ex);
    });
  }

  async function loadMailChatFolder(folder: Folder): Promise<void> {
    if (folder instanceof OWAFolder) {
      await folder.syncOnFolderOpen();
      folder.notifyObservers();
      return;
    }
    let newMessages = await folder.listMessages();
    await folder.downloadMessages(newMessages);
  }

  function updateChatRoom(account: MailAccount | null | undefined, person: MailChatContact | null, messages: Collection<EMail>): void {
    if (chatRoom && chatRoomAccount == account && chatRoomPerson == person && chatRoomMessages == messages) {
      return;
    }
    chatRoom?.destroy();
    chatRoomAccount = account;
    chatRoomPerson = person;
    chatRoomMessages = messages;
    chatRoom = account && person
      ? new MailChatRoom(account, person, messages)
      : null;
  }

  onDestroy(() => {
    releaseObservableFilter(personMessagesSource, personMessages);
    releaseObservableFilter(searchedChatSource, searchedChatMessages);
    chatRoom?.destroy();
    chatRoom = null;
    chatRoomAccount = null;
    chatRoomPerson = null;
    chatRoomMessages = null;
  });
</script>

<style>
  .left-pane {
    box-shadow: 2px 0px 6px 0px rgba(0, 0, 0, 10%); /* Also on MessageList */
    background-color: var(--leftbar-bg);
    color: var(--leftbar-fg);
  }
  .right-pane {
    min-height: 0;
    min-width: 0;
  }
  .messages {
    flex: 1 1 0;
    min-height: 0;
    min-width: 0;
  }
  .messages :global(.background),
  .messages :global(.scroll),
  .messages :global(.inside),
  .messages :global(.messages) {
    width: 100%;
    min-width: 0;
  }
  .editor {
    flex: 0 0 auto;
    height: max-content;
    min-height: 126px;
    min-width: 0;
  }
  .editor > :global(.container) {
    flex: 0 0 auto;
  }
  .buttons {
    margin: 10px 16px;
    justify-content: end;
  }
  .buttons :global(svg) {
    margin: 4px;
  }
  .spacer {
    min-width: 8px;
  }
  .mode-note {
    align-items: center;
    gap: 6px;
    padding: 4px 20px;
    color: var(--fg);
    opacity: 0.75;
    border-block-end: 1px solid var(--border);
  }
  .empty-state {
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 32px;
    text-align: center;
    color: var(--fg);
    opacity: 0.8;
  }
  .empty-state h3 {
    margin: 0;
  }
  .empty-state p {
    max-width: 28em;
    margin: 0;
    line-height: 1.4;
  }
</style>
