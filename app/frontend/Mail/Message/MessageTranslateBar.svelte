<!--
  Полоска перевода над текстом письма: предложение перевести, ход перевода,
  «Переведено с …» с возвратом к оригиналу, ошибка с «Повторить».
-->
{#if $translation.status == "error"}
  <vbox class="translate-error" class:compact>
    <ErrorMessage ex={$translation.error} onRetry={() => translation.translate()} onClose={() => translation.reset()} />
  </vbox>
{:else if $translation.status == "consent"}
  <vbox class="translate-consent" class:compact>
    <Notice tone="warning"
      message={$t`The text of this email will be sent to DeepL for translation`}
      hint={$t`DeepL SE processes it on its servers in the EU. Switch to translation on this computer in Settings → Mail → Read to keep emails on this device.`}
      onClose={() => translation.reset()}
      >
      <hbox class="actions">
        <Button classes="secondary" label={$t`Send and translate`} onClick={() => translation.acceptConsent()} />
        <Button plain label={$t`Cancel`} onClick={() => translation.reset()} />
      </hbox>
    </Notice>
  </vbox>
{:else if bar}
  <hbox class="translate-bar font-small" class:compact role="status" aria-live="polite">
    <span class="icon" class:spin={bar == "translating"} aria-hidden="true">
      <svelte:component this={bar == "translating" ? LoaderIcon : LanguagesIcon} size="16px" />
    </span>
    <span class="text">
      {#if bar == "suggest"}
        {$t`This email is in ${languageName(suggestedLanguage, "prepositional")}.`}
      {:else if bar == "translating"}
        {#if $translation.model}
          {$t`Downloading the language model, once: ${megabytes($translation.model.loadedBytes)} of ${megabytes($translation.model.totalBytes)} MB`}
        {:else if $translation.total > 1}
          {$t`Translating… ${Math.min($translation.done, $translation.total)} of ${$translation.total}`}
        {:else}
          {$t`Translating…`}
        {/if}
      {:else if bar == "translated"}
        {#if $translation.sourceLanguage}
          {$t`Translated from ${languageName($translation.sourceLanguage, "genitive")}`}
        {:else}
          {$t`Translated`}
        {/if}
        {#if $translation.engine == "deepl"}
          <span class="engine">· DeepL</span>
        {/if}
      {:else if bar == "original"}
        {$t`Showing the original`}
      {:else if bar == "same-language"}
        {$t`This email is already in ${languageName($translation.targetLanguage, "prepositional")}.`}
      {:else if bar == "choose-language"}
        {$t`Could not tell the language of this email.`}
      {/if}
    </span>
    <hbox class="actions">
      {#if bar == "suggest"}
        <Button classes="secondary" label={$t`Translate into ${languageName(targetLanguage)}`}
          onClick={() => translation.translate(suggestedLanguage)} />
        <Button plain label={$t`Never for ${languageName(suggestedLanguage, "genitive")}`}
          onClick={neverForLanguage} />
      {:else if bar == "translating"}
        <Button plain label={$t`Cancel`} onClick={() => translation.cancel()} />
      {:else if bar == "translated"}
        <Button plain label={$t`Show original`} onClick={() => translation.showOriginal()} />
      {:else if bar == "original"}
        <Button plain label={$t`Show translation`} onClick={() => translation.showTranslation()} />
      {:else if bar == "choose-language"}
        <label class="language">
          <span>{$t`Language of the email`}</span>
          <select bind:value={chosenLanguage}>
            {#each sourceLanguages as language (language)}
              <option value={language}>{capitalizeLanguageName(languageName(language), getUILocale())}</option>
            {/each}
          </select>
        </label>
        <Button classes="secondary" label={$t`Translate`} disabled={!chosenLanguage}
          onClick={() => translation.translate(chosenLanguage)} />
      {/if}
    </hbox>
    {#if bar == "suggest" || bar == "same-language" || bar == "choose-language"}
      <span class="close">
        <RoundButton label={$t`Close`} icon={CloseIcon} iconSize="14px" classes="plain small" border={false}
          onClick={closeBar} />
      </span>
    {/if}
  </hbox>
{/if}

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import {
    dismissTranslationSuggestion,
    getMessageTranslation,
    getTranslationNeverSuggestSetting,
    getTranslationSuggestSetting,
    getTranslationTargetSetting,
    neverSuggestLanguage,
    translationLanguages,
    translationSuggestionFor,
    translationTargetLanguage,
  } from "./messageTranslation";
  import {
    capitalizeLanguageName,
    translationLanguageName,
    type LanguageNameCase,
  } from "../../../logic/Mail/Translate/translationEngine";
  import Button from "../../Shared/Button.svelte";
  import RoundButton from "../../Shared/RoundButton.svelte";
  import Notice from "../../Shared/Notice.svelte";
  import ErrorMessage from "../../Shared/ErrorMessageInline.svelte";
  import LanguagesIcon from "lucide-svelte/icons/languages";
  import LoaderIcon from "lucide-svelte/icons/loader-circle";
  import CloseIcon from "lucide-svelte/icons/x";
  import { getUILocale, t } from "../../../l10n/l10n";

  export let message: EMail;
  /** В пузыре «Письмо как чат»: меньше отступов */
  export let compact = false;
  /** Предлагать перевод письма на другом языке */
  export let suggest = true;

  $: translation = getMessageTranslation(message);

  let suggestSetting = getTranslationSuggestSetting();
  let neverSetting = getTranslationNeverSuggestSetting();
  let targetSetting = getTranslationTargetSetting();

  let suggestedLanguage: string | null = null;
  let suggestionFor: EMail | null = null;
  let suggestionRun = 0;
  $: targetLanguage = translationTargetLanguage($targetSetting.value);
  $: void refreshSuggestion(message, suggest && $message.loadedBody, $suggestSetting.value,
    $neverSetting.value, targetLanguage);

  async function refreshSuggestion(current: EMail, enabled: boolean, ..._settings: unknown[]) {
    let run = ++suggestionRun;
    if (!enabled) {
      suggestedLanguage = null;
      suggestionFor = current;
      return;
    }
    let language = await translationSuggestionFor(current);
    if (run == suggestionRun) {
      suggestedLanguage = language;
      suggestionFor = current;
    }
  }

  $: bar = barFor($translation.status, $translation.showOriginal,
    suggestionFor === message ? suggestedLanguage : null);

  function barFor(status: string, showOriginal: boolean, suggestion: string | null) {
    switch (status) {
    case "translating":
      return "translating";
    case "translated":
      return showOriginal ? "original" : "translated";
    case "same-language":
    case "choose-language":
      return status;
    case "idle":
      return suggestion ? "suggest" : null;
    default:
      return null;
    }
  }

  let sourceLanguages: string[] = [];
  let chosenLanguage = "";
  $: if (bar == "choose-language") {
    void loadSourceLanguages();
  }

  async function loadSourceLanguages() {
    try {
      let { from } = await translationLanguages();
      let target = translationTargetLanguage();
      sourceLanguages = from.filter(language => language != target)
        .sort((a, b) => languageName(a).localeCompare(languageName(b)));
      if (!sourceLanguages.includes(chosenLanguage)) {
        chosenLanguage = sourceLanguages.includes("en") ? "en" : sourceLanguages[0] ?? "";
      }
    } catch (ex) {
      translation.showError(ex);
    }
  }

  function languageName(code: string, grammaticalCase: LanguageNameCase = "nominative"): string {
    return translationLanguageName(code, getUILocale(), grammaticalCase);
  }

  function megabytes(bytes: number): string {
    return (Math.max(0, bytes) / 1024 / 1024).toFixed(bytes > 10 * 1024 * 1024 ? 0 : 1);
  }

  function neverForLanguage() {
    if (suggestedLanguage) {
      neverSuggestLanguage(suggestedLanguage);
    }
    suggestedLanguage = null;
  }

  function closeBar() {
    if (bar == "suggest") {
      dismissTranslationSuggestion(message);
      suggestedLanguage = null;
    } else {
      translation.reset();
    }
  }
</script>

<style>
  .translate-bar {
    align-items: center;
    flex-wrap: wrap;
    gap: 4px 10px;
    margin-block: 4px 6px;
    margin-inline: 8px 16px;
    padding: 4px 6px 4px 10px;
    min-height: 32px;
    box-sizing: border-box;
    border: 1px solid var(--border);
    border-radius: 6px;
    background-color: var(--surface-subtle, color-mix(in srgb, var(--border) 18%, transparent));
    color: var(--main-fg);
  }
  .translate-bar.compact {
    margin: 0 0 6px;
    padding: 2px 4px 2px 8px;
    min-height: 28px;
    border-style: dashed;
    background-color: transparent;
  }
  .icon {
    display: flex;
    flex: none;
    color: var(--icon-primary);
  }
  .icon.spin :global(svg) {
    animation: translate-spin 900ms linear infinite;
  }
  .text {
    flex: 1 1 12em;
    min-width: 0;
    overflow-wrap: anywhere;
    line-height: 1.35;
  }
  .engine {
    opacity: 0.7;
  }
  .actions {
    align-items: center;
    flex-wrap: wrap;
    gap: 4px;
    min-width: 0;
    max-width: 100%;
  }
  /* Подпись кнопки переносится, только если не помещается даже в отдельной
   * строке (узкая область письма), а не вылезает за край плашки. */
  .translate-bar :global(button) {
    max-width: 100%;
    text-align: start;
    padding-block: 3px;
  }
  .language {
    align-items: center;
    gap: 6px;
    display: flex;
  }
  .language select {
    max-width: 14em;
  }
  .close {
    flex: none;
    display: flex;
  }
  .translate-error,
  .translate-consent {
    margin-inline: 8px 16px;
  }
  .translate-error.compact,
  .translate-consent.compact {
    margin-inline: 0;
  }
  .translate-consent .actions {
    margin-block-start: 6px;
  }
  @keyframes translate-spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .icon.spin :global(svg) {
      animation: none;
    }
  }
</style>
