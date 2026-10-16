/**
 * The bring-your-own CLI runtimes, one entry per provider executable.
 *
 * Discovery, installation, readiness and the CLI listing read a runtime's
 * names, overrides and official installer from here, so adding a provider is
 * one entry rather than another branch in each of those modules. How a
 * runtime signs in, configures MCP and runs a session stays with its adapter.
 */
import type { NativeAgentId } from './agent-runtime-paths.ts';

export interface NativeAgentSpec {
  id: NativeAgentId;
  label: string;
  vendor: string;
  /** The command name probed on PATH and in the official per-user bin. */
  bin: string;
  /** Explicit executable overrides; the first executable one wins. */
  envNames: string[];
  /** The npm package that also publishes this command, when one exists. */
  npmPackage?: string;
  /** The provider's official standalone installer scripts. */
  installer: { posix: string; posixShell: 'sh' | 'bash'; win32: string };
  /** The official Windows bin directory under `%LOCALAPPDATA%`, for a
   *  provider whose Windows installer does not use `~/.local/bin`. */
  windowsLocalAppDataBin?: readonly string[];
}

export const NATIVE_AGENTS: Readonly<Record<NativeAgentId, NativeAgentSpec>> = {
  codex: {
    id: 'codex',
    label: 'Codex',
    vendor: 'OpenAI',
    bin: 'codex',
    envNames: ['STASHBASE_CODEX_BIN', 'CODEX_CLI_BIN', 'CODEX_CLI_PATH'],
    npmPackage: '@openai/codex',
    installer: {
      posix: 'https://chatgpt.com/codex/install.sh',
      posixShell: 'sh',
      win32: 'https://chatgpt.com/codex/install.ps1',
    },
    windowsLocalAppDataBin: ['Programs', 'OpenAI', 'Codex', 'bin'],
  },
  claude: {
    id: 'claude',
    label: 'Claude',
    vendor: 'Anthropic',
    bin: 'claude',
    envNames: ['STASHBASE_CLAUDE_BIN', 'CLAUDE_CODE_BIN'],
    npmPackage: '@anthropic-ai/claude-code',
    installer: {
      posix: 'https://claude.ai/install.sh',
      posixShell: 'bash',
      win32: 'https://claude.ai/install.ps1',
    },
  },
  antigravity: {
    id: 'antigravity',
    label: 'Antigravity',
    vendor: 'Google',
    bin: 'agy',
    envNames: ['STASHBASE_AGY_BIN', 'AGY_CLI_BIN'],
    installer: {
      posix: 'https://antigravity.google/cli/install.sh',
      posixShell: 'bash',
      win32: 'https://antigravity.google/cli/install.ps1',
    },
    windowsLocalAppDataBin: ['agy', 'bin'],
  },
};

export const NATIVE_AGENT_IDS = Object.keys(NATIVE_AGENTS) as NativeAgentId[];

export function isNativeAgentId(value: unknown): value is NativeAgentId {
  return typeof value === 'string' && Object.hasOwn(NATIVE_AGENTS, value);
}

/** The spec whose command is `bin`, for code that only knows the command. */
export function nativeAgentForBin(bin: string): NativeAgentSpec | null {
  return Object.values(NATIVE_AGENTS).find((spec) => spec.bin === bin) ?? null;
}

/** The discovery inputs `agent-cli.ts` resolves an executable from. */
export function nativeAgentCliSpec(id: NativeAgentId): { name: string; envNames: string[]; logLabel: string } {
  const spec = NATIVE_AGENTS[id];
  return { name: spec.bin, envNames: spec.envNames, logLabel: spec.label };
}

export function nativeAgentInstallerUrl(id: NativeAgentId, platform: NodeJS.Platform = process.platform): string {
  const { installer } = NATIVE_AGENTS[id];
  return platform === 'win32' ? installer.win32 : installer.posix;
}

/** The copy-paste command shown when the executable is missing. */
export function nativeAgentInstallHint(id: NativeAgentId, platform: NodeJS.Platform = process.platform): string {
  const { installer } = NATIVE_AGENTS[id];
  return platform === 'win32'
    ? `irm ${installer.win32} | iex`
    : `curl -fsSL ${installer.posix} | ${installer.posixShell}`;
}
