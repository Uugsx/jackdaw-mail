<hbox class="name-container">
  {#if isRenaming}
    <input type="text" bind:value={name}
      autofocus
      on:keydown={event => catchErrors(() => onKeyEnter(event, onRenameSave))}
      />
  {:else}
    <Clickable onDoubleClick={onRenameStart}>
      <hbox class="name">
        {file.name}
      </hbox>
    </Clickable>
  {/if}
  <hbox flex />
  <hbox class="buttons">
    <RoundButton
      onClick={isRenaming ? onRenameSave : onRenameStart}
      label={isRenaming ? $t`Save` : $t`Rename`}
      icon={isRenaming ? OKIcon : PencilIcon}
      iconSize="16px"
      padding="6px"
      classes="rename plain"
      border={false}
      />
  </hbox>
</hbox>

<script lang="ts">
  import type { FileOrDirectory } from "../../../logic/Files/FileOrDirectory";
  import { File } from "../../../logic/Files/File";
  import { onKeyEnter } from "../../Util/util";
  import Clickable from "../../Shared/Clickable.svelte";
  import RoundButton from "../../Shared/RoundButton.svelte";
  import PencilIcon from "lucide-svelte/icons/pencil";
  import OKIcon from "lucide-svelte/icons/check";
  import { catchErrors } from "../../Util/error";
  import { t, gt } from "../../../l10n/l10n";
  import { UserError } from "../../../logic/util/util";

  export let file: FileOrDirectory;

  let name = file.name;
  let isRenaming = false;
  // Компонент переиспользуется при выборе другого файла: незавершённое
  // переименование не должно примениться к новому выбранному файлу.
  $: resetRename(file);
  function resetRename(_file: FileOrDirectory) {
    isRenaming = false;
    name = _file?.name;
  }
  function onRenameStart() {
    if (file instanceof File) {
      name = file.nameWithoutExt;
    } else {
      name = file.name;
    }
    isRenaming = true;
  }
  async function onRenameSave() {
    let newName = name?.trim();
    if (!newName || /[\/\\]/.test(newName) || newName == "." || newName == "..") {
      throw new UserError(gt`Please enter a valid name. It must not contain slashes.`);
    }
    let oldName = file.name;
    let oldNameWithoutExt = file instanceof File ? file.nameWithoutExt : null;
    if (file instanceof File) {
      file.name = newName + (file.ext ? "." + file.ext : "");
      file.nameWithoutExt = newName;
    } else {
      file.name = newName;
    }
    isRenaming = false;
    try {
      await file.save();
    } catch (ex) {
      // Сервер не переименовал — возвращаем прежнее имя, чтобы список не врал
      file.name = oldName;
      if (file instanceof File) {
        file.nameWithoutExt = oldNameWithoutExt;
      }
      throw ex;
    }
  }
</script>

<style>
  .name {
    font-size: 120%;
    font-weight: bold;
  }
  input {
    font-size: 120%;
    font-weight: bold;
  }
  .buttons {
    align-items: start;
  }
</style>
