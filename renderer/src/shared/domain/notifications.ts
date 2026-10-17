/** Producers publish typed, replaceable snapshots. Clearing one category cannot
 * clear another, and activation carries identity only, never an arbitrary action. */
type DesktopNotification = {
  kind: 'agent-confirmation' | 'agent-completed' | 'agent-failed';
  id: string;
  project: string;
  conversation: string;
};
export type NotificationKind = DesktopNotification['kind'];
interface NotificationBatch {
  kind: NotificationKind;
  events: DesktopNotification[];
}
interface NotificationActivation {
  kind: NotificationKind;
  id: string;
}
export interface NotificationStatus {
  enabled: boolean;
  categories: Record<NotificationKind, boolean>;
  supported: boolean;
  systemSettings: { canOpen: boolean; instructions: string };
  /** Delivery is evidence of a send, not permission or proof the user saw it. */
  delivery: 'unknown' | 'sent' | 'failed';
}
export interface NotificationPreferencesPort {
  read(): Promise<NotificationStatus>;
  openSettings(): Promise<void>;
  setEnabled(enabled: boolean): Promise<NotificationStatus>;
  setCategory(kind: NotificationKind, enabled: boolean): Promise<NotificationStatus>;
  onChanged(handler: (status: NotificationStatus) => void): () => void;
}
export interface DesktopNotificationsPort {
  sync(batch: NotificationBatch): Promise<void>;
  onActivate(handler: (activation: NotificationActivation) => void): () => void;
}
