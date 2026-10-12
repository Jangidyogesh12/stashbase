/**
 * The fake transport the session-runtime suites drive a runtime over.
 *
 * Each suite checks a different slice of one runtime — transport, turns,
 * context, skills, recovery — against the same fake session port and the same
 * hand-released reconnect scheduler. The wiring is here so the suites cannot
 * drift into testing slightly different runtimes.
 *
 * Only a test file imports this.
 */
import { vi } from 'vite-plus/test';

import { agentSessionPort } from '@/test/fakes/agent';

import type { AgentReconnectScheduler, AgentSessionPort } from './ports';

type AgentConnectRequest = Parameters<AgentSessionPort['connect']>[0];

/** A reconnect scheduler with no jitter whose waits stay pending until the
 *  test releases one from `waits`. */
export function heldScheduler(): {
  scheduler: AgentReconnectScheduler;
  waits: Array<() => void>;
} {
  const waits: Array<() => void> = [];
  const scheduler: AgentReconnectScheduler = {
    jitter: (value) => value,
    wait: vi.fn(
      () =>
        new Promise<void>((resolve) => {
          waits.push(resolve);
        }),
    ),
  };
  return { scheduler, waits };
}

/** A fake session port whose replay restores one question and its answer,
 *  with a held scheduler for its reconnects. */
export function harness() {
  const { listeners, port, sent } = agentSessionPort({
    replay: vi.fn(async () => ({
      effort: 'high',
      transcript: [
        { kind: 'user' as const, id: 'user-1', text: 'Keep this question.' },
        { kind: 'assistant' as const, id: 'assistant-1', text: 'Keep this answer.' },
      ],
    })),
  });
  const { scheduler, waits } = heldScheduler();
  /** Every connect request in order, read back off the port's own spy. */
  const requests = (): AgentConnectRequest[] =>
    vi.mocked(port.connect).mock.calls.map(([request]) => request);
  return { listeners, port, requests, scheduler, sent, waits };
}
