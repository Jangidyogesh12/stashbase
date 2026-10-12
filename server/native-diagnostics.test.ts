import './__tests__/isolated-home.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createNativeDiagnostics } from './native-diagnostics.ts';
import { createTelemetry } from './telemetry.ts';
import type { AppConfigFile } from './app-config.ts';

test('native failures survive host restart with original time/version, then opt-out erases them', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stashbase-native-diagnostics-'));
  let config: AppConfigFile = {};
  let now = Date.now();
  const read = () => structuredClone(config);
  const write = (value: AppConfigFile) => { config = structuredClone(value); };
  const native = createNativeDiagnostics({ directory, available: true, version: '2.15.10', now: () => now, read });
  try {
    native.record(Object.assign(new Error('Update download failed: checksum mismatch token=secret-value'), { code: 'ERR_SHA512' }), 'app-update', { stage: 'downloading', target_version: '2.15.11' });
    const files = fs.readdirSync(directory);
    assert.equal(files.length, 1);
    const pending = JSON.parse(fs.readFileSync(path.join(directory, files[0]), 'utf8'));
    assert.ok(!JSON.stringify(pending).includes('secret-value'));
    const sent: any[] = [];
    now += 60_000;
    const service = createTelemetry({ available: true, version: '2.15.11', os: 'darwin', projectToken: 'fixture', host: 'https://example.invalid',
      read, write, now: () => now, native, fetch: async (_url, init) => { sent.push(JSON.parse(String(init?.body))); return new Response(null, { status: 200 }); } });
    t.mock.timers.tick(5000);
    await service.flush();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].uuid, pending.uuid);
    assert.equal(sent[0].timestamp, pending.timestamp);
    assert.equal(sent[0].properties.app_version, '2.15.10');
    assert.equal(sent[0].properties.diagnostic.code, 'ERR_SHA512');
    assert.deepEqual(sent[0].properties.context, { stage: 'downloading', target_version: '2.15.11' });
    assert.deepEqual(fs.readdirSync(directory), []);
    native.record(new Error('Host crashed'), 'native');
    service.update({ enabled: false });
    native.record(new Error('Disabled'), 'native');
    assert.deepEqual(fs.readdirSync(directory), []);
    service.close();
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('native suppression creates no files and an unowned startup failure cannot move to a later account', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stashbase-native-suppression-'));
  let config: AppConfigFile = {};
  try {
    createNativeDiagnostics({ directory, available: false, version: 'test', read: () => config }).record(new Error('suppressed'), 'startup');
    assert.deepEqual(fs.readdirSync(directory), []);
    const native = createNativeDiagnostics({ directory, available: true, version: 'test', read: () => config });
    native.record(new Error('before sign-in'), 'startup');
    config = { account: { session: { userId: 'later-user' } } } as AppConfigFile;
    native.drain(() => { assert.fail('must not attribute a first-launch failure to a different account'); });
    assert.deepEqual(fs.readdirSync(directory), []);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
