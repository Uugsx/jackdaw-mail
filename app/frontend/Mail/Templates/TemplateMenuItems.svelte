{#if state == "loading"}
  <MenuLabel label={$t`Loading templates…`} />
{:else if state == "error"}
  <MenuLabel label={$t`Could not load templates`} tooltip={errorText} />
  <MenuItem
    label={$t`Try again`}
    icon={RetryIcon}
    closeOnClick={false}
    onClick={load} />
{:else if templates.length == 0}
  <vbox class="template-empty">
    <span class="empty-title">{$t`No templates yet`}</span>
    <span class="empty-hint">{$t`Write a message you send often and save it as a template.`}</span>
  </vbox>
{:else}
  <MenuLabel label={$t`Insert template`} />
  {#each templates as template (template.id)}
    <MenuItem
      label={template.name}
      icon={TemplateIcon}
      classes="template-item"
      tooltip={templateTooltip(template)}
      onClick={() => onInsert(template.id)} />
  {/each}
{/if}
<MenuDivider />
<MenuItem
  label={$t`Save as template…`}
  icon={SaveIcon}
  onClick={onSave} />
{#if onManage}
  <MenuItem
    label={$t`Manage templates…`}
    icon={ManageIcon}
    onClick={onManage} />
{/if}

<script lang="ts">
  import { onMount } from "svelte";
  import type { MailTemplateSummary } from "../../../logic/Mail/Templates/MailTemplate";
  import { listMailTemplates } from "../../../logic/Mail/Templates/MailTemplateData";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import MenuLabel from "../../Shared/Menu/MenuLabel.svelte";
  import MenuDivider from "../../Shared/Menu/MenuDivider.svelte";
  import TemplateIcon from "lucide-svelte/icons/file-text";
  import SaveIcon from "lucide-svelte/icons/file-plus";
  import ManageIcon from "lucide-svelte/icons/settings-2";
  import RetryIcon from "lucide-svelte/icons/refresh-cw";
  import { backgroundError, userMessage } from "../../Util/error";
  import { t } from "../../../l10n/l10n";

  export let onInsert: (id: number) => void;
  export let onSave: () => void;
  /** null — управление недоступно (отдельное окно редактора) */
  export let onManage: (() => void) | null = null;

  let state: "loading" | "error" | "ready" = "loading";
  let templates: MailTemplateSummary[] = [];
  let errorText = "";

  // Меню создаётся при каждом открытии: список всегда свежий,
  // даже если шаблон добавили в другом окне
  onMount(load);

  async function load() {
    state = "loading";
    try {
      templates = await listMailTemplates();
      state = "ready";
    } catch (ex) {
      backgroundError(ex);
      errorText = userMessage(ex);
      state = "error";
    }
  }

  function templateTooltip(template: MailTemplateSummary): string {
    let lines = [template.name];
    if (template.subject) {
      lines.push($t`Subject: ${template.subject}`);
    }
    if (template.attachmentCount) {
      lines.push($t`Attachments: ${template.attachmentCount}`);
    }
    return lines.join("\n");
  }
</script>

<style>
  .template-empty {
    max-width: 260px;
    padding: 8px 14px;
    gap: 4px;
  }
  .empty-title {
    font-size: 13px;
    font-weight: 600;
  }
  .empty-hint {
    font-size: 12px;
    line-height: 1.4;
    color: color-mix(in srgb, var(--main-fg) 65%, transparent);
  }
  :global(.menuitem.template-item) {
    max-width: 320px;
  }
  :global(.menuitem.template-item .label) {
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
