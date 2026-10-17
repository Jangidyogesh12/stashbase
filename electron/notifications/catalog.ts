import type { NotificationBatch, NotificationEvent } from '../../shared/protocols/electron/notifications.ts';
import type { NotificationContent, PreparedNotification } from './center.ts';

/** Product wording stays here, separate from native delivery. Adding a wire
 * variant requires a matching case; each producer owns activation semantics. */
function describe(event: NotificationEvent, count: number): NotificationContent {
  switch (event.kind) {
    case 'agent-confirmation': return {
      title: 'Needs confirmation',
      body: `${event.project} · ${event.conversation}${count > 1 ? ` — ${count} requests waiting` : ''}`,
    };
    case 'agent-completed': return {
      title: 'Task completed',
      body: `${event.project} · ${event.conversation}${count > 1 ? ` — ${count} tasks completed` : ''}`,
    };
    case 'agent-failed': return {
      title: 'Task failed',
      body: `${event.project} · ${event.conversation}${count > 1 ? ` — ${count} tasks need attention` : ''}`,
    };
  }
}
export function prepareNotifications(batch: NotificationBatch): PreparedNotification[] {
  return batch.events.map((event) => ({ id: event.id, delivery: event.kind === 'agent-confirmation' ? 'pending' : 'event', content: describe(event, batch.events.length) }));
}
