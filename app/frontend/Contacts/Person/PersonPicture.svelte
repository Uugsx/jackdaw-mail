<vbox class="avatar" style="width: {size}px; height: {size}px;">
  {#if picture}
    <img
      src={picture}
      width={size} height={size}
      title={$t`Picture of ${person.name}`}
      alt=""
      class:broken-image={isBroken}
      on:error={() => isBroken = true}
      />
  {:else if placeholder == "slot"}
    <slot name="placeholder" />
  {:else if placeholder == "icon"}
    <Icon data={contactsIcon} size="{size}px" />
  {:else if placeholder == "empty"}
    <hbox class="placeholder" />
  {:else if placeholder == "initials"}
    <!-- Без фото — инициалы на цветном круге: цвет постоянный для имени, чтобы людей легко различать -->
    <hbox class="initials" style:--initials-hue={hue} style:font-size="{Math.round(size * 0.4)}px" aria-hidden="true">{initials}</hbox>
  {/if}
</vbox>

<script lang="ts">
  import type { PersonOrGroup } from "./PersonOrGroup";
  import type { ChatPersonUID } from "../../../logic/Chat/ChatPersonUID";
  import contactsIcon from '../../asset/icon/appBar/contacts.svg?raw';
  import Icon from "../../Shared/Icon.svelte";
  import { t } from "../../../l10n/l10n";

  export let person: PersonOrGroup | ChatPersonUID;
  export let size = 48;
  export let placeholder: "none" | "empty" | "icon" | "slot" | "initials" = "none";

  let isBroken = false;
  $: picture = $person?.picture;
  $: picture, isBroken = false;
  $: initials = initialsOf($person?.name ?? "");
  $: hue = hueOf($person?.name ?? "");

  function initialsOf(name: string): string {
    let words = name.replace(/[@._-]+/g, " ").trim().split(/\s+/).filter(Boolean);
    let letters = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2);
    return letters.toUpperCase();
  }
  /** Оттенок из тёплой части круга (без кислотных зелёных и синих) */
  function hueOf(name: string): number {
    let hash = 0;
    for (let char of name) {
      hash = (hash * 31 + char.charCodeAt(0)) | 0;
    }
    return [12, 28, 40, 150, 200, 260, 330][Math.abs(hash) % 7];
  }
</script>

<style>
  .avatar {
    /*margin: 7px 12px; -- Breaks mobile app menu, bottom left button, when a contact is selected */
    clip-path: circle();
  }
  .placeholder {
    width: 100%;
    height: 100%;
    border: 1px solid var(--border);
    border-radius: 1000px;
  }
  .avatar .broken-image {
    visibility: hidden;
  }
  .initials {
    width: 100%;
    height: 100%;
    align-items: center;
    justify-content: center;
    font-weight: 600;
    line-height: 1;
    letter-spacing: 0.02em;
    color: hsl(var(--initials-hue) 45% 28%);
    background-color: hsl(var(--initials-hue) 55% 86%);
    user-select: none;
  }
</style>
