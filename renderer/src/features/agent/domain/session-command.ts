/** What the renderer asks a live session to do. Commands are the feature's
 *  own vocabulary — one member per verb the runtime exposes, with an absent
 *  choice spelled `null` rather than left off — and `infrastructure/session-api`
 *  is the only place that turns one into a frame on the socket. */
import type { AgentAccessMode } from '@/features/agent/domain/access';
import type { AgentApprovalScope } from '@/features/agent/domain/session-transcript';

/** A native approval duration, a runtime's boolean remember option, or
 *  clarifying replies keyed by question text. */
export interface AgentPermissionDecision {
  always?: boolean;
  scope?: AgentApprovalScope;
  answers?: Record<string, string>;
}

export type AgentSessionCommand =
  /** Sends one user turn, optionally under the skill armed for it. */
  | {
      kind: 'prompt';
      telemetryTurnId?: string;
      text: string;
      skill: string | null;
      titleHint?: string;
      attachments?: string[];
    }
  /** Hands a follow-up to the turn already running, for runtimes that can
   *  take one; its answer is a `steer-result` event under the same id. */
  | { kind: 'steer'; id: string; text: string }
  | { kind: 'interrupt' }
  /** Answers one permission request; `always` remembers the decision and
   *  `answers` carry a clarifying question's replies. */
  | {
      kind: 'reply-permission';
      id: string;
      allow: boolean;
      always: boolean | null;
      scope?: AgentApprovalScope;
      answers: Record<string, string> | null;
    }
  /** Picks a catalog model, or returns to the runtime's own choice. */
  | { kind: 'select-model'; model: string | null }
  | { kind: 'set-access-mode'; mode: AgentAccessMode }
  /** Asks a live runtime to re-read the skills it can run in this scope. */
  | { kind: 'refresh-skills' };
