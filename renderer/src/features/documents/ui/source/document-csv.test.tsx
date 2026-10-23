import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vite-plus/test';

import type {
  DelimitedTablePort,
  DocumentSourcePort,
} from '@/features/documents/application/ports';
import type { DelimitedTablePage } from '@/features/documents/domain/table';
import { sourceApi, tableApi, textSource } from '@/test/fakes/documents';

import { codeEditor, registerSourceCleanup, renderSource } from './document-source.harness';

registerSourceCleanup();

const SALES = { folderPath: '/project/notes', path: 'sales.csv' };

function tablePage(
  rows: string[][],
  overrides: Partial<DelimitedTablePage> = {},
): DelimitedTablePage {
  return {
    columnCount: rows[0]?.length ?? 0,
    delimiter: ',',
    editable: true,
    kind: 'table',
    name: SALES.path,
    rowCount: rows.length,
    rows,
    size: 64,
    start: 0,
    totalColumns: rows[0]?.length ?? 0,
    version: 'v1',
    ...overrides,
  } as DelimitedTablePage;
}

describe('CSV documents', () => {
  it('open as a table with the header pinned, and edit their source through the text save', async () => {
    const user = userEvent.setup();
    let rows = [
      ['产品', '金额'],
      ['Pro', '12'],
    ];
    const table = tableApi({
      load: vi.fn<DelimitedTablePort['load']>(async () =>
        tablePage(rows, { version: `v${rows.length}` }),
      ),
    });
    const api = sourceApi({
      load: vi.fn(async () => textSource({ content: '产品,金额\nPro,12\n', format: 'csv' })),
      save: vi.fn<DocumentSourcePort['save']>(async (_source, input) =>
        textSource({ content: input.content, format: 'csv', version: 'v2' }),
      ),
    });
    renderSource(api, SALES, { tableApi: table });

    expect(await screen.findByRole('grid', { name: 'sales.csv' })).not.toBeNull();
    expect(screen.getByRole('columnheader', { name: '产品' })).not.toBeNull();
    expect(screen.getByRole('gridcell', { name: 'Pro' })).not.toBeNull();
    expect(screen.getByText('Comma-separated')).not.toBeNull();
    expect(screen.getByText('2 rows × 2 columns')).not.toBeNull();
    expect(api.load).not.toHaveBeenCalled();

    await user.click(screen.getByRole('tab', { name: 'Source' }));
    await screen.findByLabelText('sales.csv source');
    const editor = codeEditor('sales.csv source');
    expect(editor.state.doc.toString()).toBe('产品,金额\nPro,12\n');
    act(() => {
      editor.dispatch({ changes: { from: editor.state.doc.length, insert: 'Plus,8\n' } });
    });
    rows = [...rows, ['Plus', '8']];
    await user.click(screen.getByRole('tab', { name: 'Table' }));
    await waitFor(() =>
      expect(api.save).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'sales.csv' }),
        { baseVersion: 'v1', content: '产品,金额\nPro,12\nPlus,8\n' },
        expect.anything(),
      ),
    );
    expect(await screen.findByRole('gridcell', { name: 'Plus' })).not.toBeNull();
  });

  it('reads further pages as the reader scrolls to them', async () => {
    const all = [['n'], ...Array.from({ length: 999 }, (_, i) => [`row ${i + 1}`])];
    const load = vi.fn<DelimitedTablePort['load']>(async (_source, page) =>
      tablePage(all.slice(page.start, page.start + page.count), {
        columnCount: 1,
        rowCount: all.length,
        start: page.start,
        totalColumns: 1,
      }),
    );
    renderSource(sourceApi(), SALES, { tableApi: tableApi({ load }) });
    const grid = await screen.findByRole('grid', { name: 'sales.csv' });
    expect(load).toHaveBeenCalledTimes(1);
    act(() => {
      grid.scrollTop = 700 * 30;
      fireEvent.scroll(grid);
    });
    expect(await screen.findByRole('gridcell', { name: 'row 701' })).not.toBeNull();
    expect(load).toHaveBeenCalledWith(
      expect.anything(),
      { count: 200, start: 600 },
      expect.anything(),
    );
  });

  it('reaches the last rows of a table taller than the browser can lay out', async () => {
    const rowCount = 2_000_001;
    const load = vi.fn<DelimitedTablePort['load']>(async (_source, page) =>
      tablePage(
        Array.from({ length: Math.min(page.count, rowCount - page.start) }, (_, offset) => [
          page.start + offset === 0 ? 'n' : `row ${page.start + offset}`,
        ]),
        { columnCount: 1, editable: false, rowCount, start: page.start, totalColumns: 1 },
      ),
    );
    renderSource(sourceApi(), SALES, { tableApi: tableApi({ load }) });
    const grid = await screen.findByRole('grid', { name: 'sales.csv' });
    act(() => {
      // happy-dom has no layout, so the grid measures its fallback viewport;
      // the end of its scroll range is the end of the table.
      grid.scrollTop = 15_000_000 - (600 - 60);
      fireEvent.scroll(grid);
    });
    expect(await screen.findByRole('gridcell', { name: 'row 2000000' })).not.toBeNull();
    expect(screen.getByRole('rowheader', { name: '2000001' })).not.toBeNull();
  });

  it('keeps a file past the text ceiling to the table', async () => {
    const api = sourceApi();
    renderSource(api, SALES, {
      tableApi: tableApi({
        load: vi.fn(async () => tablePage([['a'], ['1']], { editable: false })),
      }),
    });
    expect(await screen.findByText(/Too large to edit as text/)).not.toBeNull();
    const source = screen.getByRole('tab', { name: 'Source' });
    expect(source.getAttribute('aria-disabled')).toBe('true');
    await userEvent.setup().click(source);
    expect(screen.getByRole('grid', { name: 'sales.csv' })).not.toBeNull();
    expect(api.load).not.toHaveBeenCalled();
  });

  it('names an encoding that is not UTF-8 and how to save it again', async () => {
    renderSource(sourceApi(), SALES, {
      tableApi: tableApi({
        load: vi.fn(async () => ({
          encoding: 'gb18030' as const,
          kind: 'unsupported-encoding' as const,
          name: SALES.path,
        })),
      }),
    });
    expect(await screen.findByText('Not saved as UTF-8')).not.toBeNull();
    expect(screen.getByText(/may be GBK or GB18030/)).not.toBeNull();
    expect(
      screen.getByText(/choose Save As, then CSV UTF-8\. The file has not been changed\./),
    ).not.toBeNull();
    expect(screen.queryByRole('tab', { name: 'Source' })).toBeNull();
  });

  it('asks the agent about selected rows by their header names and row numbers', async () => {
    const user = userEvent.setup();
    const onAskAgent = vi.fn();
    renderSource(sourceApi(), SALES, {
      onAskAgent,
      tableApi: tableApi({
        load: vi.fn(async () =>
          tablePage([
            ['产品', '金额'],
            ['Pro', '12'],
            ['Plus', '8'],
          ]),
        ),
      }),
    });
    await user.click(await screen.findByRole('rowheader', { name: '2' }));
    await user.keyboard('{Shift>}');
    await user.click(screen.getByRole('rowheader', { name: '3' }));
    await user.keyboard('{/Shift}');
    await user.click(screen.getByRole('button', { name: 'Ask agent' }));
    expect(onAskAgent).toHaveBeenCalledWith({
      markdown: [
        'Cells A2:B3 (2 rows × 2 columns).',
        '',
        '| Row | 产品 (A) | 金额 (B) |',
        '| --- | --- | --- |',
        '| 2 | Pro | 12 |',
        '| 3 | Plus | 8 |',
      ].join('\n'),
      source: SALES,
    });
  });
});
