import type { BrowserWindow, IpcMain } from 'electron';
import {
  NOTIFICATIONS_CAPABILITY, NOTIFICATIONS_SYNC, NOTIFICATIONS_READ,
  NOTIFICATIONS_OPEN_SETTINGS,
  NOTIFICATIONS_ACTIVITY, NOTIFICATIONS_OPEN_SESSION, sessionActivitiesSchema, type SessionActivity,
  NOTIFICATIONS_SET_ENABLED, NOTIFICATIONS_CHANGED, NOTIFICATIONS_ACTIVATE,
  notificationActivationSchema, notificationBatchSchema, notificationUpdateSchema, notificationKindSchema,
  type NotificationStatus, type NotificationSettingsTarget,
} from '../../shared/protocols/electron/notifications.ts';
import { authorizeSender, type SenderAuthorization } from '../project/dialog.ts';
import { prepareNotifications } from './catalog.ts';
import { createNotificationCenter, type NativeNotice, type NotificationContent } from './center.ts';
import { notificationPreferences } from './preferences.ts';
import type { DesktopIndicators } from './indicators.ts';

export { NOTIFICATIONS_CAPABILITY };
interface Dependencies extends SenderAuthorization {
  ipcMain: Pick<IpcMain, 'handle'>;
  filePath: string;
  supported(): boolean;
  settingsTarget(): NotificationSettingsTarget;
  openSettings(): Promise<void>;
  indicators?: DesktopIndicators;
  isAppFocused(): boolean;
  createNotification(content: NotificationContent): NativeNotice;
}

/** Authorize the producer window, validate typed events and route clicks back
 * to that window. Native delivery never receives Agent or document state. */
export function registerNotifications(deps: Dependencies) {
  const preferences = notificationPreferences(deps.filePath);
  const windows = new Set<BrowserWindow>();
  const activities = new Map<BrowserWindow, SessionActivity[]>();
  const focusListeners = new Map<BrowserWindow, () => void>();
  let unread = 0;
  const updateIndicators = () => {
    const sessions = [...activities].flatMap(([win, entries]) => entries.map((session) => ({ win, session })));
    const waiting = sessions.filter(({ session }) => session.state === 'waiting').length;
    deps.indicators?.update({
      unread, waiting, working: sessions.length - waiting,
      sections: [{
        id: 'running', title: 'Running',
        items: sessions.map(({ win, session }) => ({
          id: JSON.stringify([win.id, session.id]),
          // Keep ordinary rows as quiet as the chat title. Disambiguate peers.
          label: sessions.filter((entry) => entry.session.conversation === session.conversation).length > 1
            ? `${session.project} · ${session.conversation}` : session.conversation,
          open() {
            if (win.isDestroyed() || !deps.isLiveWindow(win) || !deps.hasCapability(win, NOTIFICATIONS_CAPABILITY) || !activities.get(win)?.includes(session)) return;
            if (win.isMinimized()) win.restore();
            win.show(); win.focus();
            win.webContents.send(NOTIFICATIONS_OPEN_SESSION, { id: session.id });
          },
        })),
      }],
    });
  };
  let delivery: NotificationStatus['delivery'] = 'unknown';
  const status = (): NotificationStatus => ({ ...preferences.snapshot(), supported: deps.supported(), settingsTarget: deps.settingsTarget(), delivery });
  const publish = () => {
    for (const win of windows) if (!win.isDestroyed()) win.webContents.send(NOTIFICATIONS_CHANGED, status());
  };
  const refreshStatus = () => {
    try { preferences.read(); } catch { return; } // Keep unreadable preferences an explicit read error.
    publish();
  };
  const center = createNotificationCenter<BrowserWindow>({
    canNotify: (kind) => preferences.enabled(notificationKindSchema.parse(kind)) && deps.supported(),
    isForeground: deps.isAppFocused,
    create: deps.createNotification,
    delivery(next) { delivery = next; publish(); },
    unreadChanged(count) { unread = count; updateIndicators(); },
    activate(win, kind, id) {
      if (win.isDestroyed()) return;
      const activation = notificationActivationSchema.parse({ kind, id });
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      win.webContents.send(NOTIFICATIONS_ACTIVATE, activation);
    },
  });
  const retire = (win: BrowserWindow) => { activities.delete(win); center.remove(win); };
  const attach = (win: BrowserWindow) => {
    if (windows.has(win)) return;
    windows.add(win);
    win.on('blur', () => { center.refresh(); });
    // Returning from OS settings refreshes availability, never inferred permission.
    const focus = () => { center.seen(win); refreshStatus(); };
    focusListeners.set(win, focus);
    win.on('focus', focus);
    win.webContents.on('render-process-gone', () => { retire(win); });
    win.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
      if (mainFrame && !inPlace) retire(win);
    });
    win.on('closed', () => { retire(win); windows.delete(win); focusListeners.delete(win); });
  };
  for (const channel of [NOTIFICATIONS_SYNC, NOTIFICATIONS_READ, NOTIFICATIONS_SET_ENABLED, NOTIFICATIONS_OPEN_SETTINGS, NOTIFICATIONS_ACTIVITY]) {
    deps.ipcMain.handle(channel, (event, payload) => {
      const win = authorizeSender(event, deps, NOTIFICATIONS_CAPABILITY);
      if (!win) throw new Error('This window cannot use notifications.');
      if (channel === NOTIFICATIONS_OPEN_SETTINGS && payload !== undefined) throw new Error('Notification settings takes no arguments.');
      attach(win);
      if (channel === NOTIFICATIONS_ACTIVITY) {
        activities.set(win, sessionActivitiesSchema.parse(payload));
        updateIndicators();
        return;
      }
      if (channel === NOTIFICATIONS_OPEN_SETTINGS) return deps.openSettings();
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
  return { dispose() {
    activities.clear();
    center.dispose();
    for (const [win, focus] of focusListeners) win.removeListener('focus', focus);
    focusListeners.clear();
    windows.clear();
    deps.indicators?.dispose();
  } };
}
