// @vitest-environment happy-dom

import { afterEach, describe, expect, test } from "vitest";
import { mount, tick, unmount } from "svelte";
import { ArrayColl } from "svelte-collections";
import FastList from "../../../frontend/Shared/FastList.svelte";

type TestItem = { id: number };

let mounted: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (mounted) {
    unmount(mounted);
    mounted = null;
  }
  document.body.replaceChildren();
});

describe("FastList mail selection", () => {
  test("selects the complete filtered list with Cmd+A after a row click", async () => {
    let items = new ArrayColl<TestItem>([{ id: 1 }, { id: 2 }, { id: 3 }]);
    let selectedItems = new ArrayColl<TestItem>();
    let target = document.createElement("div");
    document.body.append(target);

    mounted = mount(FastList, {
      target,
      props: {
        items,
        selectedItems,
        focusOnSelect: true,
      },
    });
    await tick();

    let list = target.querySelector(".fast-list") as HTMLElement;
    let rows = target.querySelectorAll(".row");
    (rows[0] as HTMLElement).click();
    list.dispatchEvent(new KeyboardEvent("keydown", {
      key: "a",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    }));

    expect(selectedItems.contents).toEqual(items.contents);
    expect(document.activeElement).toBe(list);
  });

  test("keeps the anchor and selects a range with Shift+click", async () => {
    let items = new ArrayColl<TestItem>([{ id: 1 }, { id: 2 }, { id: 3 }]);
    let selectedItems = new ArrayColl<TestItem>();
    let target = document.createElement("div");
    document.body.append(target);

    mounted = mount(FastList, {
      target,
      props: {
        items,
        selectedItems,
        focusOnSelect: true,
      },
    });
    await tick();

    let rows = target.querySelectorAll(".row");
    (rows[0] as HTMLElement).click();
    (rows[2] as HTMLElement).dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      shiftKey: true,
    }));

    expect(selectedItems.contents).toEqual(items.contents);
  });

  test("preserves all selected rows when the list rebuilds row objects", async () => {
    let items = new ArrayColl<TestItem>([{ id: 1 }, { id: 2 }, { id: 3 }]);
    let selectedItems = new ArrayColl<TestItem>();
    let target = document.createElement("div");
    document.body.append(target);

    mounted = mount(FastList, {
      target,
      props: {
        items,
        selectedItems,
        selectionKey: (item: TestItem) => item.id,
      },
    });
    await tick();

    let list = target.querySelector(".fast-list") as HTMLElement;
    let rows = target.querySelectorAll(".row");
    (rows[0] as HTMLElement).click();
    list.dispatchEvent(new KeyboardEvent("keydown", {
      key: "a",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    }));

    let rebuiltItems = [{ id: 1 }, { id: 2 }, { id: 3 }];
    items.replaceAll(rebuiltItems);
    await tick();

    expect(selectedItems.contents).toEqual(rebuiltItems);
  });
  test("keeps the selected row when a new row arrives above it", async () => {
    let a = { id: 1 }, b = { id: 2 }, c = { id: 3 };
    let items = new ArrayColl<TestItem>([a, b, c]);
    let selectedItems = new ArrayColl<TestItem>();
    let target = document.createElement("div");
    document.body.append(target);
    mounted = mount(FastList, {
      target,
      props: { items, selectedItems, selectionKey: (item: TestItem) => item.id },
    });
    await tick();
    (target.querySelectorAll(".row")[1] as HTMLElement).click();
    expect(selectedItems.contents).toEqual([b]);

    // Новое письмо сверху, строки пересоздаются
    items.replaceAll([{ id: 9 }, { id: 1 }, { id: 2 }, { id: 3 }]);
    await tick();
    expect(selectedItems.contents.map(i => i.id)).toEqual([2]);

    // То же, но добавлением без пересоздания
    items.add({ id: 10 });
    items.replaceAll([{ id: 10 }, ...items.contents.filter(i => i.id != 10)]);
    await tick();
    expect(selectedItems.contents.map(i => i.id)).toEqual([2]);
  });
});
