// @vitest-environment happy-dom
import { describe, expect, test, beforeEach } from "vitest";
import { Tag, availableTags } from "../../../logic/Abstract/Tag";
import {
  TagCombination,
  applyTagCombinationToEmails,
  loadTagCombinations,
  saveTagCombinations,
  tagCombinations,
  usableTagCombinations,
} from "../../../logic/Abstract/TagCombination";

describe("TagCombination", () => {
  beforeEach(() => {
    availableTags.clear();
    tagCombinations.clear();
    const store = new Map<string, string>();
    globalThis.localStorage = {
      getItem: key => store.get(key) ?? null,
      setItem: (key, value) => { store.set(key, value); },
      removeItem: key => { store.delete(key); },
      clear: () => { store.clear(); },
      key: () => null,
      length: store.size,
    } as Storage;
  });

  function tag(name: string): Tag {
    let entry = new Tag();
    entry.name = name;
    availableTags.add(entry);
    return entry;
  }

  test("usableTagCombinations пропускает пустые комбинации", () => {
    let ready = new TagCombination();
    ready.name = "Ready";
    ready.tagNames = ["A"];
    tagCombinations.add(ready);
    let draft = new TagCombination();
    draft.name = "Draft";
    draft.tagNames = [];
    tagCombinations.add(draft);
    expect(usableTagCombinations().map(entry => entry.name)).toEqual(["Ready"]);
  });

  test("applyTagCombinationToEmails добавляет все категории", async () => {
    tag("1. Ошибка");
    tag("2. Тест");
    tag("3. Массовая");
    let combination = new TagCombination();
    combination.name = "Bug report";
    combination.tagNames = ["1. Ошибка", "2. Тест", "3. Массовая"];
    let added: string[] = [];
    let updateCount = 0;
    let email = {
      tags: {
        contains: () => false,
        add: (entry: Tag) => { added.push(entry.name); },
      },
      storage: { saveMessageTags: async () => {} },
      addTags: async (entries: readonly Tag[]) => {
        for (let entry of entries) {
          added.push(entry.name);
        }
        updateCount++;
      },
    };
    await applyTagCombinationToEmails([email as any], combination);
    expect(added).toEqual(["1. Ошибка", "2. Тест", "3. Массовая"]);
    expect(updateCount).toBe(1);
  });

  test("применяет комбинацию ко всем письмам одновременно", async () => {
    let category = tag("Массовая");
    let combination = new TagCombination();
    combination.name = "Bulk";
    combination.tagNames = [category.name];
    let started = 0;
    let release!: () => void;
    let waitForRelease = new Promise<void>(resolve => release = resolve);
    let addTags = async () => {
      started++;
      await waitForRelease;
    };
    let first = { addTags } as any;
    let second = { addTags } as any;

    let applying = applyTagCombinationToEmails([first, second], combination);
    await Promise.resolve();
    expect(started).toBe(2);
    release();
    await applying;
  });

  test("save/load сохраняет комбинации", async () => {
    tag("A");
    let combination = new TagCombination();
    combination.name = "Combo";
    combination.tagNames = ["A"];
    tagCombinations.add(combination);
    await saveTagCombinations();
    tagCombinations.clear();
    await loadTagCombinations();
    expect(usableTagCombinations()[0]?.name).toBe("Combo");
  });
});

describe("EMail.clearTags", () => {
  test("удаляет все категории одним обновлением", async () => {
    let a = new Tag(); a.name = "A";
    let b = new Tag(); b.name = "B";
    let c = new Tag(); c.name = "C";
    let current = new Set([a, b, c]);
    let updateCount = 0;
    let email = {
      tags: {
        contains: (entry: Tag) => current.has(entry),
        remove: (entry: Tag) => { current.delete(entry); },
        get contents() { return [...current]; },
      },
      storage: { saveMessageTags: async () => {} },
      removeTagsOnServer: async () => { updateCount++; },
      async removeTags(tags: readonly Tag[]) {
        for (let entry of tags) {
          current.delete(entry);
        }
        await this.storage.saveMessageTags(this);
        await this.removeTagsOnServer(tags);
      },
      async clearTags() {
        await this.removeTags(this.tags.contents.slice());
      },
    };
    await email.clearTags();
    expect(current.size).toBe(0);
    expect(updateCount).toBe(1);
  });
});
