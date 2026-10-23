import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { appStateDbPath } from './local-data.ts';
import { checkPreparationStorage, closeStateDb, getConversionStatus, setConversionStatus } from './state-db.ts';

function fixture(t: TestContext): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stashbase-storage-check-'));
  const previous = process.env.STASHBASE_LOCAL_DATA_ROOT;
  closeStateDb();
  process.env.STASHBASE_LOCAL_DATA_ROOT = path.join(root, 'app-data');
  t.after(() => {
    closeStateDb();
    if (previous === undefined) delete process.env.STASHBASE_LOCAL_DATA_ROOT;
    else process.env.STASHBASE_LOCAL_DATA_ROOT = previous;
    fs.rmSync(root, { recursive: true, force: true });
  });
  return process.env.STASHBASE_LOCAL_DATA_ROOT;
}

test('startup verifies real SQLite persistence, cleans scratch files and preserves cancellation', (t) => {
  const root = fixture(t);
  assert.deepEqual(checkPreparationStorage(), { ok: true });
  const source = path.join(root, 'draft.pdf');
  setConversionStatus(source, 'cancelled');
  closeStateDb();
  assert.deepEqual(checkPreparationStorage(), { ok: true });
  assert.equal(getConversionStatus(source)?.status, 'cancelled');
  assert.deepEqual(fs.readdirSync(root), ['state']);
});

test('ABI load failure gives source repair advice and packaged reinstall advice without touching user data', async (t) => {
  const root = fixture(t);
  for (const packaged of ['0', '1']) {
    await t.test(packaged === '1' ? 'packaged' : 'source', () => {
      // Isolate the native loader fault from this worker's already loaded
      // addon. Exercise the real constructor path without replacing binaries.
      const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', `
        import { checkPreparationStorage } from './server/state-db.ts';
        process.dlopen = () => {
          throw Object.assign(new Error('Compiled against NODE_MODULE_VERSION 147; this runtime requires 137'), { code: 'ERR_DLOPEN_FAILED' });
        };
        console.log(JSON.stringify(checkPreparationStorage()));
      `], {
        cwd: fileURLToPath(new URL('../', import.meta.url)),
        env: { ...process.env, STASHBASE_PACKAGED: packaged, STASHBASE_TELEMETRY_DISABLED: '1' },
        encoding: 'utf8', timeout: 15_000,
      });
      assert.equal(child.status, 0, child.stderr);
      const result = JSON.parse(child.stdout);
      assert.equal(result.ok, false);
      assert.equal(result.code, 'PREPARATION_NATIVE_UNAVAILABLE');
      if (packaged === '1') {
        assert.match(result.message, /Reinstall StashBase/);
        assert.doesNotMatch(result.message, /pnpm|Node|ABI/);
      } else {
        assert.match(result.message, /pnpm rebuild better-sqlite3/);
        assert.ok(result.message.includes(process.version));
        assert.ok(result.message.includes(`ABI ${process.versions.modules}`));
      }
      assert.equal(fs.existsSync(root), false);
    });
  }
});

test('unwritable or full app data fails the actual write probe and recovers on the next check', (t) => {
  const root = fixture(t);
  const mkdtemp = fs.mkdtempSync;
  for (const code of ['EACCES', 'ENOSPC']) {
    const failure = t.mock.method(fs, 'mkdtempSync', (...args: Parameters<typeof mkdtemp>) => {
      if (String(args[0]).startsWith(root)) throw Object.assign(new Error('write refused'), { code });
      return mkdtemp(...args);
    });
    const result = checkPreparationStorage();
    assert.equal(result.ok, false);
    if (result.ok) assert.fail('storage fault must not pass');
    assert.equal(result.code, 'PREPARATION_STORAGE_UNAVAILABLE');
    assert.match(result.message, /disk space and write permissions/);
    failure.mock.restore();
  }
  assert.deepEqual(checkPreparationStorage(), { ok: true });
  assert.deepEqual(fs.readdirSync(root), ['state']);
});

test('a healthy scratch database does not hide a corrupt state database or replace its bytes', (t) => {
  const root = fixture(t);
  const database = appStateDbPath();
  fs.mkdirSync(path.dirname(database), { recursive: true });
  fs.writeFileSync(database, 'keep this damaged database for recovery');
  const result = checkPreparationStorage();
  assert.equal(result.ok, false);
  if (result.ok) assert.fail('corrupt state must not pass');
  assert.equal(result.code, 'PREPARATION_STORAGE_UNAVAILABLE');
  assert.equal(fs.readFileSync(database, 'utf8'), 'keep this damaged database for recovery');
  assert.deepEqual(fs.readdirSync(root), ['state']);
  // Simulate an explicit repair of this disposable fixture only.
  fs.rmSync(database);
  assert.deepEqual(checkPreparationStorage(), { ok: true });
});


test('a read-only existing state file fails while the application data directory stays writable', (t) => {
  if (process.platform === 'win32' || process.getuid?.() === 0) {
    t.skip('POSIX permissions require a non-root process');
    return;
  }
  const root = fixture(t);
  assert.deepEqual(checkPreparationStorage(), { ok: true });
  const source = path.join(root, 'draft.pdf');
  setConversionStatus(source, 'cancelled');
  closeStateDb();
  const database = appStateDbPath();
  fs.chmodSync(database, 0o400);
  try {
    const result = checkPreparationStorage();
    assert.equal(result.ok, false);
    if (result.ok) assert.fail('read-only state must not pass');
    assert.equal(result.code, 'PREPARATION_STORAGE_UNAVAILABLE');
  } finally {
    closeStateDb();
    // SQLite sidecars inherit the database mode, so repair their permissions
    // as well. Production checks never chmod or delete user state.
    for (const name of fs.readdirSync(path.dirname(database))) {
      fs.chmodSync(path.join(path.dirname(database), name), 0o600);
    }
  }
  assert.deepEqual(checkPreparationStorage(), { ok: true });
  assert.equal(getConversionStatus(source)?.status, 'cancelled');
});

test('a scratch directory that cannot be removed does not fail a passed check', (t) => {
  const root = fixture(t);
  const rm = fs.rmSync;
  t.mock.method(fs, 'rmSync', (...args: Parameters<typeof rm>) => {
    if (path.basename(String(args[0])).startsWith('.storage-check-')) {
      throw Object.assign(new Error('resource busy or locked'), { code: 'EBUSY' });
    }
    return rm(...args);
  });
  assert.deepEqual(checkPreparationStorage(), { ok: true });
  setConversionStatus(path.join(root, 'draft.pdf'), 'done');
  assert.equal(getConversionStatus(path.join(root, 'draft.pdf'))?.status, 'done', 'the state database stays open after the check');
});

test('another process holding the state write lock neither stalls nor fails the startup check', async (t) => {
  fixture(t);
  assert.deepEqual(checkPreparationStorage(), { ok: true });
  closeStateDb();
  // A separate process, like a second StashBase host sharing this app data,
  // holds the lock until told to let go.
  const holder = spawn(process.execPath, ['--eval', `
    const db = new (require('better-sqlite3'))(process.env.STATE_DB);
    db.exec('BEGIN IMMEDIATE');
    console.log('locked');
    process.stdin.once('data', () => setTimeout(() => { db.exec('COMMIT'); db.close(); }, 500));
  `], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    env: { ...process.env, STATE_DB: appStateDbPath() },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  t.after(() => holder.kill());
  await once(holder.stdout!, 'data');

  const started = Date.now();
  assert.deepEqual(checkPreparationStorage(), { ok: true });
  // The default busy timeout is 5 s; the check gives up on a held lock well before it.
  assert.ok(Date.now() - started < 4_000, 'the check must not wait for the full busy timeout');
  // Ordinary writes keep the full timeout: one made while the lock is still
  // held waits for its release instead of failing after the check's 250 ms.
  await new Promise<void>((resolve) => holder.stdin!.end('release', resolve));
  const source = path.join(os.tmpdir(), 'draft.pdf');
  setConversionStatus(source, 'done');
  assert.equal(getConversionStatus(source)?.status, 'done');
  await once(holder, 'exit');
});
