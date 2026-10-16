/**
 * Agent CLI registry. The supported CLIs (Claude, Codex, Antigravity) are
 * enumerated in `native-agents.ts`; this listing carries their install
 * hints, and the chat panel surfaces them via `/api/terminal/clis`.
 *
 * The CLIs themselves run through structured agent bridges (Claude Agent
 * SDK in server/agent.ts, Codex app-server in server/codex-session-runtime.ts,
 * Antigravity stream-json in server/antigravity-session-runtime.ts), not a
 * PTY — this module no longer bridges a shell.
 */
import { NATIVE_AGENT_IDS, NATIVE_AGENTS, nativeAgentInstallHint } from './native-agents.ts';

/** Registry of supported AI CLIs. Adding a new one = one entry in
 *  `native-agents.ts`. `installHint`
 *  is the copy-paste command shown when the binary is missing; `bin` is
 *  what we probe on PATH. */
export interface CliDef {
  id: string;
  label: string;
  vendor: string;
  bin: string;           // PATH name we probe
  installHint: string;   // human-readable install command
}

export const CLIS: Record<string, CliDef> = Object.fromEntries(
  NATIVE_AGENT_IDS.map((id) => [id, {
    id,
    label: NATIVE_AGENTS[id].label,
    vendor: NATIVE_AGENTS[id].vendor,
    bin: NATIVE_AGENTS[id].bin,
    installHint: nativeAgentInstallHint(id),
  }]),
);
