<script context="module" lang="ts">
  let nextRelatedPopupId = 0;
</script>

<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import LinkIcon from "lucide-svelte/icons/link";
  import ChevronDownIcon from "lucide-svelte/icons/chevron-down";
  import ChevronRightIcon from "lucide-svelte/icons/chevron-right";
  import RefreshIcon from "lucide-svelte/icons/refresh-cw";
  import TriangleAlertIcon from "lucide-svelte/icons/triangle-alert";
  import XIcon from "lucide-svelte/icons/x";
  import Button from "../../Shared/Button.svelte";
  import Popup from "../../Shared/Popup.svelte";
  import { catchErrors } from "../../Util/error";
  import { getDateTimeString } from "../../Util/date";
  import { personDisplayName } from "../../../logic/Abstract/PersonUID";
  import type { EMail } from "../../../logic/Mail/EMail";
  import {
    findRelatedEmails,
    groupRelatedMailMatches,
    type RelatedMailFeature,
    type RelatedMailFeatureKind,
    type RelatedMailGroup,
    type RelatedMailMatch,
    type RelatedMailReason,
  } from "../../../logic/Mail/RelatedEMail";
  import { openEMailMessage } from "../open";
  import { t } from "../../../l10n/l10n";

  export let message: EMail;

  type RelatedState = "idle" | "loading" | "ready" | "error";
  let status: RelatedState = "idle";
  let matches: RelatedMailMatch[] = [];
  let expandedGroupKeys = new Set<string>();
  /** Пользователь сам раскрывал группы: не перестраиваем их при догрузке */
  let groupsToggled = false;
  /** Быстрые результаты уже показаны, идёт поиск по тексту писем */
  let scanningText = false;
  let popupOpen = false;
  let triggerElement: HTMLButtonElement;
  let popupCloseButton: HTMLButtonElement;
  let loadToken = 0;

  const popupId = `related-messages-popup-${++nextRelatedPopupId}`;
  const titleId = `${popupId}-title`;

  $: triggerLabel = status == "idle"
    ? $t`Search in mail`
    : status == "loading"
      ? $t`Checking local mail…`
      : status == "error"
        ? $t`Could not check related messages.`
        : matches.length
          ? $t`Found related messages: ${matches.length}`
          : $t`No related messages found in local mail.`;

  $: if (popupOpen) {
    void focusPopup();
  }
  $: relatedGroups = groupRelatedMailMatches(matches);

  onDestroy(() => {
    loadToken++;
  });

  async function loadRelated() {
    if (status == "loading") {
      return;
    }
    const token = ++loadToken;
    status = "loading";
    matches = [];
    groupsToggled = false;
    scanningText = false;
    try {
      const result = await findRelatedEmails(message, undefined, partial => {
        if (token != loadToken) {
          return;
        }
        showMatches(partial);
        scanningText = true;
      });
      if (token != loadToken) {
        return;
      }
      showMatches(result);
    } catch {
      if (token == loadToken) {
        status = "error";
      }
    } finally {
      if (token == loadToken) {
        scanningText = false;
      }
    }
  }

  function showMatches(result: RelatedMailMatch[]) {
    matches = result;
    if (!groupsToggled) {
      const firstGroup = groupRelatedMailMatches(result)[0];
      expandedGroupKeys = new Set(firstGroup ? [firstGroup.key] : []);
    }
    status = "ready";
  }

  function togglePopup() {
    popupOpen = !popupOpen;
    if (popupOpen && (status == "idle" || status == "error")) {
      void loadRelated();
    }
  }

  function closePopup() {
    popupOpen = false;
    triggerElement?.focus();
  }

  async function focusPopup() {
    await tick();
    if (popupOpen) {
      popupCloseButton?.focus();
    }
  }

  function onWindowKeydown(event: KeyboardEvent) {
    if (event.key == "Escape" && popupOpen) {
      event.preventDefault();
      closePopup();
    }
  }

  function openMatch(match: RelatedMailMatch) {
    popupOpen = false;
    void catchErrors(() => openEMailMessage(match.email));
  }

  function toggleGroup(groupKey: string) {
    groupsToggled = true;
    const nextKeys = new Set(expandedGroupKeys);
    if (nextKeys.has(groupKey)) {
      nextKeys.delete(groupKey);
    } else {
      nextKeys.add(groupKey);
    }
    expandedGroupKeys = nextKeys;
  }

  function groupReasonLabel(group: RelatedMailGroup): string {
    if (group.feature) {
      return featureGroupLabel(group.feature);
    }
    switch (group.kind) {
      case "identifier":
        return reasonLabel("same-identifier");
      case "conversation":
        return reasonLabel("same-thread");
      case "contact":
        return reasonLabel("same-contact");
      case "topic":
        return reasonLabel("same-topic");
    }
  }

  /** Почему письма группы связаны с открытым */
  function featureGroupLabel(kind: RelatedMailFeatureKind): string {
    switch (kind) {
      case "duplicate":
        return $t`Exact duplicate`;
      case "thread":
        return $t`Same conversation`;
      case "ticket":
        return $t`Same reference number`;
      case "customer":
        return $t`Same client number (ICN)`;
      case "order":
        return $t`Same order or parcel`;
      case "inn":
        return $t`Same tax ID (INN)`;
      case "address":
        return $t`Same client (address)`;
      case "company":
        return $t`Same company`;
      case "reference":
        return $t`Same number`;
      case "domain":
        return $t`Same organization (domain)`;
      case "subject":
        return $t`Similar topic`;
    }
  }

  /** Короткая пометка дополнительного признака на письме */
  function featureChipLabel(feature: RelatedMailFeature): string {
    switch (feature.kind) {
      case "duplicate":
        return $t`Exact duplicate`;
      case "thread":
        return $t`Same conversation`;
      case "subject":
        return $t`Similar topic`;
      case "ticket":
        return $t`Request ${feature.label}`;
      case "customer":
        return $t`ICN ${feature.label}`;
      case "order":
        return $t`Order ${feature.label}`;
      case "inn":
        return $t`INN ${feature.label}`;
      case "address":
        return $t`Client ${feature.label}`;
      case "company":
        return feature.label;
      case "reference":
        return $t`Number ${feature.label}`;
      case "domain":
        return $t`Domain ${feature.label}`;
    }
  }

  /** Признаки письма, кроме того, по которому оно уже стоит в группе */
  function extraFeatures(match: RelatedMailMatch): RelatedMailFeature[] {
    return match.features?.slice(1) ?? [];
  }

  function isMonospaceGroup(group: RelatedMailGroup): boolean {
    return group.kind == "identifier" || group.feature == "address" || group.feature == "domain";
  }

  function reasonLabel(reason: RelatedMailReason): string {
    switch (reason) {
      case "duplicate":
        return $t`Exact duplicate`;
      case "same-thread":
        return $t`Same conversation`;
      case "same-identifier":
        return $t`Same reference number`;
      case "same-contact":
        return $t`Same client (address)`;
      case "same-company":
        return $t`Same company`;
      case "same-domain":
        return $t`Same organization (domain)`;
      case "same-topic":
        return $t`Same subject`;
      case "similar-topic":
        return $t`Similar topic`;
    }
  }

  function contactLabel(email: EMail): string {
    return personDisplayName(email.contact) || email.from?.emailAddress || "";
  }

  function sharedContextLabel(match: RelatedMailMatch): string {
    return match.sharedIdentifiers[0] ?? "";
  }
</script>

<svelte:window on:keydown={onWindowKeydown} />

<button
  type="button"
  class="related-trigger"
  class:has-results={status == "ready" && matches.length > 0}
  class:error={status == "error"}
  class:loading={status == "loading"}
  aria-label={triggerLabel}
  aria-expanded={popupOpen}
  aria-controls={popupId}
  aria-busy={status == "loading" || scanningText}
  title={triggerLabel}
  bind:this={triggerElement}
  on:click={togglePopup}
  >
  {#if status == "error"}
    <TriangleAlertIcon size="15px" aria-hidden="true" />
  {:else}
    <LinkIcon size="15px" aria-hidden="true" />
  {/if}
  {#if status == "ready" && matches.length > 0}
    <span class="trigger-count">{matches.length}</span>
  {:else if status == "loading"}
    <span class="trigger-loading" aria-hidden="true"></span>
  {/if}
</button>

<Popup
  bind:popupOpen
  popupAnchor={triggerElement}
  placement="bottom-end"
  boundaryElSel=".message-list-pane"
  >
  <vbox
    class="related-popup"
    id={popupId}
    role="dialog"
    aria-modal="false"
    aria-labelledby={titleId}
    aria-busy={status == "loading" || scanningText}
    >
    <header class="related-popup-header">
      <div class="related-title">
        <LinkIcon size="16px" aria-hidden="true" />
        <div class="related-title-copy">
          <h2 id={titleId}>{$t`Related messages`}</h2>
          {#if status == "idle"}
            <span class="related-summary">{$t`Search in mail`}</span>
          {:else if status == "loading"}
            <span class="related-summary">{$t`Checking local mail…`}</span>
          {:else if status == "ready"}
            <span class="related-summary">
              {$t`Found related messages: ${matches.length}`}
            </span>
            {#if scanningText}
              <span class="related-summary scanning" role="status">
                <span class="trigger-loading" aria-hidden="true"></span>
                {$t`Searching message text…`}
              </span>
            {/if}
          {:else}
            <span class="related-summary">{$t`Could not check related messages.`}</span>
          {/if}
        </div>
      </div>
      <div class="related-actions">
        {#if (status == "ready" && !scanningText) || status == "error"}
          <button
            type="button"
            class="popup-icon-button"
            aria-label={$t`Check again`}
            title={$t`Check again`}
            on:click={() => void loadRelated()}
            >
            <RefreshIcon size="15px" aria-hidden="true" />
          </button>
        {/if}
        <button
          type="button"
          class="popup-icon-button"
          aria-label={$t`Close`}
          title={$t`Close`}
          bind:this={popupCloseButton}
          on:click={closePopup}
          >
          <XIcon size="16px" aria-hidden="true" />
        </button>
      </div>
    </header>

    <div class="related-popup-body">
      {#if status == "idle"}
        <p class="state-row idle-state" role="status">
          {$t`Search in mail`}
        </p>
      {:else if status == "loading"}
        <div class="loading-row" aria-live="polite">
          <span class="skeleton-line short"></span>
          <span class="skeleton-line"></span>
        </div>
      {:else if status == "error"}
        <div class="state-row error-state" role="status">
          <span>{$t`The local search is temporarily unavailable.`}</span>
          <Button label={$t`Try again`} classes="secondary" onClick={loadRelated} />
        </div>
      {:else if !matches.length && scanningText}
        <div class="loading-row" aria-live="polite">
          <span class="skeleton-line short"></span>
          <span class="skeleton-line"></span>
        </div>
      {:else if !matches.length}
        <p class="state-row empty-state" role="status">
          {$t`No related messages found in local mail.`}
        </p>
      {:else}
        <ul class="related-groups">
          {#each relatedGroups as group, groupIndex (group.key)}
            <li class="related-group">
              <button
                type="button"
                class="group-toggle"
                aria-expanded={expandedGroupKeys.has(group.key)}
                aria-controls={`${popupId}-group-${groupIndex}`}
                on:click={() => toggleGroup(group.key)}
                >
                <span class="group-toggle-icon" aria-hidden="true">
                  {#if expandedGroupKeys.has(group.key)}
                    <ChevronDownIcon size="15px" />
                  {:else}
                    <ChevronRightIcon size="15px" />
                  {/if}
                </span>
                <span class="group-copy">
                  <span class="group-reason">{groupReasonLabel(group)}</span>
                  <span class:group-identifier={isMonospaceGroup(group)} class="group-label">
                    {group.label || $t`No subject`}
                  </span>
                </span>
                <span class="group-count">{group.matches.length}</span>
              </button>
              {#if expandedGroupKeys.has(group.key)}
                <ul class="related-list" id={`${popupId}-group-${groupIndex}`}>
                  {#each group.matches as match (match.email.dbID ?? match.email.messageID)}
                    <li>
                      <button
                        type="button"
                        class="related-item"
                        on:click={() => openMatch(match)}
                        >
                        <div class="item-heading">
                          <span class="item-subject">
                            {match.email.subject || $t`No subject`}
                          </span>
                          <span class="item-date">
                            {getDateTimeString(match.email.listDisplayDate())}
                          </span>
                        </div>
                        <div class="item-details">
                          {#if !match.features?.length}
                            <span class="reason">{reasonLabel(match.reason)}</span>
                          {/if}
                          <span class="item-contact">{contactLabel(match.email)}</span>
                          {#if match.email.folder}
                            <span class="item-folder" title={match.email.folder.account?.name}>{match.email.folder.name}</span>
                          {/if}
                          {#if match.email.isReplied}
                            <span class="reply-status">{$t`Reply was sent`}</span>
                          {:else if match.email.outgoing}
                            <span class="reply-status">{$t`Sent message`}</span>
                          {:else}
                            <span class="reply-status">{$t`Received message`}</span>
                          {/if}
                          {#if !match.features && sharedContextLabel(match)}
                            <span class="identifier" title={sharedContextLabel(match)}>{sharedContextLabel(match)}</span>
                          {/if}
                        </div>
                        {#if extraFeatures(match).length}
                          <div class="item-features" aria-label={$t`Also linked by`}>
                            {#each extraFeatures(match) as feature (feature.kind + ":" + feature.value)}
                              <span class="feature-chip" title={featureGroupLabel(feature.kind)}>{featureChipLabel(feature)}</span>
                            {/each}
                          </div>
                        {/if}
                      </button>
                    </li>
                  {/each}
                </ul>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </vbox>
</Popup>

<style>
  .related-trigger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    min-width: 26px;
    height: 26px;
    padding: 3px 6px;
    margin-inline-end: 8px;
    border: 1px solid transparent;
    border-radius: 6px;
    background: transparent;
    color: color-mix(in srgb, var(--main-fg) 58%, transparent);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .related-trigger:hover,
  .related-trigger:focus-visible {
    background: var(--hover-bg);
    color: var(--hover-fg);
  }
  .related-trigger:focus-visible,
  .popup-icon-button:focus-visible,
  .group-toggle:focus-visible,
  .related-item:focus-visible {
    outline: 2px solid var(--icon-primary);
    outline-offset: 1px;
  }
  .related-trigger.has-results {
    border-color: color-mix(in srgb, var(--icon-primary) 34%, var(--border));
    background: color-mix(in srgb, var(--icon-primary) 10%, transparent);
    color: var(--icon-primary);
  }
  .related-trigger.error {
    color: var(--error-color, #b42318);
  }
  .trigger-count {
    font-variant-numeric: tabular-nums;
    font-weight: 700;
    line-height: 1;
  }
  .trigger-loading {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: currentColor;
    animation: related-pulse 1.2s ease-in-out infinite alternate;
  }
  .related-popup {
    display: flex;
    flex-direction: column;
    width: min(420px, calc(100vw - 24px));
    max-height: min(560px, var(--popup-max-height, 70vh));
    overflow: hidden;
    color: var(--main-fg);
  }
  .related-popup-header,
  .related-title,
  .related-actions,
  .item-heading,
  .item-details,
  .state-row,
  .loading-row {
    display: flex;
    align-items: center;
  }
  .related-popup-header {
    flex: 0 0 auto;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 12px 10px;
    border-block-end: 1px solid var(--border);
  }
  .related-title {
    min-width: 0;
    gap: 8px;
  }
  .related-title > :global(svg) {
    flex: 0 0 auto;
    color: var(--icon-primary);
  }
  .related-title-copy {
    min-width: 0;
  }
  h2 {
    margin: 0;
    font-size: 14px;
    line-height: 1.25;
  }
  .related-summary,
  .item-contact,
  .item-folder,
  .reply-status,
  .identifier,
  .item-date {
    color: color-mix(in srgb, var(--main-fg) 64%, transparent);
    font-size: 12px;
  }
  .related-summary.scanning {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .related-summary {
    display: block;
    margin-top: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .related-actions {
    flex: 0 0 auto;
    gap: 2px;
  }
  .popup-icon-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    padding: 4px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: color-mix(in srgb, var(--main-fg) 68%, transparent);
    cursor: pointer;
  }
  .popup-icon-button:hover {
    background: var(--hover-bg);
    color: var(--hover-fg);
  }
  .related-popup-body {
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
    padding: 10px 12px 12px;
  }
  .related-list {
    display: grid;
    gap: 2px;
    padding: 0;
    margin: 0;
    list-style: none;
  }
  .related-groups {
    display: grid;
    gap: 4px;
    padding: 0;
    margin: 0;
    list-style: none;
  }
  .related-group {
    min-width: 0;
  }
  .group-toggle {
    display: flex;
    align-items: center;
    width: 100%;
    min-width: 0;
    gap: 8px;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: color-mix(in srgb, var(--main-bg) 88%, var(--hover-bg));
    color: var(--main-fg);
    font: inherit;
    text-align: start;
    cursor: pointer;
  }
  .group-toggle:hover,
  .group-toggle:focus-visible {
    background: var(--hover-bg);
  }
  .group-toggle-icon {
    display: inline-flex;
    flex: 0 0 auto;
    color: var(--icon-primary);
  }
  .group-copy {
    display: flex;
    flex: 1 1 auto;
    min-width: 0;
    flex-direction: column;
    gap: 2px;
  }
  .group-reason {
    color: color-mix(in srgb, var(--main-fg) 62%, transparent);
    font-size: 11px;
    line-height: 1.2;
  }
  .group-label {
    min-width: 0;
    overflow-wrap: anywhere;
    font-size: 13px;
    font-weight: 600;
    line-height: 1.25;
  }
  .group-identifier {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .group-count {
    flex: 0 0 auto;
    min-width: 22px;
    padding: 2px 6px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--icon-primary) 13%, transparent);
    color: var(--icon-primary);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    font-weight: 700;
    line-height: 1.2;
    text-align: center;
  }
  .related-item {
    display: flex;
    flex-direction: column;
    width: 100%;
    min-width: 0;
    gap: 4px;
    padding: 8px;
    border: 1px solid transparent;
    border-radius: 6px;
    background: transparent;
    color: var(--main-fg);
    font: inherit;
    text-align: start;
    cursor: pointer;
  }
  .related-item:hover {
    background: var(--hover-bg);
  }
  .item-heading {
    width: 100%;
    min-width: 0;
    gap: 12px;
    align-items: flex-start;
  }
  .item-subject {
    flex: 1 1 auto;
    min-width: 0;
    overflow-wrap: anywhere;
    white-space: normal;
    font-size: 13px;
    font-weight: 600;
    line-height: 1.25;
  }
  .item-date {
    flex: 0 0 auto;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .item-details {
    flex-wrap: wrap;
    gap: 4px 8px;
    min-width: 0;
  }
  .reason {
    color: var(--icon-primary);
    font-size: 12px;
    font-weight: 600;
  }
  .item-contact,
  .item-folder,
  .reply-status,
  .identifier {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .identifier {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .item-features {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    min-width: 0;
  }
  .feature-chip {
    max-width: 100%;
    padding: 1px 6px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--icon-primary) 10%, transparent);
    color: color-mix(in srgb, var(--main-fg) 78%, var(--icon-primary));
    font-size: 11px;
    line-height: 1.4;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .state-row {
    justify-content: space-between;
    gap: 10px;
    margin: 0;
    color: color-mix(in srgb, var(--main-fg) 68%, transparent);
    font-size: 12px;
  }
  .error-state {
    align-items: flex-start;
    color: var(--main-fg);
  }
  .loading-row {
    gap: 8px;
    padding: 4px 2px;
  }
  .skeleton-line {
    display: block;
    width: 42%;
    height: 8px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--border) 78%, var(--main-bg));
    animation: related-pulse 1.2s ease-in-out infinite alternate;
  }
  .skeleton-line.short {
    width: 18%;
  }
  @keyframes related-pulse {
    from { opacity: 0.55; }
    to { opacity: 1; }
  }
  @media (max-width: 600px) {
    .related-popup {
      width: min(360px, calc(100vw - 16px));
    }
    .item-heading {
      align-items: flex-start;
      flex-direction: column;
      gap: 2px;
    }
  }
</style>
