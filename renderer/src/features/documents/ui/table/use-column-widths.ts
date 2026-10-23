import { useEffect, useMemo, useState } from 'react';

import { columnLayout, columnWidthFor, type ColumnLayout, type VisibleWindow } from './geometry';

/** Column widths from the sample, widened for any longer value drawn since,
 *  and the window of cells those widths put in view. A column never narrows,
 *  so scrolling back never shifts what was read. */
export function useColumnWidths(
  columnCount: number,
  sample: readonly (readonly string[])[],
  row: (index: number) => readonly string[] | undefined,
  windowFor: (layout: ColumnLayout) => VisibleWindow,
): { layout: ColumnLayout; view: VisibleWindow } {
  const [widened, setWidened] = useState<ReadonlyMap<number, number>>(() => new Map());
  const layout = useMemo(
    () => columnLayout(columnCount, sample, widened),
    [columnCount, sample, widened],
  );
  const view = windowFor(layout);
  const { first: firstRow, last: lastRow } = view.rows;
  const { first: firstColumn, last: lastColumn } = view.columns;

  // `row` answers for pages that load after a render, so it is a dependency:
  // a newly loaded row can widen its columns too.
  useEffect(() => {
    let next: Map<number, number> | null = null;
    for (let index = firstRow; index <= lastRow; index += 1) {
      const values = row(index);
      if (!values) continue;
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        const need = columnWidthFor(values[column] ?? '');
        if (need > (next?.get(column) ?? layout.widths[column] ?? 0)) {
          next ??= new Map(widened);
          next.set(column, need);
        }
      }
    }
    if (next) setWidened(next);
  }, [firstColumn, firstRow, lastColumn, lastRow, layout, row, widened]);

  return { layout, view };
}
