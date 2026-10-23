<svelte:window on:click|capture={onClickTopLevel} />

<vbox flex class="standalone-compose">
  <NotificationBar notifications={$notifications} />
  {#if loading}
    <vbox flex class="compose-state" aria-live="polite">
      <Spinner size="36px" />
      <p>{$t`Loading compose window…`}</p>
    </vbox>
  {:else if errorMessage}
    <vbox flex class="compose-state">
      <!-- Свой заголовок: внутренние тексты загрузки окна не для пользователя;
           причина и подсказка — из ошибки, исходник — в «Подробностях» -->
      <Notice ex={loadError} message={errorMessage} onRetry={load} />
    </vbox>
  {:else if mail}
    <MailComposer {mail} standalone
      sendInOwner={sendInOwner}
      searchContactsInOwner={searchContactsInOwner}
      on:close={closeWindow} />
  {/if}
</vbox>

<script lang="ts">
  import Notice from "../../Shared/Notice.svelte";
  import { onMount } from "svelte";
  import type { EMail } from "../../../logic/Mail/EMail";
  import { PersonUID } from "../../../logic/Abstract/PersonUID";
  import { appGlobal } from "../../../logic/app";
  import { getStartObjects } from "../../../logic/startup";
  import { assert } from "../../../logic/util/util";
  import { openExternalURL } from "../../../logic/util/os-integration";
  import { deserializeComposeMail, serializeComposeMail } from "./composeWindow";
  import { getComposeLinkURL } from "./composeLink";
  import MailComposer from "./MailComposer.svelte";
  import NotificationBar from "../../MainWindow/NotificationBar.svelte";
  import { backgroundError } from "../../Util/error";
  import { notifications } from "../../MainWindow/Notification";
  import Spinner from "../../Shared/Spinner.svelte";
  import { t } from "../../../l10n/l10n";

  export let composeWindowID: string;

  let mail: EMail | null = null;
  let loading = true;
  let errorMessage: string | null = null;
  let loadError: unknown = null;
  let startObjectsPromise: Promise<void> | null = null;

  async function load(): Promise<void> {
    loading = true;
    errorMessage = null;
    loadError = null;
    mail = null;
    try {
      let nativeAPI = (window as any).api;
      if (typeof nativeAPI?.getComposeWindowData !== "function") {
        throw new Error("Native compose windows are unavailable");
      }
      let payload = await nativeAPI.getComposeWindowData(composeWindowID);
      assert(payload, "Compose window data is missing");
      startObjectsPromise ??= getStartObjects();
      try {
        await startObjectsPromise;
      } catch (ex) {
        startObjectsPromise = null;
        throw ex;
      }
      let account = appGlobal.emailAccounts.find(candidate => candidate.id === payload.accountID);
      assert(account, "Compose window account is missing");
      await Promise.all([
        account.readFromDB(),
        ...[...appGlobal.addressbooks].map(addressbook => addressbook.readFromDB()),
      ]);
      mail = deserializeComposeMail(payload, account);
    } catch (ex) {
      errorMessage = $t`Could not load the compose window`;
      loadError = ex;
    } finally {
      loading = false;
    }
  }

  async function sendInOwner(sendAt?: Date): Promise<void> {
    assert(mail, "Compose window message is missing");
    let nativeAPI = (window as any).api;
    assert(typeof nativeAPI?.sendComposeWindowMail === "function", "Compose window send is unavailable");
    let payload = await serializeComposeMail(mail, composeWindowID);
    payload.sendAt = sendAt ? sendAt.toISOString() : null;
    let result = await nativeAPI.sendComposeWindowMail(composeWindowID, payload);
    if (!result?.ok) {
      throw new Error(result?.errorMessage ?? "Could not send the message");
    }
  }

  async function searchContactsInOwner(
    searchText: string,
    skip: (person: PersonUID) => boolean,
  ): Promise<PersonUID[]> {
    let nativeAPI = (window as any).api;
    assert(typeof nativeAPI?.searchComposeWindowContacts === "function", "Compose window contact search is unavailable");
    let results = await nativeAPI.searchComposeWindowContacts(composeWindowID, searchText);
    return results
      .map(person => new PersonUID(person.emailAddress, person.name ?? undefined))
      .filter(person => !skip(person));
  }

  function closeWindow(): void {
    (window as any).api.closeComposeWindow(composeWindowID);
  }

  function onClickTopLevel(event: MouseEvent): void {
    if (event.button != 0 || event.defaultPrevented) {
      return;
    }
    let url = getComposeLinkURL(event.target);
    if (!url) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    void openExternalURL(url).catch(backgroundError);
  }

  onMount(() => {
    void load();
  });
</script>

<style>
  .standalone-compose {
    min-width: 0;
    min-height: 100vh;
    width: 100%;
    max-width: 100%;
    overflow: hidden;
    box-sizing: border-box;
    background: var(--main-bg, var(--bg));
    color: var(--main-fg, var(--fg));
  }
  .standalone-compose :global(.container),
  .standalone-compose :global(.content) {
    width: 100%;
    max-width: 100%;
    min-width: 0;
    overflow: hidden;
  }
  .compose-state {
    align-items: center;
    justify-content: center;
    gap: 16px;
    padding: 32px;
    text-align: center;
  }
  .compose-state p {
    max-width: 560px;
    margin: 0;
  }
</style>
