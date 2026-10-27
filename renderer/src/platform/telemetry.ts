import type { HttpClient } from '@/platform/http/client';
import {
  rendererTelemetryEventSchema,
  telemetryReceiptSchema,
  type TelemetryEvent,
} from '@/protocols/http/telemetry';

/** Sends only the schema's bounded facts to the local collection owner. Errors never
 * reach the writing flow; the server owns opt-out and outbound transport. */
export function createUsageRecorder(client: HttpClient) {
  const recent = new Map<string, number>();
  const starts = new Map<string, Promise<void>>();
  let pending = 0;
  return (event: TelemetryEvent): void => {
    const parsed = rendererTelemetryEventSchema.safeParse(event);
    if (!parsed.success || pending >= 100) return;
    const key =
      event.event === 'document_engaged'
        ? `${event.event}:${event.activity}:${event.format}`
        : event.event === 'app_active'
          ? `${event.event}:${event.mode}`
          : null;
    if (key) {
      const minute = Math.floor(Date.now() / 60_000);
      if (recent.get(key) === minute) return;
      recent.set(key, minute);
    }
    const body = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      event: parsed.data,
    };
    pending++;
    const send = async () => {
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          if (attempt) await new Promise<void>((resolve) => setTimeout(resolve, 500 * attempt));
          try {
            const response = await client.request({
              path: '/api/telemetry/events',
              method: 'POST',
              body,
              signal: AbortSignal.timeout(2000),
            });
            const receipt = telemetryReceiptSchema.safeParse(response.body);
            if (response.status === 200 && receipt.success && receipt.data.status !== 'retry')
              return;
            if (
              response.status >= 400 &&
              response.status < 500 &&
              response.status !== 408 &&
              response.status !== 429
            )
              return;
          } catch {
            /* Short retries never delay or resend the user's actual work. */
          }
        }
      } finally {
        pending--;
      }
    };
    if (event.event === 'agent_turn_started' && event.turn_id) {
      const id = event.turn_id;
      const request = send();
      if (starts.size >= 100) starts.delete(starts.keys().next().value ?? '');
      starts.set(id, request);
      void request.finally(() => {
        if (starts.get(id) === request) starts.delete(id);
      });
    } else if (
      event.event === 'agent_turn_finished' &&
      event.turn_id &&
      starts.has(event.turn_id)
    ) {
      // Only this turn's terminal fact waits, never another user's new start.
      void starts.get(event.turn_id)?.then(send);
    } else void send();
  };
}

/** Input presence only: never inspect keys, text, targets or pointer positions.
 * A resident/background window cannot manufacture an active day. */
export function listenForDesktopActivity(
  record: (event: TelemetryEvent) => void,
  mode: 'welcome' | 'documents' | 'chat',
  target: Window = window,
): () => void {
  let minute = -1;
  const interact = (event: Event) => {
    if (
      !event.isTrusted ||
      target.document.visibilityState !== 'visible' ||
      !target.document.hasFocus()
    )
      return;
    const current = Math.floor(Date.now() / 60_000);
    if (current === minute) return;
    minute = current;
    record({ event: 'app_active', mode });
  };
  for (const name of ['pointerdown', 'keydown', 'wheel'])
    target.addEventListener(name, interact, { passive: true, capture: true });
  return () => {
    for (const name of ['pointerdown', 'keydown', 'wheel'])
      target.removeEventListener(name, interact, true);
  };
}
