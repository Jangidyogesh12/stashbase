/**
 * The Agent panel's renderer ↔ server wire protocol.
 *
 * Both ends speak exactly this vocabulary over the panel's WebSocket: the
 * renderer sends `AgentClientEvent`, the server sends `AgentServerEvent`, and
 * `AgentModel` / `AgentSkill` are the two payload shapes those events carry.
 *
 * They live in `shared/` — beside `conversion.ts` —
 * rather than in `server/agent-contract.ts` because the renderer must be able
 * to import them without reaching into `server/`. `agent-contract.ts` pulls in
 * `ws`, the CLI resolvers, and the runtime installer; a single non-type import
 * from the renderer would drag that whole graph into the browser bundle.
 * `server/agent-contract.ts` re-exports everything here, so server-side callers
 * keep importing it from one place.
 *
 * Runtime-specific lifecycle detail (adapters, capabilities, session scope)
 * stays in `server/agent-contract.ts`: it is server vocabulary, not wire
 * vocabulary.
 */

export { AGENT_SESSION_CLOSE } from './protocols/websocket/agent-session.ts';

export type {
  AgentClientEvent,
  AgentId,
  AgentModel,
  AgentServerEvent,
  AgentSkill,
  AgentTurnFailure,
  AgentTurnFailureKind,
} from './protocols/websocket/agent-session.ts';
