import { CrepeBuilder } from '@milkdown/crepe/builder';
import { editorViewCtx } from '@milkdown/kit/core';
import { expect, it, vi } from 'vite-plus/test';

import { watchMarkdownChanges } from './changes';

it('holds edits until flushed, and publishes the latest one on an immediate disposal', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = new CrepeBuilder({ root: host, defaultValue: 'Before' });
  const report = vi.fn();
  const changes = watchMarkdownChanges(editor, { accepts: () => true, report });
  try {
    await editor.create();
    const insert = (text: string, from: number, to: number) =>
      editor.editor.action((context) => {
        const view = context.get(editorViewCtx);
        view.dispatch(view.state.tr.insertText(text, from, to));
      });
    insert('After', 1, 7);
    expect(report).not.toHaveBeenCalled();
    expect(changes.flush()).toBe(true);
    expect(report).toHaveBeenLastCalledWith('After\n');
    expect(changes.flush()).toBe(false);

    insert('Again', 1, 6);
    await editor.destroy();
    expect(report).toHaveBeenLastCalledWith('Again\n');
  } finally {
    host.remove();
  }
});
