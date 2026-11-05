<vbox class="island">
  <IslandSwitcher faint={false}>
    <Button
      label={$t`Cloud storage`}
      tooltip={$t`Cloud storage`}
      icon={CloudIcon}
      iconSize="16px"
      iconOnly={active != FilesView.CloudStorage}
      onClick={() => active = FilesView.CloudStorage}
      selected={active == FilesView.CloudStorage}
      />
    <Button
      label={$t`Persons`}
      tooltip={$t`Persons`}
      icon={PersonIcon}
      classes="vertical"
      iconSize="16px"
      iconOnly={active != FilesView.Person}
      onClick={() => active = FilesView.Person}
      selected={active == FilesView.Person}
      />
    <!--
    <Button
      label={$t`Projects`}
      icon={ProjectIcon}
      classes="vertical"
      iconSize="16px"
      iconOnly={active != FilesView.Project}
      onClick={() => active = FilesView.Project}
      selected={active == FilesView.Project}
      />
      -->
  </IslandSwitcher>
</vbox>

<script lang="ts" context="module">
  export enum FilesView {
    Harddrive,
    CloudStorage,
    Person,
    Project,
    Recent,
    Search,
  }
</script>

<script lang="ts">
  import IslandSwitcher from "../../Shared/IslandSwitcher.svelte";
  import Button from "../../Shared/Button.svelte";
  import CloudIcon from "lucide-svelte/icons/cloudy";
  import PersonIcon from "lucide-svelte/icons/user";
  import ProjectIcon from "lucide-svelte/icons/boxes";
  import { t } from "../../../l10n/l10n";

  /** in/out */
  export let active: FilesView;
</script>

<style>
  /* Название вкладки в одну строку с многоточием: раньше слово рвалось по буквам
     и обрезалось по высоте. Полное название — в подсказке кнопки. */
  .island :global(.button .label) {
    display: block;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
