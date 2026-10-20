<vbox class="groups">
  <HeaderGroupBox>
    <hbox slot="header">
      {$t`Alert incidents`}
    </hbox>
    <vbox class="content">
      <p class="hint">
        {$t`In an alert folder, messages of the same alert are shown as one incident card with a counter, the first and the last alert. Turn it on from the folder menu or with a folder name rule below.`}
      </p>

      <label class="row">
        <span>{$t`Quiet after`}</span>
        <select bind:value={quietMinutes} on:change={onQuietChanged}>
          {#each alertQuietMinutesOptions as minutes}
            <option value={minutes}>{quietLabel(minutes)}</option>
          {/each}
        </select>
      </label>

      <vbox class="radios" role="radiogroup" aria-label={$t`Close incident`}>
        <span class="caption">{$t`Close incident`}</span>
        <label class="radio">
          <input type="radio" value="read" bind:group={$alertCloseActionSetting.value} />
          {$t`Mark all its messages as read`}
        </label>
        <label class="radio">
          <input type="radio" value="archive" bind:group={$alertCloseActionSetting.value} />
          {$t`Archive all its messages`}
        </label>
      </vbox>
    </vbox>
  </HeaderGroupBox>

  <HeaderGroupBox>
    <hbox slot="header">
      {$t`Alert folders by name`}
    </hbox>
    <vbox class="content">
      <p class="hint">{$t`Folders whose name contains one of these words are alert folders. One word per line.`}</p>
      <textarea rows="4" spellcheck="false" bind:value={nameRulesText} on:change={saveNameRules}
        placeholder={$t`Monitoring`}></textarea>
    </vbox>
  </HeaderGroupBox>

  <HeaderGroupBox>
    <hbox slot="header">
      {$t`Ignored parts of the subject`}
    </hbox>
    <vbox class="content">
      <p class="hint">{$t`Numbers, IDs, dates, IP addresses and host names are ignored already. Add a regular expression per line for other changing parts, for example server names.`}</p>
      <textarea rows="4" spellcheck="false" class="code" bind:value={patternsText} on:change={savePatterns}
        aria-invalid={invalidPatterns.length > 0}
        placeholder="srv-[a-z0-9]+"></textarea>
      {#if invalidPatterns.length}
        <p class="error" role="alert">{$t`Invalid expression, it is ignored: ${invalidPatterns.join(", ")}`}</p>
      {/if}
    </vbox>
  </HeaderGroupBox>
</vbox>

<script lang="ts">
  import HeaderGroupBox from "../../Shared/HeaderGroupBox.svelte";
  import {
    alertCloseActionSetting,
    alertFolderNameRulesSetting,
    alertPatternsSetting,
    alertQuietMinutesOptions,
    alertQuietMinutesSetting,
  } from "../../Mail/alertIncidentSettings";
  import { isValidAlertPattern } from "../../../logic/Mail/AlertIncident";
  import { t, plural } from "../../../l10n/l10n";

  let quietMinutes = alertQuietMinutesOptions.includes(alertQuietMinutesSetting.value)
    ? alertQuietMinutesSetting.value
    : 60;
  let nameRulesText = (alertFolderNameRulesSetting.value ?? []).join("\n");
  let patternsText = (alertPatternsSetting.value ?? []).join("\n");

  $: invalidPatterns = lines(patternsText).filter(line => !isValidAlertPattern(line));

  function lines(text: string): string[] {
    return text.split("\n").map(line => line.trim()).filter(Boolean);
  }

  function quietLabel(minutes: number): string {
    return minutes < 60
      ? $plural(minutes, { one: "# minute", other: "# minutes" })
      : $plural(minutes / 60, { one: "# hour", other: "# hours" });
  }

  function onQuietChanged() {
    alertQuietMinutesSetting.value = quietMinutes;
  }

  function saveNameRules() {
    alertFolderNameRulesSetting.value = lines(nameRulesText);
  }

  function savePatterns() {
    alertPatternsSetting.value = lines(patternsText);
  }
</script>

<style>
  .groups {
    gap: 16px;
    max-width: 640px;
  }
  .content {
    gap: 10px;
  }
  .hint {
    margin: 0;
    opacity: 0.75;
    line-height: 1.45;
  }
  .row {
    align-items: center;
    gap: 8px;
  }
  .radios {
    gap: 4px;
  }
  .caption {
    font-weight: 600;
  }
  .radio {
    align-items: center;
    margin-inline-start: 8px;
  }
  textarea {
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
    font: inherit;
  }
  textarea.code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  textarea[aria-invalid="true"] {
    border-color: var(--danger-fg);
  }
  .error {
    margin: 0;
    color: var(--danger-fg);
  }
</style>
