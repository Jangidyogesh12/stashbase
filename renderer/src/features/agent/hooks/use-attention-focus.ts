import { useEffect, type RefObject } from 'react';
import { useStore } from 'zustand';

import type { AgentWorkspaceRuntime } from '@/features/agent/application/workspace-runtime';

/** Only an explicit notification click moves the reading position. */
export function useAttentionFocus(
  runtime: AgentWorkspaceRuntime,
  sessionId: string,
  log: RefObject<HTMLDivElement | null>,
) {
  const target = useStore(runtime.store, (state) => state.attentionTarget);
  useEffect(() => {
    if (!target || target.sessionId !== sessionId) return;
    const frame = requestAnimationFrame(() => {
      const attribute = target.blockId ? 'data-notification-block-id' : 'data-permission-id';
      const card = Array.from(
        log.current?.querySelectorAll<HTMLElement>(`[${attribute}]`) ?? [],
      ).find((element) => element.getAttribute(attribute) === (target.blockId ?? target.requestId));
      if (!card) return;
      card.scrollIntoView({ block: 'center' });
      (target.blockId ? card : card.querySelector<HTMLElement>('h3'))?.focus({
        preventScroll: true,
      });
      if (runtime.store.getState().attentionTarget === target)
        runtime.store.setState({ attentionTarget: null });
    });
    return () => cancelAnimationFrame(frame);
  }, [runtime, sessionId, target, log]);
  return target?.sessionId === sessionId ? target.blockId : undefined;
}
