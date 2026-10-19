import './isolated-home.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { ensureAgentMcp } from '../agent-mcp.ts';
import { resolveAgentCli, resolveAgentCliWithLoginShell } from '../agent-cli.ts';
import { ownAgentProcess, retireAgentProcess, closeAgentProcesses, agentProcessClosed } from '../agent-process.ts';
import { once } from 'node:events';
import { telemetry } from '../telemetry.ts';
import { telemetryEventSchema, type TelemetryEvent } from '../../shared/protocols/http/telemetry.ts';

test('MCP preparation uses each CLI custom config home without changing default configs', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stashbase-custom-agent-home-'));
  const keys = ['CODEX_HOME', 'CLAUDE_CONFIG_DIR'] as const;
  const previous = keys.map((key) => process.env[key]);
  t.after(() => {
    keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
    fs.rmSync(root, { recursive: true, force: true });
  });
  for (const [id, key, file] of [['codex', 'CODEX_HOME', 'config.toml'], ['claude', 'CLAUDE_CONFIG_DIR', '.claude.json']] as const) {
    const home = path.join(root, id);
    fs.mkdirSync(home);
    process.env[key] = home;
    const config = path.join(home, file);
    fs.writeFileSync(config, id === 'codex' ? 'model = "kept"\n' : '{"theme":"kept"}');
    const defaultConfig = id === 'codex' ? path.join(os.homedir(), '.codex', 'config.toml') : path.join(os.homedir(), '.claude.json');
    const before = fs.existsSync(defaultConfig) ? fs.readFileSync(defaultConfig, 'utf8') : null;
    ensureAgentMcp(id);
    assert.match(fs.readFileSync(config, 'utf8'), /stashbase/);
    assert.match(fs.readFileSync(config, 'utf8'), /kept/);
    assert.equal(fs.existsSync(defaultConfig) ? fs.readFileSync(defaultConfig, 'utf8') : null, before);
  }
});

test('MCP setup preserves unrelated commented/quoted tables and multiline text, and refuses invalid config', () => {
  const config = path.join(os.homedir(), '.codex', 'config.toml');
  fs.mkdirSync(path.dirname(config), { recursive: true });
  const unrelated = `[mcp_servers."other"] # keep this server\ncommand = "other-server"\nnote = '''\n[mcp_servers.stashbase]\nnot a table\n'''\n`;
  fs.writeFileSync(config, `[mcp_servers."stashbase"] # our old entry\ncommand = "old"\n\n${unrelated}`);
  ensureAgentMcp('codex');
  const updated = fs.readFileSync(config, 'utf8');
  assert.ok(updated.includes(unrelated));
  assert.ok(!updated.includes('command = "old"'));
  ensureAgentMcp('codex');
  assert.equal(fs.readFileSync(config, 'utf8'), updated, 'unchanged setup must not rewrite the file');
  const malformed = '[mcp_servers.stashbase\ncommand = "keep"';
  fs.writeFileSync(config, malformed);
  assert.throws(() => ensureAgentMcp('codex'), /leaving it untouched/);
  assert.equal(fs.readFileSync(config, 'utf8'), malformed);
  fs.rmSync(config);
});

test('Claude MCP setup keeps the user\'s other settings and asks for StashBase tools to stay loaded', () => {
  const config = path.join(os.homedir(), '.claude.json');
  fs.writeFileSync(config, JSON.stringify({
    theme: 'dark',
    mcpServers: { other: { command: 'other-server' }, stashbase: { command: 'old' } },
  }));
  ensureAgentMcp('claude');
  const updated = JSON.parse(fs.readFileSync(config, 'utf8'));
  assert.equal(updated.theme, 'dark');
  assert.deepEqual(updated.mcpServers.other, { command: 'other-server' });
  assert.equal(updated.mcpServers.stashbase.alwaysLoad, true);
  assert.notEqual(updated.mcpServers.stashbase.command, 'old');
  const malformed = '{ "mcpServers": ';
  fs.writeFileSync(config, malformed);
  assert.throws(() => ensureAgentMcp('claude'), /leaving it untouched/);
  assert.equal(fs.readFileSync(config, 'utf8'), malformed);
  fs.rmSync(config);
});

test('valid login-shell discoveries survive elapsed time and disappear only when their file disappears', { skip: process.platform === 'win32' }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stashbase-cli-cache-'));
  const shell = path.join(root, 'shell');
  const binary = path.join(root, 'custom-agent');
  fs.writeFileSync(binary, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(shell, `#!/bin/sh\nprintf '%s\\n' '${binary}'\n`, { mode: 0o755 });
  const previous = process.env.SHELL;
  t.after(() => { if (previous === undefined) delete process.env.SHELL; else process.env.SHELL = previous; fs.rmSync(root, { recursive: true, force: true }); });
  process.env.SHELL = shell;
  const spec = { name: `stashbase-cache-${process.pid}`, envNames: [], logLabel: 'Fixture' };
  assert.equal(await resolveAgentCliWithLoginShell(spec), binary);
  const now = Date.now();
  t.mock.method(Date, 'now', () => now + 301_000);
  assert.equal(resolveAgentCli(spec), binary);
  fs.rmSync(binary);
  assert.equal(resolveAgentCli(spec), null);
});

for (const leaderExits of [false, true]) test(`native retirement closes descendants when leader ${leaderExits ? 'crashes first' : 'receives termination'}`,  { skip: process.platform === 'win32' }, async () => {
  const leaf = `process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},1000);`;
  const parent = `const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e',${JSON.stringify(leaf)}],{stdio:['ignore','pipe','ignore']});child.stdout.once('data',()=>{console.log(child.pid);${leaderExits ? 'process.exit(1);' : ''}});setInterval(()=>{},1000);`;
  const child = ownAgentProcess(spawn(process.execPath, ['-e', parent], { detached: true, stdio: ['pipe', 'pipe', 'pipe'] }));
  await new Promise<void>((resolve, reject) => { child.stdout.once('data', () => resolve()); child.once('error', reject); });
  try {
    if (leaderExits) await new Promise<void>((resolve) => child.once('close', () => resolve()));
    const retirement = retireAgentProcess(child);
    assert.equal(retireAgentProcess(child), retirement);
    await retirement;
    assert.throws(() => process.kill(-child.pid!, 0), { code: 'ESRCH' });
    await closeAgentProcesses();
  } finally {
    try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* already reaped */ }
  }
});

test('a timed-out child keeps one failure until late pipe closure releases ownership', async (t) => {
  const events: Extract<TelemetryEvent, { event: 'agent_runtime_stop_result' }>[] = [];
  t.mock.method(telemetry, 'scoped', () => (input: TelemetryEvent) => {
    const event = telemetryEventSchema.parse(input);
    if (event.event === 'agent_runtime_stop_result') events.push(event);
  });
  const child = ownAgentProcess(spawn(process.execPath, ['-e', "process.stdout.write('ready');setInterval(()=>{},1000)"], {
    detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
  }), { runtime: 'stashbase', purpose: 'prewarm', processStartId: '11111111-1111-4111-8111-111111111111' });
  await once(child.stdout, 'data');
  const emit = child.emit.bind(child);
  let closeArgs: unknown[] | undefined;
  t.mock.method(child, 'emit', (event: string | symbol, ...args: unknown[]) => {
    if (event === 'close') { closeArgs = args; return true; }
    return emit(event, ...args);
  });
  t.after(() => { if (closeArgs) emit('close', ...closeArgs); child.kill('SIGKILL'); });
  let completed = false;
  void agentProcessClosed(child).then(() => { completed = true; });
  const closing = retireAgentProcess(child, 'spare_expired');
  await assert.rejects(closing, { code: 'AGENT_PROCESS_CLOSE_TIMEOUT' });
  assert.equal(completed, false);
  assert.equal(retireAgentProcess(child), closing, 'another caller must not create another termination or diagnostic');
  await assert.rejects(closeAgentProcesses(), { code: 'AGENT_PROCESS_CLOSE_TIMEOUT' });
  assert.equal(events.length, 1);
  assert.equal(events[0].outcome, 'timeout');
  assert.equal(events[0].exit_observed, true);
  assert.equal(events[0].pipes_closed, false);
  assert.equal(events[0].reason, 'spare_expired');
  assert.equal(events[0].context?.process_start_id, '11111111-1111-4111-8111-111111111111');
  assert.ok(closeArgs, 'the real process exited before its close notification was released');
  emit('close', ...closeArgs);
  await agentProcessClosed(child);
  await closeAgentProcesses();
  await assert.rejects(closing, { code: 'AGENT_PROCESS_CLOSE_TIMEOUT' });
  assert.deepEqual(events.map(event => event.outcome), ['timeout', 'closed_after_timeout']);
  assert.equal(events[1].attempt_id, events[0].attempt_id);
  assert.equal(events[1].pipes_closed, true);
});
