<HeaderGroupBox>
  <hbox slot="header">
    {$t`Quote`}
  </hbox>
  <vbox>
    <hbox class="subtitle">{$t`When replying:`}</hbox>

    <hbox class="quote">
      <vbox>
        <label class="radio">
          <input type="radio" value="below" bind:group={quoteSetting.value} />
          {$t`Quote below, Reply above`}
        </label>
        <vbox class="illustration-paper">
          <Paper>
            <div class="illustration">
              <p>{$t`At 8:00 *=> Meet at 8 AM`}</p>
              <p>{$t`${`Ben Bucksch`} wrote:`}</p>
              <blockquote type="cite">
                {$t`When do we meet?`}
              </blockquote>
            </div>
          </Paper>
        </vbox>
      </vbox>

      <vbox>
        <label class="radio">
          <input type="radio" value="above" bind:group={quoteSetting.value} />
          {$t`Quote above, Reply below`}
        </label>
        <vbox class="illustration-paper">
          <Paper>
            <div class="illustration">
              <p>{$t`${`Ben Bucksch`} wrote: *=> Mail quote attribution line`}</p>
              <blockquote type="cite">
                {$t`When do we meet?`}
              </blockquote>
              <p>{$t`At 8:00 *=> Meet at 8 AM`}</p>
            </div>
          </Paper>
        </vbox>
      </vbox>

      <vbox>
        <label class="radio">
          <input type="radio" value="none" bind:group={quoteSetting.value} />
          {$t`Do not quote`}
        </label>
        <hbox />
      </vbox>
    </hbox>
    {#if quoteSetting.value !== "none"}
      <hbox class="quote-attribution">
        <input type="checkbox" bind:checked={quoteAttributionSetting.value} id="quote-attribution" />
        <label for="quote-attribution">
          {$t`Show attribution line (who wrote and when)`}
        </label>
      </hbox>
    {/if}
  </vbox>
</HeaderGroupBox>

<HeaderGroupBox>
  <hbox slot="header">
    {$t`Formatting`}
  </hbox>
  <hbox class="format">
    <vbox>
      <label class="radio">
        <input type="radio" value="html" bind:group={formatSetting.value} />
        {$t`Send as HTML and Plaintext`}
      </label>
      <vbox class="illustration-paper">
        <Paper>
          <div class="illustration">
            <blockquote type="cite">
              {@html $t`<strong>When</strong> and <strong>where</strong> do we meet?`}
            </blockquote>
            <ul>
              <li>{$t`At 8:00 *=> Meet at 8 AM`}</li>
              <li>{@html $t`I'll come by <em>your</em> office`}</li>
            </ul>
          </div>
        </Paper>
      </vbox>
    </vbox>

    <vbox>
      <label class="radio">
        <input type="radio" value="plaintext" bind:group={formatSetting.value} />
        {$t`Send as Plaintext only`}
      </label>
      <vbox class="illustration-paper">
        <Paper>
          <div class="illustration">
            <pre>&gt; {$t`*When* and *where* do we meet?`}

* {$t`At 8:00 *=> Meet at 8 AM`}
* {$t`I'll come by /your/ office`}</pre>
          </div>
        </Paper>
      </vbox>
    </vbox>
  </hbox>
</HeaderGroupBox>

<HeaderGroupBox>
  <hbox slot="header">
    {$t`Composition defaults`}
  </hbox>
  <grid class="default-format-grid">
    <hbox class="default-format-setting">
      <label for="default-font-family">{$t`Font`}</label>
      <select id="default-font-family" bind:value={defaultFontFamilySetting.value}>
        {#each composeFontFamilies as font}
          <option value={font.value}>{font.label()}</option>
        {/each}
      </select>
    </hbox>
    <hbox class="default-format-setting">
      <label for="default-font-size">{$t`Font size`}</label>
      <select id="default-font-size" bind:value={defaultFontSizeSetting.value}>
        {#each composeFontSizes as size}
          <option value={size}>{formatFontSizeLabel(size)} pt</option>
        {/each}
      </select>
    </hbox>
    <hbox class="default-format-setting">
      <label for="default-text-color">{$t`Font color`}</label>
      <hbox class="color-setting">
        <input id="default-text-color" type="color"
          value={$defaultTextColorSetting.value || composeTextColors[0]}
          aria-label={$t`Font color`}
          on:input={onDefaultTextColorInput} />
        <Button
          plain
          label={$t`Automatic`}
          onClick={clearDefaultTextColor}
          disabled={!$defaultTextColorSetting.value} />
      </hbox>
    </hbox>
    <hbox class="default-format-setting">
      <label for="default-line-height">{$t`Line spacing`}</label>
      <select id="default-line-height" bind:value={defaultLineHeightSetting.value}>
        {#each composeLineHeights as lineHeight}
          <option value={lineHeight.value}>{lineHeight.label}</option>
        {/each}
      </select>
    </hbox>
    <hbox class="default-format-setting">
      <label for="default-text-align">{$t`Alignment`}</label>
      <select id="default-text-align" bind:value={defaultTextAlignSetting.value}>
        <option value="left">{$t`Align left`}</option>
        <option value="center">{$t`Align center`}</option>
        <option value="right">{$t`Align right`}</option>
        <option value="justify">{$t`Justify`}</option>
      </select>
    </hbox>
    <hbox class="default-format-setting">
      <label for="default-paragraph-spacing">{$t`Paragraph spacing`}</label>
      <select id="default-paragraph-spacing" bind:value={defaultParagraphSpacingSetting.value}>
        {#each composeParagraphSpacingValues as spacing}
          <option value={spacing}>{spacing == "0" ? $t`Default` : `${spacing} pt`}</option>
        {/each}
      </select>
    </hbox>
    <hbox class="default-format-setting">
      <label for="default-first-line-indent">{$t`First-line indent`}</label>
      <select id="default-first-line-indent" bind:value={defaultFirstLineIndentSetting.value}>
        {#each composeFirstLineIndentValues as indent}
          <option value={indent}>{indent == "0" ? $t`Default` : `${indent} pt`}</option>
        {/each}
      </select>
    </hbox>
  </grid>
  <span class="hint">{$t`Used for the text you write in new messages and replies.`}</span>
</HeaderGroupBox>

<HeaderGroupBox>
  <hbox slot="header">
    {$t`Composition`}
  </hbox>
  <vbox class="composition-settings">
    <hbox class="composition">
      <input type="checkbox" bind:checked={spellcheckEnabledSetting.value} id="spellcheck" name="spellcheck" />
      <label class="spellcheck" for="spellcheck">
        {$t`Spell check`}
      </label>
    </hbox>
    <hbox class="composition">
      <input type="checkbox" bind:checked={warnMissingAttachmentSetting.value} id="warn-missing-attachment" name="warn-missing-attachment" />
      <label class="spellcheck" for="warn-missing-attachment">
        {$t`Warn when the text mentions an attachment, but no file is attached`}
      </label>
    </hbox>
    <hbox class="composition undo-send">
      <label for="undo-send-seconds">{$t`Undo send`}</label>
      <select id="undo-send-seconds" bind:value={undoSeconds}>
        {#each kUndoSendChoices as seconds}
          <option value={seconds}>{seconds ? $t`${seconds} seconds` : $t`Off`}</option>
        {/each}
      </select>
    </hbox>
    <span class="hint">{$t`After you click Send, the message waits this long. Until then, you can take it back to the editor.`}</span>
    {#if !webMail}
      <hbox class="presentation">
        <span class="presentation-label">{$t`Open compose window:`}</span>
        <label class="radio">
          <input type="radio" value="fullscreen" bind:group={presentationSetting.value} />
          {$t`In main window`}
        </label>
        <label class="radio">
          <input type="radio" value="window" bind:group={presentationSetting.value} />
          {$t`In separate movable window`}
        </label>
      </hbox>
    {/if}
  </vbox>
</HeaderGroupBox>

<script lang="ts">
  import HeaderGroupBox from "../../Shared/HeaderGroupBox.svelte";
  import { getLocalStorage } from "../../Util/LocalStorage";
  import { t } from "../../../l10n/l10n";
  import Paper from "../../Shared/Paper.svelte";
  import Button from "../../Shared/Button.svelte";
  import { webMail } from "../../../logic/build";
  import { kUndoSendChoices, normalizeUndoSeconds, undoSendSecondsSetting } from "../../Mail/Scheduled/scheduledSend";
  import {
    composeDefaultFontFamily,
    composeDefaultFontSize,
    composeDefaultTextColor,
    composeDefaultLineHeight,
    composeDefaultTextAlign,
    composeDefaultParagraphSpacing,
    composeDefaultFirstLineIndent,
    composeFontFamilies,
    composeFontSizes,
    composeLineHeights,
    composeParagraphSpacingValues,
    composeFirstLineIndentValues,
    composeTextColors,
    formatFontSizeLabel,
  } from "../../Shared/Editor/composeEditorExtensions";

  let formatSetting = getLocalStorage("mail.send.format", "html");
  let quoteSetting = getLocalStorage("mail.send.quote", "below");
  let quoteAttributionSetting = getLocalStorage("mail.send.quote.attribution", false);
  let spellcheckEnabledSetting = getLocalStorage("mail.send.spellcheck.enabled", false);
  let warnMissingAttachmentSetting = getLocalStorage("mail.send.warnMissingAttachment", true);
  let undoSeconds = normalizeUndoSeconds(undoSendSecondsSetting.value);
  $: undoSendSecondsSetting.value = normalizeUndoSeconds(undoSeconds);
  let presentationSetting = getLocalStorage("mail.compose.presentation", "fullscreen");
  let defaultFontFamilySetting = getLocalStorage("mail.compose.defaultFontFamily", composeDefaultFontFamily);
  let defaultFontSizeSetting = getLocalStorage("mail.compose.defaultFontSize", composeDefaultFontSize);
  let defaultTextColorSetting = getLocalStorage("mail.compose.defaultTextColor", composeDefaultTextColor);
  let defaultLineHeightSetting = getLocalStorage("mail.compose.defaultLineHeight", composeDefaultLineHeight);
  let defaultTextAlignSetting = getLocalStorage("mail.compose.defaultTextAlign", composeDefaultTextAlign);
  let defaultParagraphSpacingSetting = getLocalStorage("mail.compose.defaultParagraphSpacing", composeDefaultParagraphSpacing);
  let defaultFirstLineIndentSetting = getLocalStorage("mail.compose.defaultFirstLineIndent", composeDefaultFirstLineIndent);

  function onDefaultTextColorInput(event: Event) {
    defaultTextColorSetting.value = (event.currentTarget as HTMLInputElement).value;
  }

  function clearDefaultTextColor() {
    defaultTextColorSetting.value = composeDefaultTextColor;
  }
</script>

<style>
  .subtitle {
    margin-block-end: 16px;
  }
  .quote-attribution {
    align-items: center;
    margin-block-start: 12px;
    margin-inline-start: 8px;
  }
  .quote-attribution label {
    margin-inline-start: 8px;
  }
  hbox.quote,
  hbox.format {
    flex-wrap: wrap;
    gap: 16px;
  }
  .quote img {
    margin: 12px 48px 24px 28px;
  }
  .format img {
    margin: 16px 32px 24px 28px;
  }
  .default-format-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(260px, 1fr));
    gap: 12px 24px;
    margin-block-start: 4px;
  }
  .default-format-setting {
    align-items: center;
    gap: 12px;
    min-width: 0;
  }
  .default-format-setting label {
    flex: 1 1 auto;
    margin-inline-start: 0;
  }
  .default-format-setting select {
    min-width: 9em;
  }
  .color-setting {
    align-items: center;
    gap: 8px;
  }
  .color-setting input[type="color"] {
    width: 32px;
    height: 28px;
    padding: 2px;
  }
  .hint {
    display: block;
    margin-block-start: 8px;
    color: var(--input-placeholder);
    font-size: 13px;
    line-height: 1.4;
  }
  label.spellcheck {
    text-decoration: underline;
    text-decoration-style: wavy;
    text-decoration-color: red;
  }
  .radio {
    align-items: center;
  }
  input[type="checkbox"] {
    margin-inline-end: 12px;
  }
  label {
    margin-inline-start: 8px;
  }
  .composition-settings {
    gap: 12px;
  }
  .presentation {
    flex-wrap: wrap;
    align-items: center;
    gap: 12px 16px;
  }
  .presentation-label {
    font-weight: 600;
    margin-inline-end: 4px;
  }
  .undo-send {
    align-items: center;
    gap: 12px;
  }
  .undo-send label {
    margin-inline-start: 0;
    font-weight: 600;
  }
  .illustration-paper {
    margin-block-start: 8px;
    margin-inline-start: 8px;
    padding-inline-start: 8px;
  }

  .illustration {
    margin-block-start: -4px;
    margin-inline-start: 8px;
    padding-inline-start: 8px;
    margin-inline-end: 16px;
  }
  .illustration blockquote[type=cite] {
    border-inline-start: 3px solid var(--selected-bg);
    padding-inline-start: 20px;
    margin-inline-start: 0px;
    margin-inline-end: 0px;
  }
  .illustration pre {
    margin-block-start: 16px;
    font-size: 14px;
  }
  .illustration ul {
    padding-inline-start: 24px;
  }
  .illustration strong {
    font-weight: 800;
  }
</style>
