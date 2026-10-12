import { CrepeBuilder } from '@milkdown/crepe/builder';
import { listItem } from '@milkdown/crepe/feature/list-item';
import { table } from '@milkdown/crepe/feature/table';
import { editorViewCtx } from '@milkdown/kit/core';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { watchMarkdownChanges } from './changes';

const editors: CrepeBuilder[] = [];

afterEach(async () => {
  await Promise.all(editors.splice(0).map((editor) => editor.destroy()));
  document.body.replaceChildren();
});

async function open(source: string) {
  const root = document.createElement('div');
  document.body.append(root);
  const editor = new CrepeBuilder({ root, defaultValue: source })
    .addFeature(listItem)
    .addFeature(table);
  editors.push(editor);
  const report = vi.fn<(markdown: string) => void>();
  const changes = watchMarkdownChanges(editor, { accepts: () => true, report });
  await editor.create();
  changes.rebase(source);
  /** Types `text` at the end of the first block whose text includes `marker`. */
  const type = (marker: string, text: string) =>
    editor.editor.action((context) => {
      const view = context.get(editorViewCtx);
      let end = -1;
      view.state.doc.descendants((node, pos) => {
        if (end === -1 && node.isTextblock && node.textContent.includes(marker)) {
          end = pos + 1 + node.content.size;
        }
        return end === -1;
      });
      view.dispatch(view.state.tr.insertText(text, end));
    });
  const appendEmptyParagraph = () =>
    editor.editor.action((context) => {
      const view = context.get(editorViewCtx);
      const paragraph = view.state.schema.nodes['paragraph']?.create();
      if (paragraph) view.dispatch(view.state.tr.insert(view.state.doc.content.size, paragraph));
    });
  const saved = () => {
    expect(changes.flush()).toBe(true);
    return report.mock.lastCall?.[0];
  };
  return { appendEmptyParagraph, saved, type };
}

const SOURCE = [
  'Title',
  '=====',
  '',
  'A 5 * 3 price and a_b_c [kept].',
  '',
  '- dash one',
  '- dash two',
  '',
  '---',
  '',
  '~~~',
  'fenced',
  '~~~',
  '',
  '',
  'Plain paragraph.',
  '',
  'Line one  ',
  'line two.',
  '',
].join('\n');

describe('source-preserving Markdown writes', () => {
  it('writes an edit without touching the formatting of other blocks', async () => {
    const { saved, type } = await open(SOURCE);
    type('Plain paragraph', ' Edited');
    expect(saved()).toBe(SOURCE.replace('Plain paragraph.', 'Plain paragraph. Edited'));

    type('dash two', ' more');
    // The edited list is serialized as a whole; everything around it is kept.
    expect(saved()).toBe(
      SOURCE.replace('Plain paragraph.', 'Plain paragraph. Edited').replace(
        '- dash one\n- dash two',
        '* dash one\n\n* dash two more',
      ),
    );
  });

  it('writes nothing for an empty paragraph the editor appends after the last block', async () => {
    const { appendEmptyParagraph, saved, type } = await open(SOURCE);
    appendEmptyParagraph();
    type('Plain paragraph', ' Edited');
    expect(saved()).toBe(SOURCE.replace('Plain paragraph.', 'Plain paragraph. Edited'));
  });

  it('keeps reference definitions when the block beside them is edited', async () => {
    // The editor resolves reference links and drops their definitions, so a
    // whole-document write would leave `[the docs][docs]` without a target.
    const source = 'See [the docs][docs].\n\n- one\n- two\n\n[docs]: https://example.com\n';
    const { saved, type } = await open(source);
    type('one', '!');
    const written = saved() ?? '';
    expect(written.startsWith('See [the docs][docs].\n\n')).toBe(true);
    expect(written).toContain('one!');
    expect(written.endsWith('\n\n[docs]: https://example.com\n')).toBe(true);
  });

  it('keeps two lists apart when an edit would join them with a blank line', async () => {
    const source = '- one\n- two\n\n<!-- split -->\n\n- three\n';
    const { saved, type } = await open(source);
    type('three', '!');
    const written = saved() ?? '';
    expect(written).toContain('three!');
    expect(written).toContain('<!-- split -->');
  });
});
