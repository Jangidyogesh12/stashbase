export interface SpreadsheetSheet {
  name: string;
  firstRow: number;
  firstColumn: number;
  rowCount: number;
  columnCount: number;
  rows: string[][];
  /** Formula cells among `rows`, by their index there. */
  formulas: { row: number; column: number; formula: string }[];
}

export interface SpreadsheetPreview {
  sheets: SpreadsheetSheet[];
  sheetCount: number;
  hasFormulas: boolean;
}

export type GenericFilePreview =
  | {
      kind: 'spreadsheet';
      workbook: SpreadsheetPreview;
      name: string;
      size: number;
      version: string;
    }
  | {
      content: string;
      kind: 'text';
      name: string;
      size: number;
      version?: string;
    }
  | {
      kind:
        | 'binary'
        | 'cloud-placeholder'
        | 'special'
        | 'symlink'
        | 'too-large'
        | 'unreadable'
        | 'invalid-spreadsheet';
      message?: string;
      name: string;
      size?: number;
    };
