import { useEffect, useRef } from 'react';

import {
  focusDesktopSession,
  subscribeDesktopSessions,
  type AgentWorkspaceRuntime,
} from '@/features/agent/public';
import type { DesktopNotificationsPort } from '@/shared/domain/notifications';

export function useDesktopSessions(
  runtime: AgentWorkspaceRuntime,
  port: DesktopNotificationsPort | undefined,
  showChat: () => void,
) {
  const show = useRef(showChat);
  show.current = showChat;
  useEffect(() => {
    if (!port) return;
    const stop = subscribeDesktopSessions(runtime, (sessions) => {
      // swallowed: a missing system tray cannot interrupt a live session.
      void port.syncActivity(sessions).catch(() => undefined);
    });
    const stopOpen = port.onOpenSession(({ id }) => {
      if (focusDesktopSession(runtime, id)) show.current();
    });
    return () => {
      stop();
      stopOpen();
      // swallowed: Main also retires sessions on navigation, crash and close.
      void port.syncActivity([]).catch(() => undefined);
    };
  }, [runtime, port]);
}
