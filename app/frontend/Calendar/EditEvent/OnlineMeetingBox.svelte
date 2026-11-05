<vbox class="online-meeting" flex>
  <label class="provider-field">
    <span>{$t`Video service`}</span>
    <select bind:value={selectedProvider} on:change={onProviderChanged}>
      <option value="custom">{$t`Custom link`}</option>
      {#each meetingProviders as provider (provider.id)}
        <option value={provider.id}>{providerLabel(provider.id)}</option>
      {/each}
    </select>
  </label>
  <p class="meeting-help">{$t`Select a video service and paste its meeting link. Teams can be created when you save.`}</p>
  <hbox class="url-row">
  <input type="url" bind:value={event.onlineMeetingURL}
    placeholder={urlPlaceholder(selectedProvider)}
    on:input={onURLChanged} />
  <hbox class="buttons">
    {#if canCreateTeams && selectedProvider == "teams"}
      <Button
        label={$t`Create Teams meeting`}
        tooltip={$t`Exchange will create a Teams link when you save`}
        plain
        disabled={hasURL || pendingTeamsCreate}
        onClick={onCreateTeams}
        />
    {/if}
    {#if selectedProvider != "custom" && !hasURL && (selectedProvider != "teams" || !canCreateTeams)}
      <Button
        label={$t`Open service`}
        icon={BrowserIcon}
        iconSize="16px"
        plain
        onClick={onOpenProvider} />
    {/if}
    <Button
      label={$t`Copy`}
      icon={CopyIcon}
      iconSize="16px"
      iconOnly
      plain
      disabled={!hasURL}
      onClick={onCopyMeetingURL}
      />
    <Button
      label={$t`Open`}
      icon={BrowserIcon}
      iconSize="16px"
      iconOnly
      plain
      disabled={!hasURL}
      onClick={onOpenMeetingURL}
      />
    <Button
      label={$t`Delete`}
      icon={DeleteIcon}
      iconSize="16px"
      iconOnly
      plain
      disabled={!event.isOnline && !hasURL}
      onClick={onRemove}
      />
  </hbox>
  </hbox>
  {#if pendingTeamsCreate}
    <hbox class="hint font-smallest">{$t`Teams link will be created when you save`}</hbox>
  {/if}
</vbox>

<script lang="ts">
  import type { Event } from "../../../logic/Calendar/Event";
  import { OWAEvent } from "../../../logic/Calendar/OWA/OWAEvent";
  import { Provider } from "../../../logic/Auth/OAuth2URLs";
  import { openExternalURL } from "../../../logic/util/os-integration";
  import Button from "../../Shared/Button.svelte";
  import CopyIcon from "lucide-svelte/icons/copy";
  import BrowserIcon from "lucide-svelte/icons/globe";
  import DeleteIcon from "lucide-svelte/icons/trash-2";
  import { t } from "../../../l10n/l10n";
  import {
    detectMeetingProvider,
    getMeetingProvider,
    meetingProviders,
    type MeetingProviderId,
  } from "../../../logic/Calendar/meetingProviders";

  export let event: Event;

  let selectedProvider: MeetingProviderId = "custom";
  let lastURL = "";
  $: if ((event.onlineMeetingURL ?? "") != lastURL) {
    lastURL = event.onlineMeetingURL ?? "";
    selectedProvider = detectMeetingProvider(lastURL);
  }

  $: hasURL = !!event.onlineMeetingURL?.startsWith("https://");
  $: canCreateTeams = event instanceof OWAEvent &&
    event.calendar?.account?.provider?.() == Provider.Office365;
  $: pendingTeamsCreate = selectedProvider == "teams" && event.isOnline && !hasURL;

  function onURLChanged() {
    event.isOnline = !!event.onlineMeetingURL?.trim();
    event.createOnlineMeetingWithAccount = null;
  }

  function onProviderChanged(): void {
    if (selectedProvider == "custom") {
      return;
    }
    event.createOnlineMeetingWithAccount = null;
  }

  function providerLabel(id: MeetingProviderId): string {
    switch (id) {
      case "teams": return "Microsoft Teams";
      case "yandex-telemost": return "Яндекс Телемост";
      case "google-meet": return "Google Meet";
      case "zoom": return "Zoom";
      case "webex": return "Cisco Webex";
      case "jitsi": return "Jitsi Meet";
      default: return $t`Custom link`;
    }
  }

  function urlPlaceholder(id: MeetingProviderId): string {
    return id == "custom"
      ? $t`Paste meeting URL`
      : $t`Paste ${providerLabel(id)} link`;
  }

  async function onOpenProvider(): Promise<void> {
    const provider = getMeetingProvider(selectedProvider);
    if (provider) {
      await openExternalURL(provider.homepage);
    }
  }

  function onCreateTeams() {
    event.onlineMeetingURL = null;
    event.isOnline = true;
    event.createOnlineMeetingWithAccount = null;
  }

  async function onCopyMeetingURL() {
    await navigator.clipboard.writeText(event.onlineMeetingURL);
  }

  async function onOpenMeetingURL() {
    await openExternalURL(event.onlineMeetingURL);
  }

  function onRemove() {
    if (event.participants.hasItems && !event.isNew && !confirm($t`Changing the meeting URL might cause some participants to miss the meeting. Are you sure?`)) {
      return;
    }
    event.isOnline = false;
    event.onlineMeetingURL = null;
    event.createOnlineMeetingWithAccount = null;
  }
</script>

<style>
  input {
    max-width: 20em;
  }
  .provider-field {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-block-end: 6px;
    font-size: 12px;
  }
  .provider-field span {
    color: color-mix(in srgb, var(--main-fg) 62%, transparent);
  }
  .meeting-help {
    max-width: 34em;
    margin: 0 0 6px;
    color: color-mix(in srgb, var(--main-fg) 58%, transparent);
    font-size: 11px;
    line-height: 1.4;
  }
  .provider-field select {
    max-width: 20em;
  }
  .hint {
    opacity: 0.7;
    margin-block-start: 4px;
  }
  /* Поле ссылки и действия с ней — в одну строку, кнопки по центру поля. */
  .url-row {
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .buttons {
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
  }
</style>
