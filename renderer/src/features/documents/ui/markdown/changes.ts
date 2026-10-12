import type { CrepeBuilder } from '@milkdown/crepe/builder';
import { remarkCtx, schemaCtx, serializerCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import type { Node } from '@milkdown/kit/prose/model';
import { Plugin } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

import {
  assembleSource,
  mapSourceBlocks,
  type SourceNode,
  type SourceSnapshot,
} from './source-blocks';

/** How long typing must pause before an edit is serialized. */
const EDIT_SETTLE_MS = 300;

interface MarkdownTools {
  parse(source: string): { root: SourceNode; definitions: SourceNode[] };
  serialize(doc: Node): string;
  serializeBlock(node: Node): string;
}

/**
 * Publishes edits as Markdown without serializing the whole document on every
 * keystroke, which costs tens of milliseconds on a long file. An edit is held
 * until typing pauses; `flush` publishes it at once for anything that must read
 * the current text, answering whether there was one, and destroying the view
 * flushes it too. Milkdown's own markdownUpdated listener is debounced the same
 * way but may be cancelled on dispose, so it cannot guard a close.
 *
 * `rebase` names the source the document was (re)loaded from, so unedited
 * blocks are written back as that source wrote them (see `source-blocks`).
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
): { flush(): boolean; rebase(source: string): void } {
  let context: Ctx | null = null;
  let current: EditorView | null = null;
  let held: EditorView | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let snapshot: SourceSnapshot | null = null;
  const blocks = new WeakMap<Node, string>();
  // Captured while the editor is live: Milkdown drops these from its context
  // before the view is destroyed, which is when the last flush runs.
  let tools: MarkdownTools | null = null;
  const live = (): MarkdownTools | null => {
    if (tools || !context) return tools;
    const serializer = context.get(serializerCtx);
    const schema = context.get(schemaCtx);
    const remark = context.get(remarkCtx);
    tools = {
      parse: (source) => {
        const tree = remark.parse(source);
        // Read before the transform below resolves reference links and drops them.
        const definitions = (tree.children as SourceNode[]).filter(
          (child) => child.type === 'definition',
        );
        return { root: remark.runSync(tree, source) as SourceNode, definitions };
      },
      serialize: serializer,
      serializeBlock: (node) => serializer(schema.topNodeType.create(null, node)).trimEnd(),
    };
    return tools;
  };
  const markdown = (doc: Node, using: MarkdownTools) => {
    const kept =
      snapshot &&
      assembleSource(snapshot, doc, (node) => {
        const cached = blocks.get(node);
        if (cached !== undefined) return cached;
        const text = using.serializeBlock(node);
        blocks.set(node, text);
        return text;
      });
    return kept ?? using.serialize(doc);
  };
  const flush = () => {
    clearTimeout(timer);
    const view = held;
    held = null;
    if (!view || !tools) return false;
    report(markdown(view.state.doc, tools));
    return true;
  };
  editor.editor.use(
    $prose((ctx) => {
      context = ctx;
      return new Plugin({
        view: (view) => {
          current = view;
          return {
            update(updated, previous) {
              current = updated;
              if (previous.doc.eq(updated.state.doc) || !accepts()) return;
              live();
              held = updated;
              clearTimeout(timer);
              timer = setTimeout(flush, EDIT_SETTLE_MS);
            },
            destroy: () => void flush(),
          };
        },
      });
    }),
  );
  return {
    flush,
    rebase(source) {
      const using = live();
      const doc = current?.state.doc;
      snapshot = using && doc ? mapSourceBlocks(source, using.parse(source), doc) : null;
    },
  };
}
