/**
 * A save that met newer text on disk, shown as both versions side by side.
 * The reader picks the disk version, keeps their own, or merges; merging is
 * the one solid action and comes last, the order the explanation reads in.
 */
import { AlertTriangle } from 'lucide-react';
import { useMemo } from 'react';

import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { computeConflictDiff } from '@/features/documents/domain/conflict-diff';
import type {
  DocumentConflictResolution,
  DocumentConflictState,
} from '@/features/documents/domain/document';
import { cn } from '@/lib/utils';
import { FailureLine } from '@/shared/ui/failure-notice';

export interface DocumentConflictProps {
  conflict: DocumentConflictState;
  name: string;
  resolve: (resolution: DocumentConflictResolution) => Promise<boolean>;
}

export function DocumentConflict({ conflict, name, resolve }: DocumentConflictProps) {
  const rows = useMemo(
    () => computeConflictDiff(conflict.editorContent, conflict.diskContent),
    [conflict],
  );
  const resolving = conflict.resolving;

  return (
    <section
      aria-busy={resolving !== null}
      aria-labelledby="document-conflict-title"
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <AlertTriangle
            aria-hidden="true"
            className="size-4 shrink-0 text-destructive"
            strokeWidth={1.5}
          />
          <div className="min-w-0">
            <h2 className="truncate text-body font-medium" id="document-conflict-title">
              {name} changed on disk
            </h2>
            <p className="text-caption text-muted-foreground">
              Use disk version discards your changes. Keep my version replaces the disk version
              shown. Merge lets you review both before saving.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            disabled={resolving !== null}
            loading={resolving === 'reload'}
            onClick={() => void resolve('reload')}
            size="compact"
            variant="tertiary"
          >
            Use disk version
          </Button>
          <Button
            className="text-destructive"
            disabled={resolving !== null}
            loading={resolving === 'overwrite'}
            onClick={() => void resolve('overwrite')}
            size="compact"
            variant="tertiary"
          >
            Keep my version
          </Button>
          {/* Merge is the answer that loses nothing, so it is the one solid
              action and comes last, in the order the sentence above names. */}
          <Button
            disabled={resolving !== null}
            loading={resolving === 'merge'}
            onClick={() => void resolve('merge')}
            size="compact"
          >
            Merge
          </Button>
        </div>
      </div>
      {conflict.resolutionMessage && (
        <FailureLine className="border-b border-border px-4 py-2" tone="input">
          {conflict.resolutionMessage}
        </FailureLine>
      )}
      <ScrollArea className="min-h-0 flex-1" orientation="both">
        <table className="w-full min-w-[48rem] table-fixed border-collapse font-mono text-caption">
          <caption className="sr-only">
            Newer disk version and unsaved editor version compared line by line
          </caption>
          <thead className="sticky top-0 z-10 bg-surface-2 text-left font-sans text-muted-foreground">
            <tr className="border-b border-border">
              <th className="w-10 px-2 py-2 text-right font-normal" scope="col">
                <span className="sr-only">Disk line</span>
              </th>
              <th className="w-[calc(50%-2.5rem)] px-3 py-2 font-medium" scope="col">
                On disk
              </th>
              <th
                className="w-10 border-l border-border px-2 py-2 text-right font-normal"
                scope="col"
              >
                <span className="sr-only">Editor line</span>
              </th>
              <th className="w-[calc(50%-2.5rem)] px-3 py-2 font-medium" scope="col">
                Your changes
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const diskChanged = row.type === 'insert' || row.type === 'modify';
              const editorChanged = row.type === 'delete' || row.type === 'modify';
              return (
                <tr
                  className="border-b border-border align-top"
                  key={`${row.diskLineNumber ?? 'none'}:${row.editorLineNumber ?? 'none'}:${row.type}`}
                >
                  <td className="bg-surface-2/40 px-2 py-0.5 text-right text-muted-foreground select-none">
                    {row.diskLineNumber ?? ''}
                  </td>
                  <td
                    className={cn(
                      'px-3 py-0.5 break-all whitespace-pre-wrap',
                      diskChanged && 'bg-destructive/8',
                    )}
                  >
                    {row.diskText ?? ''}
                  </td>
                  <td className="border-l border-border bg-surface-2/40 px-2 py-0.5 text-right text-muted-foreground select-none">
                    {row.editorLineNumber ?? ''}
                  </td>
                  <td
                    className={cn(
                      'px-3 py-0.5 break-all whitespace-pre-wrap',
                      editorChanged && 'bg-accent/40',
                    )}
                  >
                    {row.editorText ?? ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollArea>
    </section>
  );
}
