/**
 * A read-only table drawn a window at a time. Column letters stay on top and
 * row numbers on the left while the reader scrolls either way; only the cells
 * in view are rendered, so a table of millions of rows scrolls as freely as a
 * short one. A CSV's first row is its header and stays pinned under the
 * letters. The reader selects cells, rows, or columns with the pointer or the
 * keyboard, copies them, and can hand them to the Agent.
 */
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import {
  columnLabel,
  looksNumeric,
  rangeContains,
  type TableOrigin,
  type TableRange,
} from '@/features/documents/domain/table';
import { cn } from '@/lib/utils';

import { ROW_HEIGHT, rowHeaderWidth, scrollToCell, verticalScale, visibleWindow } from './geometry';
import { TableFooter } from './table-footer';
import { useColumnWidths } from './use-column-widths';
import { useGridSelection } from './use-grid-selection';
import { useTableActions, type TableRows } from './use-table-actions';

export interface DataGridProps {
  columnCount: number;
  /** The selection as the Agent should read it. */
  describe(range: TableRange, rows: TableRows): string;
  formula?: ((row: number, column: number) => string | undefined) | undefined;
  /** The first row names the columns and stays in view. */
  header?: boolean | undefined;
  label: string;
  onAskAgent?: ((text: string) => void) | undefined;
  onVisibleRows?: ((first: number, last: number) => void) | undefined;
  origin: TableOrigin;
  readRows(top: number, bottom: number, signal: AbortSignal): Promise<TableRows>;
  /** A row's values, or undefined while its page is loading. */
  row(index: number): readonly string[] | undefined;
  rowCount: number;
  /** Rows the column widths are measured from. */
  sample: TableRows;
  /** What the footer says while nothing is selected. */
  status: ReactNode;
}

const headerCell =
  'absolute top-0 flex h-full items-center border-r border-b border-border bg-surface-2 px-2 text-muted-foreground';

export function DataGrid(props: DataGridProps) {
  const { columnCount, header = false, origin, row, rowCount } = props;
  const id = useId();
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef<'cells' | 'columns' | 'rows' | null>(null);
  const [scroll, setScroll] = useState({ left: 0, top: 0 });
  const [viewport, setViewport] = useState({ height: 600, width: 900 });
  const selection = useGridSelection(rowCount, columnCount);
  const actions = useTableActions({
    describe: props.describe,
    onAskAgent: props.onAskAgent,
    range: selection.range,
    readRows: props.readRows,
  });

  const bodyStart = header && rowCount > 0 ? 1 : 0;
  const headerHeight = ROW_HEIGHT * (bodyStart + 1);
  const rowsWidth = rowHeaderWidth(origin.firstRow + rowCount);
  const scale = verticalScale(rowCount - bodyStart, viewport.height - headerHeight);
  // Where the rows stand; past the layout ceiling it differs from the
  // scroll position, and every row is drawn by this offset.
  const rowsTop = scale.toRows(scroll.top);
  const frame = {
    bodyStart,
    headerHeight,
    rowCount,
    rowHeaderWidth: rowsWidth,
    scrollLeft: scroll.left,
    scrollTop: rowsTop,
    viewportHeight: viewport.height,
    viewportWidth: viewport.width,
  };
  const { layout, view } = useColumnWidths(columnCount, props.sample, row, (columnLayout) =>
    visibleWindow({ ...frame, columnLayout }),
  );
  const geometry = { ...frame, columnLayout: layout };
  const totalWidth = rowsWidth + (layout.offsets[columnCount] ?? 0);
  const totalHeight = headerHeight + scale.height;
  const { onVisibleRows } = props;

  useEffect(() => {
    if (view.rows.last >= view.rows.first) onVisibleRows?.(view.rows.first, view.rows.last);
  }, [onVisibleRows, view.rows.first, view.rows.last]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const measure = () =>
      setViewport({ height: scroller.clientHeight || 600, width: scroller.clientWidth || 900 });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  const reveal = (target: { column: number; row: number }) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const next = scrollToCell({ ...geometry, column: target.column, row: target.row });
    scroller.scrollTop = scale.toScroll(next.top);
    scroller.scrollLeft = next.left;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const command = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (command && key === 'a') {
      event.preventDefault();
      selection.selectAll();
      return;
    }
    if (event.key === 'Escape') {
      selection.clear();
      return;
    }
    const from = selection.active ?? { column: 0, row: bodyStart };
    const page = Math.max(1, Math.floor((viewport.height - headerHeight) / ROW_HEIGHT) - 1);
    const moves: Record<string, () => { column: number; row: number }> = {
      ArrowDown: () => ({ ...from, row: from.row + 1 }),
      ArrowLeft: () => ({ ...from, column: from.column - 1 }),
      ArrowRight: () => ({ ...from, column: from.column + 1 }),
      ArrowUp: () => ({ ...from, row: from.row - 1 }),
      End: () =>
        command
          ? { column: columnCount - 1, row: rowCount - 1 }
          : { ...from, column: columnCount - 1 },
      Home: () => (command ? { column: 0, row: 0 } : { ...from, column: 0 }),
      PageDown: () => ({ ...from, row: from.row + page }),
      PageUp: () => ({ ...from, row: from.row - page }),
    };
    const destination = moves[event.key];
    if (!destination) return;
    event.preventDefault();
    const target = destination();
    const clamped = {
      column: Math.max(0, Math.min(target.column, columnCount - 1)),
      row: Math.max(0, Math.min(target.row, rowCount - 1)),
    };
    selection.move(clamped, event.shiftKey);
    reveal(clamped);
  };

  const range = selection.range;
  const active = selection.active;

  // Copy arrives as the clipboard event, which the app menu's Copy and the
  // browser's own shortcut both raise on the focused grid. Loaded rows go on
  // the clipboard at once; rows still on disk are read and written after.
  const onCopy = (event: ClipboardEvent<HTMLDivElement>) => {
    if (!range) return;
    event.preventDefault();
    const rows: (readonly string[])[] = [];
    for (let index = range.top; index <= range.bottom; index += 1) {
      const values = row(index);
      if (!values) {
        void actions.copy();
        return;
      }
      rows.push(values);
    }
    const text = actions.copyLoaded(rows);
    if (text === null) void actions.copy();
    else event.clipboardData.setData('text/plain', text);
  };
  const columns: number[] = [];
  for (let column = view.columns.first; column <= view.columns.last; column += 1)
    columns.push(column);
  const bodyRows: number[] = [];
  for (let index = view.rows.first; index <= view.rows.last; index += 1) bodyRows.push(index);
  const cellId = (index: number, column: number) => `${id}-r${index}-c${column}`;
  const activeRendered =
    active &&
    (active.row < bodyStart || (active.row >= view.rows.first && active.row <= view.rows.last)) &&
    active.column >= view.columns.first &&
    active.column <= view.columns.last;
  const columnSelected = (column: number) =>
    !!range && column >= range.left && column <= range.right;
  const rowSelected = (index: number) => !!range && index >= range.top && index <= range.bottom;

  const renderCells = (index: number, values: readonly string[] | undefined, pinned: boolean) =>
    columns.map((column) => {
      const value = values?.[column] ?? '';
      const selected = !!range && rangeContains(range, { column, row: index });
      const isActive = !!active && active.row === index && active.column === column;
      const formula = props.formula?.(index, column);
      return (
        <div
          aria-colindex={column + 2}
          aria-selected={selected}
          className={cn(
            'absolute top-0 h-full truncate border-r border-b border-border px-2',
            pinned && 'bg-surface-2 font-medium',
            !pinned && looksNumeric(value) && 'text-right tabular-nums',
            selected && 'bg-[var(--selected)]',
            isActive &&
              'outline-[1.5px] -outline-offset-[1.5px] outline-foreground/70 outline-solid group-focus-visible/grid:outline-[var(--focus-ring)]',
          )}
          id={cellId(index, column)}
          key={column}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            draggingRef.current = 'cells';
            selection.pressCell({ column, row: index }, event.shiftKey);
          }}
          onPointerEnter={(event) => {
            if (draggingRef.current === 'cells' && event.buttons === 1) {
              selection.pressCell({ column, row: index }, true);
            }
          }}
          role={pinned ? 'columnheader' : 'gridcell'}
          style={{
            left: rowsWidth + (layout.offsets[column] ?? 0),
            lineHeight: `${ROW_HEIGHT - 1}px`,
            width: layout.widths[column],
          }}
          title={formula ?? (value.length > 32 || value.includes('\n') ? value : undefined)}
        >
          {value}
        </div>
      );
    });

  const renderRowNumber = (index: number, pinned: boolean) => (
    <div
      aria-colindex={1}
      className={cn(
        'sticky left-0 z-10 flex h-full items-center justify-end border-r border-b border-border bg-surface-2 px-2 text-muted-foreground tabular-nums',
        rowSelected(index) && 'bg-hover text-foreground',
      )}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        draggingRef.current = 'rows';
        selection.pressRow(index, event.shiftKey);
      }}
      onPointerEnter={(event) => {
        if (draggingRef.current === 'rows' && event.buttons === 1) selection.pressRow(index, true);
      }}
      role="rowheader"
      style={{ width: rowsWidth }}
    >
      {origin.firstRow + index + 1}
      {pinned && <span className="sr-only">, header</span>}
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        aria-activedescendant={
          activeRendered && active ? cellId(active.row, active.column) : undefined
        }
        aria-colcount={columnCount + 1}
        aria-label={props.label}
        aria-multiselectable="true"
        aria-readonly="true"
        aria-rowcount={rowCount + 1}
        className="group/grid relative min-h-0 flex-1 overflow-auto bg-background text-caption outline-none select-none"
        onCopy={onCopy}
        onKeyDown={onKeyDown}
        // A drag extends only while the button is held (each enter checks
        // `buttons`); releasing over the grid also ends it here.
        onPointerUp={() => {
          draggingRef.current = null;
        }}
        onScroll={(event) => {
          const target = event.currentTarget;
          setScroll({ left: target.scrollLeft, top: target.scrollTop });
        }}
        ref={scrollerRef}
        role="grid"
        tabIndex={0}
      >
        <div className="relative" style={{ height: totalHeight, width: totalWidth }}>
          <div
            className="sticky top-0 z-20"
            role="rowgroup"
            style={{ height: headerHeight, width: totalWidth }}
          >
            <div aria-rowindex={1} className="relative" role="row" style={{ height: ROW_HEIGHT }}>
              <div
                aria-colindex={1}
                className="sticky left-0 z-10 h-full border-r border-b border-border bg-surface-2"
                onPointerDown={(event) => {
                  if (event.button === 0) selection.selectAll();
                }}
                role="columnheader"
                style={{ width: rowsWidth }}
              >
                <span className="sr-only">Row</span>
              </div>
              {columns.map((column) => (
                <div
                  aria-colindex={column + 2}
                  className={cn(
                    headerCell,
                    'justify-center',
                    columnSelected(column) && 'bg-hover text-foreground',
                  )}
                  key={column}
                  onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    draggingRef.current = 'columns';
                    selection.pressColumn(column, event.shiftKey);
                  }}
                  onPointerEnter={(event) => {
                    if (draggingRef.current === 'columns' && event.buttons === 1) {
                      selection.pressColumn(column, true);
                    }
                  }}
                  role="columnheader"
                  style={{
                    left: rowsWidth + (layout.offsets[column] ?? 0),
                    width: layout.widths[column],
                  }}
                >
                  {columnLabel(origin.firstColumn + column)}
                </div>
              ))}
            </div>
            {bodyStart === 1 && (
              <div aria-rowindex={2} className="relative" role="row" style={{ height: ROW_HEIGHT }}>
                {renderRowNumber(0, true)}
                {renderCells(0, row(0), true)}
              </div>
            )}
          </div>
          <div role="rowgroup">
            {bodyRows.map((index) => {
              const values = row(index);
              return (
                <div
                  aria-busy={values === undefined || undefined}
                  aria-rowindex={index + 2}
                  className="absolute left-0"
                  key={index}
                  role="row"
                  style={{
                    height: ROW_HEIGHT,
                    top: headerHeight + (index - bodyStart) * ROW_HEIGHT - rowsTop + scroll.top,
                    width: totalWidth,
                  }}
                >
                  {renderRowNumber(index, false)}
                  {renderCells(index, values, false)}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <TableFooter
        actions={actions}
        canAsk={!!props.onAskAgent}
        origin={origin}
        range={range}
        status={props.status}
      />
    </div>
  );
}
