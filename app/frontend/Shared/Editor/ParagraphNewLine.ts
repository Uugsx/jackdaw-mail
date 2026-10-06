import type { CommandProps } from '@tiptap/core';
import Paragraph from '@tiptap/extension-paragraph';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    paragraphNewLine: {
      /**
       * Enter in a paragraph always starts a new paragraph.
       * Shift+Enter still inserts a line break (StarterKit HardBreak).
       * If the cursor sits next to a stray `<br>`, remove it while splitting.
       */
      onParagraphEnter: () => ReturnType;
    }
  }
}

export const ParagraphNewLine = Paragraph.extend({
  addKeyboardShortcuts() {
    return {
      Enter: () => this.editor.commands.onParagraphEnter(),
    }
  },
  addCommands() {
    return {
      onParagraphEnter: () => ({ tr, chain }) => {
        let { $from, $to } = tr.selection;
        if ($from.parent.type.name != 'paragraph' || $from.depth > 1) {
          return false;
        }
        let paragraphAttributes = { ...$from.parent.attrs };
        let splittableMarks = this.editor.extensionManager.splittableMarks;
        let storedMarks = (tr.storedMarks ?? $from.marks())
          .filter(mark => splittableMarks.includes(mark.type.name));
        let preserveFormatting = ({ tr: currentTr }: CommandProps) => {
          let { $from: currentFrom } = currentTr.selection;
          if (currentFrom.parent.type.name == "paragraph" && currentFrom.depth > 0) {
            currentTr.setNodeMarkup(
              currentFrom.before(currentFrom.depth),
              currentFrom.parent.type,
              { ...currentFrom.parent.attrs, ...paragraphAttributes },
              currentFrom.parent.marks,
            );
          }
          currentTr.setStoredMarks(storedMarks ? [...storedMarks] : null);
          return true;
        };
        /*
         * Deletes the <br> then splits the paragraph into two paragraphs
         * This is becauase just splitting creates <p><br></br><p></p>
         * instead of <p></p><p></p>
         */
        if ($from.nodeBefore?.type.name == "hardBreak") {
          return chain()
            .deleteRange({
              from: $from.pos - $from.nodeBefore.nodeSize,
              to: $from.pos
            }).splitBlock({ keepMarks: true }).command(preserveFormatting).scrollIntoView().run();
        }
        if ($to.nodeAfter?.type.name == "hardBreak") {
          return chain()
            .deleteRange({
              from: $to.pos,
              to: $to.pos + $to.nodeAfter.nodeSize
            }).splitBlock({ keepMarks: true }).command(preserveFormatting).scrollIntoView().run();
        }
        return chain().splitBlock({ keepMarks: true }).command(preserveFormatting).scrollIntoView().run();
      },
    }
  },
});
