import { describe, expect, it } from 'vite-plus/test';

import { PASSAGE_QUOTE_LIMIT } from '@/shared/domain/passage';

import {
  cellLabel,
  clampRange,
  columnLabel,
  looksNumeric,
  rangeLabel,
  selectionMayFitPassage,
  tableSelectionText,
  tableTsv,
} from './table';

describe('table coordinates', () => {
  it('names columns and cells as spreadsheets do, from where the sheet starts', () => {
    expect([0, 25, 26, 51, 52, 701, 702].map(columnLabel)).toEqual([
      'A',
      'Z',
      'AA',
      'AZ',
      'BA',
      'ZZ',
      'AAA',
    ]);
    const origin = { firstColumn: 2, firstRow: 3 };
    expect(cellLabel({ column: 0, row: 0 }, origin)).toBe('C4');
    expect(rangeLabel({ bottom: 0, left: 0, right: 0, top: 0 }, origin)).toBe('C4');
    expect(rangeLabel({ bottom: 9, left: 0, right: 1, top: 1 }, origin)).toBe('C5:D13');
  });

  it('keeps a selection inside a table that shrank', () => {
    expect(clampRange({ bottom: 50, left: 1, right: 9, top: 40 }, 10, 3)).toEqual({
      bottom: 9,
      left: 1,
      right: 2,
      top: 9,
    });
    expect(clampRange({ bottom: 1, left: 0, right: 0, top: 0 }, 0, 3)).toBeNull();
  });
});

describe('table selections', () => {
  it('copies as tab-separated values a spreadsheet pastes into the same cells', () => {
    expect(
      tableTsv([
        ['a', 'b\tc'],
        ['line\nbreak', 'say "hi"'],
        ['', 'plain'],
      ]),
    ).toBe('a\t"b\tc"\n"line\nbreak"\t"say ""hi"""\n\tplain');
  });

  it('describes a CSV selection by header names, keeping row numbers and escaping cells', () => {
    expect(
      tableSelectionText({
        header: ['名称', '', 'Note'],
        origin: { firstColumn: 0, firstRow: 0 },
        range: { bottom: 2, left: 0, right: 2, top: 0 },
        rows: [
          ['名称', '', 'Note'],
          ['A|B', '1', 'two\nlines'],
          ['C', '2', 'back\\slash'],
        ],
      }),
    ).toBe(
      [
        'Cells A1:C3 (3 rows × 3 columns).',
        '',
        '| Row | 名称 (A) | B | Note (C) |',
        '| --- | --- | --- | --- |',
        '| 2 | A\\|B | 1 | two<br>lines |',
        '| 3 | C | 2 | back\\\\slash |',
      ].join('\n'),
    );
  });

  it('refuses early only when a selection cannot fit, and leaves the exact check to its text', () => {
    expect(selectionMayFitPassage({ bottom: 99, left: 0, right: 4, top: 0 })).toBe(true);
    expect(selectionMayFitPassage({ bottom: 999, left: 0, right: 4, top: 0 })).toBe(false);
    const rows = Array.from({ length: 80 }, () => ['x'.repeat(80)]);
    const text = tableSelectionText({
      origin: { firstColumn: 0, firstRow: 0 },
      range: { bottom: 79, left: 0, right: 0, top: 0 },
      rows,
    });
    expect(text.length).toBeGreaterThan(PASSAGE_QUOTE_LIMIT);
  });

  it('right-aligns values that read as numbers', () => {
    expect(['12', '-3.5', '1,234.50', '$1,234.50', '(42)', '15%', '€ 3'].every(looksNumeric)).toBe(
      true,
    );
    expect(['', 'v1.2', '2026-10-23', 'abc', '12 apples'].some(looksNumeric)).toBe(false);
  });
});
