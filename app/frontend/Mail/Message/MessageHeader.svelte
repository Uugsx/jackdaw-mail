<vbox class="message-header"
  class:outgoing={$message.outgoing}
  on:swipeleft={onPreviousMessage}
  on:swiperight={onNextMessage}
  >
  <hbox class="subject-line">
    <value class="subject">{$message.subject}</value>
    <hbox flex />
    <hbox class="subject-tools">
      {#key $message.dbID ?? $message.messageID}
        <RelatedMessages message={$message} />
      {/key}
      <value class="date font-small">
        {getDateTimeString($message.sent)}
      </value>
      {#if !$appGlobal.isSmall}
        <MessageZoomControls />
        <vbox class="display-mode">
          <DisplayModeSwitcher {message} />
        </vbox>
      {/if}
    </hbox>
  </hbox>
  <ShowReplyBanner {message} />
  <hbox class="message-meta">
    {#if $message.contact instanceof Person && $message.contact.picture}
      <PersonPicture person={$message.contact} size={avatarSize} />
    {/if}
    <vbox class="message-details" flex>
      <hbox class="identity-row">
        <hbox class="sender">
          {#if $message.outgoing && !$message.folder?.account?.isDependentAccount}
            <value class="sender-name">
              {$t`me *=> myself as sender of the email`}
              {#if $message.from.emailAddress}
                <span class="sender-email">&lt;{$message.from.emailAddress}&gt;</span>
              {/if}
            </value>
          {:else}
            <Recipient recipient={$message.from} showFullEmail={true} />
          {/if}
          <EncryptionButtons {message} bind:isExpanded={isEncryptionExpanded} />
        </hbox>
        <hbox flex class="identity-spacer" />
        <hbox class="message-actions">
          <MessageToolbar {message} />
          {#if $tags.hasItems}
            <hbox class="tags">
              <TagSelector tags={$tags} object={message} canAdd={false}>
                <RoundButton
                  slot="tag-button"
                  let:tag
                  label={$t`Remove`}
                  onClick={() => onTagRemove(tag)}
                  icon={RemoveIcon}
                  classes="small remove"
                  iconSize="12px"
                  padding="0px"
                  border={false}
                  />
              </TagSelector>
            </hbox>
          {/if}
        </hbox>
      </hbox>
      <vbox class="recipients">
        {#if $message.to.hasItems}
          <hbox class="to font-small">
            <hbox class="label">{$t`to`}</hbox>
            <RecipientsList recipients={$message.to} />
          </hbox>
        {/if}
        {#if $message.cc.hasItems}
          <hbox class="cc font-small">
            <hbox class="label">{$t`cc`}</hbox>
            <RecipientsList recipients={$message.cc} />
          </hbox>
        {/if}
        {#if $message.bcc.hasItems}
          <hbox class="bcc font-small">
            <hbox class="label">{$t`bcc`}</hbox>
            <RecipientsList recipients={$message.bcc} />
          </hbox>
        {/if}
      </vbox>
      {#if isEncryptionExpanded}
        <EncryptionDetails {message} bind:isExpanded={isEncryptionExpanded} />
      {/if}
    </vbox>
  </hbox>
  {#if message.to.isEmpty || message.from.emailAddress == kDummyPerson.emailAddress}
  {#await message.loadForDisplay()}
    <!-- Subject etc. are loaded by search,
      and body is loaded by MessageBody calling message.loadBody(),
      but not to/from etc. -->
  {:catch ex}
    <ErrorMessageInline {ex} />
  {/await}
{/if}
</vbox>

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import { PersonUID, kDummyPerson } from "../../../logic/Abstract/PersonUID";
  import { Person } from "../../../logic/Abstract/Person";
  import type { PersonOrGroup } from "../../Contacts/Person/PersonOrGroup";
  import { selectedPerson } from "../../Contacts/Person/Selected";
  import type { Tag } from "../../../logic/Abstract/Tag";
  import { appGlobal } from "../../../logic/app";
  import MessageToolbar from "./MessageToolbar.svelte";
  import RelatedMessages from "./RelatedMessages.svelte";
  import RecipientsList from "./RecipientsList.svelte";
  import Recipient from "./Recipient.svelte";
  import PersonPicture from "../../Contacts/Person/PersonPicture.svelte";
  import DisplayModeSwitcher from "./DisplayModeSwitcher.svelte";
  import MessageZoomControls from "./MessageZoomControls.svelte";
  import TagSelector from "../../Shared/Tag/TagSelector.svelte";
  import EncryptionButtons from "./EncryptionButtons.svelte";
  import EncryptionDetails from "./EncryptionDetails.svelte";
  import ErrorMessageInline from "../../Shared/ErrorMessageInline.svelte";
  import ShowReplyBanner from "./ShowReplyBanner.svelte";
  import RoundButton from "../../Shared/RoundButton.svelte";
  import RemoveIcon from "lucide-svelte/icons/x";
  import { getLocalStorage } from "../../Util/LocalStorage";
  import { catchErrors, backgroundError } from "../../Util/error";
  import { getDateTimeString } from "../../Util/date";
  import { t } from "../../../l10n/l10n";
  import { normalizeUIDensity, uiDensitySetting } from "../../Settings/Global/uiDensity";
  import { onDestroy } from "svelte";

  export let message: EMail;

  $: tags = message.tags;
  $: density = normalizeUIDensity($uiDensitySetting.value);
  $: avatarSize = density == "compact" ? 28 : density == "large" ? 40 : 32;

  let readDelaySetting = getLocalStorage("mail.read.after", 0); // 0 = Immediately; -1 = Manually; 1 to 20 = delay in seconds
  $: readDelay = $readDelaySetting.value;
  $: catchErrors(() => markMessageAsRead(message, readDelay), backgroundError);
  let readTimeout: NodeJS.Timeout;
  function markMessageAsRead(message: EMail, readDelay: number) {
    if (message.isRead) {
      return;
    }
    if (readDelay < 0) {
      return;
    }
    if (readDelay == 0) {
      readDelay = 0.2; // Avoid that normal scrolling marks all msgs as read
    }
    clearTimeout(readTimeout);
    readTimeout = setTimeout(() => {
      message.markRead(true)
        .catch(message.folder.account.errorCallback);
    }, readDelay * 1000);
  }
  onDestroy(() => {
    clearTimeout(readTimeout);
  });

  let isEncryptionExpanded = false;
  $: $message, closeEncryption()
  function closeEncryption() {
    isEncryptionExpanded = false;
  }

  // TODO Duplicated in MailApp.svelte
  $: selectPerson(message?.contact);
  function selectPerson(contact: PersonOrGroup | PersonUID) {
    if (contact instanceof PersonUID) {
      contact = contact.findPerson();
    }
    if (!(contact instanceof Person)) {
      return;
    }
    $selectedPerson = contact;
  }

  async function onTagRemove(tag: Tag) {
    await message.removeTag(tag);
  }

  function onNextMessage() {
    message = message.nextMessage(false);
  }
  function onPreviousMessage() {
    message = message.nextMessage(true);
  }
</script>

<style>
  .message-header {
    min-height: 0;
    padding: var(--message-header-padding-block-start, 10px)
      var(--message-header-padding-inline, 20px)
      var(--message-header-padding-block-end, 10px);
    background-color: color-mix(in srgb, var(--message-viewer-bg, var(--main-bg)) 94%, var(--offset-bg));
    border: 0;
    border-radius: 0 0 var(--border-radius) var(--border-radius);
    box-shadow: 0 1px 0 color-mix(in srgb, var(--border) 22%, transparent);
    z-index: 1;
    container-type: inline-size;
    container-name: message-header;
    transition: padding 180ms ease, background-color 180ms ease, box-shadow 180ms ease;
  }
  .message-meta,
  .identity-row,
  .message-actions,
  .subject-tools {
    align-items: center;
  }
  .message-meta {
    gap: 10px;
    min-width: 0;
  }
  .message-meta :global(.avatar) {
    flex: 0 0 auto;
  }
  .message-details,
  .sender,
  .message-actions {
    min-width: 0;
  }
  .message-actions {
    flex: 0 1 auto;
    flex-wrap: wrap;
    max-width: 100%;
    overflow: visible;
  }
  .message-actions :global(.buttons) {
    min-width: 0;
    max-width: 100%;
  }
  .message-details {
    gap: 1px;
    flex: 1 1 0;
  }
  .identity-row {
    min-width: 0;
    min-height: var(--message-toolbar-control-size, 30px);
    gap: 8px;
  }
  .identity-spacer {
    min-width: 0;
    flex: 1 1 auto;
  }
  .sender {
    align-items: center;
    overflow: hidden;
    font-weight: 650;
  }
  .sender-name,
  .sender :global(.recipient),
  .sender :global(.recipient .name),
  .sender :global(.recipient .full-email) {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tags {
    min-width: 0;
    max-width: 100%;
    flex: 0 1 auto;
    margin-inline-start: 4px;
    overflow: visible;
  }
  .tags :global(.tag-list) {
    min-width: 0;
    max-width: 100%;
  }
  .subject {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 700;
    font-size: calc(15px * var(--ui-font-scale, 1));
    line-height: 1.25;
    letter-spacing: -0.015em;
  }
  .sender-email {
    font-weight: normal;
    margin-inline-start: 4px;
  }
  .sender :global(.domain) {
    font-weight: normal;
  }
  .outgoing .sender-name {
    font-weight: normal;
    color: color-mix(in srgb, var(--message-viewer-fg, var(--main-fg)) 68%, transparent);
  }
  .recipients {
    min-width: 0;
    justify-content: start;
    gap: 1px;
    overflow: hidden;
  }
  .recipients > hbox {
    min-width: 0;
    align-items: baseline;
    overflow: hidden;
  }
  .recipients :global(.persons) {
    min-width: 0;
    max-height: none;
    font-size: inherit;
    line-height: 1.3;
  }
  .recipients .label {
    margin-block-start: 2px;
    margin-inline-end: 6px;
    flex-shrink: 0;
  }
  .to {
    color: color-mix(in srgb, var(--message-viewer-fg, var(--main-fg)) 68%, transparent);
  }
  .cc, .bcc {
    color: color-mix(in srgb, var(--message-viewer-fg, var(--main-fg)) 68%, transparent);
  }
  .outgoing .to {
    font-weight: bold;
    color: inherit;
  }
  .date {
    align-self: center;
    margin-inline: 2px 4px;
    font-weight: 300;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .subject-line {
    min-width: 0;
    flex-wrap: nowrap;
    align-items: center;
    min-height: 22px;
    margin-block-end: 6px;
    gap: 8px;
  }
  .subject-tools {
    flex-shrink: 0;
    gap: 2px;
  }
  .display-mode {
    justify-content: end;
  }
  .message-header :global(.show-reply) {
    margin-block: 4px 5px;
    padding: 4px 8px;
    border: 0;
    border-radius: 8px;
    background-color: color-mix(in srgb, var(--border) 18%, transparent);
  }
  .message-header :global(.error) {
    margin-inline: -4px -12px;
  }
  @media (max-width: 600px)  {
    .message-header {
      min-height: 0;
      padding-inline: 16px 8px;
      padding-block: 8px;
    }
    .display-mode {
      display: none;
    }
    .date {
      margin-inline-end: 2px;
    }
  }
  @container message-header (max-width: 900px) {
    .identity-row {
      align-items: flex-start;
      flex-wrap: wrap;
      row-gap: 4px;
    }
    .identity-spacer {
      display: none;
    }
    .sender {
      flex: 1 1 auto;
    }
    .message-actions {
      flex: 1 1 100%;
      justify-content: flex-start;
    }
    .message-actions :global(.buttons) {
      flex: 1 1 auto;
      flex-wrap: wrap;
      justify-content: flex-start;
    }
    .tags {
      flex: 1 1 auto;
    }
  }
  @container message-header (max-width: 720px) {
    .subject-line {
      flex-wrap: wrap;
    }
    .subject {
      flex: 1 1 100%;
    }
    .subject-tools {
      margin-inline-start: auto;
    }
    .message-meta {
      align-items: flex-start;
    }
    .message-actions {
      flex-wrap: wrap;
      justify-content: flex-start;
    }
    .message-actions :global(.buttons) {
      flex-wrap: wrap;
      justify-content: flex-start;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .message-header {
      transition: none;
    }
  }
</style>
