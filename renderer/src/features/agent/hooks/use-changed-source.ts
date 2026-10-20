import { useMemo } from 'react';
import { useStore } from 'zustand';

import type { AgentWorkspaceRuntime } from '@/features/agent/application/workspace-runtime';
import { changedSource } from '@/features/agent/domain/file-change';
import type { AgentScope } from '@/features/agent/domain/session';

/** Resolves a path a turn changed to the project source it names, only while
 *  the scope's listing still holds that file. */
export function useChangedSource(runtime: AgentWorkspaceRuntime, scope: AgentScope) {
  const environment = useStore(runtime.store, (state) => state.scopeEnvironment);
  return useMemo(
    () => (path: string) => {
      const source = changedSource(scope, path);
      return source &&
        environment?.folderPath === source.folderPath &&
        environment.listing.files.some((file) => file.path === source.path)
        ? source
        : null;
    },
    [scope, environment],
  );
}
