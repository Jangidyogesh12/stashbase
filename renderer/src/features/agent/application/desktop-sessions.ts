import { agentSessionIsBusy, agentWorkStatus, scopeLabel } from '@/features/agent/domain/session';
import type { DesktopSessionActivity } from '@/shared/domain/notifications';

import { focusAgentRequest, pendingAgentRequests } from './attention';
import { observeAgentSessions } from './observe-sessions';
import type { AgentWorkspaceRuntime } from './workspace-runtime';

function snapshot(runtime: AgentWorkspaceRuntime): DesktopSessionActivity[] {
  if (runtime.store.getState().disposed) return [];
  const waiting = new Set(pendingAgentRequests(runtime).map((request) => request.sessionId));
  return runtime.store.getState().tabs.flatMap((tab) => {
    const session = runtime.session(tab.id)?.store.getState();
    if (!session || ['disposed', 'retired'].includes(session.connection.kind)) return [];
    if (!agentSessionIsBusy(session)) return [];
    return [
      {
        id: tab.id,
        project: scopeLabel(session.scope).slice(0, 160),
        conversation: session.title.slice(0, 160),
        state: waiting.has(tab.id) ? ('waiting' as const) : ('working' as const),
        detail: agentWorkStatus(session) ?? 'Ready',
      },
    ];
  });
}

/** A live projection, separate from notification eligibility and unread state.
 * Streaming text does not send another IPC snapshot unless the summary changes. */
export function subscribeDesktopSessions(
  runtime: AgentWorkspaceRuntime,
  publish: (sessions: DesktopSessionActivity[]) => void,
) {
  let previous = '';
  const changed = () => {
    const sessions = snapshot(runtime);
    const key = JSON.stringify(sessions);
    if (key !== previous) {
      previous = key;
      publish(sessions);
    }
  };
  const stop = observeAgentSessions(runtime, changed, changed);
  changed();
  return stop;
}

export function focusDesktopSession(runtime: AgentWorkspaceRuntime, id: string): boolean {
  if (!snapshot(runtime).some((session) => session.id === id)) return false;
  const request = pendingAgentRequests(runtime).find((entry) => entry.sessionId === id);
  if (request) return focusAgentRequest(runtime, request);
  runtime.activate(id);
  return true;
}
