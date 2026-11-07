// @vitest-environment happy-dom
import { describe, expect, test, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";

/** Похож на редактор tiptap: у уничтоженного редактора `view.dom` бросает исключение. */
function fakeEditor() {
  let dom = document.createElement("div");
  let editor = {
    isDestroyed: false,
    on() { return editor; },
    off() { return editor; },
    get view() {
      return new Proxy({ dom }, {
        get(target, key) {
          if (editor.isDestroyed && key == "dom") {
            throw new Error("[tiptap error]: The editor view is not available. Cannot access view['dom'].");
          }
          return target[key as keyof typeof target];
        },
      });
    },
  };
  return { editor, dom };
}

describe("MentionSuggest", () => {
  test("закрытие ответа: редактор уничтожен раньше подсказки — без исключения", async () => {
    // Раньше onDestroy обращался к view.dom уничтоженного редактора, и весь экран почты
    // заменялся ошибкой «[tiptap error]» после «Ответить» → «×»
    await import("../../../logic/app");
    let { default: MentionSuggest } = await import("../../../frontend/Mail/Mentions/MentionSuggest.svelte");
    let { editor, dom } = fakeEditor();
    let target = document.createElement("div");
    document.body.append(target);
    let component = mount(MentionSuggest, { target, props: { editor: editor as any, mail: null as any } });
    flushSync();
    editor.isDestroyed = true;
    let consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    let errors: unknown[] = [];
    let onError = (event: ErrorEvent) => errors.push(event.error ?? event.message);
    window.addEventListener("error", onError);
    try {
      await unmount(component);
      flushSync();
    } catch (ex) {
      errors.push(ex);
    } finally {
      window.removeEventListener("error", onError);
    }
    let logged = consoleError.mock.calls.flat().map(String).filter(text => text.includes("tiptap"));
    consoleError.mockRestore();
    expect([...errors.map(String), ...logged]).toEqual([]);
    // Обработчик снят с запомненного элемента
    expect(() => dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }))).not.toThrow();
    target.remove();
  });
});
