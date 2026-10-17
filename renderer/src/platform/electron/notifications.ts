import {
  notificationBatchSchema,
  notificationActivationSchema,
  notificationStatusSchema,
} from '@/protocols/electron/notifications';
import type {
  DesktopNotificationsPort,
  NotificationPreferencesPort,
  NotificationKind,
} from '@/shared/domain/notifications';

export interface NotificationsBridge {
  sync(batch: unknown): Promise<unknown>;
  read(): Promise<unknown>;
  setEnabled(enabled: boolean): Promise<unknown>;
  setCategory(kind: NotificationKind, enabled: boolean): Promise<unknown>;
  onActivate(handler: (target: unknown) => void): () => void;
  onChanged(handler: (status: unknown) => void): () => void;
}

export function createNotificationsAdapter(
  bridge: NotificationsBridge,
): DesktopNotificationsPort & NotificationPreferencesPort {
  return {
    async sync(batch) {
      await bridge.sync(notificationBatchSchema.parse(batch));
    },
    async read() {
      return notificationStatusSchema.parse(await bridge.read());
    },
    async setEnabled(enabled) {
      return notificationStatusSchema.parse(await bridge.setEnabled(enabled));
    },
    async setCategory(kind, enabled) {
      return notificationStatusSchema.parse(await bridge.setCategory(kind, enabled));
    },
    onActivate(handler) {
      return bridge.onActivate((value) => {
        const parsed = notificationActivationSchema.safeParse(value);
        if (parsed.success) handler(parsed.data);
      });
    },
    onChanged(handler) {
      return bridge.onChanged((value) => {
        const parsed = notificationStatusSchema.safeParse(value);
        if (parsed.success) handler(parsed.data);
      });
    },
  };
}
