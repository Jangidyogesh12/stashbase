/** Editor-owned passage anchors and decorations; never part of saved Markdown. */
import type { CrepeBuilder } from '@milkdown/crepe/builder';
import { editorViewCtx, parserCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import type { Node } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

type Anchor = { from: number; to: number; text: string };
interface Passages {
  anchors: Map<string, Anchor | null>;
  references: readonly string[];
  active: string | null;
}
type Action =
  | { kind: 'capture'; quote: string; anchor: Anchor }
  | { kind: 'references'; quotes: readonly string[] }
  | { kind: 'reveal'; quote: string; anchor: Anchor }
  | { kind: 'clear' };
const key = new PluginKey<Passages>('referenced-passages');

function textAt(doc: Node, from: number, to: number): string {
  return doc.textBetween(from, to, '\n', '\ufffc');
}

/** Recover only an unambiguous exact text match after reopening a document.
 * Markdown is parsed by the editor's own schema, including lists and marks. */
function resolve(ctx: Ctx, doc: Node, quote: string): Anchor | null {
  const parsed = ctx.get(parserCtx)(quote);
  const text = parsed ? textAt(parsed, 0, parsed.content.size).trim() : '';
  if (!text) return null;
  let corpus = '';
  const positions: number[] = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock && corpus) {
      corpus += '\n';
      positions.push(pos);
    }
    const value = node.isText ? node.text : node.isLeaf && node.isInline ? '\ufffc' : '';
    if (value) {
      for (let index = 0; index < value.length; index++) positions.push(pos + index);
      corpus += value;
    }
  });
  const start = corpus.indexOf(text);
  if (start < 0 || corpus.indexOf(text, start + 1) >= 0) return null;
  const from = positions[start];
  const last = positions[start + text.length - 1];
  if (from === undefined || last === undefined) return null;
  return { from, to: last + 1, text };
}

/** Snapshot the exact selected occurrence before collapsing the selection.
 * A document transaction closes Crepe's selection toolbar without stealing
 * focus back from the Agent composer. */
export function capturePassage(ctx: Ctx, quote: string): void {
  const view = ctx.get(editorViewCtx);
  const { from, to } = view.state.selection;
  const action: Action = {
    kind: 'capture',
    quote,
    anchor: { from, to, text: textAt(view.state.doc, from, to) },
  };
  view.dispatch(
    view.state.tr.setMeta(key, action).setSelection(TextSelection.near(view.state.doc.resolve(to))),
  );
}

export function attachPassageHighlights(editor: CrepeBuilder) {
  editor.editor.use(
    $prose(
      (ctx) =>
        new Plugin<Passages>({
          key,
          state: {
            init: () => ({ anchors: new Map(), references: [], active: null }),
            apply(tr, previous) {
              const action: Action | undefined = tr.getMeta(key);
              if (!tr.docChanged && !tr.selectionSet && !action) return previous;
              const anchors = new Map(previous.anchors);
              let references = previous.references;
              let active = tr.docChanged || tr.selectionSet ? null : previous.active;
              if (tr.docChanged) {
                for (const [quote, anchor] of anchors) {
                  if (!anchor) continue;
                  const from = tr.mapping.map(anchor.from, 1);
                  const to = tr.mapping.map(anchor.to, -1);
                  // Keep an invalid anchor as a tombstone: a later click must
                  // not silently jump to another copy of the original words.
                  anchors.set(
                    quote,
                    from < to && textAt(tr.doc, from, to) === anchor.text
                      ? { ...anchor, from, to }
                      : null,
                  );
                }
              }
              if (action?.kind === 'capture' || action?.kind === 'reveal') {
                anchors.set(action.quote, action.anchor);
                active = action.kind === 'reveal' ? action.quote : null;
              } else if (action?.kind === 'references') {
                references = action.quotes;
                for (const quote of references) {
                  if (!anchors.has(quote)) anchors.set(quote, resolve(ctx, tr.doc, quote));
                }
                if (active && !references.includes(active)) active = null;
              } else if (action?.kind === 'clear') active = null;
              return { anchors, references, active };
            },
          },
          props: {
            decorations(state) {
              const passages = key.getState(state);
              if (!passages) return null;
              const quotes = new Set(passages.references);
              if (passages.active) quotes.add(passages.active);
              return DecorationSet.create(
                state.doc,
                [...quotes].flatMap((quote) => {
                  const anchor = passages.anchors.get(quote);
                  return anchor
                    ? [
                        Decoration.inline(anchor.from, anchor.to, {
                          class:
                            passages.active === quote
                              ? 'markdown-passage-reference markdown-passage-active'
                              : 'markdown-passage-reference',
                          title: 'Referenced in this chat',
                        }),
                      ]
                    : [];
                }),
              );
            },
            handleDOMEvents: {
              pointerdown(view) {
                if (key.getState(view.state)?.active) {
                  view.dispatch(view.state.tr.setMeta(key, { kind: 'clear' } satisfies Action));
                }
                return false;
              },
            },
          },
        }),
    ),
  );
  return {
    setReferences(quotes: readonly string[]) {
      editor.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const previous = key.getState(view.state)?.references;
        // Streaming replies change the chat snapshot without changing its references.
        if (
          previous?.length === quotes.length &&
          previous.every((quote, index) => quote === quotes[index])
        )
          return;
        view.dispatch(view.state.tr.setMeta(key, { kind: 'references', quotes } satisfies Action));
      });
    },
    reveal(quote: string) {
      return editor.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const anchors = key.getState(view.state)?.anchors;
        const anchor = anchors?.has(quote)
          ? anchors.get(quote)
          : resolve(ctx, view.state.doc, quote);
        if (!anchor) {
          view.dispatch(view.state.tr.setMeta(key, { kind: 'clear' } satisfies Action));
          return { current: 0, total: 0 };
        }
        view.dispatch(
          view.state.tr.setMeta(key, { kind: 'reveal', quote, anchor } satisfies Action),
        );
        // Reveal skipped content before asking ProseMirror for its coordinates.
        const node = view.domAtPos(anchor.from).node;
        const element = node instanceof HTMLElement ? node : node.parentElement;
        element?.scrollIntoView({ block: 'center' });
        const scroller = view.dom.closest<HTMLElement>('.milkdown') ?? view.dom;
        const rect = view.coordsAtPos(anchor.from);
        const container = scroller.getBoundingClientRect();
        scroller.scrollBy({ top: rect.top - container.top - scroller.clientHeight / 2 });
        return { current: 1, total: 1 };
      });
    },
    clearFocus() {
      editor.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        view.dispatch(view.state.tr.setMeta(key, { kind: 'clear' } satisfies Action));
      });
    },
  };
}
