import { useRef, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import type { UploadPort } from '@/features/workspace/application/ports';
import type { WorkspaceRuntime } from '@/features/workspace/application/runtime';
import { useFileImport } from '@/features/workspace/hooks/use-file-import';
import { FailureLine, FailureNotice } from '@/shared/ui/failure-notice';

/** What the import offers the tree: the file picker, a drop of desktop files
 *  into one of the project's folders, and what the last of them refused. */
export interface FileImportAction {
  disabled: boolean;
  drop(dataTransfer: DataTransfer, parentPath: string): void;
  /** Said by the tree beside its own refusals, so every failure in Files
   *  reads in one place; nothing when the last import refused nothing. */
  refusals?: ReactNode;
  run(): void;
}

/** Desktop files dropped on the Files column copy into the project, into the
 *  folder the tree resolves under the pointer. Chat owns its separate drops. */
export function FileImport({
  api,
  children,
  runtime,
}: {
  api: UploadPort;
  children: (importAction: FileImportAction) => ReactNode;
  runtime: WorkspaceRuntime;
}) {
  const [folderDropped, setFolderDropped] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const state = useFileImport(runtime, api);
  const drop = (dataTransfer: DataTransfer, parentPath: string) => {
    const hasFolder = Array.from(dataTransfer.items).some(
      (item) => item.webkitGetAsEntry()?.isDirectory,
    );
    setFolderDropped(hasFolder);
    if (!hasFolder) void state.importFiles(Array.from(dataTransfer.files), parentPath);
  };
  // A refusal of what the reader dropped or chose is said as one, in the
  // input tone, rather than as a caption under the import's progress.
  const refusals = (folderDropped || state.failure || state.refused.length > 0) && (
    <>
      {folderDropped && (
        <FailureLine className="px-2 pt-2" tone="input">
          Choose files to import. To use a whole folder, open it as a project.
        </FailureLine>
      )}
      {state.failure && <FailureNotice className="px-2 pt-2" failure={state.failure} />}
      {state.refused.length > 0 && (
        <>
          <FailureLine className="px-2 pt-2" tone="input">
            Could not import: {state.refused.map((file) => file.name).join(', ')}
          </FailureLine>
          <Button
            className="mt-2 ml-2"
            disabled={state.pending}
            onClick={() => void state.retryRefused()}
            size="compact"
            variant="tertiary"
          >
            Retry
          </Button>
        </>
      )}
    </>
  );
  return (
    <div role="group" aria-label="Import project files">
      <div className="px-2">
        <input
          aria-label="Choose files to import"
          hidden
          multiple
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []);
            event.currentTarget.value = '';
            setFolderDropped(false);
            void state.importFiles(files);
          }}
          ref={input}
          type="file"
        />
        <div aria-live="polite" className="text-caption text-muted-foreground">
          {state.pending && <p>Importing…</p>}
          {state.imported > 0 && (
            <p>
              {state.imported} {state.imported === 1 ? 'file' : 'files'} imported.
            </p>
          )}
        </div>
      </div>
      {children({
        disabled: state.pending,
        drop,
        refusals,
        run: () => input.current?.click(),
      })}
    </div>
  );
}
