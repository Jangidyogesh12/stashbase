import { describe, expect, it } from 'vite-plus/test';

import {
  columnLayout,
  columnWidthFor,
  ROW_HEIGHT,
  scrollToCell,
  verticalScale,
  visibleWindow,
} from './geometry';

const frame = {
  bodyStart: 1,
  headerHeight: ROW_HEIGHT * 2,
  rowCount: 10_000,
  rowHeaderWidth: 60,
  scrollLeft: 0,
  scrollTop: 0,
  viewportHeight: 600,
  viewportWidth: 500,
};

describe('table geometry', () => {
  it('sizes columns from their sample and only ever widens them', () => {
    const sample = [
      ['id', 'a much longer header value'],
      ['1', 'x'],
    ];
    const layout = columnLayout(2, sample);
    expect(layout.widths[0]).toBe(columnWidthFor(''));
    expect(layout.widths[1]).toBe(columnWidthFor('a much longer header value'));
    expect(layout.offsets[2]).toBe((layout.widths[0] ?? 0) + (layout.widths[1] ?? 0));
    const widened = columnLayout(2, sample, new Map([[0, 200]]));
    expect(widened.widths[0]).toBe(200);
    // A wider sample keeps its width when a narrower widening arrives.
    expect(columnLayout(2, sample, new Map([[1, 80]])).widths[1]).toBe(layout.widths[1]);
    expect(columnWidthFor('x'.repeat(10_000))).toBe(columnWidthFor('x'.repeat(48)));
  });

  it('draws only the rows and columns in view, plus a margin', () => {
    const layout = columnLayout(1_000, []);
    const top = visibleWindow({ ...frame, columnLayout: layout });
    expect(top.rows).toEqual({ first: 1, last: 1 + Math.ceil(540 / ROW_HEIGHT) + 8 });
    expect(top.columns.first).toBe(0);
    expect(top.columns.last).toBeLessThan(12);
    const far = visibleWindow({
      ...frame,
      columnLayout: layout,
      scrollLeft: 500 * (layout.widths[0] ?? 0),
      scrollTop: 5_000 * ROW_HEIGHT,
    });
    expect(far.rows.first).toBe(5_001 - 8);
    expect(far.columns.first).toBe(498);
    const end = visibleWindow({ ...frame, columnLayout: layout, scrollTop: 10_000 * ROW_HEIGHT });
    expect(end.rows.last).toBe(9_999);
  });

  it('scrolls a cell below or beside the sticky headers fully into view', () => {
    const layout = columnLayout(50, []);
    const below = scrollToCell({ ...frame, column: 0, columnLayout: layout, row: 100 });
    expect(below.top).toBe(100 * ROW_HEIGHT - (600 - ROW_HEIGHT * 2));
    const right = scrollToCell({ ...frame, column: 20, columnLayout: layout, row: 1 });
    expect(right.left).toBe((layout.offsets[21] ?? 0) - (500 - 60));
    const above = scrollToCell({
      ...frame,
      column: 0,
      columnLayout: layout,
      row: 3,
      scrollTop: 900,
    });
    expect(above.top).toBe(2 * ROW_HEIGHT);
  });

  it('scrolls a table past the layout ceiling through its rows in proportion', () => {
    const short = verticalScale(1_000, 540);
    expect(short.height).toBe(1_000 * ROW_HEIGHT);
    expect(short.toRows(900)).toBe(900);
    const tall = verticalScale(2_000_000, 540);
    expect(tall.height).toBeLessThan(33_000_000);
    // The end of the scroll range shows the last rows, and the start the first.
    expect(tall.toRows(tall.height - 540)).toBeCloseTo(2_000_000 * ROW_HEIGHT - 540);
    expect(tall.toRows(0)).toBe(0);
    expect(tall.toScroll(tall.toRows(1_234_567))).toBeCloseTo(1_234_567);
  });
});
