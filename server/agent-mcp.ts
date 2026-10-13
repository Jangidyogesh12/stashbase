/**
 * StashBase MCP launcher and Agent Panel runtime MCP configuration.
 *
 * Owns the platform launcher script under `~/.stashbase/bin`, the
 * per-process launcher used by OpenQuill, and idempotent config writes
 * for the bring-your-own Chat runtimes (Claude, Codex). Only Agent
 * readiness calls `ensureAgentMcp`; every other
 * MCP-compatible client configures itself from the standard config that
 * Settings → MCP exposes read-only.
 */
import fs from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { parseTOML, getStaticTOMLValue } from 'toml-eslint-parser';
import os from 'node:os';
import path from 'node:path';
import { appDataRoot } from './local-data.ts';
import { writeFileAtomic } from './atomic-write.ts';
import { claudeConfigPath, codexConfigPath } from './agent-config-paths.ts';
import { parsePortArg } from '../shared/port-arg.ts';

const APP_ROOT = process.env.STASHBASE_APP_ROOT
  ? path.resolve(process.env.STASHBASE_APP_ROOT)
  : path.resolve(process.cwd());

const MCP_ENTRY = fs.existsSync(path.join(APP_ROOT, 'dist', 'mcp', 'server.mjs'))
  ? path.join(APP_ROOT, 'dist', 'mcp', 'server.mjs')
  : path.join(APP_ROOT, 'mcp', 'server.ts');

/** Regenerate the launcher when the MCP entry is available, so the config
 * handed out to copy actually works when pasted; otherwise report the
 * expected path without writing. */
export function ensureMcpLauncher(homeDir = os.homedir()): string {
  return fs.existsSync(MCP_ENTRY) ? writeMcpWrapper(homeDir) : currentMcpWrapper(homeDir);
}

export function standardMcpJson(wrapper: string): Record<string, unknown> {
  return {
    mcpServers: {
      stashbase: {
        command: wrapper,
      },
    },
  };
}

/** Idempotently wire the given built-in Chat runtime to StashBase MCP:
 * regenerate the launcher, then rewrite the stashbase entry in that agent's
 * own config file. Third-party clients are never written here — they get the
 * standard config to paste. */
export function ensureAgentMcp(id: 'claude' | 'codex'): void {
  if (!fs.existsSync(MCP_ENTRY)) {
    throw new Error(`MCP entry missing: ${MCP_ENTRY}`);
  }
  const wrapper = writeMcpWrapper();
  if (id === 'codex') {
    configureCodex(codexConfigPath(), wrapper);
  } else {
    // Claude defers MCP tool definitions behind its tool search once a user's
    // connectors grow past a share of the context, leaving the model a bare
    // name such as `edit_file` and no account of what it does. The routing
    // policy names these tools, so their descriptions must always be loaded.
    configureJsonMcp(claudeConfigPath(), { type: 'stdio', command: wrapper, alwaysLoad: true });
  }
}

function currentMcpWrapper(homeDir = os.homedir()): string {
  return path.join(
    homeDir,
    '.stashbase',
    'bin',
    process.platform === 'win32' ? 'stashbase-mcp.cmd' : 'stashbase-mcp',
  );
}

function shellQuote(value: string): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function cmdQuote(value: string): string {
  return `"${cmdValue(value).replace(/"/g, '""')}"`;
}

function cmdValue(value: string): string {
  return String(value).replace(/%/g, '%%');
}

function localBin(name: string): string {
  return path.join(APP_ROOT, 'node_modules', '.bin', process.platform === 'win32' ? `${name}.cmd` : name);
}

function writeMcpWrapper(homeDir = os.homedir()): string {
  // Stdio clients must reach the host that generated their launcher. Explicit
  // launcher arguments still win, for clients deliberately targeting a port.
  const port = parsePortArg(process.argv.slice(2), 8090);
  const binDir = path.join(homeDir, '.stashbase', 'bin');
  const wrapper = currentMcpWrapper(homeDir);
  const resourcesPath = process.env.STASHBASE_RESOURCES_PATH || APP_ROOT;
  const isBuilt = MCP_ENTRY.endsWith(path.join('dist', 'mcp', 'server.mjs'));
  const diagnosticEnv = {
    STASHBASE_PACKAGED: process.env.STASHBASE_PACKAGED === '1' ? '1' : '0',
    STASHBASE_DIAGNOSTICS_CONFIG: path.join(os.homedir(), '.stashbase', 'config.json'),
    STASHBASE_DIAGNOSTICS_ROOT: path.join(appDataRoot(), 'native-diagnostics'),
  };
  const content = process.platform === 'win32'
    ? [
        '@echo off',
        ...Object.entries(diagnosticEnv).map(([key, value]) => `set "${key}=${cmdValue(value)}"`),
        `set "STASHBASE_APP_ROOT=${cmdValue(APP_ROOT)}"`,
        `set "STASHBASE_RESOURCES_PATH=${cmdValue(resourcesPath)}"`,
        ...(isBuilt
          ? [
              'set "ELECTRON_RUN_AS_NODE=1"',
              `${cmdQuote(process.execPath)} ${cmdQuote(MCP_ENTRY)} %* --port=${port}`,
            ]
          : [
              `${cmdQuote(localBin('tsx'))} ${cmdQuote(MCP_ENTRY)} %* --port=${port}`,
            ]),
        '',
      ].join('\r\n')
    : [
        '#!/bin/sh',
        'set -eu',
        ...Object.entries(diagnosticEnv).map(([key, value]) => `export ${key}=${shellQuote(value)}`),
        `export STASHBASE_APP_ROOT=${shellQuote(APP_ROOT)}`,
        `export STASHBASE_RESOURCES_PATH=${shellQuote(resourcesPath)}`,
        ...(isBuilt
          ? [
              'export ELECTRON_RUN_AS_NODE=1',
              `exec ${shellQuote(process.execPath)} ${shellQuote(MCP_ENTRY)} "$@" --port=${port}`,
            ]
          : [
              `exec ${shellQuote(localBin('tsx'))} ${shellQuote(MCP_ENTRY)} "$@" --port=${port}`,
            ]),
        '',
      ].join('\n');
  fs.mkdirSync(binDir, { recursive: true });
  writeFileAtomic(wrapper, content, { mode: 0o755 });
  return wrapper;
}

function readJsonObject(file: string): Record<string, unknown> | null {
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

function writeJson(file: string, value: unknown): void {
  writeFileAtomic(file, JSON.stringify(value, null, 2) + '\n');
}

function configureJsonMcp(file: string, serverConfig: Record<string, unknown>): void {
  const config = readJsonObject(file);
  if (!config) throw new Error(`Couldn't parse ${file}; leaving it untouched.`);
  const currentServers =
    config.mcpServers && typeof config.mcpServers === 'object' && !Array.isArray(config.mcpServers)
      ? config.mcpServers as Record<string, unknown>
      : {};
  config.mcpServers = {
    ...currentServers,
    stashbase: serverConfig,
  };
  writeJson(file, config);
}

/** Source ranges preserve comments, quoted keys and multiline strings outside our tables.
 * Unsupported shapes or invalid TOML fail before publishing any config bytes. */
function replaceCodexMcpTables(raw: string, block: string): string {
  const ast = parseTOML(raw);
  const current = getStaticTOMLValue(ast) as { mcp_servers?: { stashbase?: unknown } };
  const desired = getStaticTOMLValue(parseTOML(block)) as { mcp_servers: { stashbase: unknown } };
  if (isDeepStrictEqual(current.mcp_servers?.stashbase, desired.mcp_servers.stashbase)) return raw;
  let updated = raw;
  const tables = ast.body[0].body.filter((node) => node.type === 'TOMLTable'
    && node.resolvedKey[0] === 'mcp_servers' && node.resolvedKey[1] === 'stashbase');
  for (const table of tables.reverse()) {
    updated = updated.slice(0, table.range[0]) + updated.slice(table.range[1]);
  }
  const result = `${updated}\n${block}\n`;
  parseTOML(result);
  return result;
}

function configureCodex(file: string, wrapper: string): void {
  const raw = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const block = [
    '[mcp_servers.stashbase]',
    `command = ${JSON.stringify(wrapper)}`,
    'default_tools_approval_mode = "prompt"',
    '',
    ...CODEX_AUTO_APPROVED_STASHBASE_TOOLS.flatMap((tool) => [
      `[mcp_servers.stashbase.tools.${tool}]`,
      'approval_mode = "approve"',
      '',
    ]),
  ].join('\n');
  let updated: string;
  try { updated = replaceCodexMcpTables(raw, block); }
  catch { throw new Error(`Could not safely update StashBase MCP in ${file}; leaving it untouched. Check the TOML configuration.`); }
  if (updated !== raw) writeFileAtomic(file, updated);
}

const CODEX_AUTO_APPROVED_STASHBASE_TOOLS = [
  'list_projects',
  'list_directory',
  'read_file',
  'reindex',
  'search_project',
];
