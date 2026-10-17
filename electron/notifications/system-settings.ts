import { spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import type { NotificationSettingsTarget } from '../../shared/protocols/electron/notifications.ts';

interface Dependencies {
  platform: NodeJS.Platform;
  desktop: string;
  openExternal(url: string): Promise<void>;
  executable?: (path: string) => boolean;
  launch?: (path: string, args: string[]) => Promise<void>;
}

function executable(path: string): boolean {
  try { accessSync(path, constants.X_OK); return true; } catch { return false; }
}

/** Settings windows can outlive this request. Detect immediate launch failure,
 * then detach; a successful launch never establishes notification permission. */
function launch(path: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(path, args, { stdio: 'ignore', detached: true });
    const finish = (error?: Error) => {
      clearTimeout(timer);
      child.removeListener('error', onError);
      child.removeListener('exit', onExit);
      child.unref();
      if (error) reject(error); else resolve();
    };
    const onError = (error: Error) => finish(error);
    const onExit = (code: number | null) => finish(code === 0 ? undefined : new Error('Settings exited before opening.'));
    const timer = setTimeout(() => finish(), 1000);
    child.once('error', onError);
    child.once('exit', onExit);
  });
}

/** Fixed, host-owned destinations only. Never accept a URL, command or desktop
 * selector from the renderer. Unknown Linux desktops retain manual guidance. */
export function createNotificationSettings(deps: Dependencies) {
  const canExecute = deps.executable ?? executable;
  const run = deps.launch ?? launch;
  function destination(): { target: NotificationSettingsTarget; command?: string } {
    if (deps.platform === 'darwin') return { target: 'macos' };
    if (deps.platform === 'win32') return { target: 'windows' };
    if (deps.platform === 'linux') {
      const desktop = deps.desktop.toLowerCase().split(/[:;\s]+/);
      if (desktop.includes('gnome') || desktop.includes('ubuntu')) {
        if (canExecute('/usr/bin/gnome-control-center')) return { target: 'gnome', command: '/usr/bin/gnome-control-center' };
      }
      if (desktop.includes('kde') || desktop.includes('plasma')) {
        for (const command of ['/usr/bin/systemsettings', '/usr/bin/systemsettings5']) {
          if (canExecute(command)) return { target: 'kde', command };
        }
      }
    }
    return { target: 'manual' };
  }
  return {
    settingsTarget: () => destination().target,
    async openSettings(): Promise<void> {
      const { target, command } = destination();
      if (target === 'macos') return deps.openExternal('x-apple.systempreferences:com.apple.Notifications-Settings.extension');
      if (target === 'windows') return deps.openExternal('ms-settings:notifications');
      if (command) return run(command, [target === 'gnome' ? 'notifications' : 'kcm_notifications']);
      throw new Error('Open notification settings manually on this desktop.');
    },
  };
}
