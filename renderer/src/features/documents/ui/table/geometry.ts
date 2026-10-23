/** Where rows and columns sit in a virtual table. Every row is one height and
 *  a column starts at the width its sample gave it, so the window of cells to
 *  draw follows from the scroll position alone. A column only ever widens, for
 *  a longer value scrolled into view, so nothing narrows under the reader. */

export const ROW_HEIGHT = 30;
const MIN_COLUMN_WIDTH = 72;
const MAX_COLUMN_WIDTH = 320;
const CHARACTER_WIDTH = 7.5;
const CELL_PADDING = 24;
const OVERSCAN_ROWS = 8;
const OVERSCAN_COLUMNS = 2;

export interface ColumnLayout {
  /** `offsets[i]` is where column `i` starts; `offsets[count]` is the width. */
  offsets: Float64Array;
  widths: Float64Array;
}

/** The width one value asks of its column, within the column bounds. */
export function columnWidthFor(value: string): number {
  const line = value.length > 48 ? 48 : (value.split('\n', 1)[0]?.length ?? 0);
  return Math.min(
    MAX_COLUMN_WIDTH,
    Math.max(MIN_COLUMN_WIDTH, Math.ceil(line * CHARACTER_WIDTH + CELL_PADDING)),
  );
}

export function columnLayout(
  columnCount: number,
  sample: readonly (readonly string[])[],
  widened: ReadonlyMap<number, number> = new Map(),
): ColumnLayout {
  const widths = new Float64Array(columnCount);
  const offsets = new Float64Array(columnCount + 1);
  let edge = 0;
  for (let column = 0; column < columnCount; column += 1) {
    let width = widened.get(column) ?? MIN_COLUMN_WIDTH;
    for (const row of sample) width = Math.max(width, columnWidthFor(row[column] ?? ''));
    widths[column] = width;
    edge += width;
    offsets[column + 1] = edge;
  }
  return { offsets, widths };
}

/** The first column whose right edge lies past `x`. */
function columnAt(layout: ColumnLayout, x: number): number {
  let low = 0;
  let high = layout.widths.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((layout.offsets[middle + 1] ?? 0) <= x) low = middle + 1;
    else high = middle;
  }
  return Math.max(0, low);
}

export interface VisibleWindow {
  columns: { first: number; last: number };
  rows: { first: number; last: number };
}

/** The cells to draw for one scroll position, with a margin either side so a
 *  short scroll never shows blank space before the next render. */
export function visibleWindow(input: {
  bodyStart: number;
  columnLayout: ColumnLayout;
  headerHeight: number;
  rowCount: number;
  rowHeaderWidth: number;
  scrollLeft: number;
  scrollTop: number;
  viewportHeight: number;
  viewportWidth: number;
}): VisibleWindow {
  const columnCount = input.columnLayout.widths.length;
  const firstVisibleRow = Math.floor(input.scrollTop / ROW_HEIGHT);
  const lastVisibleRow = Math.ceil(
    (input.scrollTop + Math.max(0, input.viewportHeight - input.headerHeight)) / ROW_HEIGHT,
  );
  const rows = {
    first: Math.max(input.bodyStart, input.bodyStart + firstVisibleRow - OVERSCAN_ROWS),
    last: Math.min(input.rowCount - 1, input.bodyStart + lastVisibleRow + OVERSCAN_ROWS),
  };
  if (columnCount === 0) return { columns: { first: 0, last: -1 }, rows };
  const left = columnAt(input.columnLayout, input.scrollLeft);
  const right = columnAt(
    input.columnLayout,
    input.scrollLeft + Math.max(0, input.viewportWidth - input.rowHeaderWidth),
  );
  return {
    columns: {
      first: Math.max(0, left - OVERSCAN_COLUMNS),
      last: Math.min(columnCount - 1, right + OVERSCAN_COLUMNS),
    },
    rows,
  };
}

/** The scroll position that brings one cell fully into view, or the current
 *  one when it already is. Sticky headers cover the top and left edges. */
export function scrollToCell(input: {
  bodyStart: number;
  column: number;
  columnLayout: ColumnLayout;
  headerHeight: number;
  row: number;
  rowHeaderWidth: number;
  scrollLeft: number;
  scrollTop: number;
  viewportHeight: number;
  viewportWidth: number;
}): { left: number; top: number } {
  let { scrollLeft: left, scrollTop: top } = input;
  if (input.row >= input.bodyStart) {
    const rowTop = (input.row - input.bodyStart) * ROW_HEIGHT;
    const visibleHeight = input.viewportHeight - input.headerHeight;
    if (rowTop < top) top = rowTop;
    else if (rowTop + ROW_HEIGHT > top + visibleHeight) top = rowTop + ROW_HEIGHT - visibleHeight;
  }
  const cellLeft = input.columnLayout.offsets[input.column] ?? 0;
  const cellRight = input.columnLayout.offsets[input.column + 1] ?? cellLeft;
  const visibleWidth = input.viewportWidth - input.rowHeaderWidth;
  if (cellLeft < left) left = cellLeft;
  else if (cellRight > left + visibleWidth) left = Math.min(cellLeft, cellRight - visibleWidth);
  return { left: Math.max(0, left), top: Math.max(0, top) };
}

/** Chromium lays out nothing taller than about 33.5 million pixels, so the
 *  scrolled height stops well short of that, and a taller table scrolls
 *  through its rows in proportion instead of pixel for pixel. */
const MAX_BODY_HEIGHT = 15_000_000;

export interface VerticalScale {
  /** The body's scrollable height. */
  readonly height: number;
  /** Where the rows stand for a scroll position. */
  toRows(scrollTop: number): number;
  /** The scroll position that shows rows standing at `top`. */
  toScroll(top: number): number;
}

export function verticalScale(bodyRows: number, viewportBody: number): VerticalScale {
  const natural = bodyRows * ROW_HEIGHT;
  if (natural <= MAX_BODY_HEIGHT)
    return { height: natural, toRows: (top) => top, toScroll: (top) => top };
  const ratio = (natural - viewportBody) / (MAX_BODY_HEIGHT - viewportBody);
  return {
    height: MAX_BODY_HEIGHT,
    toRows: (top) => top * ratio,
    toScroll: (top) => top / ratio,
  };
}

export function rowHeaderWidth(lastRowNumber: number): number {
  return Math.max(44, 20 + String(lastRowNumber).length * 8);
}
