/** Current preparation failures/cancellations; MFS owns indexing state. */
import { createRequire } from 'node:module';
import type BetterSqlite3 from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { appDataRoot, appStateDbPath } from './local-data.ts';
import { errorCode, logger } from './log.ts';
import { filesystemPath } from './filesystem-path.ts';

export type ConversionStatus = 'in-flight' | 'done' | 'failed' | 'cancelled';

export interface ConversionStatusEntry {
  status: ConversionStatus;
  attempts: number;
  lastError?: string;
  lastAttemptAt: string;
  doneAt?: string;
}

const nodeRequire = createRequire(import.meta.url);

let DatabaseCtor: typeof BetterSqlite3 | null | undefined;
let db: BetterSqlite3.Database | null = null;
let dbPath: string | null = null;
type StatusWrite = { pathKey: string; status: ConversionStatus; opts: { error?: string; incrementAttempts?: boolean } };
// Failed terminal writes remain pending in this process. Reads fail closed until
// storage is usable, then replay them before discovery can admit more work.
const pendingWrites = new Map<string, Map<string, StatusWrite>>();

export type PreparationStorageCheck =
  | { ok: true }
  | { ok: false; code: 'PREPARATION_NATIVE_UNAVAILABLE' | 'PREPARATION_STORAGE_UNAVAILABLE'; message: string };

function storageFailure(cause: unknown): Extract<PreparationStorageCheck, { ok: false }> {
  const code = errorCode(cause);
  const native = code === 'ERR_DLOPEN_FAILED' || code === 'MODULE_NOT_FOUND'
    || (cause instanceof Error && /Could not locate the bindings file/.test(cause.message));
  if (native) {
    const recovery = process.env.STASHBASE_PACKAGED === '1'
      ? 'Reinstall StashBase using the installer for this computer, then reopen it. If this continues, report a bug.'
      : `With the Node runtime used to start StashBase (${process.version}, ABI ${process.versions.modules}), run pnpm rebuild better-sqlite3 in the source checkout, then restart StashBase.`;
    return { ok: false, code: 'PREPARATION_NATIVE_UNAVAILABLE',
      message: `Preparation status is unavailable because the local database module could not load. ${recovery}` };
  }
  return { ok: false, code: 'PREPARATION_STORAGE_UNAVAILABLE',
    message: 'Preparation status could not be saved or read. Check free disk space and write permissions for the StashBase application data directory, then restart StashBase. If this continues, report a bug; keep the existing data for recovery.' };
}

/** Check the runtime that actually owns SQLite, before any project is opened.
 * Reopening a disposable disk database verifies persistence and WAL support,
 * not just module resolution or a directory's advertised permissions. */
export function checkPreparationStorage(): PreparationStorageCheck {
  let probe: BetterSqlite3.Database | undefined;
  let temporary: string | undefined;
  try {
    try {
      DatabaseCtor ??= nodeRequire('better-sqlite3') as typeof BetterSqlite3;
      // Load the native binding before touching storage, so an ABI mismatch
      // is diagnosed even when the app data directory has not been created.
      probe = new DatabaseCtor(':memory:');
      probe.close();
      probe = undefined;
      fs.mkdirSync(appDataRoot(), { recursive: true });
      temporary = fs.mkdtempSync(path.join(appDataRoot(), '.storage-check-'));
      const filename = path.join(temporary, 'probe.db');
      probe = new DatabaseCtor(filename, { timeout: 1_000 });
      probe.pragma('journal_mode = WAL');
      probe.exec('CREATE TABLE probe (value TEXT NOT NULL)');
      probe.prepare('INSERT INTO probe (value) VALUES (?)').run('storage-check');
      probe.close();
      probe = new DatabaseCtor(filename, { readonly: true, fileMustExist: true });
      const row = probe.prepare('SELECT value FROM probe').get() as { value: string } | undefined;
      if (row?.value !== 'storage-check') throw new Error('Local database round trip failed');
      // A writable scratch directory does not prove the existing state file
      // is readable. Preserve it and report failure instead of replacing it.
      const state = getStateDb();
      // Acquire write access without changing a row. Existing read-only state
      // must not pass merely because the parent allows scratch files.
      state.transaction(() => {
        state.prepare('UPDATE conversions SET attempts = attempts WHERE 0').run();
      }).immediate();
    } finally {
      try { probe?.close(); }
      finally { if (temporary) fs.rmSync(temporary, { recursive: true, force: true }); }
    }
    return { ok: true };
  } catch (cause) {
    closeStateDb();
    const failure = storageFailure(cause);
    logger('preparation-storage').warn(failure.message, cause);
    return failure;
  }
}

function stateDbPath(): string {
  return appStateDbPath();
}

function getStateDb(): BetterSqlite3.Database {
  const target = stateDbPath();
  try {
    DatabaseCtor ??= nodeRequire('better-sqlite3') as typeof BetterSqlite3;
    if (!db || dbPath !== target) {
      closeStateDb();
      fs.mkdirSync(path.dirname(target), { recursive: true });
      db = new DatabaseCtor(target);
      dbPath = target;
      db.pragma('journal_mode = WAL');
      db.pragma('foreign_keys = ON');
      initializeSchema(db);
    }
    const pending = pendingWrites.get(target);
    for (const [key, write] of pending ?? []) {
      writeStatus(db, write);
      pending!.delete(key);
    }
    pendingWrites.delete(target);
    return db;
  } catch (cause: unknown) {
    closeStateDb();
    throw new Error(storageFailure(cause).message, { cause });
  }
}

export function closeStateDb(): void {
  if (!db) return;
  try { db.close(); } catch { /* ignore */ }
  db = null;
  dbPath = null;
}

function initializeSchema(conn: BetterSqlite3.Database): void {
  conn.exec(`
    CREATE TABLE IF NOT EXISTS conversions (
      path TEXT PRIMARY KEY,
      path_identity TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('in-flight', 'done', 'failed', 'cancelled')),
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      last_attempt_at TEXT NOT NULL,
      done_at TEXT
    );
    CREATE INDEX IF NOT EXISTS conversions_status_idx ON conversions(status, last_attempt_at);
    CREATE UNIQUE INDEX IF NOT EXISTS conversions_path_identity_idx ON conversions(path_identity);
  `);
}

export function readConversionStatusMap(): Record<string, ConversionStatusEntry> {
  const conn = getStateDb();
  const rows = conn.prepare(`
    SELECT path, status, attempts, last_error AS lastError,
           last_attempt_at AS lastAttemptAt, done_at AS doneAt
    FROM conversions
    ORDER BY path
  `).all() as Array<{ path: string } & ConversionStatusEntry>;
  const out: Record<string, ConversionStatusEntry> = {};
  for (const row of rows) {
    const { path: rowPath, ...entry } = row;
    out[rowPath] = {
      status: entry.status,
      attempts: entry.attempts,
      lastAttemptAt: entry.lastAttemptAt,
      ...(entry.lastError ? { lastError: entry.lastError } : {}),
      ...(entry.doneAt ? { doneAt: entry.doneAt } : {}),
    };
  }
  return out;
}

export function getConversionStatus(pathKey: string): ConversionStatusEntry | undefined {
  const conn = getStateDb();
  const row = conn.prepare(`
    SELECT status, attempts, last_error AS lastError,
           last_attempt_at AS lastAttemptAt, done_at AS doneAt
    FROM conversions
    WHERE path_identity = ?
    LIMIT 1
  `).get(filesystemPath.identity(pathKey)) as ConversionStatusEntry | undefined;
  if (!row) return undefined;
  return {
    status: row.status,
    attempts: row.attempts,
    lastAttemptAt: row.lastAttemptAt,
    ...(row.lastError ? { lastError: row.lastError } : {}),
    ...(row.doneAt ? { doneAt: row.doneAt } : {}),
  };
}


export function setConversionStatus(pathKey: string, status: ConversionStatus, opts: { error?: string; incrementAttempts?: boolean } = {}): void {
  const target = stateDbPath();
  let pending = pendingWrites.get(target);
  if (!pending) { pending = new Map(); pendingWrites.set(target, pending); }
  pending.set(filesystemPath.identity(pathKey), { pathKey, status, opts });
  getStateDb();
}

function writeStatus(conn: BetterSqlite3.Database, { pathKey, status, opts }: StatusWrite): void {
  const prev = conn.prepare('SELECT attempts FROM conversions WHERE path_identity = ?')
    .get(filesystemPath.identity(pathKey)) as { attempts: number } | undefined;
  const sourcePath = filesystemPath.absolute(pathKey);
  const pathIdentity = filesystemPath.identity(sourcePath);
  const now = new Date().toISOString();
  conn.prepare(`
    INSERT INTO conversions (path, path_identity, status, attempts, last_error, last_attempt_at, done_at)
    VALUES (@path, @pathIdentity, @status, @attempts, @lastError, @lastAttemptAt, @doneAt)
    ON CONFLICT(path_identity) DO UPDATE SET
      status = excluded.status,
      attempts = excluded.attempts,
      last_error = excluded.last_error,
      last_attempt_at = excluded.last_attempt_at,
      done_at = excluded.done_at
  `).run({
    path: sourcePath,
    pathIdentity,
    status,
    attempts: opts.incrementAttempts ? (prev?.attempts ?? 0) + 1 : (prev?.attempts ?? 1),
    lastError: opts.error ?? null,
    lastAttemptAt: now,
    doneAt: status === 'done' ? now : null,
  });
}

export function clearConversionStatus(pathKey: string): void {
  const conn = getStateDb();
  conn.prepare('DELETE FROM conversions WHERE path_identity = ?')
    .run(filesystemPath.identity(pathKey));
}

export function clearConversionStatusUnder(pathKey: string, excludedRoots: readonly string[] = []): void {
  const conn = getStateDb();
  const rows = conn.prepare('SELECT path_identity AS pathIdentity FROM conversions')
    .all() as Array<{ pathIdentity: string }>;
  const matches = rows
    .map((row) => row.pathIdentity)
    .filter((identity) => filesystemPath.contains(pathKey, identity)
      && !excludedRoots.some((root) => filesystemPath.contains(root, identity)));
  if (matches.length === 0) return;
  const remove = conn.prepare('DELETE FROM conversions WHERE path_identity = ?');
  conn.transaction((identities: string[]) => {
    for (const identity of identities) remove.run(identity);
  })(matches);
}

export function listConversionStatus(status: ConversionStatus): Array<{ path: string; entry: ConversionStatusEntry }> {
  const conn = getStateDb();
  const rows = conn.prepare(`
    SELECT path, status, attempts, last_error AS lastError,
           last_attempt_at AS lastAttemptAt, done_at AS doneAt
    FROM conversions
    WHERE status = ?
    ORDER BY path
  `).all(status) as Array<{ path: string } & ConversionStatusEntry>;
  return rows.map((row) => ({
    path: row.path,
    entry: {
      status: row.status,
      attempts: row.attempts,
      lastAttemptAt: row.lastAttemptAt,
      ...(row.lastError ? { lastError: row.lastError } : {}),
      ...(row.doneAt ? { doneAt: row.doneAt } : {}),
    },
  }));
}
