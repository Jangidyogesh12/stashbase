import { StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';

import { createFindMatchCursor } from '@/features/documents/application/find-cursor';
import type { DocumentFindController } from '@/features/documents/application/navigation-runtime';
import { findTextMatches, type TextRange } from '@/features/documents/domain/find-text';

interface FindMarks {
  active: TextRange | null;
  matches: readonly TextRange[];
}

const setFindMarks = StateEffect.define<FindMarks>();
const matchMark = Decoration.mark({ class: 'cm-find-match' });
const currentMark = Decoration.mark({ class: 'cm-find-match cm-find-match-current' });

const findMarks = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, transaction) {
    let next = marks.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(setFindMarks)) continue;
      const { active, matches } = effect.value;
      next = Decoration.set(
        matches
          .filter((match) => match.to > match.from)
          .map((match) => (match === active ? currentMark : matchMark).range(match.from, match.to)),
        true,
      );
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * Paints Find's matches in the editor. The Find bar keeps focus while the
 * reader types, and the editor shows no selection it does not hold, so the
 * matches are marks of their own in Markdown's Find colours.
 */
export const codeFindHighlight: Extension = [
  findMarks,
  EditorView.theme({
    '.cm-find-match': { backgroundColor: 'color-mix(in oklab, var(--accent) 72%, transparent)' },
    '.cm-find-match-current': {
      backgroundColor: 'color-mix(in oklab, var(--focus-ring) 46%, transparent)',
    },
  }),
];

/**
 * Find over the editor's live document. A match is marked, scrolled to, and
 * selected for when the reader returns to the editor, without taking focus
 * from the Find bar they are typing in.
 */
export function createCodeFindController(getView: () => EditorView | null): DocumentFindController {
  return createFindMatchCursor<TextRange>({
    collect(query, options) {
      const view = getView();
      return view ? findTextMatches(view.state.doc.toString(), query, options) : [];
    },
    present(matches, active) {
      getView()?.dispatch({ effects: setFindMarks.of({ active, matches }) });
    },
    reveal(match) {
      getView()?.dispatch({
        effects: EditorView.scrollIntoView(match.from, { y: 'center' }),
        selection: { anchor: match.from, head: match.to },
      });
    },
  });
}
