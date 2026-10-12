/**
 * Agent CLI registry. The supported CLIs (Claude, Codex) are
 * enumerated here with their install hints; the chat panel surfaces
 * them via `/api/terminal/clis`.
 *
 * The CLIs themselves run through structured agent bridges (Claude Agent
 * SDK in server/agent.ts, Codex app-server in server/codex-session-runtime.ts),
 * not a PTY — this module no longer bridges a shell.
 */

function codexInstallHint(): string {
  if (process.platform === 'win32') return 'irm https://chatgpt.com/codex/install.ps1 | iex';
  return 'curl -fsSL https://chatgpt.com/codex/install.sh | sh';
}

function claudeInstallHint(): string {
  if (process.platform === 'win32') return 'irm https://claude.ai/install.ps1 | iex';
  return 'curl -fsSL https://claude.ai/install.sh | bash';
}

/** Registry of supported AI CLIs. Adding a new one = one entry here +
 *  it surfaces in the renderer's launchers automatically. `installHint`
 *  is the copy-paste command shown when the binary is missing; `bin` is
 *  what we probe on PATH. */
export interface CliDef {
  id: string;
  label: string;
  vendor: string;
  bin: string;           // PATH name we probe
  installHint: string;   // human-readable install command
}

export const CLIS: Record<string, CliDef> = {
  claude: {
    id: 'claude',
    label: 'Claude',
    vendor: 'Anthropic',
    bin: 'claude',
    installHint: claudeInstallHint(),
  },
  codex: {
    id: 'codex',
    label: 'Codex',
    vendor: 'OpenAI',
    bin: 'codex',
    installHint: codexInstallHint(),
  },
};
