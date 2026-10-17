import {
  notificationBatchSchema,
  notificationActivationSchema,
  notificationStatusSchema,
} from '@/protocols/electron/notifications';
import type {
  DesktopNotificationsPort,
  NotificationPreferencesPort,
  NotificationKind,
  NotificationStatus,
} from '@/shared/domain/notifications';

export interface NotificationsBridge {
  sync(batch: unknown): Promise<unknown>;
  read(): Promise<unknown>;
  openSettings(): Promise<void>;
  setEnabled(enabled: boolean): Promise<unknown>;
  setCategory(kind: NotificationKind, enabled: boolean): Promise<unknown>;
  onActivate(handler: (target: unknown) => void): () => void;
  onChanged(handler: (status: unknown) => void): () => void;
}

function status(value: unknown): NotificationStatus {
  const { settingsTarget, ...rest } = notificationStatusSchema.parse(value);
  const instructions = {
    macos: 'In System Settings → Notifications, select StashBase and turn on Allow notifications.',
    windows:
      'In Settings → System → Notifications, turn on notifications and enable StashBase in the app list.',
    gnome:
      'In Settings → Notifications, enable notifications for StashBase and turn off Do Not Disturb.',
    kde: 'In System Settings → Notifications, open Application Settings and enable StashBase notifications.',
    manual:
      'Open your desktop’s notification settings and allow StashBase. Check Do Not Disturb and your notification service too.',
  };
  return {
    ...rest,
    systemSettings: {
      canOpen: settingsTarget !== 'manual',
      instructions: instructions[settingsTarget],
    },
  };
}

export function createNotificationsAdapter(
  bridge: NotificationsBridge,
): DesktopNotificationsPort & NotificationPreferencesPort {
  return {
    async sync(batch) {
      await bridge.sync(notificationBatchSchema.parse(batch));
    },
    async read() {
      return status(await bridge.read());
    },
    openSettings: () => bridge.openSettings(),
    async setEnabled(enabled) {
      return status(await bridge.setEnabled(enabled));
    },
    async setCategory(kind, enabled) {
      return status(await bridge.setCategory(kind, enabled));
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
        if (parsed.success) handler(status(parsed.data));
      });
    },
  };
}
