/**
 * The preparation status row a document viewer drops in.
 *
 * This binder exists so a viewer never holds preparation's own hook: it takes
 * the polled folder status and one source, and hands `PreparationStatusLine`
 * — a pure view the tests and Storybook drive directly — the projection and
 * the two commands. Splitting the two is what keeps the row renderable
 * without a query client.
 */
import type { PreparationControlPort } from '@/features/preparation/application/ports';
import { sourceReadiness, type PreparedFormat } from '@/features/preparation/domain/readiness';
import { usePreparationActions } from '@/features/preparation/hooks/use-preparation-actions';
import type { FolderIndexStatus } from '@/shared/domain/folder-index-status';
import type { SourceReference } from '@/shared/domain/source-reference';

import { PreparationStatusLine } from './status-line';

export interface SourcePreparationStatusProps {
  controlApi: PreparationControlPort;
  format: PreparedFormat;
  source: SourceReference;
  status: FolderIndexStatus | null;
}

/** Drop-in viewer row: projects the polled folder status onto one source and
 *  wires its reprocess and cancel controls. */
export function SourcePreparationStatus({
  controlApi,
  format,
  source,
  status,
}: SourcePreparationStatusProps) {
  const actions = usePreparationActions(controlApi, source);
  return (
    <PreparationStatusLine
      error={actions.error}
      format={format}
      onCancel={actions.cancel}
      onReprocess={() => void actions.reprocess()}
      pending={actions.pending}
      // The status names paths in its own folder only; a source from another
      // folder must not borrow the state of a same-named file here.
      readiness={sourceReadiness(
        status?.folderPath === source.folderPath ? status : null,
        source.path,
      )}
    />
  );
}
