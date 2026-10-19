import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { get } from "svelte/store";
import { darkBlockStyle, darkColorScheme, readableDarkTextColor } from "../../Mail/Composer/composeDarkColors";

type DarkModeColorsState = { dark: boolean; decorations: DecorationSet };

export const darkModeColorsKey = new PluginKey<DarkModeColorsState>("darkModeColors");

/**
 * Декорации для показа цветов письма в тёмной теме: документ TipTap и getHTML()
 * остаются с исходными цветами, меняется только отображение.
 */
export function buildDarkModeDecorations(doc: ProseMirrorNode): DecorationSet {
  let decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.isText) {
      let marks = node.marks.map(mark => mark.type.name);
      // У подсветки свой контрастный цвет текста, ссылки красит CSS.
      if (marks.includes("highlight") || marks.includes("link")) {
        return false;
      }
      let color = node.marks.find(mark => mark.type.name == "textStyle")?.attrs.color;
      let readable = typeof color == "string" && color ? readableDarkTextColor(color) : null;
      if (readable) {
        decorations.push(Decoration.inline(pos, pos + node.nodeSize, { style: `color: ${readable}` }));
      }
      return false;
    }
    let style = darkBlockStyle(node.attrs.style, node.attrs.bgcolor);
    if (style) {
      decorations.push(Decoration.node(pos, pos + node.nodeSize, { style }));
    }
    return true;
  });
  return DecorationSet.create(doc, decorations);
}

function stateFor(doc: ProseMirrorNode, dark: boolean): DarkModeColorsState {
  return { dark, decorations: dark ? buildDarkModeDecorations(doc) : DecorationSet.empty };
}

/** Тёмная тема редактора письма в стиле Outlook (только отображение). */
export const DarkModeColors = Extension.create({
  name: "darkModeColors",

  addProseMirrorPlugins() {
    return [
      new Plugin<DarkModeColorsState>({
        key: darkModeColorsKey,
        state: {
          init: (_, state) => stateFor(state.doc, get(darkColorScheme)),
          apply(tr, value, _oldState, newState) {
            let dark = tr.getMeta(darkModeColorsKey) as boolean | undefined;
            if (dark !== undefined && dark !== value.dark) {
              return stateFor(newState.doc, dark);
            }
            return tr.docChanged && value.dark ? stateFor(newState.doc, true) : value;
          },
        },
        props: {
          decorations(state) {
            return darkModeColorsKey.getState(state)?.decorations;
          },
        },
        view(view) {
          let unsubscribe = darkColorScheme.subscribe(dark => {
            if (darkModeColorsKey.getState(view.state)?.dark !== dark) {
              view.dispatch(view.state.tr.setMeta(darkModeColorsKey, dark).setMeta("addToHistory", false));
            }
          });
          return { destroy: unsubscribe };
        },
      }),
    ];
  },
});
