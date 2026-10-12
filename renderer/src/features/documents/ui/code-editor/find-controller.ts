import { EditorView } from '@codemirror/view';

import { createFindMatchCursor } from '@/features/documents/application/find-cursor';
import type { DocumentFindController } from '@/features/documents/application/navigation-runtime';
import { findTextMatches, type TextRange } from '@/features/documents/domain/find-text';

/** Find over the editor's live document, selecting each match in the view. */
export function createCodeFindController(getView: () => EditorView | null): DocumentFindController {
  return createFindMatchCursor<TextRange>({
    collect(query, options) {
      const view = getView();
      return view ? findTextMatches(view.state.doc.toString(), query, options) : [];
    },
    reveal(match) {
      const view = getView();
      if (view) selectMatch(view, match);
    },
  });
}

function selectMatch(view: EditorView, match: TextRange): void {
  view.dispatch({
    effects: EditorView.scrollIntoView(match.from, { y: 'center' }),
    selection: { anchor: match.from, head: match.to },
  });
  view.focus();
}
