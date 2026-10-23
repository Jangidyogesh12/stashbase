/** References shown in the current chat, including its draft and queue. */
import { useMemo } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { createStore } from 'zustand/vanilla';

import type { AgentWorkspaceRuntime } from '@/features/agent/application/workspace-runtime';
import { contextItemKey } from '@/features/agent/domain/context';
import type { AgentSessionState } from '@/features/agent/domain/session';

const empty = createStore<
  Pick<AgentSessionState, 'context' | 'queuedPrompts' | 'steers' | 'transcript'>
>(() => ({
  context: [],
  queuedPrompts: [],
  steers: [],
  transcript: [],
}));

export function useReferencedPassages(workspace: AgentWorkspaceRuntime) {
  const session = useStore(workspace.store, (state) => workspace.session(state.activeId));
  const { context, queuedPrompts, steers, transcript } = useStore(
    session?.store ?? empty,
    useShallow((state) => ({
      context: state.context,
      queuedPrompts: state.queuedPrompts,
      steers: state.steers,
      transcript: state.transcript,
    })),
  );
  return useMemo(() => {
    const seen = new Set<string>();
    return [
      ...context,
      ...queuedPrompts.flatMap((prompt) => prompt.context),
      ...steers.flatMap((prompt) => prompt.context),
      ...transcript.flatMap((block) => (block.kind === 'user' ? (block.context ?? []) : [])),
    ].flatMap((item) => {
      if (item.kind !== 'passage') return [];
      const key = contextItemKey(item);
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ source: item.source, markdown: item.quote }];
    });
  }, [context, queuedPrompts, steers, transcript]);
}
