/**
 * What Ask agent takes from a selection, proven against the real Milkdown
 * build: exactly what is selected, code included, and nothing for a selection
 * that holds no text.
 */
import { CrepeBuilder } from '@milkdown/crepe/builder';
import { editorViewCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import { TextSelection } from '@milkdown/kit/prose/state';
import { afterEach, describe, expect, it } from 'vite-plus/test';

import { selectedMarkdown } from './selection-markdown';

const SOURCE =
  '# Title\n\nThe first line.\n\nThe second line, comprehensively.\n\n```js\nconst code = 1;\n```\n\n- one\n- two\n';

const live: CrepeBuilder[] = [];

afterEach(async () => {
  for (const editor of live.splice(0)) await editor.destroy();
});

async function openProbe() {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = new CrepeBuilder({ root: host, defaultValue: SOURCE });
  live.push(editor);
  await editor.create();
  const action = <T>(run: (ctx: Ctx) => T): T => editor.editor.action(run);
  const selectRange = (from: number, to: number) =>
    action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
    });
  /** The document position where `text` starts, found in the live document
   *  rather than counted by hand. */
  const positionOf = (text: string): number =>
    action((ctx) => {
      let found = -1;
      ctx.get(editorViewCtx).state.doc.descendants((node, pos) => {
        if (found >= 0 || !node.isText || !node.text?.includes(text)) return found < 0;
        found = pos + node.text.indexOf(text);
        return false;
      });
      if (found < 0) throw new Error(`"${text}" is not in the document`);
      return found;
    });
  const select = (text: string, through = text) =>
    selectRange(positionOf(text), positionOf(through) + through.length);
  return { action, select, selectRange };
}

describe('selected markdown', () => {
  it('takes exactly the selected words, not the paragraph around them', async () => {
    const probe = await openProbe();
    probe.select('second line');

    expect(probe.action(selectedMarkdown)).toBe('second line');
  });

  it('keeps the blocks a selection crosses, code included', async () => {
    const probe = await openProbe();
    probe.select('Title', 'first');
    expect(probe.action(selectedMarkdown)).toBe('# Title\n\nThe first');

    probe.select('comprehensively', 'code');
    expect(probe.action(selectedMarkdown)).toBe('comprehensively.\n\n```js\nconst code\n```');
  });

  it('answers nothing for an empty or whitespace-only selection', async () => {
    const probe = await openProbe();
    probe.selectRange(1, 1);
    expect(probe.action(selectedMarkdown)).toBeNull();

    probe.select('The first line.');
    const end = probe.action((ctx) => ctx.get(editorViewCtx).state.selection.to);
    // The gap between two paragraphs holds no text at all.
    probe.selectRange(end, end + 2);
    expect(probe.action(selectedMarkdown)).toBeNull();
  });
});
