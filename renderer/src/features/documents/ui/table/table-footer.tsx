import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
  counted,
  rangeColumns,
  rangeLabel,
  rangeRows,
  type TableOrigin,
  type TableRange,
} from '@/features/documents/domain/table';

import type { TableActions } from './use-table-actions';

/** The line under a table: what it is, or what is selected and what can be
 *  done with it. A refusal replaces the selection's summary until the reader
 *  chooses another. */
export function TableFooter({
  actions,
  canAsk,
  origin,
  range,
  status,
}: {
  actions: TableActions;
  canAsk: boolean;
  origin: TableOrigin;
  range: TableRange | null;
  status: ReactNode;
}) {
  const summary = range
    ? `${rangeLabel(range, origin)} · ${counted(rangeRows(range), 'row')} × ${counted(rangeColumns(range), 'column')}`
    : status;

  return (
    <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-4 py-1.5">
      <p
        className={
          actions.notice?.tone === 'refused'
            ? 'min-w-0 flex-1 text-caption text-foreground'
            : 'min-w-0 flex-1 truncate text-caption text-muted-foreground'
        }
        role="status"
      >
        {actions.notice?.text ?? summary}
      </p>
      {range && (
        <div className="flex shrink-0 items-center gap-2">
          <Button
            loading={actions.pending === 'copy'}
            onClick={() => void actions.copy()}
            size="compact"
            variant="tertiary"
          >
            Copy
          </Button>
          {canAsk && (
            <Button
              loading={actions.pending === 'ask'}
              onClick={() => void actions.ask()}
              size="compact"
              variant="tertiary"
            >
              Ask agent
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
