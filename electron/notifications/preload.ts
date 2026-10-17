import {
  NOTIFICATIONS_ACTIVATE, NOTIFICATIONS_CHANGED, NOTIFICATIONS_READ,
  NOTIFICATIONS_SET_ENABLED, NOTIFICATIONS_SYNC,
  NOTIFICATIONS_OPEN_SETTINGS,
  notificationBatchSchema, notificationActivationSchema, notificationUpdateSchema,
  notificationStatusSchema, type NotificationBatch, type NotificationActivation,
  type NotificationStatus, type NotificationKind,
} from '../../shared/protocols/electron/notifications.ts';

interface IpcRenderer {
  invoke(channel: string, payload?: unknown): Promise<unknown>;
  on(channel: string, listener: (event: unknown, payload: unknown) => void): unknown;
  removeListener(channel: string, listener: (event: unknown, payload: unknown) => void): unknown;
}

export function createNotificationsPreload(ipc: IpcRenderer) {
  function subscribe<T>(channel: string, parse: (value: unknown) => T | null, handler: (value: T) => void) {
    const listener = (_event: unknown, payload: unknown) => {
      const value = parse(payload);
      if (value !== null) handler(value);
    };
    ipc.on(channel, listener);
    return () => { ipc.removeListener(channel, listener); };
  }
  return Object.freeze({
    async sync(batch: NotificationBatch) {
      await ipc.invoke(NOTIFICATIONS_SYNC, notificationBatchSchema.parse(batch));
    },
    async read(): Promise<NotificationStatus> {
      return notificationStatusSchema.parse(await ipc.invoke(NOTIFICATIONS_READ));
    },
    async openSettings(): Promise<void> {
      await ipc.invoke(NOTIFICATIONS_OPEN_SETTINGS);
    },
    async setEnabled(enabled: boolean): Promise<NotificationStatus> {
      return notificationStatusSchema.parse(await ipc.invoke(
        NOTIFICATIONS_SET_ENABLED, notificationUpdateSchema.parse({ enabled }),
      ));
    },
    async setCategory(kind: NotificationKind, enabled: boolean): Promise<NotificationStatus> {
      return notificationStatusSchema.parse(await ipc.invoke(
        NOTIFICATIONS_SET_ENABLED, notificationUpdateSchema.parse({ kind, enabled }),
      ));
    },
    onActivate(handler: (target: NotificationActivation) => void) {
      return subscribe(NOTIFICATIONS_ACTIVATE, (value) => {
        const parsed = notificationActivationSchema.safeParse(value);
        return parsed.success ? parsed.data : null;
      }, handler);
    },
    onChanged(handler: (status: NotificationStatus) => void) {
      return subscribe(NOTIFICATIONS_CHANGED, (value) => {
        const parsed = notificationStatusSchema.safeParse(value);
        return parsed.success ? parsed.data : null;
      }, handler);
    },
  });
}
