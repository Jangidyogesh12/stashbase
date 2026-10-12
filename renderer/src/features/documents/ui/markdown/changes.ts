import type { CrepeBuilder } from '@milkdown/crepe/builder';
import { serializerCtx } from '@milkdown/kit/core';
import { Plugin } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

/** How long typing must pause before an edit is serialized. */
const EDIT_SETTLE_MS = 300;

/**
 * Publishes edits as Markdown without serializing the whole document on every
 * keystroke, which costs tens of milliseconds on a long file. An edit is held
 * until typing pauses; `flush` publishes it at once for anything that must read
 * the current text, answering whether there was one, and destroying the view
 * flushes it too. Milkdown's own markdownUpdated listener is debounced the same
 * way but may be cancelled on dispose, so it cannot guard a close.
 */
export function watchMarkdownChanges(
  editor: CrepeBuilder,
  {
    accepts,
    report,
  }: {
    /** Whether an edit made now belongs to the reader, checked as it happens. */
    accepts(): boolean;
    report(markdown: string): void;
  },
): { flush(): boolean } {
  let held: EditorView | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Captured while the editor is live: Milkdown drops the serializer from its
  // context before the view is destroyed, which is when the last flush runs.
  let serialize: ((doc: EditorView['state']['doc']) => string) | null = null;
  const flush = () => {
    clearTimeout(timer);
    const view = held;
    held = null;
    if (!view || !serialize) return false;
    report(serialize(view.state.doc));
    return true;
  };
  editor.editor.use(
    $prose(
      (context) =>
        new Plugin({
          view: () => ({
            update(view, previous) {
              if (previous.doc.eq(view.state.doc) || !accepts()) return;
              serialize ??= context.get(serializerCtx);
              held = view;
              clearTimeout(timer);
              timer = setTimeout(flush, EDIT_SETTLE_MS);
            },
            destroy: () => void flush(),
          }),
        }),
    ),
  );
  return { flush };
}
