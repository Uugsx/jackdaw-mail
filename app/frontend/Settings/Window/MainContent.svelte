<Scroll bind:this={scroll}>
  <vbox flex class="settings-content">
    {#if page}
      <svelte:component this={page} account={$selectedAccount} />
    {/if}
  </vbox>
</Scroll>

<script lang="ts">
  import type { SettingsCategory } from "../SettingsCategory";
  import { selectedAccount } from "./selected";
  import Scroll from "../../Shared/Scroll.svelte";

  export let category: SettingsCategory;

  /* Новый раздел — с начала страницы, а не с прокрутки прошлого */
  let scroll: Scroll;
  $: category, scroll?.scrollTo(0);

  /* У раздела верхнего уровня вроде «Общие» нет своей страницы. Вместо пустого
   * экрана показываем первый подраздел, у которого страница есть. */
  $: page = category?.windowContent ??
    category?.subCategories?.find(sub => !!sub.windowContent)?.windowContent;
</script>

<style>
  .settings-content {
    max-width: 98%; /* HACK for account name page*/
    /* Страницы подстраиваются под ширину правой части настроек, а не окна. */
    container: settings-page / inline-size;
  }
</style>
