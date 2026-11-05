// @vitest-environment happy-dom

import "../../../logic/app";
import { ArrayColl } from "svelte-collections";
import { get } from "svelte/store";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  applyCategoryShortcut,
  assignCategoryShortcut,
  clearCategoryShortcut,
  findCategoryShortcut,
  formatCategoryShortcut,
  getCategoryShortcut,
  keyboardCategoryShortcutFromEvent,
  KeyboardCategoryShortcutPressGuard,
  mouseCategoryShortcutFromEvent,
} from "../../../frontend/Mail/CategoryShortcuts";
import { Tag, availableTags } from "../../../logic/Abstract/Tag";
import { TagCombination, tagCombinations } from "../../../logic/Abstract/TagCombination";
import { selectedMessage, selectedMessages } from "../../../frontend/Mail/Selected";
import { hoverRow } from "./hoverRow";

const tagTarget = { type: "tag" as const, id: "__category-shortcut-test__" };
const combinationTarget = {
  type: "combination" as const,
  id: "__category-shortcut-combination-test__",
};

afterEach(() => {
  clearCategoryShortcut(tagTarget);
  clearCategoryShortcut(combinationTarget);
});

describe("category shortcuts", () => {
  test("creates keyboard and mouse shortcuts from native events", () => {
    let keyboard = keyboardCategoryShortcutFromEvent(new KeyboardEvent("keydown", {
      key: "k",
      code: "KeyK",
      ctrlKey: true,
    }));
    let mouse = mouseCategoryShortcutFromEvent(new MouseEvent("mousedown", { button: 1 }));

    expect(keyboard).toEqual({
      kind: "keyboard",
      code: "KeyK",
      key: "k",
      ctrl: true,
      alt: false,
      shift: false,
      meta: false,
    });
    expect(mouse).toEqual({ kind: "mouse", button: 1 });
  });

  test("keeps a modifier-only shortcut identifiable", () => {
    let shortcut = keyboardCategoryShortcutFromEvent(new KeyboardEvent("keydown", {
      key: "Shift",
      code: "ShiftLeft",
      shiftKey: true,
    }));

    expect(shortcut?.shift).toBe(true);
    expect(shortcut?.ctrl).toBe(false);
    expect(formatCategoryShortcut(shortcut!)).toBe("Shift");
  });

  test("does not claim the same physical key until it is released", () => {
    let guard = new KeyboardCategoryShortcutPressGuard();

    expect(guard.claim("KeyK", 0)).toBe(true);
    expect(guard.claim("KeyK", 1)).toBe(false);

    guard.release("KeyK");
    expect(guard.claim("KeyK", 499)).toBe(false);
    expect(guard.claim("KeyK", 500)).toBe(true);

    guard.clear();
    expect(guard.claim("KeyK", 201)).toBe(true);
  });

  test("игнорирует повторный keydown после раннего keyup", () => {
    let guard = new KeyboardCategoryShortcutPressGuard();

    expect(guard.claim("KeyK", 1000)).toBe(true);
    guard.release("KeyK");

    expect(guard.claim("KeyK", 1200)).toBe(false);
    expect(guard.claim("KeyK", 1500)).toBe(true);
  });

  test("clears the duplicate-event cooldown", () => {
    let guard = new KeyboardCategoryShortcutPressGuard();

    expect(guard.claim("KeyK", 0)).toBe(true);
    guard.release("KeyK");
    guard.clear();

    expect(guard.claim("KeyK", 1)).toBe(true);
  });

  test("moves a shortcut when another target claims it", () => {
    let shortcut = { kind: "mouse" as const, button: 1 };

    expect(assignCategoryShortcut(tagTarget, shortcut)).toBeNull();
    expect(findCategoryShortcut(shortcut)).toEqual(tagTarget);
    expect(assignCategoryShortcut(combinationTarget, shortcut)).toEqual(tagTarget);
    expect(getCategoryShortcut(tagTarget)).toBeNull();
    expect(getCategoryShortcut(combinationTarget)).toEqual(shortcut);
    expect(formatCategoryShortcut(shortcut)).toBe("Mouse middle");
  });

  test("applies a category to the current message", async () => {
    let tag = new Tag();
    tag.name = tagTarget.id;
    tag.color = "#123456";
    availableTags.add(tag);
    let tags = new ArrayColl<Tag>();
    let addTags = vi.fn(async (nextTags: readonly Tag[]) => {
      for (let nextTag of nextTags) tags.add(nextTag);
    });
    let removeTags = vi.fn(async (nextTags: readonly Tag[]) => {
      for (let nextTag of nextTags) tags.remove(nextTag);
    });
    let message = { tags, addTags, removeTags };
    let previousMessage = get(selectedMessage);
    let previousMessages = get(selectedMessages);
    selectedMessage.set(message as any);
    selectedMessages.set(new ArrayColl());

    try {
      await expect(applyCategoryShortcut(tagTarget)).resolves.toBe(true);
      expect(addTags).toHaveBeenCalledWith([tag]);
      expect(tags.contains(tag)).toBe(true);

      await expect(applyCategoryShortcut(tagTarget)).resolves.toBe(true);
      expect(removeTags).toHaveBeenCalledWith([tag]);
      expect(tags.contains(tag)).toBe(false);
    } finally {
      selectedMessage.set(previousMessage);
      selectedMessages.set(previousMessages);
      availableTags.remove(tag);
    }
  });

  test("applies every category from a combination to selected messages", async () => {
    let firstTag = new Tag();
    firstTag.name = "__category-shortcut-first__";
    let secondTag = new Tag();
    secondTag.name = "__category-shortcut-second__";
    availableTags.add(firstTag);
    availableTags.add(secondTag);

    let combination = new TagCombination();
    combination.id = combinationTarget.id;
    combination.name = "Test combination";
    combination.tagNames = [firstTag.name, secondTag.name];
    tagCombinations.add(combination);

    let tags = new ArrayColl<Tag>();
    let addTags = vi.fn(async (nextTags: readonly Tag[]) => {
      for (let nextTag of nextTags) tags.add(nextTag);
    });
    let removeTags = vi.fn(async (nextTags: readonly Tag[]) => {
      for (let nextTag of nextTags) tags.remove(nextTag);
    });
    let message = { tags, addTags, removeTags };
    let previousMessage = get(selectedMessage);
    let previousMessages = get(selectedMessages);
    selectedMessage.set(undefined);
    selectedMessages.set(new ArrayColl([message as any]));

    try {
      await expect(applyCategoryShortcut(combinationTarget)).resolves.toBe(true);
      expect(addTags).toHaveBeenCalledWith([firstTag, secondTag]);
      expect(tags.contains(firstTag)).toBe(true);
      expect(tags.contains(secondTag)).toBe(true);

      await expect(applyCategoryShortcut(combinationTarget)).resolves.toBe(true);
      expect(removeTags).toHaveBeenCalledWith([firstTag, secondTag]);
      expect(tags.hasItems).toBe(false);
    } finally {
      selectedMessage.set(previousMessage);
      selectedMessages.set(previousMessages);
      tagCombinations.remove(combination);
      availableTags.remove(firstTag);
      availableTags.remove(secondTag);
    }
  });

  test("ставит категорию письму под курсором, а не выделенному", async () => {
    let tag = new Tag();
    tag.name = tagTarget.id;
    availableTags.add(tag);
    let makeMessage = () => ({
      tags: new ArrayColl<Tag>(),
      addTags: vi.fn(async () => undefined),
      removeTags: vi.fn(async () => undefined),
    });
    let selected = makeMessage();
    let hovered = makeMessage();
    let previousMessage = get(selectedMessage);
    let previousMessages = get(selectedMessages);
    selectedMessage.set(selected as any);
    selectedMessages.set(new ArrayColl([selected as any]));
    let hover = hoverRow(hovered as any);

    try {
      await expect(applyCategoryShortcut(tagTarget)).resolves.toBe(true);
      expect(hovered.addTags).toHaveBeenCalledWith([tag]);
      expect(selected.addTags).not.toHaveBeenCalled();
      expect(get(selectedMessage)).toBe(selected);

      hover.leave();
      await expect(applyCategoryShortcut(tagTarget)).resolves.toBe(true);
      expect(selected.addTags).toHaveBeenCalledWith([tag]);
    } finally {
      hover.leave();
      selectedMessage.set(previousMessage);
      selectedMessages.set(previousMessages);
      availableTags.remove(tag);
    }
  });
});
