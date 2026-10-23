/** Copy and Ask agent for a table selection. Both read the selected rows,
 *  which for a large CSV may not be loaded yet, so both are asynchronous and
 *  both refuse a selection too large to finish rather than cutting it short. */
import { useEffect, useState } from 'react';

import { TABLE_ACTION_MESSAGES } from '@/features/documents/application/failure-messages';
import {
  counted,
  rangeColumns,
  rangeRows,
  SELECTION_TOO_LARGE,
  selectionFitsPassage,
  selectionMayFitPassage,
  TABLE_COPY_CELL_LIMIT,
  tableTsv,
  type TableRange,
} from '@/features/documents/domain/table';
import { useRequestSignals } from '@/shared/runtime/use-request-signals';
import { writeToClipboard } from '@/shared/ui/clipboard';

export type TableRows = readonly (readonly string[])[];

export interface TableActionsOptions {
  /** The selection as the Agent should read it. */
  describe(range: TableRange, rows: TableRows): string;
  onAskAgent?: ((text: string) => void) | undefined;
  range: TableRange | null;
  /** Rows `top`…`bottom`, inclusive, read wherever they are. */
  readRows(top: number, bottom: number, signal: AbortSignal): Promise<TableRows>;
}

interface TableNotice {
  text: string;
  tone: 'done' | 'refused';
}

export interface TableActions {
  ask(): Promise<void>;
  copy(): Promise<void>;
  /** The selection as tab-separated text, when its rows are already loaded
   *  and within the copy limit; a clipboard event takes it synchronously. */
  copyLoaded(rows: TableRows): string | null;
  notice: TableNotice | null;
  pending: 'ask' | 'copy' | null;
}

function block(range: TableRange, rows: TableRows): string[][] {
  return rows.map((row) =>
    Array.from({ length: rangeColumns(range) }, (_, offset) => row[range.left + offset] ?? ''),
  );
}

export function useTableActions({
  describe,
  onAskAgent,
  range,
  readRows,
}: TableActionsOptions): TableActions {
  const signalFor = useRequestSignals<'ask' | 'copy'>();
  const [pending, setPending] = useState<'ask' | 'copy' | null>(null);
  const [notice, setNotice] = useState<TableNotice | null>(null);
  const rangeKey = range ? `${range.top}:${range.left}:${range.bottom}:${range.right}` : '';

  // A notice answers one selection; choosing another retires it.
  useEffect(() => {
    setNotice(null);
  }, [rangeKey]);

  const run = async (lane: 'ask' | 'copy', work: (signal: AbortSignal) => Promise<void>) => {
    const signal = signalFor(lane);
    setPending(lane);
    try {
      await work(signal);
    } catch {
      if (!signal.aborted) setNotice({ text: TABLE_ACTION_MESSAGES.read, tone: 'refused' });
    } finally {
      if (!signal.aborted) setPending(null);
    }
  };

  const copy = async () => {
    if (!range) return;
    if (rangeRows(range) * rangeColumns(range) > TABLE_COPY_CELL_LIMIT) {
      setNotice({ text: TABLE_ACTION_MESSAGES.tooManyToCopy, tone: 'refused' });
      return;
    }
    await run('copy', async (signal) => {
      const rows = await readRows(range.top, range.bottom, signal);
      if (signal.aborted) return;
      try {
        await writeToClipboard(tableTsv(block(range, rows)));
      } catch {
        setNotice({ text: TABLE_ACTION_MESSAGES.clipboard, tone: 'refused' });
        return;
      }
      setNotice({
        text: `Copied ${counted(rangeRows(range) * rangeColumns(range), 'cell')}`,
        tone: 'done',
      });
    });
  };

  const copyLoaded = (rows: TableRows) => {
    if (!range || rangeRows(range) * rangeColumns(range) > TABLE_COPY_CELL_LIMIT) return null;
    setNotice({
      text: `Copied ${counted(rangeRows(range) * rangeColumns(range), 'cell')}`,
      tone: 'done',
    });
    return tableTsv(block(range, rows));
  };

  const ask = async () => {
    if (!range || !onAskAgent) return;
    if (!selectionMayFitPassage(range)) {
      setNotice({ text: SELECTION_TOO_LARGE, tone: 'refused' });
      return;
    }
    await run('ask', async (signal) => {
      const rows = await readRows(range.top, range.bottom, signal);
      if (signal.aborted) return;
      const text = describe(range, block(range, rows));
      if (!selectionFitsPassage(text)) {
        setNotice({ text: SELECTION_TOO_LARGE, tone: 'refused' });
        return;
      }
      onAskAgent(text);
    });
  };

  return { ask, copy, copyLoaded, notice, pending };
}
