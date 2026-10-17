import fs from 'node:fs';
import path from 'node:path';
import { notificationPreferenceSchema, type NotificationKind, type NotificationPreferences } from '../../shared/protocols/electron/notifications.ts';

/** Main is the sole writer. An unreadable preference is never silently reset. */
export function notificationPreferences(filePath: string) {
  let value: NotificationPreferences = { enabled: true, categories: { 'agent-confirmation': true, 'agent-completed': true, 'agent-failed': true } };
  let readable = true;
  try {
    value = notificationPreferenceSchema.parse(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
      value.enabled = false;
      readable = false;
    }
  }
  return {
    snapshot: () => value,
    enabled: (kind: NotificationKind) => value.enabled && value.categories[kind],
    read() {
      if (!readable) throw new Error('Notification preferences could not be read.');
      return value;
    },
    save(enabled: boolean, kind?: NotificationKind) {
      if (!readable) throw new Error('Notification preferences could not be read.');
      const next = kind ? { ...value, categories: { ...value.categories, [kind]: enabled } } : { ...value, enabled };
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const temp = `${filePath}.tmp`;
      try {
        fs.writeFileSync(temp, JSON.stringify(next), 'utf8');
        fs.renameSync(temp, filePath);
      } finally { fs.rmSync(temp, { force: true }); }
      value = next;
    },
  };
}
