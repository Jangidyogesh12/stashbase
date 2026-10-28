/**
 * Create, rename, move, and delete for the active folder's tree.
 *
 * Every mutation captures the workspace scope before its first await and
 * settles through that token: a create that lands after the window moved to
 * another folder updates nothing, refetches nothing, and asks for no focus.
 *
 * One mutation runs at a time; a retry checks an unresolved operation before
 * changing files again. Scope retirement refuses late UI completions.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';

import { filesFailure, moveFailure } from '@/features/workspace/application/failure-messages';
import type { FilesPort } from '@/features/workspace/application/ports';
import { refreshFolderListing } from '@/features/workspace/application/queries';
import type {
  WorkspaceOperationScope,
  WorkspaceRuntime,
} from '@/features/workspace/application/runtime';
import {
  entryNameProblem,
  parentTreePath,
  type WorkspaceEntry,
} from '@/features/workspace/domain/tree';
import {
  expandTreeFolder,
  forgetTreePath,
  moveTreePath,
  renameTreePath,
  selectTreePath,
  type WorkspaceState,
} from '@/features/workspace/domain/workspace';
import type { FailureView } from '@/shared/domain/feature-error';
import type { SourceReference } from '@/shared/domain/source-reference';
import { basePathName } from '@/shared/utils/file-path';

/** The one naming task the tree can hold open: a new entry waiting for its
 *  name under a parent, or an existing entry taking a new one. */
export type FileTreeNaming =
  | { kind: 'create'; entryKind: WorkspaceEntry['kind']; parentPath: string }
  | { entry: WorkspaceEntry; kind: 'rename' };

/** How the tree asks for a source to open: a created entry, and one reopened
 *  after its rename was refused, ask for a tab that stays. */
export interface TreeOpenOptions {
  keep?: boolean;
}

export interface FileOperationsOptions {
  onOpenSource?: ((source: SourceReference, options?: TreeOpenOptions) => void) | undefined;
  /** Coordinates saves and retains tabs until the mutation is confirmed. */
  mutateSources?:
    | ((entry: WorkspaceEntry, operation: () => Promise<string | null>) => Promise<boolean>)
    | undefined;
}

/** A document the reader has open refused to save, which is theirs to fix. */
const RETIRE_BLOCKED: FailureView = {
  message: 'An open document could not be saved, so nothing was changed.',
  tone: 'input',
};

/** Naming happens inline, deletion waits for confirmation, and every settled
 *  mutation moves expansion and selection with the entry before the listing
 *  refetches, so the tree never shows a stale open folder or a selection that
 *  left. */
export function useFileOperations(
  runtime: WorkspaceRuntime,
  api: FilesPort,
  options: FileOperationsOptions = {},
) {
  const queryClient = useQueryClient();
  const latest = useRef(options);
  latest.current = options;
  const [naming, setNaming] = useState<FileTreeNaming | null>(null);
  const [deleting, setDeleting] = useState<WorkspaceEntry | null>(null);
  const [failure, setFailure] = useState<FailureView | null>(null);
  const [pending, setPending] = useState(false);
  const running = useRef(false);
  /** The path whose row should take focus once the listing shows it. */
  const [settledPath, setSettledPath] = useState<string | null>(null);
  /** The path whose row should start a rename once the listing shows it: a
   *  draft the tree just made, whose name is the first thing to type. */
  const [renamePath, setRenamePath] = useState<string | null>(null);

  const folderPath = runtime.scope.folder.path;
  /** Applies a state change only while `capturedScope` is still the open one. */
  const update = useCallback(
    (
      captured: WorkspaceOperationScope,
      change: (state: WorkspaceState) => WorkspaceState,
    ): boolean => runtime.accept(captured, () => runtime.store.setState(change)),
    [runtime],
  );
  /** True while the scope an operation started in is still the open one. */
  const stillOpen = useCallback(
    (captured: WorkspaceOperationScope): boolean => runtime.accept(captured, () => undefined),
    [runtime],
  );
  const refresh = useCallback(
    () => refreshFolderListing(queryClient, folderPath),
    [folderPath, queryClient],
  );
  const openSource = useCallback(
    (path: string, how: TreeOpenOptions = { keep: true }) =>
      latest.current.onOpenSource?.({ folderPath, path }, how),
    [folderPath],
  );

  /** Runs one mutation, keeping a failure on screen and answering null. The
   *  sentence comes from the failure's kind; a throw that is not a files
   *  failure reads as the unavailable one. */
  const run = useCallback(
    async <Result>(
      operation: (signal: AbortSignal) => Promise<Result>,
      describe: (error: unknown) => FailureView = filesFailure,
    ): Promise<Result | null> => {
      if (running.current) return null;
      running.current = true;
      // Ordinary mode changes must not turn an accepted mutation into a lost response.
      const signal = runtime.signal;
      setPending(true);
      setFailure(null);
      try {
        return await operation(signal);
      } catch (error) {
        if (!signal.aborted) {
          setFailure(describe(error));
        }
        return null;
      } finally {
        running.current = false;
        if (!signal.aborted) setPending(false);
      }
    },
    [runtime.signal],
  );

  const mutate = useCallback(
    async (entry: WorkspaceEntry, operation: () => Promise<string | null>) => {
      const handler = latest.current.mutateSources;
      let result: { path: string | null } | null = null;
      const execute = async () => {
        const path = await operation();
        result = { path };
        return path;
      };
      if (handler) {
        if (!(await handler(entry, execute))) {
          setFailure(RETIRE_BLOCKED);
          return null;
        }
      } else await execute();
      return result as { path: string | null } | null;
    },
    [],
  );

  const cancelNaming = useCallback(() => {
    if (running.current) return;
    setNaming(null);
    setFailure(null);
  }, []);

  const beginCreate = useCallback(
    (entryKind: WorkspaceEntry['kind'], parentPath: string) => {
      if (running.current) return;
      if (parentPath) update(runtime.capture(), (state) => expandTreeFolder(state, parentPath));
      setFailure(null);
      setNaming({ entryKind, kind: 'create', parentPath });
    },
    [runtime, update],
  );

  /** Creates a draft under `parentPath` with the name the tree chose, opens
   *  it the moment it exists as a kept tab, and, once the refreshed listing
   *  shows its row, hands that row to a rename so the name is the first thing
   *  typed. */
  const createDraft = useCallback(
    async (parentPath: string, name: string): Promise<void> => {
      if (running.current) return;
      const capturedScope = runtime.capture();
      setNaming(null);
      const created = await run((signal) =>
        api.createEntry(folderPath, 'file', parentPath, name, signal),
      );
      if (!created || !stillOpen(capturedScope)) return;
      openSource(created.path, { keep: true });
      update(capturedScope, (state) =>
        selectTreePath(parentPath ? expandTreeFolder(state, parentPath) : state, created.path),
      );
      await refresh();
      if (!stillOpen(capturedScope)) return;
      setRenamePath(created.path);
    },
    [api, folderPath, openSource, refresh, run, runtime, stillOpen, update],
  );

  const createInteractiveNote = useCallback(
    async (parentPath: string): Promise<void> => {
      if (running.current) return;
      const captured = runtime.capture();
      setNaming(null);
      const created = await run((signal) =>
        api.createInteractiveNote(folderPath, parentPath, signal),
      );
      if (!created || !stillOpen(captured)) return;
      openSource(created.entryPath, { keep: true });
      update(captured, (state) =>
        selectTreePath(
          expandTreeFolder(parentPath ? expandTreeFolder(state, parentPath) : state, created.path),
          created.path,
        ),
      );
      await refresh();
      if (stillOpen(captured)) setRenamePath(created.path);
    },
    [api, folderPath, openSource, refresh, run, runtime, stillOpen, update],
  );

  const beginRename = useCallback((entry: WorkspaceEntry) => {
    if (running.current) return;
    setFailure(null);
    setNaming({ entry, kind: 'rename' });
  }, []);

  const commitNaming = useCallback(
    async (rawName: string): Promise<void> => {
      if (!naming || running.current) return;
      const name = rawName.trim();
      if (naming.kind === 'rename' && (name === '' || name === basePathName(naming.entry.path))) {
        cancelNaming();
        return;
      }
      const problem = entryNameProblem(name);
      if (problem) {
        // A name the reader typed is theirs to correct.
        setFailure({ message: problem, tone: 'input' });
        return;
      }
      const capturedScope = runtime.capture();
      if (naming.kind === 'create') {
        const created = await run((signal) =>
          api.createEntry(folderPath, naming.entryKind, naming.parentPath, name, signal),
        );
        if (!stillOpen(capturedScope)) return;
        if (!created) {
          setSettledPath(naming.parentPath || null);
          return;
        }
        setNaming(null);
        update(capturedScope, (state) => {
          const selected = selectTreePath(state, created.path);
          return naming.entryKind === 'folder'
            ? expandTreeFolder(selected, created.path)
            : selected;
        });
        await refresh();
        if (!stillOpen(capturedScope)) return;
        setSettledPath(created.path);
        if (naming.entryKind === 'file') openSource(created.path);
        return;
      }
      const { entry } = naming;
      const renamed = await run((signal) =>
        mutate(entry, async () => (await api.renameEntry(folderPath, entry, name, signal)).path),
      );
      if (!stillOpen(capturedScope) || !renamed?.path) return;
      const renamedPath = renamed.path;
      setNaming(null);
      update(capturedScope, (state) =>
        renameTreePath(state, entry.path, basePathName(renamedPath)),
      );
      await refresh();
      if (!stillOpen(capturedScope)) return;
      setSettledPath(renamed.path);
    },
    [
      api,
      cancelNaming,
      folderPath,
      naming,
      openSource,
      refresh,
      mutate,
      run,
      runtime,
      stillOpen,
      update,
    ],
  );

  /** Moves a file or folder under its own name into another folder of the
   *  project. The destination opens, so the row lands where the reader can
   *  see it, and a moved folder keeps its open branches. */
  const moveEntry = useCallback(
    async (entry: WorkspaceEntry, parentPath: string): Promise<void> => {
      if (running.current || parentTreePath(entry.path) === parentPath) return;
      const capturedScope = runtime.capture();
      const moved = await run(
        (signal) =>
          mutate(
            entry,
            async () => (await api.moveEntry(folderPath, entry, parentPath, signal)).path,
          ),
        (error) => moveFailure(error, entry.kind),
      );
      if (!stillOpen(capturedScope) || !moved?.path) return;
      const movedPath = moved.path;
      update(capturedScope, (state) => {
        const relocated = moveTreePath(state, entry.path, movedPath);
        return parentPath ? expandTreeFolder(relocated, parentPath) : relocated;
      });
      await refresh();
      if (!stillOpen(capturedScope)) return;
      setSettledPath(movedPath);
    },
    [api, folderPath, mutate, refresh, run, runtime, stillOpen, update],
  );

  const requestDelete = useCallback((entry: WorkspaceEntry) => {
    if (running.current) return;
    setFailure(null);
    setDeleting(entry);
  }, []);

  const cancelDelete = useCallback(() => {
    if (running.current) return;
    setDeleting(null);
    setFailure(null);
  }, []);

  const confirmDelete = useCallback(async (): Promise<void> => {
    if (!deleting) return;
    const entry = deleting;
    const capturedScope = runtime.capture();
    const deleted = await run((signal) =>
      mutate(entry, async () => {
        await api.deleteEntry(folderPath, entry, signal);
        return null;
      }),
    );
    if (!stillOpen(capturedScope) || !deleted) return;
    setDeleting(null);
    update(capturedScope, (state) => forgetTreePath(state, entry.path));
    await refresh();
    if (!stillOpen(capturedScope)) return;
    setSettledPath(parentTreePath(entry.path) || null);
  }, [api, deleting, folderPath, refresh, mutate, run, runtime, stillOpen, update]);

  const consumeSettledPath = useCallback(() => setSettledPath(null), []);
  const consumeRenamePath = useCallback(() => setRenamePath(null), []);

  return {
    beginCreate,
    beginRename,
    cancelDelete,
    cancelNaming,
    commitNaming,
    confirmDelete,
    consumeRenamePath,
    consumeSettledPath,
    createDraft,
    createInteractiveNote,
    deleting,
    failure,
    moveEntry,
    naming,
    pending,
    renamePath,
    requestDelete,
    settledPath,
  };
}
