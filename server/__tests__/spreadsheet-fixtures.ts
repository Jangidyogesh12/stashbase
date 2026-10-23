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
