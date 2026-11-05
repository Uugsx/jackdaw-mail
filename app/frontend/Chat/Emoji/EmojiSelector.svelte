<hbox class="emoji-selector" flex>
  <hbox class="selector">
    <Scroll>
      <vbox class="group-selector">
        {#each emojisList as group}
          <RoundButton
            label={group.title}
            onClick={() => onScrollTo(group)}
            border={false} classes="plain"
            padding="0px"
            >
            <hbox class="icon font-large" slot="icon">
              {group.icon}
            </hbox>
          </RoundButton>
        {/each}
      </vbox>
    </Scroll>
  </hbox>
  <Scroll bind:this={groupsScroll}>
    <vbox class="groups">
      {#each emojisList as group}
        <vbox bind:this={groupElements[group.id]} data-emoji-group={group.id}>
          <hbox class="title font-small">
            {group.title}
          </hbox>
          <hbox class="emojis">
            {#each group.emojis as entry}
              <RoundButton
                label={entry.name}
                onClick={() => dispatchEvent("select", { emoji: entry.emoji })}
                border={false} classes="plain"
                padding="0px"
                >
                <hbox class="icon font-large" slot="icon">
                  {entry.emoji}
                </hbox>
              </RoundButton>
            {/each}
          </hbox>
        </vbox>
      {/each}
    </vbox>
  </Scroll>
</hbox>

<script lang="ts">
  import emojisJSON from "./emojis.json";
  import { isEmojiSupported } from "./emojiSupport";
  import RoundButton from "../../Shared/RoundButton.svelte";
  import Scroll from "../../Shared/Scroll.svelte";
  import { createEventDispatcher } from 'svelte';
  const dispatchEvent = createEventDispatcher<{ select: { emoji: string | null, } }>();

  export let searchTerm: string | null;

  let groupsScroll: Scroll;
  let groupElements: Record<string, HTMLElement> = {};

  $: emojisList = list(searchTerm);

  /** Только смайлики, которые система умеет рисовать: остальные были пустыми квадратами */
  let supportedGroups: typeof emojisJSON | null = null;
  function supportedEmojis(): typeof emojisJSON {
    supportedGroups ??= emojisJSON
      .map(group => ({ ...group, emojis: group.emojis.filter(entry => isEmojiSupported(entry.emoji)) }))
      .filter(group => group.emojis.length);
    return supportedGroups;
  }

  function list(searchTerm: string) {
    if (!searchTerm) {
      return supportedEmojis();
    }
    let term = searchTerm.toLowerCase();
    let list = [];
    for (let group of supportedEmojis()) {
      let emojis = [];
      for (let emoji of group.emojis) {
        if (emoji.keywords.some(keyword => keyword.includes(term))) {
          emojis.push(emoji);
        }
      }
      if (emojis.length) {
        let filteredGroup = Object.assign({}, group);
        filteredGroup.emojis = emojis;
        list.push(filteredGroup);
      }
    }
    return list;
  }

  function onScrollTo(group: { id: string }) {
    let groupE = groupElements[group.id];
    if (!groupsScroll || !groupE) {
      return;
    }
    groupsScroll.scrollTo(groupE.offsetTop, "smooth");
  }
</script>

<style>
  .emoji-selector {
    flex: 1 1 0;
    min-height: 0;
    min-width: 0;
  }
  .groups {
    padding: 4px 8px;
  }
  .group-selector .icon {
    font-size: 20px;
  }
  .title {
    opacity: 70%;
    margin-block-end: 2px;
  }
  .emojis {
    flex-wrap: wrap;
    margin-block-end: 8px;
  }
  .selector {
    flex: 0 0 48px;
    min-height: 0;
    width: 48px;
  }
</style>
