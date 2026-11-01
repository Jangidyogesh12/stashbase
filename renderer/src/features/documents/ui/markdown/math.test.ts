/**
 * Math in the Markdown surface, proven against the real Milkdown build: only
 * two dollars open math, so prices survive both rendering and saving.
 */
import { CrepeBuilder } from '@milkdown/crepe/builder';
import { codeMirror } from '@milkdown/crepe/feature/code-mirror';
import { editorViewCtx } from '@milkdown/kit/core';
import { redo, undo, undoDepth } from '@milkdown/kit/prose/history';
import { afterEach, describe, expect, it } from 'vite-plus/test';

import { math, refreshMath, type MathModeRef } from './math';

const live: CrepeBuilder[] = [];

afterEach(async () => {
  for (const editor of live.splice(0)) await editor.destroy();
});

async function open(source: string, mathMode: boolean | MathModeRef = false) {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = new CrepeBuilder({ root: host, defaultValue: source })
    .addFeature(codeMirror)
    .addFeature(math, mathMode);
  live.push(editor);
  await editor.create();
  return { editor, host, markdown: () => editor.getMarkdown() };
}

describe('math', () => {
  it('leaves single dollars as text, on screen and on save', async () => {
    const source =
      'Reads cost $0.005 each: about $0.10–$0.50 per run ($2.50 at most), users $0.01.\n';
    const { host, markdown } = await open(source);

    expect(host.querySelector('[data-type="math_inline"]')).toBeNull(); // dom-contract: currency stays prose, without math schema nodes.
    expect(host.textContent).toContain('about $0.10–$0.50 per run ($2.50 at most)');
    expect(markdown()).toBe(source);
  });

  it('renders inline math opened by two dollars and saves it unchanged', async () => {
    const source = 'Energy is $$E=mc^2$$ here.\n';
    const { host, markdown } = await open(source);

    // dom-contract: the schema value and KaTeX child prove a formula was rendered.
    const formula = host.querySelector<HTMLElement>('[data-type="math_inline"]');
    expect(formula?.dataset.value).toBe('E=mc^2');
    expect(formula?.querySelector('.katex')).not.toBeNull(); // dom-contract: KaTeX's child proves the formula rendered.
    expect(markdown()).toBe(source);
  });

  it('uses single dollars for inline math only when the project enables math mode', async () => {
    const source = 'Energy is $E=mc^2$ here, while \\$10 stays a dollar amount.\n';
    const { host, markdown } = await open(source, true);

    const formula = host.querySelector<HTMLElement>('[data-type="math_inline"]');
    expect(formula?.dataset.value).toBe('E=mc^2');
    expect(host.textContent).toContain('$10 stays a dollar amount');
    expect(markdown()).toBe(source);
  });

  it('refreshes Math in place without clearing an existing undo step', async () => {
    const mathMode: MathModeRef = { current: false };
    const source = 'Energy is $E=mc^2$ here.\n';
    const { editor, host, markdown } = await open(source, mathMode);
    const view = editor.editor.action((context) => context.get(editorViewCtx));
    view.dispatch(view.state.tr.insertText('Draft: ', 1));
    const historyBeforeToggle = undoDepth(view.state);
    const selectionBeforeToggle = view.state.selection;

    mathMode.current = true;
    refreshMath(editor);

    expect(host.querySelector<HTMLElement>('[data-type="math_inline"]')?.dataset.value).toBe('E=mc^2');
    expect(markdown()).toBe(`Draft: ${source}`);
    expect(undoDepth(view.state)).toBe(historyBeforeToggle);
    expect(view.state.selection).toEqual(selectionBeforeToggle);
    expect(undo(view.state, view.dispatch)).toBe(true);
    expect(markdown()).toBe(source);
    expect(redo(view.state, view.dispatch)).toBe(true);
    expect(markdown()).toBe(`Draft: ${source}`);
  });

  it('renders LaTeX bracket delimiters outside code without enabling single dollars', async () => {
    const source = 'Inline \\(x^2\\).\n\n\\[\n\\frac{1}{2}\n\\]\n\nKeep `\\(x\\)` as code.\n';
    const { host, markdown } = await open(source);

    expect(host.querySelector<HTMLElement>('[data-type="math_inline"]')?.dataset.value).toBe('x^2');
    expect(host.textContent).toContain(String.raw`\(x\)`);
    expect(markdown()).toContain('$$');
  });

  it('keeps a $$ block as $$ and a ```latex fence as a fence', async () => {
    const source = '$$\na^2 + b^2 = c^2\n$$\n\n```latex\n\\frac{1}{2}\n```\n';
    const { markdown } = await open(source);

    expect(markdown()).toBe(source);
  });
});
