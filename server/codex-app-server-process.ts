import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  agentCliEnv,
  agentCliNeedsShell,
  commandDir,
  resolveAgentCli,
} from './agent-cli.ts';
import { ownAgentProcess } from './agent-process.ts';
import { logger } from './log.ts';

const log = logger('codex-app-server');

function resolveCodexBinary(): string | null {
  return resolveAgentCli({
    name: 'codex',
    envNames: ['STASHBASE_CODEX_BIN', 'CODEX_CLI_BIN', 'CODEX_CLI_PATH'],
    logLabel: 'Codex',
  }, (message) => log.warn(message));
}
export function spawnCodexAppServerProcess(
  cwd: string,
  extraEnv: NodeJS.ProcessEnv = {},
): ChildProcessWithoutNullStreams {
  const command = resolveCodexBinary();
  if (!command) {
    throw Object.assign(new Error('Codex CLI not found. Install Codex in Settings → Agents to access its chats.'), {
      status: 412,
      code: 'AGENT_NOT_INSTALLED',
    });
  }
  log.info(`spawning Codex app-server via ${command}`);
  return ownAgentProcess(spawn(command, ['app-server', '--listen', 'stdio://'], {
    cwd,
    detached: process.platform !== 'win32',
    windowsHide: true,
    env: agentCliEnv(extraEnv, [commandDir(command)]),
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: agentCliNeedsShell(command),
  }));
}

export function appVersion(): string {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8');
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}
