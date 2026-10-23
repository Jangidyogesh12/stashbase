import * as XLSX from 'xlsx';

export function spreadsheetFixture(): Buffer {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ['产品', '金额', '日期', '合计', '备注'],
    ['StashBase', 1234.5, 46045, 2469, '<script>alert(1)</script>'],
  ]);
  sheet.B2.z = '$#,##0.00';
  sheet.C2.z = 'yyyy-mm-dd';
  sheet.D2.f = 'B2*2';
  XLSX.utils.book_append_sheet(book, sheet, '销售');
  XLSX.utils.book_append_sheet(book, { C4: { t: 's', v: 'Second sheet' }, '!ref': 'C4:C4' }, 'Notes');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([]), 'Empty');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Hidden value']]), 'Hidden');
  book.Workbook = { Sheets: book.SheetNames.map((name) => ({ name, Hidden: name === 'Hidden' ? 1 : 0 })) };
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx', compression: true });
}

/** A one-sheet workbook whose worksheet body is `content`, written as given,
 *  for sheets too large to build cell by cell or that declare a wrong extent. */
export function worksheetFixture(content: string): Buffer {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['placeholder']]), 'Data');
  const zip = XLSX.CFB.read(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' });
  const sheet = zip.FileIndex[zip.FullPaths.findIndex((path: string) => path.endsWith('xl/worksheets/sheet1.xml'))];
  sheet.content = Buffer.from(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${content}</worksheet>`,
  );
  return Buffer.from(XLSX.CFB.write(zip, { type: 'buffer', fileType: 'zip' }));
}

/** `<row>` elements for `rows` × `columns` numeric cells from row `first` (one-based). */
export function worksheetRows(rows: number, columns: number, first = 1): string {
  const letters = Array.from({ length: columns }, (_, column) => XLSX.utils.encode_col(column));
  let xml = '';
  for (let row = first; row < first + rows; row += 1) {
    xml += `<row r="${row}">`;
    for (let column = 0; column < columns; column += 1) xml += `<c r="${letters[column]}${row}"><v>${(row + column) % 10}</v></c>`;
    xml += '</row>';
  }
  return xml;
}
