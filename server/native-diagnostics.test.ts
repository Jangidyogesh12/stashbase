import './__tests__/isolated-home.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createNativeDiagnostics } from './native-diagnostics.ts';
import { createTelemetry } from './telemetry.ts';
import { randomUUID } from 'node:crypto';
import type { AppConfigFile } from './app-config.ts';

test('native failures survive host restart with original time/version/distribution, then opt-out erases them', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stashbase-native-diagnostics-'));
  let config: AppConfigFile = {};
  let now = Date.now();
  const read = () => structuredClone(config);
  const write = (value: AppConfigFile) => { config = structuredClone(value); };
  const native = createNativeDiagnostics({ directory, available: true, distribution: 'source', version: '2.15.10', now: () => now, read });
  try {
    native.record(Object.assign(new Error('Update download failed: checksum mismatch token=secret-value'), { code: 'ERR_SHA512' }), 'app-update', { stage: 'downloading', target_version: '2.15.11' });
    const files = fs.readdirSync(directory);
    assert.equal(files.length, 1);
    const pending = JSON.parse(fs.readFileSync(path.join(directory, files[0]), 'utf8'));
    assert.ok(!JSON.stringify(pending).includes('secret-value'));
    const sent: any[] = [];
    now += 60_000;
    const service = createTelemetry({ available: true, distribution: 'packaged', version: '2.15.11', os: 'darwin', projectToken: 'fixture', host: 'https://example.invalid',
      read, write, now: () => now, native, fetch: async (_url, init) => { sent.push(JSON.parse(String(init?.body))); return new Response(null, { status: 200 }); } });
    t.mock.timers.tick(5000);
    await service.flush();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].uuid, pending.uuid);
    assert.equal(sent[0].timestamp, pending.timestamp);
    assert.equal(sent[0].properties.app_version, '2.15.10');
    assert.equal(sent[0].properties.app_distribution, 'source');
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
    createNativeDiagnostics({ directory, available: false, distribution: 'source', version: 'test', read: () => config }).record(new Error('suppressed'), 'startup');
    assert.deepEqual(fs.readdirSync(directory), []);
    const native = createNativeDiagnostics({ directory, available: true, distribution: 'source', version: 'test', read: () => config });
    native.record(new Error('before sign-in'), 'startup');
    config = { account: { session: { userId: 'later-user' } } } as AppConfigFile;
    native.drain(() => { assert.fail('must not attribute a first-launch failure to a different account'); });
    assert.deepEqual(fs.readdirSync(directory), []);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('native update warnings aggregate hourly across checks, preserve occurrence metadata and flush on shutdown', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stashbase-update-warnings-'));
  let now = Date.now();
  let config: AppConfigFile = { telemetry: { enabled: true, installationId: randomUUID(), anonymousId: randomUUID(), firstSeenAt: new Date(now).toISOString() } };
  const read = () => structuredClone(config);
  const write = (value: AppConfigFile) => { config = structuredClone(value); };
  const sent: any[] = [];
  const native = createNativeDiagnostics({ directory, available: true, distribution: 'packaged', version: '2.16.3', now: () => now, read });
  const options = { available: true, distribution: 'source' as const, version: '2.16.4', os: process.platform, projectToken: 'fixture', host: 'https://example.invalid',
    read, write, now: () => now, native, fetch: async (_url: unknown, init?: RequestInit) => { sent.push(JSON.parse(String(init?.body))); return new Response(null, { status: 200 }); } };
  const service = createTelemetry(options);
  const failure = new Error('net::ERR_INTERNET_DISCONNECTED');
  const record = () => native.record(failure, 'app-update', { stage: 'checking' }, 'warning');
  const drain = async () => { t.mock.timers.tick(5000); await service.flush(); };
  try {
    record();
    await drain();
    assert.deepEqual(sent.map((event) => [event.event, event.properties.occurrences]), [['application_warning', 1]]);
    now += 15 * 60_000;
    record();
    const repeated = JSON.parse(fs.readFileSync(path.join(directory, fs.readdirSync(directory)[0]), 'utf8'));
    await drain();
    now += 15 * 60_000;
    record();
    await drain();
    assert.equal(sent.length, 1);
    now += 30 * 60_000;
    t.mock.timers.tick(60_000);
    await service.flush();
    assert.equal(sent[1].event, 'application_warning');
    assert.equal(sent[1].properties.occurrences, 2);
    assert.equal(sent[1].uuid, repeated.uuid);
    assert.equal(sent[1].timestamp, repeated.timestamp);
    assert.equal(sent[1].properties.app_version, '2.16.3');
    assert.equal(sent[1].properties.app_distribution, 'packaged');
    record();
    await drain();
    now += 15 * 60_000;
    record(); // Close must drain this last native occurrence before releasing counts.
    service.close();
    assert.equal(config.telemetry?.queue?.length, 1);
    assert.equal((config.telemetry?.queue?.[0].event as any).occurrences, 1);
    assert.deepEqual(fs.readdirSync(directory), []);
    const restarted = createTelemetry(options);
    await restarted.flush();
    assert.equal(sent.reduce((total, event) => total + event.properties.occurrences, 0), 5);
    restarted.close();
  } finally { service.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('offline native warnings retain account boundaries and opt-out erases counted repeats', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stashbase-update-identity-'));
  let now = Date.now();
  let config: AppConfigFile = { account: { session: { userId: 'first-user' } }, telemetry: { enabled: true, installationId: randomUUID(), anonymousId: randomUUID(), firstSeenAt: new Date(now).toISOString(), userId: 'first-user' } } as AppConfigFile;
  const read = () => structuredClone(config);
  const write = (value: AppConfigFile) => { config = structuredClone(value); };
  const native = createNativeDiagnostics({ directory, available: true, distribution: 'source', version: 'test', now: () => now, read });
  const failure = new Error('net::ERR_NETWORK_CHANGED');
  const record = () => native.record(failure, 'app-update', { stage: 'checking' }, 'warning');
  // Deliberately reverse the spool order: filename ordering must not define windows.
  now += 15 * 60_000; record(); now -= 15 * 60_000; record(); now += 15 * 60_000;
  const sent: any[] = [];
  const service = createTelemetry({ available: true, distribution: 'source', version: 'test', os: 'win32', projectToken: 'fixture', host: 'https://example.invalid',
    read, write, now: () => now, native, fetch: async (_url, init) => { sent.push(JSON.parse(String(init?.body))); return new Response(null, { status: 200 }); } });
  try {
    t.mock.timers.tick(5000); await service.flush();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].properties.user_id, 'first-user');
    config.account!.session!.userId = 'second-user';
    service.identityChanged();
    record();
    t.mock.timers.tick(5000); await service.flush();
    const warnings = sent.filter((event) => event.event === 'application_warning');
    assert.deepEqual(warnings.map((event) => event.properties.user_id), ['first-user', 'second-user']);
    service.update({ enabled: false });
    record();
    service.close();
    assert.deepEqual(fs.readdirSync(directory), []);
    assert.equal(config.telemetry?.queue, undefined);
  } finally { service.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('socket loss joins native lifecycle observations without classifying normal closure as an error', async (t) => {
  const { EventEmitter } = await import('node:events');
  const { telemetry } = await import('./telemetry.ts');
  const { attachAgentDiagnostics } = await import('./error-reporting.ts');
  const { rendererTelemetryEventSchema } = await import('../shared/protocols/http/telemetry.ts');
  t.mock.timers.enable({ apis: ['setInterval'] });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stashbase-lifecycle-'));
  let config: AppConfigFile = {};
  const sent: any[] = [];
  const read = () => structuredClone(config);
  const native = createNativeDiagnostics({ directory, available: true, distribution: 'source', version: 'test', read });
  const service = createTelemetry({ available: true, distribution: 'source', version: 'test', os: process.platform,
    projectToken: 'fixture', host: 'https://example.invalid', read, write: value => { config = structuredClone(value); }, native,
    fetch: async (_url, init) => { sent.push(JSON.parse(String(init?.body))); return new Response(null, { status: 200 }); } });
  const windowId = randomUUID(), hostId = randomUUID(), connectionId = randomUUID();
  const previous = process.env.STASHBASE_SERVER_INSTANCE_ID;
  process.env.STASHBASE_SERVER_INSTANCE_ID = hostId;
  t.mock.method(telemetry, 'scoped', () => service.scoped());
  try {
    const connection = new EventEmitter();
    attachAgentDiagnostics(connection as any, 'stashbase', connectionId, windowId);
    connection.emit('error', Object.assign(new Error('reset'), { code: 'ECONNRESET', errno: -54 }));
    connection.emit('close', 1006);
    native.record({ message: 'Window closed' }, 'window-lifecycle', { window_id: windowId, host_instance_id: hostId, stage: 'closed' }, 'info');
    native.record({ message: 'Renderer exited: oom', exitCode: -1 }, 'window-lifecycle', { window_id: windowId, host_instance_id: hostId, stage: 'exit' });
    t.mock.timers.tick(5000);
    await service.flush();
    const closed = sent.find(row => row.event === 'agent_connection_closed').properties;
    assert.equal(closed.context.window_id, windowId);
    assert.equal(closed.context.host_instance_id, hostId);
    assert.equal(closed.context.connection_id, connectionId);
    assert.equal(closed.context.socket_error_code, 'ECONNRESET');
    assert.equal(closed.context.socket_error_errno, -54);
    const observation = sent.find(row => row.event === 'native_lifecycle').properties;
    assert.equal(observation.context.window_id, windowId);
    assert.equal(observation.context.host_instance_id, hostId);
    assert.equal(sent.filter(row => row.event === 'application_error').length, 1);
    assert.equal(rendererTelemetryEventSchema.safeParse({ event: 'native_lifecycle', operation: 'window-lifecycle', diagnostic: { message: 'spoof' }, context: {} }).success, false);
    service.update({ enabled: false });
    native.record({ message: 'disabled' }, 'window-lifecycle', {}, 'info');
    assert.deepEqual(fs.readdirSync(directory), []);
  } finally {
    if (previous === undefined) delete process.env.STASHBASE_SERVER_INSTANCE_ID;
    else process.env.STASHBASE_SERVER_INSTANCE_ID = previous;
    service.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
