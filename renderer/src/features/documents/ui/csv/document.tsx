/**
 * A CSV or TSV file, shown as a table or as its source text. The table reads
 * the saved file in pages; the source edits it as plain text through the same
 * versioned save and conflict handling every text document uses. Switching to
 * the table saves the source first, so the table shows what was typed.
 */
import { FileCode2, Sheet } from 'lucide-react';
import type { ReactNode } from 'react';
import { useStore } from 'zustand';

import { TabsSubtle, TabsSubtleItem } from '@/components/ui/tabs-subtle';
import type { DocumentRuntime } from '@/features/documents/application/document-runtime';
import { DOCUMENT_SOURCE_MESSAGES } from '@/features/documents/application/failure-messages';
import type { DocumentNavigationRuntime } from '@/features/documents/application/navigation-runtime';
import type {
  DelimitedTablePort,
  DocumentSourcePort,
} from '@/features/documents/application/ports';
import { isDocumentDirty } from '@/features/documents/domain/document';
import type { DocumentSelection } from '@/features/documents/domain/selection';
import {
  counted,
  DELIMITER_NAMES,
  tableSelectionText,
  type DelimitedTablePage,
} from '@/features/documents/domain/table';
import { useDelimitedTable } from '@/features/documents/hooks/use-delimited-table';
import { RefreshFailedBanner } from '@/features/documents/ui/banner';
import { FilePlaceholder } from '@/features/documents/ui/file-placeholder';
import { PlainTextSource } from '@/features/documents/ui/source/plain-text-source';
import { documentStatusRenderer } from '@/features/documents/ui/source/status';
import type { DocumentViewerStatus } from '@/features/documents/ui/source/viewer';
import { DataGrid } from '@/features/documents/ui/table/data-grid';

import { tableUnavailableCopy } from './presentation';

const ORIGIN = { firstColumn: 0, firstRow: 0 };

/** The source view loads text, so it reports text failures in their words. */
const sourceStatus = documentStatusRenderer<'unsupported-encoding' | 'missing'>(
  'DocumentSourceError',
  DOCUMENT_SOURCE_MESSAGES,
);

export interface CsvDocumentProps {
  active: boolean;
  name: string;
  navigation: DocumentNavigationRuntime;
  onAskAgent?: ((selection: DocumentSelection) => void) | undefined;
  runtime: DocumentRuntime;
  sourceApi: DocumentSourcePort;
  status(status: DocumentViewerStatus): ReactNode;
  tableApi: DelimitedTablePort;
}

export function CsvDocument({
  active,
  name,
  navigation,
  onAskAgent,
  runtime,
  sourceApi,
  status,
  tableApi,
}: CsvDocumentProps) {
  const mode = useStore(runtime.store, (state) => state.tableMode);
  const dirty = useStore(runtime.store, (state) => !!state.editor && isDocumentDirty(state.editor));
  const conflict = useStore(runtime.store, (state) => state.editor?.save.kind === 'conflict');
  const table = useDelimitedTable(tableApi, runtime, active && mode === 'table');
  const { head } = table;

  if (head.isPending) return <>{status({ name })}</>;
  if (!head.data) {
    return <>{status({ error: head.error, name, retry: () => void head.refetch() })}</>;
  }
  const page = head.data;
  if (page.kind !== 'table') {
    return (
      <FilePlaceholder role="status" {...tableUnavailableCopy(page)}>
        <p className="mt-3 font-mono text-caption break-all text-muted-foreground">{page.name}</p>
      </FilePlaceholder>
    );
  }
  // A file past the text ceiling still opens as a table, but only as one.
  const shown = page.editable ? mode : 'table';

  const choose = (next: 'source' | 'table') => {
    if (next === 'table') void runtime.save(sourceApi);
    runtime.setTableMode(next);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface-2" data-table-mode={shown}>
      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-border pr-[5px] pl-4">
        <p className="min-w-0 flex-1 truncate text-caption text-muted-foreground">
          {DELIMITER_NAMES[page.delimiter]}
          {!page.editable && ' · Too large to edit as text'}
        </p>
        <TabsSubtle
          aria-label="CSV view"
          iconOnly
          onSelect={(index) => choose(index === 0 ? 'table' : 'source')}
          selectedIndex={shown === 'table' ? 0 : 1}
          size="compact"
          track
        >
          <TabsSubtleItem icon={Sheet} label="Table" title="Table" />
          <TabsSubtleItem
            disabled={!page.editable}
            icon={FileCode2}
            label="Source"
            title="Source"
          />
        </TabsSubtle>
      </div>
      {head.isError && <RefreshFailedBanner onRetry={() => void head.refetch()} />}
      {shown === 'table' ? (
        <DataGrid
          columnCount={page.columnCount}
          describe={(range, rows) =>
            tableSelectionText({ header: table.row(0), origin: ORIGIN, range, rows })
          }
          header
          label={name}
          onAskAgent={
            onAskAgent && ((text) => onAskAgent({ markdown: text, source: runtime.scope.source }))
          }
          onVisibleRows={table.onVisibleRows}
          origin={ORIGIN}
          readRows={table.readRows}
          row={table.row}
          rowCount={page.rowCount}
          sample={page.rows}
          status={tableStatus(page, dirty, conflict)}
        />
      ) : (
        <PlainTextSource
          active={active}
          name={name}
          navigation={navigation}
          runtime={runtime}
          sourceApi={sourceApi}
          status={sourceStatus}
        />
      )}
    </div>
  );
}

function tableStatus(
  page: Extract<DelimitedTablePage, { kind: 'table' }>,
  dirty: boolean,
  conflict: boolean,
): string {
  const parts = [`${counted(page.rowCount, 'row')} × ${counted(page.totalColumns, 'column')}`];
  if (page.totalColumns > page.columnCount) {
    parts.push(`Showing the first ${counted(page.columnCount, 'column')}`);
  }
  // The table reads the file; an edit still saving shows once it lands, and
  // one that met a newer file waits in Source for the reader's decision.
  if (conflict) parts.push('Your edits conflict with the file; open Source to compare');
  else if (dirty) parts.push('Showing the last saved version');
  return parts.join(' · ');
}
