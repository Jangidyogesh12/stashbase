/**
 * Stored agent session history as the Chats navigator reads it.
 *
 * Each agent keeps its own transcript store, so a listing is per agent and
 * the renderer merges them; `folder` is what lets a row from the
 * application-wide history listing be resumed in the scope that owns it rather than the
 * one the navigator happened to be opened from.
 */

export type {
  AgentSessionBlockWire as SessionBlock,
  AgentSessionInfoWire as SessionInfo,
} from './protocols/http/agent-sessions.ts';
