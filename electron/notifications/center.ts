/** Product-independent delivery lifecycle. Producers replace only their own
 * window/category snapshot; they never clear another producer's notifications. */
export interface NotificationContent { title: string; body: string }
export interface NativeNotice {
  on(event: 'click' | 'show' | 'failed', listener: () => void): unknown;
  show(): void;
  close(): void;
}
export interface PreparedNotification { id: string; delivery: 'pending' | 'event'; content: NotificationContent }
interface Group {
  items: PreparedNotification[];
  announced: Set<string>;
  unread: Set<string>;
  notice: NativeNotice | null;
  timer: ReturnType<typeof setTimeout> | null;
}
interface Dependencies<Owner> {
  canNotify(kind: string): boolean;
  isForeground(): boolean;
  create(content: NotificationContent): NativeNotice;
  activate(owner: Owner, kind: string, id: string): void;
  delivery(status: 'sent' | 'failed'): void;
  unreadChanged(count: number): void;
}

export function createNotificationCenter<Owner>(deps: Dependencies<Owner>) {
  const owners = new Map<Owner, Map<string, Group>>();
  const publishUnread = () => {
    let count = 0;
    for (const groups of owners.values()) for (const group of groups.values()) count += group.unread.size;
    deps.unreadChanged(count);
  };
  const dismiss = (group: Group) => {
    const notice = group.notice;
    group.notice = null;
    // A failed native close cannot retain click authority or break an Agent.
    try { notice?.close(); } catch { deps.delivery('failed'); }
  };
  const clear = (group: Group) => {
    if (group.timer) clearTimeout(group.timer);
    group.timer = null;
    group.items = [];
    group.announced.clear();
    group.unread.clear();
    dismiss(group);
  };
  const consumeEvents = (group: Group) => {
    for (const item of group.items) if (item.delivery === 'event') group.announced.add(item.id);
  };
  const present = (owner: Owner, kind: string, group: Group) => {
    group.timer = null;
    if (!deps.canNotify(kind) || deps.isForeground()) {
      consumeEvents(group);
      return;
    }
    const first = group.items.find((item) => !group.announced.has(item.id));
    if (!first) return;
    dismiss(group);
    for (const item of group.items) {
      if (!group.announced.has(item.id)) group.unread.add(item.id);
      group.announced.add(item.id);
    }
    publishUnread();
    try {
      const notice = deps.create(first.content);
      group.notice = notice;
      notice.on('click', () => {
        if (!deps.canNotify(kind) || group.notice !== notice || !group.items.some((item) => item.id === first.id)) return;
        dismiss(group);
        if (first.delivery === 'event') group.unread.delete(first.id);
        publishUnread();
        deps.activate(owner, kind, first.id);
      });
      notice.on('show', () => { if (group.notice === notice) deps.delivery('sent'); });
      notice.on('failed', () => { if (group.notice === notice) deps.delivery('failed'); });
      notice.show();
    } catch {
      deps.delivery('failed');
    }
  };
  const schedule = (owner: Owner, kind: string, group: Group) => {
    // Fixed coalescing window, not debounce: streaming must not postpone alerts.
    if (!group.timer) group.timer = setTimeout(() => present(owner, kind, group), 350);
  };
  return {
    sync(owner: Owner, kind: string, items: PreparedNotification[]) {
      let groups = owners.get(owner);
      if (!groups) { groups = new Map(); owners.set(owner, groups); }
      let group = groups.get(kind);
      if (!group) {
        group = { items: [], announced: new Set(), unread: new Set(), notice: null, timer: null };
        groups.set(kind, group);
      }
      const keys = new Set(items.map((item) => item.id));
      const removed = group.items.some((item) => !keys.has(item.id));
      group.items = items;
      group.announced = new Set([...group.announced].filter((id) => keys.has(id)));
      group.unread = new Set([...group.unread].filter((id) => keys.has(id)));
      if (removed || items.length === 0) dismiss(group);
      if (!deps.canNotify(kind) || deps.isForeground()) consumeEvents(group);
      schedule(owner, kind, group);
      publishUnread();
    },
    refresh() {
      for (const [owner, groups] of owners) for (const [kind, group] of groups) {
        if (!deps.canNotify(kind)) { dismiss(group); consumeEvents(group); group.unread.clear(); }
        else schedule(owner, kind, group);
      }
      publishUnread();
    },
    seen(owner: Owner) {
      for (const group of owners.get(owner)?.values() ?? []) {
        for (const item of group.items) if (item.delivery === 'event') group.unread.delete(item.id);
      }
      publishUnread();
    },
    remove(owner: Owner) {
      for (const group of owners.get(owner)?.values() ?? []) clear(group);
      owners.delete(owner);
      publishUnread();
    },
    dispose() {
      for (const groups of owners.values()) for (const group of groups.values()) clear(group);
      owners.clear();
      publishUnread();
    },
  };
}
