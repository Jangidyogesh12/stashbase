import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import type { AgentPreferencesPort } from '@/features/agent/application/ports';
import { agentContextPort, idleAgentSessionPort } from '@/test/fakes/agent';

import { useAgentWorkspaceRuntime } from './use-agent-workspace-runtime';

afterEach(cleanup);

type FolderRemovedSubscription = (handler: (folderPath: string) => void) => () => void;

const noSubscription: FolderRemovedSubscription = () => () => undefined;

function mount(
  folderPath: string | null,
  subscribeFolderRemoved: FolderRemovedSubscription = noSubscription,
) {
  let nextId = 0;
  return renderHook(
    ({ folder }: { folder: string | null }) =>
      useAgentWorkspaceRuntime({
        context: agentContextPort(),
        createId: () => `chat-${++nextId}`,
        folderPath: folder,
        session: idleAgentSessionPort(),
        subscribeFolderRemoved,
      }),
    { initialProps: { folder: folderPath } },
  );
}

describe('useAgentWorkspaceRuntime', () => {
  it('refreshes the inherited Agent when an existing Welcome window enters a project', async () => {
    let defaultAgent: 'stashbase' | 'claude' = 'stashbase';
    const preferences: AgentPreferencesPort = {
      load: vi.fn(async () => ({ defaultAgent, projects: [] })),
      save: vi.fn(async () => undefined),
    };
    let nextId = 0;
    const hook = renderHook(
      ({ folder }: { folder: string | null }) =>
        useAgentWorkspaceRuntime({
          context: agentContextPort(),
          createId: () => `chat-${++nextId}`,
          folderPath: folder,
          preferences,
          session: idleAgentSessionPort(),
          subscribeFolderRemoved: noSubscription,
        }),
      { initialProps: { folder: null as string | null } },
    );
    expect(preferences.load).not.toHaveBeenCalled();
    defaultAgent = 'claude'; // Chosen in another window while Welcome is open.
    hook.rerender({ folder: '/project/New' });
    await waitFor(() =>
      expect(hook.result.current.activeSession().store.getState().agent).toBe('claude'),
    );
    expect(preferences.save).not.toHaveBeenCalled();
  });

  it('keeps one runtime for the window and republishes the folder it moves to', () => {
    const hook = mount('/project/Research');
    const runtime = hook.result.current;

    hook.rerender({ folder: '/project/Plans' });

    // A folder change rebinds the window's runtime rather than replacing it,
    // which is what lets a started conversation survive the move.
    expect(hook.result.current).toBe(runtime);
    expect(runtime.activeSession().store.getState().scope).toEqual({
      kind: 'folder',
      path: '/project/Plans',
    });
  });

  it('retires the sessions bound to a folder the host removed', () => {
    const removed: Array<(folderPath: string) => void> = [];
    const hook = mount('/project/Research', (handler) => {
      removed.push(handler);
      return () => undefined;
    });
    const session = hook.result.current.activeSession();
    session.store.setState({ nativeSessionId: 'native-1' });

    for (const handler of removed) handler('/project/Research');

    expect(session.store.getState().connection.kind).toBe('retired');
  });

  it('disposes the runtime and drops its host subscription when the window goes', () => {
    const unsubscribe = vi.fn();
    const hook = mount('/project/Research', () => unsubscribe);
    const runtime = hook.result.current;
    const session = runtime.activeSession();

    hook.unmount();

    expect(unsubscribe).toHaveBeenCalledOnce();
    // The retained runtime defers teardown by a microtask so a StrictMode
    // remount can cancel it; a real unmount still tears down before the next.
    return Promise.resolve().then(() => {
      expect(session.store.getState().connection.kind).toBe('disposed');
    });
  });
});
