/**
 * Points every home-derived location at a temporary directory, so a host test
 * never reads or writes the developer's own ~/.stashbase config, app data or
 * agent settings. `test:server`, `test:agent` and `test:mcp` preload it with
 * `--import`; test workers and the processes they spawn inherit it.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isolatedEnvironment } from '../../scripts/testing/environment.ts';

const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stashbase-agent-test-home-'));
const env = isolatedEnvironment(isolatedRoot);
for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
Object.assign(process.env, env);
fs.mkdirSync(env.HOME!, { recursive: true });

process.once('exit', () => {
  try { fs.rmSync(isolatedRoot, { recursive: true, force: true }); } catch { /* best effort */ }
});
