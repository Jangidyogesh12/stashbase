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

/** The passage items themselves, which keep their identity while a reply
 *  streams, so the shallow comparison holds and the caller is not rendered
 *  again for every delta. */
function passageItems(
  state: Pick<AgentSessionState, 'context' | 'queuedPrompts' | 'steers' | 'transcript'>,
) {
  const seen = new Set<string>();
  return [
    ...state.context,
    ...state.queuedPrompts.flatMap((prompt) => prompt.context),
    ...state.steers.flatMap((prompt) => prompt.context),
    ...state.transcript.flatMap((block) => (block.kind === 'user' ? (block.context ?? []) : [])),
  ].flatMap((item) => {
    if (item.kind !== 'passage') return [];
    const key = contextItemKey(item);
    if (seen.has(key)) return [];
    seen.add(key);
    return [item];
  });
}

export function useReferencedPassages(workspace: AgentWorkspaceRuntime) {
  const session = useStore(workspace.store, (state) => workspace.session(state.activeId));
  const items = useStore(session?.store ?? empty, useShallow(passageItems));
  return useMemo(
    () => items.map((item) => ({ source: item.source, markdown: item.quote })),
    [items],
  );
}
