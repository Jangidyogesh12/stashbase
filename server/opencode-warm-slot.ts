import { logger } from './log.ts';
import type { AgentStopReason } from './agent-process.ts';

const log = logger('opencode-runtime');

/** One unused OpenCode server, prepared for the next chat. Claiming it
 * transfers exclusive ownership; it is never shared by active chats. */
export interface WarmOpenCode {
  key: string;
  windowId: string;
  directory: string;
  close(reason?: AgentStopReason): Promise<void>;
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
    this.clearInBackground('spare_replaced');
    this.entry = entry;
    this.refresh(entry.key);
  }

  /** Continuing the matching chat keeps its spare warm, without spawning
   * another server. Expiry measures idle time since the last turn. */
  refresh(key: string): boolean {
    if (this.entry?.key !== key) return false;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.clearInBackground('spare_expired'); }, this.idleMs);
    this.timer.unref?.();
    return true;
  }

  /** A failed warm-up must not retire a newer spare or a claimed server. */
  discard(entry: T): void {
    if (this.entry === entry) this.clearInBackground('spare_discarded');
  }

  private clearInBackground(reason: AgentStopReason): void {
    // Observe this async wrapper too: the process owner's rejection handler
    // does not handle the new promise returned by clear().
    void this.clear(() => true, reason).catch((error: unknown) => log.warn('Could not retire the spare agent runtime.', error));
  }

  async clear(matches: (entry: T) => boolean = () => true, reason: AgentStopReason = 'session_closed'): Promise<void> {
    const entry = this.entry;
    if (!entry || !matches(entry)) return;
    this.entry = undefined;
    clearTimeout(this.timer);
    await entry.close(reason);
  }
}
