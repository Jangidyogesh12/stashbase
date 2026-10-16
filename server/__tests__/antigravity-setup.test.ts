import './isolated-home.ts';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { antigravityAuthState, loginToAntigravity } from '../antigravity-setup.ts';
import { antigravityModelsFromListing } from '../antigravity-model-catalog.ts';
import { antigravityErrorFromStderr, parseAntigravityLine } from '../antigravity-protocol.ts';
import { antigravityHookLauncher, ensureAgentMcp } from '../agent-mcp.ts';

test('the sign-in check reads a refusal as signed out and any other failure as unknown', () => {
  assert.equal(antigravityAuthState({ status: 0, stdout: '{"status":"SUCCESS","command":{"name":"usage"}}', stderr: '' }), 'signed-in');
  assert.equal(antigravityAuthState({ status: 1, stdout: '', stderr: 'error: authentication required' }), 'signed-out');
  assert.equal(antigravityAuthState({ status: 0, stdout: '{"status":"ERROR","error":"Not signed in"}', stderr: '' }), 'signed-out');
  assert.equal(antigravityAuthState({ status: 3, stdout: '', stderr: 'AGY_ERROR: {"short_error":"deadline exceeded"}' }), 'unknown');
  assert.equal(antigravityAuthState({ status: 0, stdout: '{"status":"ERROR","error":"backend unavailable"}', stderr: '' }), 'unknown');
});

test('sign-in keeps the interactive run until the check passes, then retires it', { skip: process.platform === 'win32' }, async () => {
  let child: ReturnType<typeof spawn> | undefined;
  let checks = 0;
  await loginToAntigravity('/unused/agy', new AbortController().signal, {
    pollMs: 5,
    spawnSignIn: () => (child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: ['pipe', 'pipe', 'pipe'] })),
    isAuthenticated: async () => ++checks >= 3,
  });
  assert.equal(checks, 3);
  assert.ok(child!.exitCode !== null || child!.signalCode !== null, 'the interactive run is retired once signed in');

  await assert.rejects(loginToAntigravity('/unused/agy', new AbortController().signal, {
    pollMs: 20,
    spawnSignIn: () => spawn(process.execPath, ['-e', 'console.log("Sign-in window closed"); process.exit(1)'], { detached: true, stdio: ['pipe', 'pipe', 'pipe'] }),
    isAuthenticated: async () => false,
  }), /closed before sign-in finished\. Sign-in window closed/);

  const cancel = new AbortController();
  const cancelled = loginToAntigravity('/unused/agy', cancel.signal, {
    pollMs: 5,
    spawnSignIn: () => spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: ['pipe', 'pipe', 'pipe'] }),
    isAuthenticated: async () => false,
  });
  setTimeout(() => cancel.abort(), 30);
  await assert.rejects(cancelled, /cancelled/);
});

test('model variants that differ only by effort become one model with those efforts', () => {
  const listing = JSON.stringify({
    status: 'SUCCESS',
    command: { name: 'models', data: { models: [
      { id: 'gemini-3.8-flash-low', label: 'Gemini 3.8 Flash (Low)' },
      { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)' },
      { id: 'gemini-4-pro', label: 'Gemini 4 Pro', default: true },
      { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
      { id: 'tiny-max', label: 'Tiny Max' },
    ] } },
  });
  assert.deepEqual(antigravityModelsFromListing(listing), {
    models: [
      { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', supportedEfforts: ['low', 'high'] },
      { id: 'gemini-4-pro', label: 'Gemini 4 Pro', isDefault: true },
      { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
      { id: 'tiny-max', label: 'Tiny Max' },
    ],
    defaultModel: 'gemini-4-pro',
  });
  assert.deepEqual(antigravityModelsFromListing('not json').models, []);
});

test('stream-json events read in their nested and flat forms, and failures carry the CLI\'s own words', () => {
  assert.deepEqual(parseAntigravityLine('{"event":"step_update","conversation_id":"c","step_index":2,"state":"DONE","step_type":"TOOL","tool_name":"view_file","tool_info":{"parameters":"{\\"AbsolutePath\\":\\"/a\\"}","output":"text"}}'), {
    kind: 'step', conversationId: 'c', index: 2, state: 'done', type: 'tool', textDelta: '',
    tool: { name: 'view_file', parameters: { AbsolutePath: '/a' }, output: 'text', error: '' },
  });
  assert.deepEqual(parseAntigravityLine('{"event":"result","result":{"status":"error","error":{"message":"bad model"},"denied_actions":[{"action":"command","display_name":"Run rm"}]}}'), {
    kind: 'result', conversationId: '', status: 'ERROR', response: '', error: 'bad model', deniedActions: ['Run rm'],
  });
  assert.equal(parseAntigravityLine('jetski: no output produced'), null);
  assert.equal(antigravityErrorFromStderr('noise\nAGY_ERROR: {"short_error":"429 rate limited","retryable":true}\n'), '429 rate limited');
  assert.equal(antigravityErrorFromStderr('error: unknown model "x"'), 'unknown model "x"');
});

test('Antigravity setup adds StashBase beside the reader\'s own MCP servers and hooks, and refuses a broken file', () => {
  const config = path.join(os.homedir(), '.gemini', 'config');
  fs.mkdirSync(config, { recursive: true });
  const mcp = path.join(config, 'mcp_config.json');
  const hooks = path.join(config, 'hooks.json');
  fs.writeFileSync(mcp, JSON.stringify({ mcpServers: { linter: { command: 'lint-mcp' }, stashbase: { command: 'old' } } }));
  const ownHook = { PreToolUse: [{ matcher: 'run_command', hooks: [{ command: '/my/guard' }] }] };
  fs.writeFileSync(hooks, JSON.stringify({ guard: ownHook }));
  ensureAgentMcp('antigravity');
  const servers = JSON.parse(fs.readFileSync(mcp, 'utf8')).mcpServers;
  assert.deepEqual(servers.linter, { command: 'lint-mcp' });
  assert.match(servers.stashbase.command, /stashbase-mcp/);
  const written = JSON.parse(fs.readFileSync(hooks, 'utf8'));
  assert.deepEqual(written.guard, ownHook);
  const [entry] = written.stashbase.PreToolUse;
  assert.equal(entry.matcher, '*');
  assert.match(entry.hooks[0].command, /stashbase-antigravity-hook/);
  assert.ok(fs.statSync(entry.hooks[0].command).mode & 0o100, 'the hook launcher is executable');

  fs.writeFileSync(hooks, '{ "guard": ');
  assert.throws(() => ensureAgentMcp('antigravity'), /leaving it untouched/);
  assert.equal(fs.readFileSync(hooks, 'utf8'), '{ "guard": ');
  fs.rmSync(config, { recursive: true, force: true });
});

test('the hook launcher is neutral outside StashBase, asks the host inside, and denies when the host is gone', { skip: process.platform === 'win32' }, async (t) => {
  const received: Array<{ session: string | undefined; body: string }> = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      received.push({ session: req.headers['x-stashbase-agent-session-id'] as string | undefined, body });
      res.setHeader('content-type', 'application/json');
      res.end('{"decision":"deny","reason":"declined"}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stashbase-agy-hook-'));
  t.after(() => { server.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const launcher = path.join(root, 'hook');
  fs.writeFileSync(launcher, antigravityHookLauncher(port, process.platform), { mode: 0o755 });
  const payload = '{"conversationId":"c1","toolCall":{"name":"run_command","args":{}}}';
  const run = (env: NodeJS.ProcessEnv) => new Promise<string>((resolve, reject) => {
    const child = spawn(launcher, [], { env, stdio: ['pipe', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.once('error', reject);
    child.once('close', () => resolve(out.trim()));
    child.stdin.end(payload);
  });
  const { STASHBASE_AGENT_SESSION_ID: _ignored, ...outside } = process.env;
  assert.equal(await run(outside), '{"decision":"allow"}');
  assert.equal(received.length, 0, 'a run outside StashBase never reaches the host');
  assert.equal(await run({ ...outside, STASHBASE_AGENT_SESSION_ID: 'session-1' }), '{"decision":"deny","reason":"declined"}');
  assert.deepEqual(received, [{ session: 'session-1', body: payload }]);
  server.close();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(await run({ ...outside, STASHBASE_AGENT_SESSION_ID: 'session-1' }), /"decision":"deny"/);
  assert.equal(spawnSync('sh', ['-n', launcher]).status, 0);
});
