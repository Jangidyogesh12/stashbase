/**
 * Tables as Documents shows them: CSV/TSV read in pages and XLSX worksheets.
 * Rows and columns are zero-based here and shown in spreadsheet coordinates
 * (row 1, column A), which is also how a selection is named to the Agent.
 */
import { PASSAGE_QUOTE_LIMIT } from '@/shared/domain/passage';

export type TableDelimiter = ',' | '\t' | ';' | '|';
type TableEncoding = 'utf-16le' | 'utf-16be' | 'gb18030';

export type DelimitedTablePage =
  | {
      kind: 'table';
      columnCount: number;
      delimiter: TableDelimiter;
      /** The source is small enough to open as text. */
      editable: boolean;
      name: string;
      rowCount: number;
      rows: string[][];
      size: number;
      start: number;
      totalColumns: number;
      version: string;
    }
  | { kind: 'unsupported-encoding'; encoding: TableEncoding | null; name: string }
  | { kind: 'too-large'; name: string; size: number }
  | { kind: 'binary'; name: string };

export type TableViewMode = 'source' | 'table';

/** An inclusive block of cells. */
export interface TableRange {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

export interface TableCell {
  column: number;
  row: number;
}

/** Where a sheet's first cell sits, for sheets whose used range starts below
 *  or to the right of A1. */
export interface TableOrigin {
  firstColumn: number;
  firstRow: number;
}

export const DELIMITER_NAMES: Readonly<Record<TableDelimiter, string>> = {
  '\t': 'Tab-separated',
  ',': 'Comma-separated',
  ';': 'Semicolon-separated',
  '|': 'Pipe-separated',
};

export function columnLabel(column: number): string {
  let label = '';
  for (let value = column + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    label = String.fromCharCode(65 + ((value - 1) % 26)) + label;
  }
  return label;
}

export function cellLabel(cell: TableCell, origin: TableOrigin): string {
  return `${columnLabel(origin.firstColumn + cell.column)}${origin.firstRow + cell.row + 1}`;
}

export function rangeBetween(anchor: TableCell, focus: TableCell): TableRange {
  return {
    bottom: Math.max(anchor.row, focus.row),
    left: Math.min(anchor.column, focus.column),
    right: Math.max(anchor.column, focus.column),
    top: Math.min(anchor.row, focus.row),
  };
}

export function rangeLabel(range: TableRange, origin: TableOrigin): string {
  const start = cellLabel({ column: range.left, row: range.top }, origin);
  const end = cellLabel({ column: range.right, row: range.bottom }, origin);
  return start === end ? start : `${start}:${end}`;
}

export function rangeRows(range: TableRange): number {
  return range.bottom - range.top + 1;
}

export function rangeColumns(range: TableRange): number {
  return range.right - range.left + 1;
}

export function rangeContains(range: TableRange, cell: TableCell): boolean {
  return (
    cell.row >= range.top &&
    cell.row <= range.bottom &&
    cell.column >= range.left &&
    cell.column <= range.right
  );
}

/** A range kept inside a table that may have shrunk since it was chosen. */
export function clampRange(
  range: TableRange,
  rowCount: number,
  columnCount: number,
): TableRange | null {
  if (rowCount === 0 || columnCount === 0) return null;
  const top = Math.min(range.top, rowCount - 1);
  const left = Math.min(range.left, columnCount - 1);
  return {
    bottom: Math.min(range.bottom, rowCount - 1),
    left,
    right: Math.min(range.right, columnCount - 1),
    top,
  };
}

/** Values pasted into a spreadsheet land in the same cells: tab-separated,
 *  with a value quoted only when a tab, line break or quote needs it. */
export function tableTsv(rows: readonly (readonly string[])[]): string {
  return rows
    .map((row) =>
      row
        .map((value) => (/[\t\r\n"]/u.test(value) ? `"${value.replace(/"/g, '""')}"` : value))
        .join('\t'),
    )
    .join('\n');
}

/** The most cells one copy reads, so selecting a whole large file and
 *  copying it cannot read the file into memory one page at a time. */
export const TABLE_COPY_CELL_LIMIT = 200_000;

export interface TableSelectionInput {
  /** The CSV header (its first row), for the selected columns' names. */
  header?: readonly string[] | undefined;
  /** Formula text by cell, for a worksheet's formula cells. */
  formulas?: ReadonlyMap<string, string> | undefined;
  origin: TableOrigin;
  range: TableRange;
  /** The selected rows' values, `range.top` first. */
  rows: readonly (readonly string[])[];
  /** A worksheet's name; absent for a CSV. */
  sheet?: string | undefined;
  /** The worksheet's first row, offered when the selection starts below it,
   *  since it usually names the columns. */
  firstRow?: readonly string[] | undefined;
}

const markdownCell = (value: string) =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r\n|\r|\n/g, '<br>');

export function formulaKey(row: number, column: number): string {
  return `${row}:${column}`;
}

/**
 * The selection as the Agent reads it: where it is, then a Markdown table
 * whose rows keep their numbers and whose columns keep their letters, and for
 * a CSV the header's names. The text travels as a passage, so it is checked
 * against the passage limit rather than cut to fit.
 */
export function tableSelectionText(input: TableSelectionInput): string {
  const { header, origin, range, rows, sheet } = input;
  const columns = Array.from({ length: rangeColumns(range) }, (_, offset) => range.left + offset);
  const size = `${counted(rangeRows(range), 'row')} × ${counted(columns.length, 'column')}`;
  const where = `${sheet === undefined ? 'Cells' : `Sheet ${sheet}, cells`} ${rangeLabel(range, origin)} (${size}).`;
  const lines = [where];
  // A CSV's first row is its header: it names the columns instead of
  // repeating as a row of values.
  const body = rows
    .map((values, offset) => ({ number: range.top + offset, values }))
    .filter(({ number }) => header === undefined || number > 0);
  const columnName = (column: number) => {
    const letter = columnLabel(origin.firstColumn + column);
    const name = header?.[column]?.trim();
    return name ? `${name} (${letter})` : letter;
  };
  if (input.firstRow && range.top > 0) {
    lines.push(
      `Row ${origin.firstRow + 1}, the sheet's first row, often names the columns: ${columns
        .map((column) =>
          `${columnLabel(origin.firstColumn + column)} ${input.firstRow?.[column] ?? ''}`.trim(),
        )
        .join('; ')}.`,
    );
  }
  const formulas: string[] = [];
  if (input.formulas?.size) {
    for (let row = range.top; row <= range.bottom; row += 1) {
      for (const column of columns) {
        const formula = input.formulas.get(formulaKey(row, column));
        if (formula) formulas.push(`${cellLabel({ column, row }, origin)} \`${formula}\``);
      }
    }
  }
  if (formulas.length > 0) {
    lines.push(
      `Formula cells show the result saved in the file, not recalculated: ${formulas.join('; ')}.`,
    );
  }
  lines.push(
    '',
    `| Row | ${columns.map((column) => markdownCell(columnName(column))).join(' | ')} |`,
    `| --- |${' --- |'.repeat(columns.length)}`,
  );
  for (const { number, values } of body) {
    lines.push(
      `| ${origin.firstRow + number + 1} | ${columns
        .map((column) => markdownCell(values[column - range.left] ?? ''))
        .join(' | ')} |`,
    );
  }
  return lines.join('\n');
}

/** Whether a selection this size could fit in one passage at all: every
 *  row costs at least its number and a separator per cell. Answering early
 *  spares reading a large file's rows only to refuse them. */
export function selectionMayFitPassage(range: TableRange): boolean {
  return rangeRows(range) * (rangeColumns(range) * 3 + 6) <= PASSAGE_QUOTE_LIMIT;
}

export function selectionFitsPassage(text: string): boolean {
  return text.length <= PASSAGE_QUOTE_LIMIT;
}

export const SELECTION_TOO_LARGE = `This selection is too large to ask about. Select fewer rows or columns (up to ${PASSAGE_QUOTE_LIMIT.toLocaleString('en-US')} characters).`;

export function counted(count: number, noun: string): string {
  return `${count.toLocaleString('en-US')} ${noun}${count === 1 ? '' : 's'}`;
}

/** Values that read as numbers sit right-aligned, as spreadsheets show them. */
export function looksNumeric(value: string): boolean {
  return /^[-+(]?[$€£¥]?\s?\d[\d,.\s]*%?\)?$/u.test(value.trim()) && value.trim() !== '';
}
