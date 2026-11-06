<hbox class="mail-create-item-menu">
  <ButtonMenu
    label={$t`Create item`}
    buttonIcon={ListPlusIcon}
    placement="bottom-start">
    <MenuItem
      label={$t`Message`}
      icon={MailPlusIcon}
      disabled={!account}
      onClick={newMail} />
    <MenuItem
      label={$t`Meeting`}
      icon={CalendarIcon}
      disabled={!calendar}
      onClick={newMeeting} />
    <MenuItem
      label={$t`Contact`}
      icon={ContactIcon}
      disabled={!addressbook}
      onClick={newContact} />
  </ButtonMenu>
</hbox>

<script lang="ts">
  import type { MailAccount } from "../../logic/Mail/MailAccount";
  import { appGlobal } from "../../logic/app";
  import { mailApp } from "./MailJackdawApp";
  import ButtonMenu from "../Shared/Menu/ButtonMenu.svelte";
  import MenuItem from "../Shared/Menu/MenuItem.svelte";
  import MailPlusIcon from "lucide-svelte/icons/mail-plus";
  import CalendarIcon from "lucide-svelte/icons/calendar-days";
  import ContactIcon from "lucide-svelte/icons/contact-round";
  import ListPlusIcon from "lucide-svelte/icons/list-plus";
  import { createNewEvent } from "../Calendar/event";
  import { selectedCalendar } from "../Calendar/selected";
  import { selectedPerson } from "../Contacts/Person/Selected";
  import { goTo } from "../AppsBar/selectedApp";
  import { URLPart } from "../Util/util";
  import { assert } from "../../logic/util/util";
  import { gt, t } from "../../l10n/l10n";

  export let account: MailAccount;

  // Календари и адресные книги загружаются после запуска: подписываемся на списки,
  // иначе «Встреча» и «Контакт» остаются неактивными до перезахода в раздел.
  const calendars = appGlobal.calendars;
  const addressbooks = appGlobal.addressbooks;
  $: calendar = $selectedCalendar ?? $calendars.first;
  $: addressbook = $addressbooks.first;

  function newMail(): void {
    assert(account, gt`Please select a mail account first`);
    mailApp.writeMail(account.newEMailFrom());
  }

  function newMeeting(): void {
    assert(calendar, gt`Please set up a calendar first`);
    createNewEvent(calendar, new Date(), false);
  }

  function newContact(): void {
    assert(addressbook, gt`Please set up an address book first`);
    const contact = addressbook.newPerson();
    $selectedPerson = contact;
    goTo(URLPart`/contacts/person/${contact.id}/edit`, { person: contact });
  }
</script>

<style>
  :global(.mail-create-item-menu) {
    flex: 0 0 auto;
  }
</style>
