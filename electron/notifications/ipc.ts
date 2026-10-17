import type { BrowserWindow, IpcMain } from 'electron';
import {
  NOTIFICATIONS_CAPABILITY, NOTIFICATIONS_SYNC, NOTIFICATIONS_READ,
  NOTIFICATIONS_SET_ENABLED, NOTIFICATIONS_CHANGED, NOTIFICATIONS_ACTIVATE,
  notificationActivationSchema, notificationBatchSchema, notificationUpdateSchema, notificationKindSchema,
  type NotificationStatus,
} from '../../shared/protocols/electron/notifications.ts';
import { authorizeSender, type SenderAuthorization } from '../project/dialog.ts';
import { prepareNotifications } from './catalog.ts';
import { createNotificationCenter, type NativeNotice, type NotificationContent } from './center.ts';
import { notificationPreferences } from './preferences.ts';

export { NOTIFICATIONS_CAPABILITY };
interface Dependencies extends SenderAuthorization {
  ipcMain: Pick<IpcMain, 'handle'>;
  filePath: string;
  supported(): boolean;
  isAppFocused(): boolean;
  createNotification(content: NotificationContent): NativeNotice;
}

/** Authorize the producer window, validate typed events and route clicks back
 * to that window. Native delivery never receives Agent or document state. */
export function registerNotifications(deps: Dependencies) {
  const preferences = notificationPreferences(deps.filePath);
  const windows = new Set<BrowserWindow>();
  let delivery: NotificationStatus['delivery'] = 'unknown';
  const status = (): NotificationStatus => ({ ...preferences.snapshot(), supported: deps.supported(), delivery });
  const publish = () => {
    for (const win of windows) if (!win.isDestroyed()) win.webContents.send(NOTIFICATIONS_CHANGED, status());
  };
  const center = createNotificationCenter<BrowserWindow>({
    canNotify: (kind) => preferences.enabled(notificationKindSchema.parse(kind)) && deps.supported(),
    isForeground: deps.isAppFocused,
    create: deps.createNotification,
    delivery(next) { delivery = next; publish(); },
    activate(win, kind, id) {
      if (win.isDestroyed()) return;
      const activation = notificationActivationSchema.parse({ kind, id });
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      win.webContents.send(NOTIFICATIONS_ACTIVATE, activation);
    },
  });
  const attach = (win: BrowserWindow) => {
    if (windows.has(win)) return;
    windows.add(win);
    win.on('blur', () => { center.refresh(); });
    win.webContents.on('render-process-gone', () => { center.remove(win); });
    win.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
      if (mainFrame && !inPlace) center.remove(win);
    });
    win.on('closed', () => { center.remove(win); windows.delete(win); });
  };
  for (const channel of [NOTIFICATIONS_SYNC, NOTIFICATIONS_READ, NOTIFICATIONS_SET_ENABLED]) {
    deps.ipcMain.handle(channel, (event, payload) => {
      const win = authorizeSender(event, deps, NOTIFICATIONS_CAPABILITY);
      if (!win) throw new Error('This window cannot use notifications.');
      attach(win);
      if (channel === NOTIFICATIONS_SET_ENABLED) {
        const update = notificationUpdateSchema.parse(payload);
        preferences.save(update.enabled, update.kind);
        center.refresh();
        publish();
        return status();
      }
      if (channel === NOTIFICATIONS_READ) { preferences.read(); return status(); }
      const batch = notificationBatchSchema.parse(payload);
      center.sync(win, batch.kind, prepareNotifications(batch));
      return { ok: true };
    });
  }
  return { dispose() { center.dispose(); windows.clear(); } };
}
