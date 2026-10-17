import type { AgentSessionState } from '@/features/agent/domain/session';

import type { AgentSessionRuntime } from './session-runtime';
import type { AgentWorkspaceRuntime } from './workspace-runtime';

/** Observe retained chats, including inactive ones, and retire subscriptions
 * with their exact runtime instance rather than just the tab ID. */
export function observeAgentSessions(
  runtime: AgentWorkspaceRuntime,
  changed: (
    session: AgentSessionRuntime,
    state: AgentSessionState,
    previous: AgentSessionState | null,
  ) => void,
  removed: (id: string) => void,
) {
  const entries = new Map<string, { session: AgentSessionRuntime; stop(): void }>();
  const reconcile = () => {
    const workspace = runtime.store.getState();
    const tabs = workspace.disposed ? [] : workspace.tabs;
    for (const [id, entry] of entries) {
      if (!tabs.some((tab) => tab.id === id) || runtime.session(id) !== entry.session) {
        entry.stop();
        entries.delete(id);
        removed(id);
      }
    }
    for (const tab of tabs) {
      const session = runtime.session(tab.id);
      if (!session || entries.has(tab.id)) continue;
      entries.set(tab.id, {
        session,
        stop: session.store.subscribe((state, previous) => changed(session, state, previous)),
      });
      changed(session, session.store.getState(), null);
    }
  };
  const stop = runtime.store.subscribe(reconcile);
  reconcile();
  return () => {
    stop();
    for (const entry of entries.values()) entry.stop();
    entries.clear();
  };
}
