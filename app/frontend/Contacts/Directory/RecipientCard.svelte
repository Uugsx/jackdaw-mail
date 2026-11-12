<!-- Карточка отправителя/получателя письма, как в Outlook: имя, должность, отдел, телефоны, email
  и кнопки «Написать», «Позвонить», «Создать встречу», «Сохранить в контакты».
  Данные: личный контакт → каталог Exchange (ResolveNames, кэш) → только то, что известно из письма. -->
<vbox class="recipient-card" role="group" aria-label={$t`Contact card`} aria-busy={loading}>
  <vbox class="head">
    <hbox class="name">{displayName}</hbox>
    {#if loading}
      <hbox class="skeleton" aria-hidden="true" />
      <hbox class="skeleton short" aria-hidden="true" />
    {:else}
      {#if jobLine}
        <hbox class="line">{jobLine}</hbox>
      {/if}
      {#if company}
        <hbox class="line subtle">{company}</hbox>
      {/if}
    {/if}
  </vbox>

  {#if !loading && isGroup}
    <hbox class="line"><UsersIcon size="14px" /><span>{$t`Distribution list`}</span></hbox>
  {/if}

  <vbox class="details font-small">
    {#if businessPhone}
      <hbox class="row">
        <span class="label">{$t`Work phone`}</span>
        <a class="value" href={telHref(businessPhone)}>{businessPhone}</a>
      </hbox>
    {/if}
    {#if mobilePhone}
      <hbox class="row">
        <span class="label">{$t`Mobile phone`}</span>
        <a class="value" href={telHref(mobilePhone)}>{mobilePhone}</a>
      </hbox>
    {/if}
    {#if emailAddress}
      <hbox class="row">
        <span class="label">{$t`Email`}</span>
        <span class="value selectable">{emailAddress}</span>
      </hbox>
    {/if}
    {#if manager}
      <hbox class="row">
        <span class="label">{$t`Manager`}</span>
        <span class="value">{manager}</span>
      </hbox>
    {/if}
    {#if failed}
      <hbox class="note error" role="status">{$t`Company directory is unavailable, showing known details`}</hbox>
    {:else if !loading && !hasDetails}
      <hbox class="note" role="status">{$t`No more details known`}</hbox>
    {/if}
  </vbox>

  <hbox class="actions">
    <Button plain icon={MailIcon} iconSize="14px" classes="card-write"
      label={$t`Write`} tooltip={$t`Write an email to this person`}
      disabled={!emailAddress}
      onClick={onWrite} />
    <Button plain icon={PhoneIcon} iconSize="14px" classes="card-call"
      label={$t`Call`} tooltip={callPhone ? $t`Call ${callPhone}` : $t`No phone number known`}
      disabled={!callPhone}
      onClick={onCall} />
    <Button plain icon={CalendarIcon} iconSize="14px" classes="card-meeting"
      label={$t`Meeting`} tooltip={$t`Create a meeting with this person`}
      disabled={!emailAddress}
      onClick={onMeeting} />
    {#if onSave}
      <Button plain icon={UserPlusIcon} iconSize="14px" classes="card-save"
        label={$t`Save to contacts`} tooltip={$t`Save this person to your contacts`}
        onClick={onSave} />
    {/if}
    {#if onOpenContact}
      <Button plain icon={UserIcon} iconSize="14px" classes="card-open"
        label={$t`Open contact`} tooltip={$t`Open this person in Contacts`}
        onClick={onOpenContact} />
    {/if}
  </hbox>
</vbox>

<script lang="ts">
  import type { PersonUID } from "../../../logic/Abstract/PersonUID";
  import { personDisplayName } from "../../../logic/Abstract/PersonUID";
  import { getExchangeDirectory, type DirectoryInfo } from "../../../logic/Contacts/EWS/ExchangeDirectory";
  import { appGlobal } from "../../../logic/app";
  import { selectedAccount } from "../../Mail/Selected";
  import { openComposer } from "../../Mail/open";
  import { openEvent } from "../../Calendar/open";
  import { setNewEventTime } from "../../Calendar/event";
  import { Participant } from "../../../logic/Calendar/Participant";
  import { InvitationResponse } from "../../../logic/Calendar/Invitation/InvitationStatus";
  import Button from "../../Shared/Button.svelte";
  import MailIcon from "lucide-svelte/icons/mail";
  import PhoneIcon from "lucide-svelte/icons/phone";
  import CalendarIcon from "lucide-svelte/icons/calendar-plus";
  import UserPlusIcon from "lucide-svelte/icons/user-plus";
  import UserIcon from "lucide-svelte/icons/user";
  import UsersIcon from "lucide-svelte/icons/users";
  import { logError, showError } from "../../Util/error";
  import { t } from "../../../l10n/l10n";
  import { get } from "svelte/store";

  export let person: PersonUID;
  /** «Сохранить в контакты»; нет — кнопки нет (человек уже в контактах) */
  export let onSave: (() => void | Promise<void>) | null = null;
  /** «Открыть контакт»; нет — кнопки нет */
  export let onOpenContact: (() => void) | null = null;
  /** Вызывается после действия, чтобы закрыть всплывающее окно */
  export let onDone: () => void = () => {};

  let info: DirectoryInfo | null = null;
  let loading = false;
  let failed = false;
  let loadedFor: string | null = null;

  $: emailAddress = person?.emailAddress ?? "";
  $: contact = person?.findPerson?.() ?? null;
  $: directory = getExchangeDirectory(appGlobal.emailAccounts, emailAddress);

  $: load(emailAddress);
  async function load(address: string) {
    let key = address?.toLowerCase() || null;
    if (key == loadedFor) {
      return;
    }
    loadedFor = key;
    info = null;
    failed = false;
    loading = false;
    if (!directory || !address?.includes("@")) {
      return;
    }
    loading = true;
    try {
      let result = await directory.getInfo(address);
      if (loadedFor == key) {
        info = result;
      }
    } catch (ex) {
      logError(ex);
      if (loadedFor == key) {
        failed = true;
      }
    } finally {
      if (loadedFor == key) {
        loading = false;
      }
    }
  }

  function firstPhone(kind: string): string | null {
    return contact?.phoneNumbers.contents.find(entry => entry.purpose == kind && entry.protocol != "fax")?.value ?? null;
  }

  $: displayName = contact?.name || info?.name || (person ? personDisplayName(person) : "") || emailAddress;
  $: jobTitle = contact?.position || info?.jobTitle || "";
  $: department = contact?.department || info?.department || "";
  $: company = contact?.company || info?.company || "";
  $: jobLine = [jobTitle, department].filter(Boolean).join(" · ");
  $: businessPhone = firstPhone("work") || info?.businessPhone || "";
  $: mobilePhone = firstPhone("mobile") || info?.mobilePhone || "";
  $: callPhone = mobilePhone || businessPhone || contact?.phoneNumbers.contents.find(entry => entry.protocol != "fax")?.value || "";
  $: manager = info?.manager?.name ?? "";
  $: isGroup = info?.kind == "group";
  $: hasDetails = !!(jobLine || company || businessPhone || mobilePhone || manager);

  function telHref(phone: string): string {
    return "tel:" + phone.replace(/[^\d+]/g, "");
  }

  function onWrite() {
    let account = get(selectedAccount) ?? appGlobal.emailAccounts.first;
    if (!account) {
      showError(new Error($t`Please select a mail account first`));
      return;
    }
    let mail = account.newEMailFrom();
    mail.to.add(person);
    openComposer(mail);
    onDone();
  }

  function onCall() {
    if (callPhone) {
      window.location.href = telHref(callPhone);
    }
    onDone();
  }

  function onMeeting() {
    let calendar = appGlobal.calendars.first;
    if (!calendar) {
      showError(new Error($t`Please set up a calendar first`));
      return;
    }
    let event = calendar.newEvent();
    setNewEventTime(event, false, new Date());
    let participant = new Participant(person.emailAddress, displayName, InvitationResponse.Unknown);
    event.participants.add(participant);
    openEvent(event, true);
    onDone();
  }
</script>

<style>
  .recipient-card {
    margin: 6px 12px 8px;
    gap: 8px;
    min-width: 260px;
    max-width: 340px;
  }
  .head {
    gap: 2px;
  }
  .name {
    font-weight: bold;
    overflow-wrap: anywhere;
  }
  .line {
    align-items: center;
    gap: 6px;
    opacity: 0.85;
  }
  .line.subtle {
    opacity: 0.65;
  }
  .skeleton {
    height: 12px;
    width: 70%;
    margin-top: 4px;
    border-radius: 4px;
    background-color: var(--hover-bg);
    animation: card-pulse 1.2s ease-in-out infinite;
  }
  .skeleton.short {
    width: 45%;
  }
  @keyframes card-pulse {
    50% { opacity: 0.4; }
  }
  @media (prefers-reduced-motion: reduce) {
    .skeleton {
      animation: none;
    }
  }
  .details {
    gap: 4px;
  }
  .row {
    gap: 8px;
    align-items: baseline;
  }
  .label {
    flex: 0 0 96px;
    opacity: 0.65;
  }
  .value {
    overflow-wrap: anywhere;
  }
  .value.selectable {
    user-select: text;
  }
  a.value {
    color: var(--link-fg, inherit);
    text-decoration: none;
  }
  a.value:hover {
    color: var(--link-hover-fg);
    text-decoration: underline;
  }
  a.value:focus-visible {
    outline: 2px solid var(--focus-outline, currentColor);
    outline-offset: 2px;
    border-radius: 2px;
  }
  .note {
    opacity: 0.65;
    font-style: italic;
  }
  .note.error {
    opacity: 0.85;
  }
  .actions {
    flex-wrap: wrap;
    gap: 2px 6px;
  }
  .actions :global(.button) {
    padding: 2px 4px;
  }
  .actions :global(.button:focus-visible) {
    outline: 2px solid var(--focus-outline, currentColor);
    outline-offset: 1px;
  }
</style>
