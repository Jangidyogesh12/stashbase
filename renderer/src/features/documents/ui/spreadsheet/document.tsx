/** Read-only workbook values. Worksheet selection and a virtual table keep
 *  large previews usable while preserving the source's row/column coordinates,
 *  and a selection can go to the Agent with its sheet and range. */
import { useMemo, useState } from 'react';

import { TabItem, TabPanel, Tabs, TabsList } from '@/components/ui/tabs';
import type {
  SpreadsheetPreview,
  SpreadsheetSheet,
} from '@/features/documents/domain/generic-preview';
import { counted, formulaKey, tableSelectionText } from '@/features/documents/domain/table';
import { DataGrid } from '@/features/documents/ui/table/data-grid';

export interface SpreadsheetDocumentProps {
  /** Binds selected cells to the Agent; absent where no Agent sits beside. */
  onAskAgent?: ((text: string) => void) | undefined;
  workbook: SpreadsheetPreview;
}

export function SpreadsheetDocument({ onAskAgent, workbook }: SpreadsheetDocumentProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const sheet = workbook.sheets.find((entry) => entry.name === selected) ?? workbook.sheets[0];
  if (!sheet) {
    return (
      <p className="p-6 text-caption text-muted-foreground" role="status">
        This workbook has no visible worksheets.
      </p>
    );
  }

  return (
    <Tabs
      className="flex min-h-0 flex-1 flex-col"
      onValueChange={setSelected}
      size="compact"
      value={sheet.name}
    >
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-3 py-2">
        <div className="min-w-0 flex-1 overflow-x-auto">
          <TabsList aria-label="Worksheets">
            {workbook.sheets.map((entry) => (
              <TabItem key={entry.name} label={entry.name} value={entry.name} />
            ))}
          </TabsList>
        </div>
        <span className="shrink-0 text-caption text-muted-foreground">Read-only</span>
      </div>
      {workbook.sheetCount > workbook.sheets.length && (
        <p className="px-4 py-2 text-caption text-muted-foreground" role="status">
          Showing {workbook.sheets.length} of {workbook.sheetCount} worksheets.
        </p>
      )}
      <TabPanel className="flex min-h-0 flex-1 flex-col" value={sheet.name}>
        <SheetGrid key={sheet.name} onAskAgent={onAskAgent} sheet={sheet} />
      </TabPanel>
      {workbook.hasFormulas && (
        <p className="shrink-0 border-t border-border px-4 py-2 text-caption text-muted-foreground">
          Formulas show saved results when available. Values are not recalculated.
        </p>
      )}
    </Tabs>
  );
}

function SheetGrid({
  onAskAgent,
  sheet,
}: {
  onAskAgent?: ((text: string) => void) | undefined;
  sheet: SpreadsheetSheet;
}) {
  const formulas = useMemo(
    () => new Map(sheet.formulas.map((cell) => [formulaKey(cell.row, cell.column), cell.formula])),
    [sheet.formulas],
  );
  const sample = useMemo(() => sheet.rows.slice(0, 200), [sheet.rows]);
  const columns = sheet.rows[0]?.length ?? 0;
  if (sheet.rows.length === 0 || columns === 0) {
    return (
      <p className="p-6 text-caption text-muted-foreground" role="status">
        This worksheet is empty.
      </p>
    );
  }
  const origin = { firstColumn: sheet.firstColumn, firstRow: sheet.firstRow };
  const truncated = sheet.rows.length < sheet.rowCount || columns < sheet.columnCount;

  return (
    <DataGrid
      columnCount={columns}
      describe={(range, rows) =>
        tableSelectionText({
          firstRow: sheet.rows[0],
          formulas,
          origin,
          range,
          rows,
          sheet: sheet.name,
        })
      }
      formula={(row, column) => formulas.get(formulaKey(row, column))}
      label={sheet.name}
      onAskAgent={onAskAgent}
      origin={origin}
      readRows={async (top, bottom) => sheet.rows.slice(top, bottom + 1)}
      row={(index) => sheet.rows[index]}
      rowCount={sheet.rows.length}
      sample={sample}
      status={
        `${counted(sheet.rowCount, 'row')} × ${counted(sheet.columnCount, 'column')}` +
        (truncated
          ? ` · Preview limited to ${counted(sheet.rows.length, 'row')} × ${counted(columns, 'column')}`
          : '')
      }
    />
  );
}
