import { useEffect, useRef } from 'react';

import {
  focusAgentRequest,
  observeAgentOutcomes,
  attentionId,
  pendingAgentRequests,
  subscribeAgentAttention,
  type AgentWorkspaceRuntime,
} from '@/features/agent/public';
import type { DesktopNotificationsPort } from '@/shared/domain/notifications';

import { useDesktopSessions } from './use-desktop-sessions';

export function useAgentNotifications(
  runtime: AgentWorkspaceRuntime,
  port: DesktopNotificationsPort | undefined,
  showChat: () => void,
) {
  useDesktopSessions(runtime, port, showChat);
  const show = useRef(showChat);
  show.current = showChat;
  useEffect(() => {
    if (!port) return;
    // IPC invocation order preserves snapshots; no response can overwrite
    // newer session state. Delivery failure never interrupts the Agent.
    const stop = subscribeAgentAttention(runtime, (requests) => {
      void port
        .sync({
          kind: 'agent-confirmation',
          events: requests.map((request) => ({
            kind: 'agent-confirmation',
            id: attentionId(request),
            project: request.project,
            conversation: request.conversation,
          })),
        })
        // swallowed: Native delivery failure must not stop an Agent or discard its pending card.
        .catch(() => undefined);
    });
    const outcomes = observeAgentOutcomes(runtime, (results) => {
      for (const kind of ['agent-completed', 'agent-failed'] as const) {
        void port
          .sync({
            kind,
            events: results
              .filter((result) => result.kind === kind)
              .map(({ id, project, conversation }) => ({ kind, id, project, conversation })),
          })
          // swallowed: Native delivery failure cannot alter the completed turn or its transcript.
          .catch(() => undefined);
      }
    });
    const stopActivate = port.onActivate((activation) => {
      if (activation.kind !== 'agent-confirmation') {
        if (outcomes.activate(activation.kind, activation.id)) show.current();
        return;
      }
      const target = pendingAgentRequests(runtime).find(
        (request) => attentionId(request) === activation.id,
      );
      if (target && focusAgentRequest(runtime, target)) show.current();
    });
    return () => {
      stop();
      stopActivate();
      outcomes.dispose();
      for (const kind of ['agent-completed', 'agent-failed'] as const) {
        // swallowed: Main also retires notifications on navigation, crash and window close.
        void port.sync({ kind, events: [] }).catch(() => undefined);
      }
      // swallowed: Main also retires notifications on navigation, crash and window close.
      void port.sync({ kind: 'agent-confirmation', events: [] }).catch(() => undefined);
    };
  }, [runtime, port]);
}
