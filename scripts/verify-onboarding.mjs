// Explicit, interactive real-provider verification. Each provider gets a
// persistent private profile; ordinary checks never run this launcher.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import electron from 'electron';
import { isolatedEnvironment } from './testing/environment.ts';

const { values } = parseArgs({ options: {
  agent: { type: 'string' },
  fresh: { type: 'boolean', default: false },
  built: { type: 'boolean', default: false },
  'debug-port': { type: 'string' },
} });
const agents = ['stashbase', 'claude', 'codex', 'antigravity'];
const index = agents.indexOf(values.agent);
if (index < 0) throw new Error('Choose one: --agent stashbase|claude|codex|antigravity');
const debugPort = values['debug-port'] ? Number(values['debug-port']) : null;
if (debugPort !== null && (!Number.isInteger(debugPort) || debugPort < 1024 || debugPort > 65535)) {
  throw new Error('--debug-port must be a TCP port between 1024 and 65535.');
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 8340 + index;
async function requireFreePort(number) {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', () => reject(new Error(`Port ${number} is in use; close the previous validation app.`)));
    server.listen(number, '127.0.0.1', () => server.close(resolve));
  });
}
await requireFreePort(port);
if (debugPort) await requireFreePort(debugPort);
if (!values.built) {
  const build = spawnSync('pnpm', ['build'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (build.error || build.status !== 0) throw new Error('Build failed; onboarding verification was not started.');
}
for (const file of ['dist/server/index.mjs', 'dist/mcp/server.mjs', 'dist/renderer/index.html', 'dist/electron/window/lifecycle.cjs']) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing ${file}; run without --built.`);
}
const profile = path.join(root, 'profiling.nosync', 'onboarding', values.agent);
if (values.fresh && fs.existsSync(profile)) {
  const archived = `${profile}-${Date.now()}`;
  fs.renameSync(profile, archived);
  console.log(`Previous profile retained at ${archived}`);
}
const env = isolatedEnvironment(profile);
delete env.ELECTRON_RUN_AS_NODE;
delete env.STASHBASE_DEV_VITE;
env.STASHBASE_APP_ROOT = root;
for (const directory of ['home', 'data', 'config', 'First essay']) fs.mkdirSync(path.join(profile, directory), { recursive: true });
console.log(`Real ${values.agent} onboarding. Profile retained at ${profile}`);
console.log(`Open ${path.join(profile, 'First essay')}, select ${values.agent}, connect/sign in and send an idea.`);
console.log('Check that the reply completes; update if needed and send again. Close and rerun without --fresh to check login reuse.');
console.log('This launcher does not certify OAuth, replies or updates automatically; record the observed results in J01.');

const children = [];
let stopping;
async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise((resolve) => child.once('close', resolve));
  const kill = (signal) => {
    try {
      if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      else process.kill(-child.pid, signal);
    } catch { /* Already gone. */ }
  };
  kill('SIGTERM');
  const timer = setTimeout(() => kill('SIGKILL'), 5000);
  try { await closed; } finally { clearTimeout(timer); }
}
function stop() {
  stopping ??= (async () => { for (const child of [...children].reverse()) await stopChild(child); })();
  return stopping;
}
function start(command, args) {
  const child = spawn(command, args, { cwd: root, env, stdio: 'inherit', detached: process.platform !== 'win32' });
  children.push(child);
  return child;
}
const abort = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  abort.abort();
  void stop();
});
try {
  const host = start(process.execPath, ['dist/server/index.mjs', `--port=${port}`]);
  host.once('error', (error) => abort.abort(error));
  const deadline = Date.now() + 30_000;
  while (true) {
    abort.signal.throwIfAborted();
    if (host.exitCode !== null || Date.now() > deadline) throw new Error('The validation host did not become ready.');
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(500) })).ok) break;
    } catch { /* Wait for the owned host. */ }
    await delay(200);
  }
  const desktop = start(electron, ['.', `--port=${port}`, `--user-data-dir=${path.join(profile, 'config', 'desktop')}`,
    ...(debugPort ? [`--remote-debugging-port=${debugPort}`] : [])]);
  const code = await new Promise((resolve, reject) => {
    desktop.once('error', reject);
    desktop.once('exit', (status) => resolve(status));
  });
  process.exitCode = code ?? (abort.signal.aborted ? 0 : 1);
} finally {
  await stop();
}
