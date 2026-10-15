/** How a new placeholder arrives in the editor: not snapped, but rolled
 *  upward at the ambient pace, slower than any interaction step. The old
 *  text rises and fades over the ambient out-step; then the text swaps under
 *  an entering mark, so the fresh node CodeMirror builds for it is born
 *  transparent and a little below its place; then the mark comes off a frame
 *  later and the theme's slow transition floats the new text up into it.
 *  While the reader's own text hides the placeholder there is nothing to
 *  move, so it is swapped in place. */
import type { Compartment } from '@codemirror/state';
import { EditorView, placeholder } from '@codemirror/view';

import { ambient } from '@/lib/springs';

const LEAVING = EditorView.contentAttributes.of({ 'data-placeholder-motion': 'leaving' });
const ENTERING = EditorView.contentAttributes.of({ 'data-placeholder-motion': 'entering' });

/** Starts the roll to `text` and returns the way to cancel it. */
export function rollPlaceholder(
  view: EditorView,
  compartments: { readonly placeholder: Compartment; readonly motion: Compartment },
  text: string,
): () => void {
  const swap = compartments.placeholder.reconfigure(placeholder(text));
  const reveal = () => view.dispatch({ effects: compartments.motion.reconfigure([]) });
  if (view.state.doc.length > 0) {
    view.dispatch({ effects: [swap, compartments.motion.reconfigure([])] });
    return () => undefined;
  }
  view.dispatch({ effects: compartments.motion.reconfigure(LEAVING) });
  let frame = 0;
  const timer = setTimeout(() => {
    view.dispatch({ effects: [swap, compartments.motion.reconfigure(ENTERING)] });
    // Two frames: the first lets the new node's transparent style settle, so
    // the second's change is a transition rather than an initial paint.
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(reveal);
    });
  }, ambient.crossfadeOutMs);
  return () => {
    clearTimeout(timer);
    cancelAnimationFrame(frame);
  };
}
