<HeaderGroupBox>
  <hbox slot="header">
    {$t`Translation`}
  </hbox>
  <vbox class="translation">
    <label class="row">
      <input type="checkbox" bind:checked={$suggestSetting.value} />
      <span>{$t`Offer to translate emails in other languages`}</span>
    </label>

    <label class="row">
      <span>{$t`Translate into`}</span>
      <select bind:value={$targetSetting.value}>
        <option value="">{$t`Language of the app (${languageName(uiLanguage)})`}</option>
        {#each targetLanguages as language (language)}
          <option value={language}>{languageName(language)}</option>
        {/each}
      </select>
    </label>

    <vbox class="engines" role="radiogroup" aria-label={$t`Translation engine`}>
      <span class="caption">{$t`Translation engine`}</span>
      <label class="radio">
        <input type="radio" value="local" bind:group={$engineSetting.value} disabled={!localAvailable} />
        <span>{$t`On this computer`}</span>
      </label>
      <p class="hint">
        {$t`The text of emails stays on this device. Language models, 20–45 MB per pair of languages, are downloaded once from Mozilla servers.`}
      </p>
      <label class="radio">
        <input type="radio" value="deepl" bind:group={$engineSetting.value} disabled={!deeplAvailable} />
        <span>{$t`DeepL, with your API key`}</span>
      </label>
      <p class="hint">
        {$t`Better wording, but the text of each translated email is sent to DeepL SE in the EU.`}
      </p>
    </vbox>

    {#if $engineSetting.value == "deepl"}
      <vbox class="deepl">
        {#if hasKey}
          <hbox class="row">
            <span>{$t`DeepL API key is saved.`}</span>
            <Button plain label={$t`Remove key`} onClick={removeKey} />
          </hbox>
        {:else}
          <label class="key">
            <span>{$t`DeepL API key`}</span>
            <input type="password" autocomplete="off" spellcheck="false" bind:value={keyInput}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:fx" />
          </label>
          <hbox class="row">
            <Button classes="secondary" label={$t`Save key`} disabled={!keyInput.trim()} onClick={saveKey} />
          </hbox>
        {/if}
        <Notice tone="warning" compact
          message={$t`Emails you translate will be sent to DeepL`}
          hint={$t`Do not use it for confidential mail unless your company allows it. Before the first translation, Jackdaw Mail asks again.`} />
      </vbox>
    {/if}

    {#if neverLanguages.length}
      <vbox class="never">
        <span class="caption">{$t`Do not offer for`}</span>
        <hbox class="chips">
          {#each neverLanguages as language (language)}
            <Button plain classes="chip" label={`${languageName(language)} ×`}
              tooltip={$t`Offer again for ${languageName(language, "genitive")}`}
              onClick={() => allowLanguage(language)} />
          {/each}
        </hbox>
      </vbox>
    {/if}

    {#if localAvailable}
      <hbox class="row models">
        <span>{$t`Downloaded language models: ${megabytes(modelsSize)} MB`}</span>
        {#if modelsSize > 0}
          <Button plain label={$t`Delete`} onClick={deleteModels} />
        {/if}
      </hbox>
    {/if}
  </vbox>
</HeaderGroupBox>

<script lang="ts">
  import HeaderGroupBox from "../../Shared/HeaderGroupBox.svelte";
  import Button from "../../Shared/Button.svelte";
  import Notice from "../../Shared/Notice.svelte";
  import {
    getDeepLKeySetting,
    getTranslationEngineSetting,
    getTranslationNeverSuggestSetting,
    getTranslationSuggestSetting,
    getTranslationTargetSetting,
    translationLanguages,
  } from "../../Mail/Message/messageTranslation";
  import {
    deleteLocalModels,
    getLocalModelsSize,
    isDeepLTranslationAvailable,
    isLocalTranslationAvailable,
    capitalizeLanguageName,
    normalizeTranslationLanguage,
    translationLanguageName,
    type LanguageNameCase,
  } from "../../../logic/Mail/Translate/translationEngine";
  import { passwordEncrypt } from "../../../logic/Auth/passwordEncrypt";
  import { getUILocale, t } from "../../../l10n/l10n";
  import { catchErrors } from "../../Util/error";

  let suggestSetting = getTranslationSuggestSetting();
  let targetSetting = getTranslationTargetSetting();
  let engineSetting = getTranslationEngineSetting();
  let neverSetting = getTranslationNeverSuggestSetting();
  let keySetting = getDeepLKeySetting();

  let localAvailable = isLocalTranslationAvailable();
  let deeplAvailable = isDeepLTranslationAvailable();
  let uiLanguage = normalizeTranslationLanguage(getUILocale());
  let keyInput = "";
  let modelsSize = 0;
  let targetLanguages: string[] = [];

  $: hasKey = !!$keySetting.value;
  $: neverLanguages = Array.isArray($neverSetting.value) ? $neverSetting.value : [];
  $: void loadTargetLanguages($engineSetting.value);

  async function loadTargetLanguages(_engine: string) {
    try {
      let { to } = await translationLanguages();
      targetLanguages = [...to].sort((a, b) => languageName(a).localeCompare(languageName(b)));
    } catch {
      // Нет сети и списка моделей: остаются язык приложения и уже выбранный
      targetLanguages = $targetSetting.value ? [$targetSetting.value] : [];
    }
  }

  async function refreshModelsSize() {
    if (localAvailable) {
      try {
        modelsSize = await getLocalModelsSize();
      } catch {
        modelsSize = 0;
      }
    }
  }
  void refreshModelsSize();

  function languageName(code: string, grammaticalCase: LanguageNameCase = "nominative"): string {
    let name = translationLanguageName(code, getUILocale(), grammaticalCase);
    return grammaticalCase == "nominative" ? capitalizeLanguageName(name, getUILocale()) : name;
  }

  function megabytes(bytes: number): string {
    return (Math.max(0, bytes) / 1024 / 1024).toFixed(0);
  }

  async function saveKey() {
    let key = keyInput.trim();
    if (!key) {
      return;
    }
    keySetting.value = await passwordEncrypt(key);
    keyInput = "";
  }

  function removeKey() {
    keySetting.value = "";
  }

  function allowLanguage(language: string) {
    neverSetting.value = neverLanguages.filter(code => code != language);
  }

  async function deleteModels() {
    await catchErrors(async () => {
      await deleteLocalModels();
    });
    await refreshModelsSize();
  }
</script>

<style>
  .translation {
    gap: 10px;
    max-width: 640px;
  }
  .row {
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .engines {
    gap: 4px;
  }
  .radio {
    align-items: center;
    gap: 6px;
    display: flex;
  }
  .caption {
    font-weight: 600;
  }
  .hint {
    margin: 0 0 4px;
    padding-inline-start: 26px;
    opacity: 0.75;
    line-height: 1.45;
  }
  .deepl {
    gap: 8px;
    padding-inline-start: 26px;
  }
  .key {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .key input {
    max-width: 28em;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .never {
    gap: 4px;
  }
  .chips {
    flex-wrap: wrap;
    gap: 4px;
  }
  .chips :global(button.chip) {
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 2px 10px;
  }
  .models {
    opacity: 0.85;
  }
  select {
    max-width: 20em;
  }
</style>
