import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { fileImportFailure } from '@/features/workspace/application/failure-messages';
import type { UploadPort } from '@/features/workspace/application/ports';
import { refreshFolderListing } from '@/features/workspace/application/queries';
import type { WorkspaceRuntime } from '@/features/workspace/application/runtime';
import type { FailureView } from '@/shared/domain/feature-error';

/** The project lifetime owns an accepted import, including across mode changes. */
export function useFileImport(runtime: WorkspaceRuntime, api: UploadPort) {
  const client = useQueryClient();
  const running = useRef(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<FailureView | null>(null);
  const [refused, setRefused] = useState<readonly File[]>([]);
  /** The folder the refused files were headed for, so a retry lands them there. */
  const [refusedParentPath, setRefusedParentPath] = useState('');
  const [imported, setImported] = useState(0);

  /** Copies files into `parentPath`, a folder of the project; the root when empty. */
  const importFiles = async (files: readonly File[], parentPath = '') => {
    if (running.current || files.length === 0 || runtime.signal.aborted) return;
    running.current = true;
    const captured = runtime.capture();
    setPending(true);
    setFailure(null);
    setRefused([]);
    setImported(0);
    try {
      const result = await api.upload(
        runtime.scope.folder.path,
        files.map((file) => ({ blob: file, name: file.name })),
        runtime.signal,
        parentPath,
      );
      runtime.accept(captured, () => {
        setImported(result.paths.length);
        setRefused(files.filter((_file, index) => result.refused.includes(index)));
        setRefusedParentPath(parentPath);
      });
    } catch (error) {
      runtime.accept(captured, () => setFailure(fileImportFailure(error)));
    } finally {
      running.current = false;
      setPending(false);
      if (runtime.accept(captured, () => undefined)) {
        // Also refresh after unknown outcomes: some files may already exist.
        await refreshFolderListing(client, runtime.scope.folder.path);
      }
    }
  };

  const retryRefused = () => importFiles(refused, refusedParentPath);

  return { failure, imported, importFiles, pending, refused, retryRefused };
}
