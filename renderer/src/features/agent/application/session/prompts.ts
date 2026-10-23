import type { AgentContextItem } from '@/features/agent/domain/context';
import type { AgentSkill } from '@/features/agent/domain/runtime-catalog';
import type { AgentQueuedPrompt, AgentSessionState } from '@/features/agent/domain/session';

/** A prompt on its way out: what the user sees, and what goes on the wire. */
export interface PendingPrompt {
  context: AgentContextItem[];
  display: string;
  /** The catalog entry armed when the prompt was sent, if any. */
  skill: AgentSkill | null;
  wire: string;
  queuedId?: string;
  draft?: { text: string; context: AgentContextItem[]; skill: string | null };
}

/** What went out for one user turn: the wire text a retry resends exactly,
 *  and the text as typed, which an edit hands back to the composer. */
interface SentTurn {
  context?: AgentContextItem[];
  display: string;
  skill: string | null;
  wire: string;
}

export interface AgentPromptLedger {
  /** Holds a prompt until the connection that will carry it is live. */
  hold(prompt: PendingPrompt): void;
  /** Takes the held prompt, leaving nothing behind. */
  takeHeld(): PendingPrompt | null;
  /** Records what went out under a transcript block id. */
  recordTurn(blockId: string, turn: SentTurn): void;
  turnFor(blockId: string): SentTurn | undefined;
}

export function createPromptLedger(): AgentPromptLedger {
  let held: PendingPrompt | null = null;
  const turnByBlock = new Map<string, SentTurn>();

  return {
    hold(prompt) {
      held = prompt;
    },
    takeHeld() {
      const prompt = held;
      held = null;
      return prompt;
    },
    recordTurn(blockId, turn) {
      turnByBlock.set(blockId, turn);
    },
    turnFor(blockId) {
      return turnByBlock.get(blockId);
    },
  };
}

/** One queue row as the composer reports it: context and skill are absent
 *  unless the composer is replaying a snapshot it already holds. */
export interface QueueEntry {
  id: string;
  text: string;
  context?: AgentContextItem[] | undefined;
  skill?: string | null | undefined;
}

/** Capture context once when a draft enters the queue. Removing a row only
 * removes it; explicit reuse is owned by the session controls. */
/** The queue as entries, with one more follow-up after the rest. */
export function queueWith(state: AgentSessionState, text: string): QueueEntry[] {
  const entries = state.queuedPrompts.map(({ id, text: queued }) => ({ id, text: queued }));
  return [...entries, { id: crypto.randomUUID(), text }];
}

export function planQueue(state: AgentSessionState, entries: readonly QueueEntry[]) {
  const previous = new Map(state.queuedPrompts.map((prompt) => [prompt.id, prompt]));
  let draftTaken = false;
  const queue: AgentQueuedPrompt[] = entries.map((entry) => {
    const known = previous.get(entry.id);
    if (known) return { ...known, text: entry.text };
    const context = entry.context ?? (draftTaken ? [] : state.context);
    const skill = entry.skill ?? (draftTaken ? null : state.skill);
    draftTaken = true;
    return { context, id: entry.id, skill, text: entry.text };
  });
  return { queue, draftTaken };
}

/** The bundled runtime consumes explicit file parts; provider-owned CLIs read
 * the paths already included in their native prompt text. */
export function attachmentFields(
  agent: AgentSessionState['agent'],
  context: readonly AgentContextItem[] = [],
): { attachments?: string[] } {
  const attachments = context.flatMap((item) => (item.kind === 'transient' ? [item.path] : []));
  return agent === 'stashbase' && attachments.length ? { attachments } : {};
}

/** Native title hints never replace a title the reader chose. */
export function promptTitleHint(
  current: AgentSessionState,
  prompt: PendingPrompt,
): string | undefined {
  return current.transcript.some((block) => block.kind === 'user')
    ? undefined
    : current.titleEdited
      ? current.title
      : (prompt.display || (prompt.skill ? `/${prompt.skill.label}` : 'Attached files'))
          .replace(/\s+/g, ' ')
          .slice(0, 80);
}
