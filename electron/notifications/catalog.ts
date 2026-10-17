import type { NotificationBatch, NotificationEvent } from '../../shared/protocols/electron/notifications.ts';
import type { NotificationContent, PreparedNotification } from './center.ts';

/** Product wording stays here, separate from native delivery. Adding a wire
 * variant requires a matching case; each producer owns activation semantics. */
function describe(event: NotificationEvent, count: number): NotificationContent {
  switch (event.kind) {
    case 'agent-confirmation': return {
      title: 'StashBase needs your attention',
      body: `${event.project} · ${event.conversation}${count > 1 ? ` — ${count} requests waiting` : ' — Waiting for your confirmation'}`,
    };
    case 'agent-completed': return {
      title: 'StashBase task completed',
      body: `${event.project} · ${event.conversation}${count > 1 ? ` — ${count} tasks completed` : ' — Your task is complete'}`,
    };
    case 'agent-failed': return {
      title: 'StashBase task failed',
      body: `${event.project} · ${event.conversation}${count > 1 ? ` — ${count} tasks need attention` : ' — Open the conversation to review what happened'}`,
    };
  }
}
export function prepareNotifications(batch: NotificationBatch): PreparedNotification[] {
  return batch.events.map((event) => ({ id: event.id, delivery: event.kind === 'agent-confirmation' ? 'pending' : 'event', content: describe(event, batch.events.length) }));
}
