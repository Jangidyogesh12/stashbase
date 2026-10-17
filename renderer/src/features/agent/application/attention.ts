import type { AttentionRequest, RequestTarget } from '@/features/agent/domain/attention';
import { agentTurnIsActive, scopeLabel } from '@/features/agent/domain/session';

import { observeAgentSessions } from './observe-sessions';
import type { AgentWorkspaceRuntime } from './workspace-runtime';

export function pendingAgentRequests(runtime: AgentWorkspaceRuntime): AttentionRequest[] {
  if (runtime.store.getState().disposed) return [];
  return runtime.store.getState().tabs.flatMap((tab) => {
    const state = runtime.session(tab.id)?.store.getState();
    if (!state || !agentTurnIsActive(state.connection) || state.delivery === 'stopping') return [];
    return state.transcript.flatMap((block) =>
      block.kind === 'tool' && block.status === 'awaiting' && block.permissionId
        ? [
            {
              sessionId: tab.id,
              requestId: block.permissionId,
              project: scopeLabel(state.scope).slice(0, 160),
              conversation: state.title.slice(0, 160),
            },
          ]
        : [],
    );
  });
}

/** Subscribe to all retained sessions, including inactive chats. Tab status
 * alone cannot distinguish a second approval from the first one. */
export function subscribeAgentAttention(
  runtime: AgentWorkspaceRuntime,
  handler: (requests: AttentionRequest[]) => void,
) {
  let previous = '';
  const publish = () => {
    const requests = pendingAgentRequests(runtime);
    const fingerprint = JSON.stringify(requests);
    if (previous === fingerprint) return;
    previous = fingerprint;
    handler(requests);
  };
  const stop = observeAgentSessions(runtime, publish, publish);
  publish();
  return stop;
}

export function focusAgentRequest(runtime: AgentWorkspaceRuntime, target: RequestTarget): boolean {
  if (
    !pendingAgentRequests(runtime).some(
      (request) => request.sessionId === target.sessionId && request.requestId === target.requestId,
    )
  )
    return false;
  runtime.activate(target.sessionId);
  runtime.store.setState({ attentionTarget: { ...target } });
  return true;
}
