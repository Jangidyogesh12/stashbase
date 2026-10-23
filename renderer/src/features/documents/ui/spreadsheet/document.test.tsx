import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vite-plus/test';

import type { SpreadsheetPreview } from '@/features/documents/domain/generic-preview';
import { pressKey } from '@/test/dom';

import { SpreadsheetDocument } from './document';

afterEach(cleanup);

const notes = {
  name: 'Notes',
  firstRow: 3,
  firstColumn: 26,
  rowCount: 1,
  columnCount: 1,
  rows: [['Second sheet']],
  formulas: [],
};

const workbook: SpreadsheetPreview = {
  sheetCount: 3,
  hasFormulas: true,
  sheets: [
    {
      name: '销售',
      firstRow: 0,
      firstColumn: 0,
      rowCount: 3,
      columnCount: 3,
      rows: [
        ['产品', '金额', '<script>alert(1)</script>'],
        ['Pro', '$1,234.50', 'x'],
        ['Plus', '$640.00', 'y'],
      ],
      formulas: [{ row: 2, column: 1, formula: '=B2/2' }],
    },
    notes,
    {
      name: 'Empty',
      firstRow: 0,
      firstColumn: 0,
      rowCount: 0,
      columnCount: 0,
      rows: [],
      formulas: [],
    },
  ],
};

it('switches worksheets, keeps coordinates, renders cells as text, and explains empty sheets', async () => {
  const { container, rerender } = render(<SpreadsheetDocument workbook={workbook} />);
  expect(screen.getByRole('gridcell', { name: '$1,234.50' })).not.toBeNull();
  expect(screen.getByText('<script>alert(1)</script>')).not.toBeNull();
  expect(container.querySelector('script')).toBeNull(); // dom-contract: workbook cells must remain text, never executable HTML.
  expect(screen.getByText(/Values are not recalculated/)).not.toBeNull();
  expect(screen.getByRole('gridcell', { name: '$640.00' }).title).toBe('=B2/2');
  await userEvent.click(screen.getByRole('tab', { name: 'Notes' }));
  expect(screen.getByRole('grid', { name: 'Notes' })).not.toBeNull();
  expect(screen.getByRole('columnheader', { name: 'AA' })).not.toBeNull();
  expect(screen.getByRole('rowheader', { name: '4' })).not.toBeNull();
  await userEvent.click(screen.getByRole('tab', { name: 'Empty' }));
  expect(screen.getByText('This worksheet is empty.')).not.toBeNull();
  rerender(<SpreadsheetDocument workbook={{ ...workbook, sheets: [] }} />);
  expect(screen.getByText('This workbook has no visible worksheets.')).not.toBeNull();
});

it('draws only the rows in view and states a limited preview', () => {
  const rows = Array.from({ length: 1000 }, (_, i) => [`Value ${i + 1}`]);
  const sheet = {
    ...notes,
    columnCount: 80,
    firstColumn: 0,
    firstRow: 0,
    name: 'Large',
    rowCount: 1001,
    rows,
  };
  render(
    <SpreadsheetDocument workbook={{ hasFormulas: false, sheetCount: 21, sheets: [sheet] }} />,
  );
  expect(screen.getByText('Showing 1 of 21 worksheets.')).not.toBeNull();
  expect(screen.getByText(/Preview limited to 1,000 rows × 1 column/)).not.toBeNull();
  expect(screen.getByRole('gridcell', { name: 'Value 1' })).not.toBeNull();
  expect(screen.queryByRole('gridcell', { name: 'Value 900' })).toBeNull();
  const grid = screen.getByRole('grid', { name: 'Large' });
  act(() => {
    grid.scrollTop = 899 * 30;
    fireEvent.scroll(grid);
  });
  expect(screen.getByRole('gridcell', { name: 'Value 900' })).not.toBeNull();
  expect(screen.queryByRole('gridcell', { name: 'Value 1' })).toBeNull();
});

it('selects a block, copies it as tab-separated values, and asks the agent with sheet, range and formulas', async () => {
  const user = userEvent.setup();
  const onAskAgent = vi.fn();
  render(<SpreadsheetDocument onAskAgent={onAskAgent} workbook={workbook} />);
  await user.click(screen.getByRole('gridcell', { name: 'Pro' }));
  await user.keyboard('{Shift>}');
  await user.click(screen.getByRole('gridcell', { name: '$640.00' }));
  await user.keyboard('{/Shift}');
  expect(screen.getByText('A2:B3 · 2 rows × 2 columns')).not.toBeNull();
  expect(screen.getByRole('gridcell', { name: 'Pro' }).getAttribute('aria-selected')).toBe('true');

  await user.click(screen.getByRole('button', { name: 'Copy' }));
  await waitFor(async () =>
    expect(await navigator.clipboard.readText()).toBe('Pro\t$1,234.50\nPlus\t$640.00'),
  );

  // The app menu's Copy raises the clipboard event on the focused grid.
  const setData = vi.fn();
  fireEvent.copy(screen.getByRole('grid', { name: '销售' }), { clipboardData: { setData } });
  expect(setData).toHaveBeenCalledWith('text/plain', 'Pro\t$1,234.50\nPlus\t$640.00');
  expect(screen.getByText('Copied 4 cells')).not.toBeNull();

  await user.click(screen.getByRole('button', { name: 'Ask agent' }));
  expect(onAskAgent).toHaveBeenCalledWith(
    [
      'Sheet 销售, cells A2:B3 (2 rows × 2 columns).',
      "Row 1, the sheet's first row, often names the columns: A 产品; B 金额.",
      'Formula cells show the result saved in the file, not recalculated: B3 `=B2/2`.',
      '',
      '| Row | A | B |',
      '| --- | --- | --- |',
      '| 2 | Pro | $1,234.50 |',
      '| 3 | Plus | $640.00 |',
    ].join('\n'),
  );
});

it('refuses to ask about a selection too large to send instead of cutting it', async () => {
  const user = userEvent.setup();
  const onAskAgent = vi.fn();
  const rows = Array.from({ length: 1000 }, (_, i) => [`Row ${i + 1} value`, 'more']);
  const sheet = {
    ...notes,
    columnCount: 2,
    firstColumn: 0,
    firstRow: 0,
    name: '销售',
    rowCount: 1000,
    rows,
  };
  render(
    <SpreadsheetDocument
      onAskAgent={onAskAgent}
      workbook={{ hasFormulas: false, sheetCount: 1, sheets: [sheet] }}
    />,
  );
  const grid = screen.getByRole('grid', { name: '销售' });
  await user.click(screen.getByRole('gridcell', { name: 'Row 1 value' }));
  pressKey(grid, 'a', { metaKey: true });
  await user.click(screen.getByRole('button', { name: 'Ask agent' }));
  expect(await screen.findByText(/This selection is too large to ask about/)).not.toBeNull();
  expect(onAskAgent).not.toHaveBeenCalled();

  // Rows reached by keyboard extend the selection from where it started.
  await user.click(screen.getByRole('gridcell', { name: 'Row 1 value' }));
  pressKey(grid, 'ArrowDown', { shiftKey: true });
  pressKey(grid, 'ArrowRight', { shiftKey: true });
  await user.click(screen.getByRole('button', { name: 'Ask agent' }));
  expect(onAskAgent).toHaveBeenCalledTimes(1);
  expect(onAskAgent.mock.calls[0]?.[0]).toContain('| 2 | Row 2 value | more |');
});

it('extends whole rows and whole columns by keyboard as rows and columns', async () => {
  const user = userEvent.setup();
  render(<SpreadsheetDocument workbook={workbook} />);
  const grid = screen.getByRole('grid', { name: '销售' });
  await user.click(screen.getByRole('rowheader', { name: '2' }));
  pressKey(grid, 'ArrowDown', { shiftKey: true });
  expect(screen.getByText('A2:C3 · 2 rows × 3 columns')).not.toBeNull();
  await user.click(screen.getByRole('columnheader', { name: 'B' }));
  pressKey(grid, 'ArrowRight', { shiftKey: true });
  expect(screen.getByText('B1:C3 · 3 rows × 2 columns')).not.toBeNull();
});
