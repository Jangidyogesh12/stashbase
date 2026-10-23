import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
import { spreadsheetPreviewSchema } from '../shared/protocols/http/files.ts';
import type { GenericFilePreview } from '../shared/project-files.ts';

type Workbook = Extract<GenericFilePreview, { kind: 'spreadsheet' }>['workbook'];
// Resolved on first parse, not at import: a server or MCP bundle that loads
// this module never fails to start over the parser.
let xlsxModule: string | null = null;
const cache = new Map<string, Workbook>();

export function isSpreadsheetFile(name: string): boolean {
  return /\.xlsx$/i.test(name) && !/(?:^|[/\\])~\$/.test(name);
}

// Resolve the installed parser explicitly, as DOCX does, so this worker works
// in both the source host and the bundled server. Only plain display strings
// cross the boundary; workbook HTML, links and formulas are never executed.
// Formula text is reported beside the value so readers can tell a saved
// result from a typed one.
const WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
const { inflateRawSync } = require('node:zlib');
try {
  const bytes = Buffer.from(workerData.bytes);
  // Bound expansion before the parser inflates OOXML entries. ZIP64 and
  // encrypted containers are outside this preview's supported input.
  let end = bytes.length - 22;
  const floor = Math.max(0, end - 65535);
  while (end >= floor && bytes.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < floor || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6))
    throw new Error('This file is not a supported XLSX workbook.');
  const count = bytes.readUInt16LE(end + 10);
  const directoryStart = bytes.readUInt32LE(end + 16);
  let offset = directoryStart, expanded = 0;
  if (count > 10000) throw new Error('This workbook is too complex to preview.');
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50)
      throw new Error('This workbook is damaged or uses an unsupported archive format.');
    const uncompressed = bytes.readUInt32LE(offset + 24);
    const compressed = bytes.readUInt32LE(offset + 20);
    expanded += uncompressed;
    if (expanded > 64 * 1024 * 1024 || (bytes.readUInt16LE(offset + 8) & 1))
      throw new Error('This workbook is too large or encrypted. Open it in a spreadsheet app.');
    const local = bytes.readUInt32LE(offset + 42);
    if (local + 30 > directoryStart || bytes.readUInt32LE(local) !== 0x04034b50)
      throw new Error('This workbook archive is damaged.');
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    if (start + compressed > directoryStart) throw new Error('This workbook archive is damaged.');
    const method = bytes.readUInt16LE(offset + 10);
    if (bytes.readUInt16LE(local + 8) !== method || ![0, 8].includes(method))
      throw new Error('This workbook uses unsupported archive compression.');
    // Check the actual expansion too: declared ZIP sizes alone cannot bound
    // a damaged or adversarial archive before SheetJS decompresses it.
    const packed = bytes.subarray(start, start + compressed);
    const unpacked = method === 0 ? packed : inflateRawSync(packed, { maxOutputLength: Math.max(1, uncompressed) });
    if (unpacked.length !== uncompressed) throw new Error('This workbook archive is damaged.');
    offset += 46 + bytes.readUInt16LE(offset + 28) + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
  }
  const XLSX = require(workerData.xlsxModule);
  const book = XLSX.read(bytes, { type: 'buffer', cellHTML: false, cellFormula: true });
  if (!book.Workbook) throw new Error('This file is not an XLSX workbook.');
  const names = book.SheetNames.filter((name, i) => !book.Workbook.Sheets?.[i]?.Hidden);
  let characters = 0, hasFormulas = false;
  const sheets = names.slice(0, 20).map(name => {
    const sheet = book.Sheets[name];
    if (!sheet?.['!ref']) return { name, firstRow: 0, firstColumn: 0, rowCount: 0, columnCount: 0, rows: [], formulas: [] };
    const range = XLSX.utils.decode_range(sheet['!ref']);
    const rowCount = range.e.r - range.s.r + 1, columnCount = range.e.c - range.s.c + 1;
    const rows = [], formulas = [];
    for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + 999); r++) {
      const row = [];
      for (let c = range.s.c; c <= Math.min(range.e.c, range.s.c + 63); c++) {
        const cell = sheet[XLSX.utils.encode_cell({ r, c })];
        if (cell?.f) {
          hasFormulas = true;
          if (formulas.length < 2000) {
            const formula = '=' + String(cell.f).slice(0, 8191);
            characters += formula.length;
            formulas.push({ row: r - range.s.r, column: c - range.s.c, formula });
          }
        }
        const value = !cell ? '' : cell.f && cell.v == null ? '=' + cell.f : XLSX.utils.format_cell(cell);
        characters += value.length;
        if (value.length > 32767 || characters > 1000000)
          throw new Error('This workbook contains too much text to preview. Open it in a spreadsheet app.');
        row.push(value);
      }
      rows.push(row);
    }
    return { name, firstRow: range.s.r, firstColumn: range.s.c, rowCount, columnCount, rows, formulas };
  });
  parentPort.postMessage({ workbook: { sheets, sheetCount: names.length, hasFormulas } });
} catch (error) {
  parentPort.postMessage({ error: error.message });
}
`;

/** Parsing cannot block the host; cancellation terminates its worker. The small
 * content-keyed cache avoids reparsing unchanged files on document refresh. */
async function parseWorkbook(bytes: Buffer, signal?: AbortSignal): Promise<Workbook> {
  signal?.throwIfAborted();
  xlsxModule ??= createRequire(import.meta.url).resolve('xlsx');
  const worker = new Worker(WORKER_SOURCE, {
    eval: true,
    workerData: { bytes, xlsxModule },
    resourceLimits: { maxOldGenerationSizeMb: 128 },
  });
  try {
    return await new Promise<Workbook>((resolve, reject) => {
      const abort = () => reject(signal?.reason ?? new Error('Preview cancelled.'));
      const timer = setTimeout(() => reject(new Error('This workbook took too long to preview.')), 15_000);
      signal?.addEventListener('abort', abort, { once: true });
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
      worker.once('message', (message: { workbook?: unknown; error?: string }) => {
        cleanup();
        const parsed = spreadsheetPreviewSchema.safeParse(message.workbook);
        if (parsed.success) resolve(parsed.data);
        else reject(new Error(message.error ?? 'This workbook could not be read.'));
      });
      worker.once('error', (error) => { cleanup(); reject(error); });
      worker.once('exit', () => { cleanup(); reject(new Error('This workbook could not be read.')); });
    });
  } finally {
    await worker.terminate();
  }
}

/** Compound File Binary, the container Excel encrypts a workbook into and
 *  the older .xls format uses; it is not a ZIP, so it cannot be an XLSX. */
const COMPOUND_FILE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

export async function spreadsheetFilePreview(bytes: Buffer, name: string, signal?: AbortSignal): Promise<GenericFilePreview> {
  signal?.throwIfAborted();
  if (bytes.subarray(0, COMPOUND_FILE.length).equals(COMPOUND_FILE)) {
    return {
      kind: 'invalid-spreadsheet', name, size: bytes.length,
      message: 'This workbook is password-protected or saved in the older Excel format. Open it in a spreadsheet app.',
    };
  }
  const version = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  try {
    let workbook = cache.get(version);
    if (!workbook) {
      workbook = await parseWorkbook(bytes, signal);
      signal?.throwIfAborted();
      if (cache.size >= 4) cache.delete(cache.keys().next().value!);
      cache.set(version, workbook);
    }
    return { kind: 'spreadsheet', name, size: bytes.length, version, workbook };
  } catch (error) {
    signal?.throwIfAborted();
    return {
      kind: 'invalid-spreadsheet', name, size: bytes.length,
      message: error instanceof Error && /^This (workbook|file) /.test(error.message)
        ? error.message.slice(0, 500) : 'The workbook may be damaged or password-protected. Open it in a spreadsheet app.',
    };
  }
}

/** A1-style column letters for a zero-based column index. */
export function spreadsheetColumnLabel(column: number): string {
  let label = '';
  for (let value = column + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    label = String.fromCharCode(65 + ((value - 1) % 26)) + label;
  }
  return label;
}

const counted = (count: number, noun: string) => `${count.toLocaleString('en-US')} ${noun}${count === 1 ? '' : 's'}`;

const tableCell = (value: string) => value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r\n|\r|\n/g, '<br>');

/**
 * The workbook as an Agent reads it: what the preview shows, from the same
 * parse, as Markdown. Every sheet keeps its name, every column its letter and
 * every row its number, so a reply can point back at a cell. Row 1 usually
 * holds the column names. Anything the preview leaves out is stated, never
 * dropped silently.
 */
export function spreadsheetAgentText(name: string, workbook: Workbook): string {
  const lines = [
    `# ${name}`,
    '',
    `Worksheet values as saved in this XLSX file. ${counted(workbook.sheetCount, 'visible worksheet')}; hidden worksheets are not included.`,
  ];
  if (workbook.hasFormulas) {
    lines.push('Formula cells show the result saved in the file. StashBase did not recalculate them.');
  }
  if (workbook.sheetCount > workbook.sheets.length) {
    lines.push(`Only the first ${workbook.sheets.length} worksheets are included.`);
  }
  workbook.sheets.forEach((sheet, index) => {
    lines.push('', `## Sheet ${index + 1}: ${sheet.name}`, '');
    const columns = sheet.rows[0]?.length ?? 0;
    if (sheet.rows.length === 0 || columns === 0) {
      lines.push('This worksheet is empty.');
      return;
    }
    const column = (offset: number) => spreadsheetColumnLabel(sheet.firstColumn + offset);
    const lastRow = sheet.firstRow + sheet.rows.length;
    lines.push(
      `Cells ${column(0)}${sheet.firstRow + 1}:${column(columns - 1)}${lastRow} (${counted(sheet.rowCount, 'row')} × ${counted(sheet.columnCount, 'column')} in the sheet).`,
    );
    if (sheet.rows.length < sheet.rowCount || columns < sheet.columnCount) {
      lines.push(
        `Only rows ${sheet.firstRow + 1}–${lastRow} and columns ${column(0)}–${column(columns - 1)} are included; the rest of this sheet is not.`,
      );
    }
    // Rows and columns keep their own numbers and letters, so leaving out the
    // empty ones costs no coordinates and keeps a sparse sheet readable.
    const kept = Array.from({ length: columns }, (_, offset) => offset).filter((offset) =>
      sheet.rows.some((row) => row[offset] !== ''),
    );
    const rows = sheet.rows
      .map((row, offset) => ({ number: sheet.firstRow + offset + 1, row }))
      .filter(({ row }) => kept.some((offset) => row[offset] !== ''));
    if (kept.length < columns || rows.length < sheet.rows.length) {
      lines.push('Empty rows and columns are not shown.');
    }
    if (rows.length === 0) {
      lines.push('', 'These cells hold no values.');
      return;
    }
    lines.push(
      '',
      `| Row | ${kept.map(column).join(' | ')} |`,
      `| --- |${' --- |'.repeat(kept.length)}`,
    );
    for (const { number, row } of rows) {
      lines.push(`| ${number} | ${kept.map((offset) => tableCell(row[offset])).join(' | ')} |`);
    }
    if (sheet.formulas.length > 0) {
      const shown = sheet.formulas.slice(0, 200).map(
        ({ row, column: offset, formula }) => `${column(offset)}${sheet.firstRow + row + 1} \`${formula}\``,
      );
      const more = sheet.formulas.length - shown.length;
      // The worker stops listing formulas at its own bound, so past it the count is a floor.
      const rest = more <= 0 ? '' : sheet.formulas.length >= 2000 ? `; and at least ${more} more` : `; and ${more} more`;
      lines.push('', `Formula cells (saved results, not recalculated): ${shown.join('; ')}${rest}.`);
    }
  });
  return `${lines.join('\n')}\n`;
}
