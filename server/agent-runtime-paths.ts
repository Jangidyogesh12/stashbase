/** Agent installation staging and development-only failure simulation. */
import path from 'node:path';
import { appDataRoot } from './local-data.ts';
import { isDevelopmentRuntime } from './development-runtime.ts';
import type {
  AgentRuntimeDebugState,
  AgentSetupFailureSimulation,
  AgentTurnFailureSimulation,
} from '../shared/agent-runtime.ts';

export type {
  AgentRuntimeDebugState,
  AgentSetupFailureSimulation,
  AgentTurnFailureSimulation,
} from '../shared/agent-runtime.ts';

export type NativeAgentId = 'claude' | 'codex' | 'antigravity';
const SETUP_FAILURE_SIMULATIONS = new Set<AgentSetupFailureSimulation>(['none', 'installation', 'authentication', 'mcp']);
const TURN_FAILURE_SIMULATIONS = new Set<AgentTurnFailureSimulation>([
  'none', 'rate-limit', 'quota', 'auth-expired', 'network', 'crash',
]);

let nextFailure: AgentSetupFailureSimulation = 'none';
let nextTurnFailure: AgentTurnFailureSimulation = 'none';

function agentRuntimeDebugEnabled(): boolean {
  return isDevelopmentRuntime() || process.env.STASHBASE_AGENT_DEBUG === '1';
}

export function getAgentRuntimeDebugState(): AgentRuntimeDebugState {
  if (!agentRuntimeDebugEnabled()) {
    return {
      enabled: false,
      nextFailure: 'none',
      nextTurnFailure: 'none',
    };
  }
  return { enabled: true, nextFailure, nextTurnFailure };
}

export function setAgentRuntimeDebugState(
  patch: Partial<Omit<AgentRuntimeDebugState, 'enabled'>>,
): AgentRuntimeDebugState {
  if (!agentRuntimeDebugEnabled()) {
    throw Object.assign(new Error('Agent runtime test controls are available in development builds only.'), { status: 404 });
  }
  if (patch.nextFailure !== undefined) {
    if (!SETUP_FAILURE_SIMULATIONS.has(patch.nextFailure)) {
      throw Object.assign(new Error('Invalid Agent setup failure simulation.'), { status: 400 });
    }
    nextFailure = patch.nextFailure;
  }
  if (patch.nextTurnFailure !== undefined) {
    if (!TURN_FAILURE_SIMULATIONS.has(patch.nextTurnFailure)) {
      throw Object.assign(new Error('Invalid Agent turn failure simulation.'), { status: 400 });
    }
    nextTurnFailure = patch.nextTurnFailure;
  }
  return getAgentRuntimeDebugState();
}

/** Consume a development failure only when readiness reaches the selected
 * stage. Installation simulations therefore remain pending when an existing
 * runtime skips installation, while every injected failure is one-shot. */
export function consumeAgentSetupFailure(
  stage: Exclude<AgentSetupFailureSimulation, 'none'>,
): boolean {
  if (!agentRuntimeDebugEnabled() || nextFailure !== stage) return false;
  nextFailure = 'none';
  return true;
}

/** Consume the armed turn failure for the next prompt of any live session.
 * One-shot: the first prompt from any runtime takes it. */
export function consumeAgentTurnFailure(): Exclude<AgentTurnFailureSimulation, 'none'> | null {
  if (!agentRuntimeDebugEnabled() || nextTurnFailure === 'none') return null;
  const consumed = nextTurnFailure;
  nextTurnFailure = 'none';
  return consumed;
}

export interface SimulatedTurnFailureScript {
  /** Session-fatal: the adapter ends the session (protocol `exit`) instead of
   * settling one turn. */
  fatal: boolean;
  message: string;
}

/** The scripted outcome each turn simulation plays through the normal adapter
 * send path. Messages are shaped like the real provider errors they stand in
 * for — and flow through the live turn-failure classifier — and are prefixed
 * so a developer never mistakes one for a live failure. */
export function simulatedTurnFailureScript(
  kind: Exclude<AgentTurnFailureSimulation, 'none'>,
): SimulatedTurnFailureScript {
  switch (kind) {
    case 'rate-limit':
      return { fatal: false, message: 'Simulated failure: 429 rate_limit_error — too many requests. Retry after 30 seconds.' };
    case 'quota':
      return { fatal: false, message: 'Simulated failure: usage limit reached — this plan’s usage window is exhausted.' };
    case 'auth-expired':
      return { fatal: false, message: 'Simulated failure: 401 authentication_error — the session token has expired. Sign in again.' };
    case 'network':
      return { fatal: false, message: 'Simulated failure: fetch failed — getaddrinfo ENOTFOUND (network unreachable).' };
    case 'crash':
      return { fatal: true, message: 'Simulated failure: the Agent runtime exited unexpectedly (code 1).' };
  }
}

/** Only temporary installer scripts live here; installed CLIs belong to the provider. */
export function agentInstallerTempRoot(id: NativeAgentId): string {
  return path.join(appDataRoot(), 'agent-installers', id);
}
