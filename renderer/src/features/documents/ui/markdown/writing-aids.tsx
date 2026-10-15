import type { CrepeBuilder } from '@milkdown/crepe/builder';
import { inlineCodeAttr } from '@milkdown/kit/preset/commonmark';
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import { Plugin, type EditorState } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';
import { useSyncExternalStore } from 'react';

import { appliedAppearance, useAppliedAppearance } from '@/shared/runtime/appearance-surface';

/** Chinese and Japanese are written without spaces, so each ideograph or
 *  kana counts as one, as word processors count them. */
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu;

/** Words as a reader counts them: runs of letters, digits, and joiners, so
 *  punctuation and Markdown syntax add nothing. */
export function countWords(text: string): number {
  const unspaced = text.match(UNSPACED)?.length ?? 0;
  const spaced = text.replace(UNSPACED, ' ').match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu);
  return unspaced + (spaced?.length ?? 0);
}

/**
 * The document's word count, counted only while something reads it. The
 * editor hands over each new document; counting waits for the visible count
 * to ask, so a hidden count costs nothing and a shown one re-renders only
 * itself.
 */
export interface WordCounter {
  update(doc: ProseMirrorNode): void;
  subscribe(listener: () => void): () => void;
  count(): number;
}

export function createWordCounter(): WordCounter {
  let doc: ProseMirrorNode | null = null;
  let counted: { doc: ProseMirrorNode; count: number } | null = null;
  const listeners = new Set<() => void>();
  return {
    update(next) {
      if (doc === next) return;
      doc = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    count() {
      if (!doc) return 0;
      if (counted?.doc !== doc) {
        counted = { doc, count: countWords(doc.textBetween(0, doc.content.size, ' ', ' ')) };
      }
      return counted.count;
    },
  };
}

/** The top-level block the caret is in, marked for focus mode's dimming. */
function currentBlock(state: EditorState): DecorationSet {
  const { $head } = state.selection;
  if ($head.depth < 1) return DecorationSet.empty;
  const from = $head.before(1);
  const node = state.doc.nodeAt(from);
  if (!node) return DecorationSet.empty;
  return DecorationSet.create(state.doc, [
    Decoration.node(from, from + node.nodeSize, { class: 'is-current-block' }),
  ]);
}

/** Holds the caret's line at the middle of the scroller while typing. */
function centerCaret(view: EditorView): void {
  const scroller = view.dom.closest<HTMLElement>('.milkdown');
  if (!scroller) return;
  const caret = view.coordsAtPos(view.state.selection.head);
  const frame = scroller.getBoundingClientRect();
  const offset = (caret.top + caret.bottom) / 2 - (frame.top + frame.height / 2);
  if (Math.abs(offset) > 2) scroller.scrollBy({ top: offset });
}

/**
 * The editor's side of three writing settings. The current-block mark is
 * always kept so focus mode is a stylesheet switch; the caret is centered only
 * while typewriter scrolling is on, asked at each move so the setting applies
 * without rebuilding the editor, and only for typing and keyboard moves, so a
 * click places the caret where the reader pointed; and every new document
 * reaches the word counter. Inline code is paths and identifiers, so it is
 * kept out of the spellchecker, which could only underline it.
 */
export function attachWritingAids(editor: CrepeBuilder, counter: WordCounter): void {
  editor.editor.config((ctx) => ctx.set(inlineCodeAttr.key, () => ({ spellcheck: 'false' })));
  let pointerPlaced = false;
  editor.editor.use(
    $prose(
      () =>
        new Plugin({
          props: {
            decorations: currentBlock,
            handleDOMEvents: {
              keydown: () => {
                pointerPlaced = false;
                return false;
              },
              mousedown: () => {
                pointerPlaced = true;
                return false;
              },
            },
          },
          view: (view) => {
            counter.update(view.state.doc);
            return {
              update(next, previous) {
                const edited = previous.doc !== next.state.doc;
                if (edited) counter.update(next.state.doc);
                const moved = edited || !previous.selection.eq(next.state.selection);
                if (
                  moved &&
                  (edited || !pointerPlaced) &&
                  next.hasFocus() &&
                  appliedAppearance()?.typewriterScrolling
                ) {
                  centerCaret(next);
                }
              },
            };
          },
        }),
    ),
  );
}

/** The document's word count in the corner, while the reader has it on. */
export function WordCount({ counter }: { counter: WordCounter }) {
  if (!useAppliedAppearance()?.wordCount) return null;
  return <WordCountLabel counter={counter} />;
}

function WordCountLabel({ counter }: { counter: WordCounter }) {
  const count = useSyncExternalStore(counter.subscribe, counter.count, counter.count);
  return (
    <div className="markdown-word-count">
      {count === 1 ? '1 word' : `${count.toLocaleString()} words`}
    </div>
  );
}
