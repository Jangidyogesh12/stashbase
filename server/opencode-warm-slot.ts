/** One unused OpenCode server, prepared for the next chat. Claiming it
 * transfers exclusive ownership; it is never shared by active chats. */
export interface WarmOpenCode {
  key: string;
  windowId: string;
  directory: string;
  close(): Promise<void>;
}

export class OpenCodeWarmSlot<T extends WarmOpenCode> {
  private entry: T | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly idleMs = 120_000) {}

  take(key: string): T | undefined {
    if (this.entry?.key !== key) return undefined;
    const entry = this.entry;
    this.entry = undefined;
    clearTimeout(this.timer);
    return entry;
  }

  put(entry: T): void {
    void this.clear();
    this.entry = entry;
    this.refresh(entry.key);
  }

  /** Continuing the matching chat keeps its spare warm, without spawning
   * another server. Expiry measures idle time since the last turn. */
  refresh(key: string): boolean {
    if (this.entry?.key !== key) return false;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.clear(); }, this.idleMs);
    this.timer.unref?.();
    return true;
  }

  /** A failed warm-up must not retire a newer spare or a claimed server. */
  discard(entry: T): void {
    if (this.entry === entry) void this.clear();
  }

  async clear(matches: (entry: T) => boolean = () => true): Promise<void> {
    const entry = this.entry;
    if (!entry || !matches(entry)) return;
    this.entry = undefined;
    clearTimeout(this.timer);
    await entry.close();
  }
}
