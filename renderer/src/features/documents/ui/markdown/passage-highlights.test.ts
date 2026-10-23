import { CrepeBuilder } from '@milkdown/crepe/builder';
import { editorViewCtx } from '@milkdown/kit/core';
import { TextSelection } from '@milkdown/kit/prose/state';
import { replaceAll } from '@milkdown/kit/utils';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { attachPassageHighlights, capturePassage } from './passage-highlights';
import { selectedMarkdown } from './selection-markdown';

const editors: CrepeBuilder[] = [];
afterEach(async () => {
  for (const editor of editors.splice(0)) await editor.destroy();
  document.body.replaceChildren();
});

async function open(source: string) {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = new CrepeBuilder({ root: host, defaultValue: source });
  const passages = attachPassageHighlights(editor);
  editors.push(editor);
  await editor.create();
  const view = editor.editor.action((ctx) => ctx.get(editorViewCtx));
  vi.spyOn(view, 'coordsAtPos').mockReturnValue({ top: 100, bottom: 120, left: 0, right: 1 });
  const select = (text: string, occurrence = 0) => {
    const positions: number[] = [];
    view.state.doc.descendants((node, pos) => {
      if (node.isText && node.text?.includes(text)) positions.push(pos + node.text.indexOf(text));
    });
    const from = positions[occurrence];
    if (from === undefined) throw new Error('Missing selection');
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, from, from + text.length)),
    );
    return from;
  };
  const capture = () =>
    editor.editor.action((ctx) => {
      const quote = selectedMarkdown(ctx);
      if (!quote) throw new Error('Empty selection');
      capturePassage(ctx, quote);
      passages.setReferences([quote]);
      return quote;
    });
  // dom-contract: ProseMirror decorations are the user-visible reference marks.
  const marks = () => [...host.querySelectorAll('.markdown-passage-reference')]; // dom-contract: editor decorations
  return { editor, view, passages, select, capture, marks };
}

describe('passage decorations', () => {
  it('marks the selected occurrence, collapses selection, and never changes source', async () => {
    const probe = await open('Same words.\n\nSame words.\n');
    const before = probe.editor.getMarkdown();
    const from = probe.select('Same words', 1);
    const quote = probe.capture();
    expect(probe.view.state.selection.empty).toBe(true);
    expect(probe.marks()).toHaveLength(1);
    const mark = probe.marks()[0];
    if (!mark) throw new Error('Missing reference decoration');
    expect(probe.view.posAtDOM(mark, 0)).toBe(from);
    expect(probe.passages.reveal(quote)).toEqual({ current: 1, total: 1 });
    expect(probe.marks()[0]?.classList.contains('markdown-passage-active')).toBe(true);
    probe.view.dom.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(probe.marks()[0]?.classList.contains('markdown-passage-active')).toBe(false);
    expect(probe.editor.getMarkdown()).toBe(before);
    probe.passages.setReferences([]);
    expect(probe.marks()).toHaveLength(0);
  });

  it('maps references through edits before them and invalidates changed words without jumping', async () => {
    const probe = await open('Same words.\n\nSame words.\n');
    probe.select('Same words', 1);
    const quote = probe.capture();
    probe.view.dispatch(probe.view.state.tr.insertText('Intro. ', 1));
    expect(probe.marks()).toHaveLength(1);
    const mark = probe.marks()[0];
    if (!mark) throw new Error('Missing reference decoration');
    const start = probe.view.posAtDOM(mark, 0);
    probe.view.dispatch(probe.view.state.tr.insertText('changed', start, start + 4));
    expect(probe.marks()).toHaveLength(0);
    expect(probe.passages.reveal(quote)).toEqual({ current: 0, total: 0 });
  });

  // The disk reconcile replaces the whole document, which is how an agent's
  // edit to the open file arrives.
  it('keeps the selected occurrence through a reload from disk unless its words changed', async () => {
    const probe = await open('Intro.\n\nSame words.\n\nSame words.\n');
    const from = probe.select('Same words', 1);
    const quote = probe.capture();
    const revised = 'Intro, revised by the agent.';
    probe.editor.editor.action(replaceAll(`${revised}\n\nSame words.\n\nSame words.\n`));
    const mark = probe.marks()[0];
    if (!mark) throw new Error('Missing reference decoration');
    expect(probe.marks()).toHaveLength(1);
    expect(probe.view.posAtDOM(mark, 0)).toBe(from + revised.length - 'Intro.'.length);
    expect(probe.passages.reveal(quote)).toEqual({ current: 1, total: 1 });

    // Its own words changed: the remaining copy is not taken for it.
    probe.editor.editor.action(replaceAll('Intro.\n\nSame words.\n\nOther words.\n'));
    expect(probe.marks()).toHaveLength(0);
    expect(probe.passages.reveal(quote)).toEqual({ current: 0, total: 0 });
  });

  it('follows a unique passage that stands between two changes of one reload', async () => {
    const probe = await open('Intro.\n\nUnique words here.\n\nOutro.\n');
    probe.select('Unique words');
    const quote = probe.capture();
    probe.editor.editor.action(
      replaceAll('Intro, revised.\n\nUnique words here.\n\nOutro, revised.\n'),
    );
    expect(probe.marks().map((mark) => mark.textContent)).toEqual(['Unique words']);
    expect(probe.passages.reveal(quote)).toEqual({ current: 1, total: 1 });
  });

  it('restores formatted and multi-block references from their Markdown', async () => {
    const probe = await open('A **bold** line.\n\n- first item\n- second item\n');
    probe.passages.setReferences(['**bold**', '- first item\n- second item']);
    expect(probe.marks().map((mark) => mark.textContent)).toEqual([
      'bold',
      'first item',
      'second item',
    ]);
    expect(probe.passages.reveal('**bold**')).toEqual({ current: 1, total: 1 });
    expect(probe.view.state.selection.empty).toBe(true);
  });

  it('refuses missing and ambiguous references after reopening', async () => {
    const probe = await open('Same words.\n\nSame words.\n');
    probe.passages.setReferences(['Same words', 'Removed words']);
    expect(probe.marks()).toHaveLength(0);
    expect(probe.passages.reveal('Same words')).toEqual({ current: 0, total: 0 });
    expect(probe.passages.reveal('Removed words')).toEqual({ current: 0, total: 0 });
  });
});
