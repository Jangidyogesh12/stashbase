import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { spreadsheetFixture, worksheetFixture, worksheetRows } from './__tests__/spreadsheet-fixtures.ts';
import { clearCurrentFolder, openProjectFolder } from './folder.ts';
import { readGenericFilePreview } from './generic-file-preview.ts';
import { spreadsheetFilePreview } from './spreadsheet-preview.ts';
import { shouldIndexFilePath } from './indexable.ts';
import { saveFileContent } from './file-save.ts';

test('opening XLSX previews formatted values and visible sheets without changing the source or text capabilities', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stashbase-xlsx-'));
  try {
    const bytes = spreadsheetFixture();
    fs.writeFileSync(path.join(root, 'test.xlsx'), bytes);
    await openProjectFolder(root);
    const preview = await readGenericFilePreview('test.xlsx');
    assert.equal(preview.kind, 'spreadsheet');
    if (preview.kind !== 'spreadsheet') return;
    assert.deepEqual(preview.workbook.sheets.map(sheet => sheet.name), ['销售', 'Notes', 'Empty']);
    assert.deepEqual(preview.workbook.sheets[0].rows[1], ['StashBase', '$1,234.50', '2026-01-23', '2469', '<script>alert(1)</script>']);
    assert.equal(preview.workbook.hasFormulas, true);
    assert.equal(preview.workbook.sheets[1].firstRow, 3);
    assert.equal(preview.workbook.sheets[1].firstColumn, 2);
    assert.deepEqual(preview.workbook.sheets[2].rows, []);
    assert.equal(shouldIndexFilePath('test.xlsx'), false);
    await assert.rejects(saveFileContent('test.xlsx', 'replacement'), { code: 'UNSUPPORTED_FORMAT' });
    assert.deepEqual(fs.readFileSync(path.join(root, 'test.xlsx')), bytes);
    const replacement = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(replacement, XLSX.utils.aoa_to_sheet([['Updated']]), 'New');
    fs.writeFileSync(path.join(root, 'test.xlsx'), XLSX.write(replacement, { type: 'buffer', bookType: 'xlsx' }));
    const refreshed = await readGenericFilePreview('test.xlsx');
    assert.equal(refreshed.kind, 'spreadsheet');
    if (refreshed.kind === 'spreadsheet') {
      assert.notEqual(refreshed.version, preview.version);
      assert.equal(refreshed.workbook.sheets[0].rows[0][0], 'Updated');
    }
  } finally {
    clearCurrentFolder();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('large sheet dimensions are reported while preview rows and columns stay bounded', async () => {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([['First']]);
  sheet.CZ2001 = { t: 's', v: 'Beyond the preview' };
  sheet['!ref'] = 'A1:CZ2001';
  XLSX.utils.book_append_sheet(book, sheet, 'Large');
  const preview = await spreadsheetFilePreview(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }), 'large.xlsx');
  assert.equal(preview.kind, 'spreadsheet');
  if (preview.kind !== 'spreadsheet') return;
  const result = preview.workbook.sheets[0];
  assert.equal(result.rowCount, 2001);
  assert.equal(result.columnCount, 104);
  assert.equal(result.rows.length, 1000);
  assert.equal(result.rows[0].length, 64);
});

test('a dense sheet previews its first rows with its true extent, even under a wrong dimension', async () => {
  const { spreadsheetAgentText } = await import('./spreadsheet-preview.ts');
  // Nearly a million cells: parsing them all exhausted the worker and
  // aborted the whole host process. The dimension claims ten rows.
  const preview = await spreadsheetFilePreview(
    worksheetFixture(`<dimension ref="A1:B10"/><sheetData>${worksheetRows(80_000, 12)}</sheetData>`),
    'dense.xlsx',
  );
  assert.equal(preview.kind, 'spreadsheet');
  if (preview.kind !== 'spreadsheet') return;
  const [sheet] = preview.workbook.sheets;
  assert.equal(sheet.rowCount, 80_000);
  assert.equal(sheet.columnCount, 12);
  assert.equal(sheet.rows.length, 1000);
  assert.deepEqual(sheet.rows[999], Array.from({ length: 12 }, (_, column) => String((1000 + column) % 10)));
  assert.match(
    spreadsheetAgentText('dense.xlsx', preview.workbook),
    /\(80,000 rows × 12 columns in the sheet\)\.\nOnly rows 1–1000 and columns A–L are included; the rest of this sheet is not\./,
  );
});

test('cells that start past the first thousand rows preview from there, and a sheet too wide is refused', async () => {
  const late = await spreadsheetFilePreview(
    worksheetFixture(`<sheetData>${worksheetRows(3, 2, 1500)}</sheetData>`),
    'late.xlsx',
  );
  assert.equal(late.kind, 'spreadsheet');
  if (late.kind === 'spreadsheet') {
    assert.equal(late.workbook.sheets[0].firstRow, 1499);
    assert.deepEqual(late.workbook.sheets[0].rows, [['0', '1'], ['1', '2'], ['2', '3']]);
  }
  const wide = await spreadsheetFilePreview(worksheetFixture(`<sheetData>${worksheetRows(1000, 600)}</sheetData>`), 'wide.xlsx');
  assert.equal(wide.kind === 'invalid-spreadsheet' && wide.message, 'This workbook is too large to preview. Open it in a spreadsheet app.');
});

test('invalid and oversized archives fail visibly, and cancellation does not publish a preview', async () => {
  const invalid = await spreadsheetFilePreview(Buffer.from('not a workbook'), 'broken.xlsx');
  assert.equal(invalid.kind, 'invalid-spreadsheet');
  // A password-protected workbook is a Compound File, not a ZIP, and says so.
  const encrypted = await spreadsheetFilePreview(
    Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(504)]),
    'locked.xlsx',
  );
  assert.equal(encrypted.kind === 'invalid-spreadsheet' && encrypted.message, 'This workbook is password-protected or saved in the older Excel format. Open it in a spreadsheet app.');
  const expanded = spreadsheetFixture();
  const directory = expanded.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  expanded.writeUInt32LE(100 * 1024 * 1024, directory + 24);
  const rejected = await spreadsheetFilePreview(expanded, 'expanded.xlsx');
  assert.equal(rejected.kind, 'invalid-spreadsheet');
  // SheetJS reads the last end-of-directory signature, so the checked record
  // must end the file: one inside its comment would bypass the bound above.
  const fixture = spreadsheetFixture();
  const commented = Buffer.concat([fixture, Buffer.from([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0])]);
  commented.writeUInt16LE(10, fixture.length - 2);
  assert.equal((await spreadsheetFilePreview(commented, 'commented.xlsx')).kind, 'invalid-spreadsheet');
  const trailing = Buffer.concat([fixture, Buffer.from('trailing bytes')]);
  assert.equal((await spreadsheetFilePreview(trailing, 'trailing.xlsx')).kind, 'invalid-spreadsheet');
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(spreadsheetFilePreview(spreadsheetFixture(), 'cancelled.xlsx', controller.signal), { name: 'AbortError' });
  const running = new AbortController();
  const pending = spreadsheetFilePreview(Buffer.from('cancel while parsing'), 'running.xlsx', running.signal);
  running.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});

test('read_file gives an agent the preview parse as tables with sheet, column and row, and formulas marked unrecalculated', async (t) => {
  const { registerProjectFolderAsync } = await import('./folder.ts');
  const { readProjectFile } = await import('./project-file-reader.ts');
  const { editProjectFile, writeProjectFile } = await import('./project-file-mutations.ts');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stashbase-xlsx-agent-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  await registerProjectFolderAsync(root);
  const source = path.join(root, 'sales.xlsx');
  const bytes = spreadsheetFixture();
  fs.writeFileSync(source, bytes);

  const read = await readProjectFile(source);
  assert.equal(read.format, 'xlsx-derived-md');
  assert.equal(read.derived, true);
  assert.match(read.version ?? '', /^sha256:/);
  assert.equal(read.content, [
    '# sales.xlsx',
    '',
    'Worksheet values as saved in this XLSX file. 3 visible worksheets; hidden worksheets are not included.',
    'Formula cells show the result saved in the file. StashBase did not recalculate them.',
    '',
    '## Sheet 1: 销售',
    '',
    'Cells A1:E2 (2 rows × 5 columns in the sheet).',
    '',
    '| Row | A | B | C | D | E |',
    '| --- | --- | --- | --- | --- | --- |',
    '| 1 | 产品 | 金额 | 日期 | 合计 | 备注 |',
    '| 2 | StashBase | $1,234.50 | 2026-01-23 | 2469 | <script>alert(1)</script> |',
    '',
    'Formula cells (saved results, not recalculated): D2 `=B2*2`.',
    '',
    '## Sheet 2: Notes',
    '',
    'Cells C4:C4 (1 row × 1 column in the sheet).',
    '',
    '| Row | C |',
    '| --- | --- |',
    '| 4 | Second sheet |',
    '',
    '## Sheet 3: Empty',
    '',
    'This worksheet is empty.',
    '',
  ].join('\n'));
  const window = await readProjectFile(source, { offset: 6, limit: 8 });
  assert.equal(window.partial, true);
  assert.match(window.content, /^## Sheet 1: 销售/);

  await assert.rejects(editProjectFile(source, 'StashBase', 'Changed'), { status: 415, code: 'UNSUPPORTED_FORMAT' });
  await assert.rejects(writeProjectFile(source, 'replacement'), { status: 415 });
  assert.deepEqual(fs.readFileSync(source), bytes);
});

test('the agent text states what a large sheet leaves out', async () => {
  const { spreadsheetAgentText } = await import('./spreadsheet-preview.ts');
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([['First', 'a|b'], ['multi\nline', '']]);
  sheet.CZ2001 = { t: 's', v: 'Beyond the preview' };
  sheet['!ref'] = 'A1:CZ2001';
  XLSX.utils.book_append_sheet(book, sheet, 'Large');
  const preview = await spreadsheetFilePreview(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }), 'large.xlsx');
  assert.equal(preview.kind, 'spreadsheet');
  if (preview.kind !== 'spreadsheet') return;
  const text = spreadsheetAgentText('large.xlsx', preview.workbook);
  assert.match(text, /Only rows 1–1000 and columns A–BL are included; the rest of this sheet is not\./);
  assert.match(text, /Empty rows and columns are not shown\./);
  assert.match(text, /\| Row \| A \| B \|\n/);
  assert.match(text, /\| 1 \| First \| a\\\|b \|\n\| 2 \| multi<br>line \|  \|\n$/);
  assert.doesNotMatch(text, /Beyond the preview/);
});
