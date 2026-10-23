import type { NotificationBatch, NotificationEvent } from '../../shared/protocols/electron/notifications.ts';
import type { NotificationContent, PreparedNotification } from './center.ts';

/** Product wording stays here, separate from native delivery. Adding a wire
 * variant requires a matching case; each producer owns activation semantics. */
function describe(event: NotificationEvent, count: number): NotificationContent {
  switch (event.kind) {
    case 'agent-confirmation': return {
      title: 'Waiting for approval',
      body: `${event.project} · ${event.conversation}${count > 1 ? ` · ${count} requests waiting` : ''}`,
    };
    case 'agent-completed': return {
      title: 'Chat finished',
      body: `${event.project} · ${event.conversation}${count > 1 ? ` · ${count} chats finished` : ''}`,
    };
    case 'agent-failed': return {
      title: 'Chat did not finish',
      body: `${event.project} · ${event.conversation}${count > 1 ? ` · ${count} chats did not finish` : ''}`,
    };
  }
}
export function prepareNotifications(batch: NotificationBatch): PreparedNotification[] {
  return batch.events.map((event) => ({ id: event.id, delivery: event.kind === 'agent-confirmation' ? 'pending' : 'event', content: describe(event, batch.events.length) }));
}
