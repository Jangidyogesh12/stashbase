/** What the reader has selected in a table: a block of cells, whole rows, or
 *  whole columns, held as the cell it started from and the cell it reaches,
 *  the way spreadsheets extend a selection with Shift. */
import { useCallback, useMemo, useState } from 'react';

import {
  clampRange,
  rangeBetween,
  type TableCell,
  type TableRange,
} from '@/features/documents/domain/table';

type SelectionMode = 'cells' | 'columns' | 'rows';

interface GridSelectionState {
  anchor: TableCell;
  focus: TableCell;
  mode: SelectionMode;
}

export interface GridSelection {
  /** The cell keyboard movement starts from, kept inside the table. */
  active: TableCell | null;
  range: TableRange | null;
  clear(): void;
  /** Moves the active cell, or extends the selection to it with `extend`. */
  move(to: TableCell, extend: boolean): void;
  pressCell(cell: TableCell, extend: boolean): void;
  pressColumn(column: number, extend: boolean): void;
  pressRow(row: number, extend: boolean): void;
  selectAll(): void;
}

function clampCell(cell: TableCell, rowCount: number, columnCount: number): TableCell {
  return {
    column: Math.max(0, Math.min(cell.column, columnCount - 1)),
    row: Math.max(0, Math.min(cell.row, rowCount - 1)),
  };
}

export function useGridSelection(rowCount: number, columnCount: number): GridSelection {
  const [state, setState] = useState<GridSelectionState | null>(null);
  const empty = rowCount === 0 || columnCount === 0;

  const range = useMemo(() => {
    if (!state || empty) return null;
    const base = rangeBetween(state.anchor, state.focus);
    const whole =
      state.mode === 'rows'
        ? { ...base, left: 0, right: columnCount - 1 }
        : state.mode === 'columns'
          ? { ...base, bottom: rowCount - 1, top: 0 }
          : base;
    // A refreshed file may have fewer rows than the selection reached.
    return clampRange(whole, rowCount, columnCount);
  }, [columnCount, empty, rowCount, state]);

  const active = state && !empty ? clampCell(state.focus, rowCount, columnCount) : null;

  const pressCell = useCallback((cell: TableCell, extend: boolean) => {
    setState((current) =>
      extend && current
        ? { anchor: current.anchor, focus: cell, mode: 'cells' }
        : { anchor: cell, focus: cell, mode: 'cells' },
    );
  }, []);

  const pressRow = useCallback((row: number, extend: boolean) => {
    setState((current) => ({
      anchor: extend && current ? current.anchor : { column: 0, row },
      focus: { column: current?.focus.column ?? 0, row },
      mode: 'rows',
    }));
  }, []);

  const pressColumn = useCallback((column: number, extend: boolean) => {
    setState((current) => ({
      anchor: extend && current ? current.anchor : { column, row: 0 },
      focus: { column, row: current?.focus.row ?? 0 },
      mode: 'columns',
    }));
  }, []);

  const selectAll = useCallback(() => {
    if (empty) return;
    setState({
      anchor: { column: 0, row: 0 },
      focus: { column: columnCount - 1, row: rowCount - 1 },
      mode: 'cells',
    });
  }, [columnCount, empty, rowCount]);

  const move = useCallback(
    (to: TableCell, extend: boolean) => {
      if (empty) return;
      const target = clampCell(to, rowCount, columnCount);
      // Extending keeps what was selected: whole rows stay whole rows and
      // whole columns whole columns, as spreadsheets extend them.
      setState((current) =>
        extend && current
          ? { anchor: current.anchor, focus: target, mode: current.mode }
          : { anchor: target, focus: target, mode: 'cells' },
      );
    },
    [columnCount, empty, rowCount],
  );

  const clear = useCallback(() => setState(null), []);

  return { active, clear, move, pressCell, pressColumn, pressRow, range, selectAll };
}
