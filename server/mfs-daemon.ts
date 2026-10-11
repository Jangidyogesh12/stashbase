/**
 * MFS sidecar daemon manager.
 *
 * Spawns `python/stashbase_daemon.py` once per server process, talks to
 * it over stdin/stdout in line-delimited JSON, and matches replies back
 * to requests by an auto-incrementing id. Auto-respawns if the daemon
 * dies (in-flight requests get rejected with the exit info).
 *
 * The daemon owns one MFS store in per-machine app data (see
 * `local-data.ts:globalVectorStoreDir`). Every Folder registers an absolute
 * root and maps to one MFS Internal namespace. The Node side records each
 * binding here so a respawn can replay it.
 *
 * Python lives in `<project>/python/.venv.nosync/bin/python` after the user
 * runs `pnpm setup:python`. In packaged Electron a portable Python
 * runtime is bundled via `extraResources` and the path is overridden
 * via `STASHBASE_PYTHON` env var (see `electron/main.cjs`).
 */
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { logger } from './log.ts';
import { globalVectorStoreDir } from './local-data.ts';
import { filesystemPath } from './filesystem-path.ts';
import { isDevelopmentRuntime } from './development-runtime.ts';
import { nativeComponentUnavailable } from './native-component-support.ts';
import type { EmbedderProvider } from '../shared/embedding.ts';

const log = logger('mfs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = process.env.STASHBASE_APP_ROOT
  ? path.resolve(process.env.STASHBASE_APP_ROOT)
  : path.resolve(__dirname, '..');
const RESOURCES_ROOT = process.env.STASHBASE_RESOURCES_PATH
  ? path.resolve(process.env.STASHBASE_RESOURCES_PATH)
  : PROJECT_ROOT;
const DEVELOPMENT_RUNTIME = isDevelopmentRuntime();

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

export const MFS_DAEMON_RETIRING = 'MFS_DAEMON_RETIRING';

/** Typed interruption emitted only when Node deliberately retires the shared
 * daemon. Callers whose operation is safe to restart can distinguish this
 * lifecycle edge from a real daemon or indexing failure. */
export class MfsDaemonRetiringError extends Error {
  readonly code = MFS_DAEMON_RETIRING;

  constructor() {
    super('MFS daemon closing');
    this.name = 'MfsDaemonRetiringError';
  }
}

export function isMfsDaemonRetiringError(error: unknown): error is MfsDaemonRetiringError {
  return error instanceof MfsDaemonRetiringError
    || (typeof error === 'object'
      && error !== null
      && (error as { code?: unknown }).code === MFS_DAEMON_RETIRING);
}

/** Ceiling for one op's reply. A daemon that is alive but never replies
 *  (for example while blocked in an MFS dependency during a competing-store
 *  failure) used to hang
 *  its caller forever: `pending` entries only settle on reply, process
 *  exit, or close(). And since the daemon serialises ops, one wedged op
 *  wedges everything queued behind it.
 *
 *  One generous global ceiling, deliberately NOT per-op tiers: a cheap
 *  `status` can legitimately sit minutes in the serial queue behind a
 *  big embed, so tight per-op budgets would false-positive exactly when
 *  the daemon is busiest. 10 min only catches the genuinely-dead case.
 *  On timeout we presume the process is wedged for good: reject and run
 *  close() — its SIGTERM→SIGKILL ladder exists for the stuck-in-C-
 *  extension case — so the next call respawns and replays bindings. */
const CALL_TIMEOUT_MS = 10 * 60_000;

/** Ceiling for the `ready` handshake after spawn. A child that starts
 *  but never prints `ready` (for example while another process owns the MFS
 *  store) would leave `readyP` — and therefore every
 *  call() — pending forever. */
const READY_TIMEOUT_MS = 90_000;

export interface BindFolderArgs {
  provider: EmbedderProvider;
  apiKey?: string;
  model?: string;
  dimension?: number;
  baseUrl?: string;
}

export interface DaemonCommand {
  command: string;
  args: string[];
  cwd: string;
}

/** Singleton-ish handle. Use `getDaemon()` to access. */
export class MfsDaemon extends EventEmitter {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private readyP: Promise<void> | null = null;
  /** One retirement barrier for every concurrent close/reset caller. A new
   * generation must not spawn until the previous child has actually exited
   * and released the process-wide daemon lock. */
  private closeP: Promise<void> | null = null;
  /** Bumps every time we (re)spawn the Python process. Callers that
   *  cache "I already configured this daemon" state can compare against
   *  the value at config time — if it changed, re-issue the config op. */
  private generation = 0;
  /** Bumps on every close() so a spawn still resolving its command when the
   *  daemon is retired does not bring up a child nobody owns. */
  private retirements = 0;

  /** Every folder root the server has asked us to bind. Keyed by comparison
   *  identity while retaining the first source spelling for daemon replay. */
  private bindings = new Map<string, { folder: string; cfg: BindFolderArgs }>();

  constructor(
    private readonly commandResolver: () => DaemonCommand | Promise<DaemonCommand> = resolveDaemonCommand,
  ) {
    super();
  }

  /** Spawn (idempotent) and resolve only after the daemon has accepted every
   * retained Folder binding. Public operations never race the bootstrap
   * handshake. */
  async ensureReady(): Promise<void> {
    // `close()` clears `proc`/`readyP` before the child has necessarily
    // released its flock. A concurrent config reset used to observe that
    // empty slot and spawn a replacement early; wait through every retirement
    // that became current before this continuation resumes.
    while (this.closeP) await this.closeP;
    if (this.readyP) return this.readyP;
    const attempt = this.spawnAndConfigure();
    this.readyP = attempt;
    try {
      await attempt;
    } catch (err) {
      if (this.readyP === attempt) {
        this.readyP = null;
        await this.close();
      }
      throw err;
    }
  }

  private async spawnAndConfigure(): Promise<void> {
    await this.spawnAndWait();
    for (const { folder, cfg } of this.bindings.values()) {
      await this.callReadyProcess('bind_folder', bindFolderPayload(folder, cfg));
    }
  }

  /** Opaque token identifying the current Python process. Increments on
   *  every respawn. Callers should treat as a black-box equality check. */
  currentGeneration(): number {
    return this.generation;
  }

  /** Issue a `bind_folder` op, recording the binding for replay on a
   *  later respawn. Safe to call repeatedly with the same args (the
   *  daemon-side op is idempotent). */
  async bindFolder(folder: string, cfg: BindFolderArgs): Promise<void> {
    const requested = filesystemPath.absolute(folder);
    const key = filesystemPath.identity(requested);
    const source = this.bindings.get(key)?.folder ?? requested;
    this.bindings.set(key, { folder: source, cfg });
    await this.call('bind_folder', {
      folder: source,
      folder_identity: key,
      provider: cfg.provider,
      ...(cfg.apiKey ? { api_key: cfg.apiKey } : {}),
      ...(cfg.model ? { model: cfg.model } : {}),
      ...(cfg.dimension ? { dimension: cfg.dimension } : {}),
      ...(cfg.baseUrl ? { base_url: cfg.baseUrl } : {}),
    });
  }

  /** Drop the renderer-side binding entry AND ask the daemon to stop
   *  routing new files for the folder. Existing rows stay searchable
   *  until explicit delete. */
  async unbindFolder(folder: string): Promise<void> {
    const requested = filesystemPath.absolute(folder);
    const key = filesystemPath.identity(requested);
    const source = this.bindings.get(key)?.folder ?? requested;
    this.bindings.delete(key);
    if (this.proc) {
      try { await this.call('unbind_folder', { folder: source, folder_identity: key }); }
      catch (err) { log.warn(`unbind_folder ${source} failed:`, err); }
    }
  }

  /** Snapshot of every folder currently bound on the renderer side. */
  knownBindings(): ReadonlyMap<string, BindFolderArgs> {
    return new Map([...this.bindings.values()].map(({ folder, cfg }) => [folder, cfg]));
  }

  /** Forget every recorded binding. Used when the global embedder
   *  credential changes: replaying bindings captured with the old key
   *  would recreate the Python embedder with stale credentials before
   *  the fresh bind lands. */
  forgetBindings(): void {
    this.bindings.clear();
  }

  private async spawnAndWait(): Promise<void> {
    // Resolving the command may probe the Python runtime, which is slow on a
    // loaded machine. No child exists yet, so a close() that lands meanwhile
    // finds nothing to retire; the counter lets that close win instead of
    // this attempt spawning an orphan afterwards.
    const retirementsBefore = this.retirements;
    const daemon = await this.commandResolver();
    if (this.retirements !== retirementsBefore) throw new MfsDaemonRetiringError();
    return new Promise<void>((resolve, reject) => {
      log.info(`spawning ${daemon.command} ${daemon.args.join(' ')}`);
      const proc = spawn(daemon.command, daemon.args, {
        cwd: daemon.cwd,
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
          // MFS's pinned backend spins up a gRPC server in-process; its client
          // client's default keepalive ping (every 10s) is too aggressive
          // for that loopback server and trips a `ENHANCE_YOUR_CALM`
          // GOAWAY ~every minute. The reconnect is transparent — only
          // the log is noisy. Drop gRPC's INFO chatter to ERROR.
          GRPC_VERBOSITY: process.env.GRPC_VERBOSITY ?? 'ERROR',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.proc = proc;
      this.generation += 1;

      // Ready-handshake watchdog — see READY_TIMEOUT_MS. SIGKILL (not
      // SIGTERM): a child stuck in a native MFS dependency may not run a
      // signal handler. The exit handler
      // below turns the kill into a rejection callers can observe.
      const readyTimer = setTimeout(() => {
        log.warn(`daemon did not report ready within ${READY_TIMEOUT_MS / 1000}s — killing`);
        try { proc.kill('SIGKILL'); } catch { /* already gone */ }
      }, READY_TIMEOUT_MS);
      readyTimer.unref();
      let ready = false;
      const failAll = (err: Error) => {
        // A retiring generation can report its exit after another lifecycle
        // continuation has begun. It no longer owns the shared pending map or
        // readiness latch, so its late event must not invalidate the current
        // child. The close barrier prevents that overlap in normal operation;
        // this identity fence keeps the callback safe by construction.
        if (this.proc !== proc) return;
        for (const slot of this.pending.values()) slot.reject(err);
        this.pending.clear();
        this.proc = null;
        this.readyP = null;
      };
      const onReady = () => {
        ready = true;
        clearTimeout(readyTimer);
        resolve();
      };

      const lines = readline.createInterface({ input: proc.stdout });
      lines.on('line', (line) => this.onLine(line, onReady));

      proc.stderr.on('data', (chunk: Buffer) => {
        process.stderr.write(`[mfs/py] ${chunk.toString()}`);
      });

      proc.on('error', (err) => {
        clearTimeout(readyTimer);
        log.warn(`MFS daemon spawn failed:`, err);
        failAll(err);
        reject(err);
      });

      proc.on('exit', (code, signal) => {
        clearTimeout(readyTimer);
        const err = Object.assign(new Error(
          `MFS daemon exited (code=${code}, signal=${signal ?? 'null'})`,
        ), code === null ? {} : { exitCode: code });
        // close() detaches its child first; only an exit nobody asked for is a warning.
        if (this.proc === proc) log.warn(err);
        else log.info(err.message);
        failAll(err);
        // If we never got `ready`, surface the failure to the caller.
        if (!ready) reject(err);
      });
    });
  }

  private onLine(line: string, readyResolve: () => void): void {
    let msg: any;
    try { msg = JSON.parse(line); } catch {
      log.warn(`non-JSON line from daemon: ${line}`);
      return;
    }
    if ('event' in msg) {
      // Namespaced event prefix so a daemon-side `{event:"error"}` doesn't
      // collide with EventEmitter's bare 'error' (which is fatal without
      // a listener).
      this.emit(`daemon:${msg.event}`, msg);
      if (msg.event === 'ready') {
        log.info(`daemon ready: store=${msg.db}`);
        readyResolve();
      } else if (msg.event === 'starting') {
        log.info(`daemon starting, pid=${msg.pid}`);
      } else if (msg.event === 'error') {
        const hint = /No module named/i.test(msg.error ?? '')
          ? '\n  → Looks like the Python sidecar deps aren\'t installed. Run: pnpm setup:python'
          : '';
        log.warn(`daemon error in ${msg.phase}: ${msg.error}${hint}`);
      }
      return;
    }
    const id = msg.id;
    const slot = this.pending.get(id);
    if (!slot) {
      log.warn(`reply with unknown id=${id}`);
      return;
    }
    this.pending.delete(id);
    if (msg.ok) slot.resolve(msg.result);
    else slot.reject(new Error(msg.error ?? 'daemon error'));
  }

  /** Send one op and await the matching reply. Awaits `ensureReady` first. */
  async call<T = unknown>(op: string, args: Record<string, unknown>): Promise<T> {
    await this.ensureReady();
    return this.callReadyProcess<T>(op, args);
  }

  /** Send one op after the raw process-ready event. Bootstrap uses this
   * directly to avoid awaiting its own configured-ready promise. */
  private async callReadyProcess<T = unknown>(op: string, args: Record<string, unknown>): Promise<T> {
    if (!this.proc) throw new Error('MFS daemon not running');
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      // No-reply watchdog — see CALL_TIMEOUT_MS. The timer is cleared on
      // any settle path (reply, daemon exit, close()) via the wrappers.
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        log.warn(
          `daemon op ${op} (id=${id}) got no reply in ${CALL_TIMEOUT_MS / 60_000}min — ` +
            'presuming wedged, restarting daemon',
        );
        reject(new Error(`daemon op ${op} timed out after ${CALL_TIMEOUT_MS / 60_000}min`));
        void this.close();
      }, CALL_TIMEOUT_MS);
      timer.unref();
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v as T); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.proc!.stdin.write(JSON.stringify({ id, op, args }) + '\n');
    });
  }

  async close(): Promise<void> {
    if (this.closeP) return this.closeP;
    const proc = this.proc;
    this.proc = null;
    this.readyP = null;
    this.retirements += 1;
    // Reject any in-flight calls so awaiters don't hang forever once
    // the process is gone.
    const inflight = [...this.pending.values()];
    this.pending.clear();
    const closeErr = new MfsDaemonRetiringError();
    for (const slot of inflight) slot.reject(closeErr);
    if (!proc) return;
    proc.stdin.end();
    // Escalation ladder: graceful EOF → SIGTERM → SIGKILL. The Python
    // signal handler can't run while the main thread is blocked inside
    // a native MFS dependency, so a stuck daemon won't die
    // on SIGTERM. SIGKILL can't be caught — guarantees the slot frees
    // up so the next bind doesn't trip on a stale flock.
    const retirement = new Promise<void>((resolve) => {
      let exited = false;
      const termTimer = setTimeout(() => {
        if (exited) return;
        try { proc.kill('SIGTERM'); } catch { /* already gone */ }
      }, 1500);
      const killTimer = setTimeout(() => {
        if (exited) return;
        try { proc.kill('SIGKILL'); } catch { /* already gone */ }
        const finalTimer = setTimeout(() => { if (!exited) resolve(); }, 500);
        finalTimer.unref();
      }, 3000);
      proc.once('exit', () => {
        exited = true;
        clearTimeout(termTimer);
        clearTimeout(killTimer);
        resolve();
      });
    });
    this.closeP = retirement;
    try {
      await retirement;
    } finally {
      if (this.closeP === retirement) this.closeP = null;
    }
  }
}

/** Locate the Python binary. Precedence:
 *   1. ``STASHBASE_PYTHON`` env (used by packaged Electron to point at the
 *      bundled portable runtime under ``process.resourcesPath``).
 *   2. ``python/.venv.nosync/bin/python`` populated by ``pnpm setup:python``.
 *   3. system ``python3.13`` / ``python3`` — last resort, giving a clearer
 *      import error than a command-resolution failure. */
async function resolvePythonBin(): Promise<string> {
  const bin = (() => {
    if (process.env.STASHBASE_PYTHON) return process.env.STASHBASE_PYTHON;
    // The packaged runtime / venv live under RESOURCES_ROOT; in dev
    // RESOURCES_ROOT falls back to PROJECT_ROOT, so a stray `python/.venv`
    // (e.g. copied in from another checkout) would shadow the dev
    // `python/.venv.nosync`. Skip the packaged candidates in dev — same
    // guard as resolveDaemonBinary. STASHBASE_PYTHON still wins.
    if (!DEVELOPMENT_RUNTIME) {
      for (const candidate of pythonCandidates(path.join(RESOURCES_ROOT, 'python', 'runtime'))) {
        if (existsSync(candidate)) return candidate;
      }
      for (const candidate of pythonCandidates(path.join(RESOURCES_ROOT, 'python', '.venv'))) {
        if (existsSync(candidate)) return candidate;
      }
    }
    for (const candidate of pythonCandidates(path.join(PROJECT_ROOT, 'python', '.venv.nosync'))) {
      if (existsSync(candidate)) return candidate;
    }
    log.warn('python/.venv.nosync not found, falling back to system `python3`');
    return 'python3';
  })();

  await probePythonDeps(bin);
  return bin;
}

const PYTHON_PROBE_TIMEOUT_MS = 30_000;
const PYTHON_PROBE_IMPORTS = 'import mfs, openai, numpy';

/** Bounded check that the interpreter can import the sidecar deps, run at
 *  daemon spawn. It stays off the event loop: an interpreter whose import
 *  deadlocks (a corrupt venv where `import openai` never returns), or one that
 *  is merely slow on a loaded machine, must not keep the server from answering
 *  `/api/health` or the app from launching. A timeout turns either into a
 *  clear, recoverable error. SIGKILL, because a child stuck in a native import
 *  may not honor SIGTERM. */
function probePythonDeps(bin: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    execFile(
      bin,
      ['-c', PYTHON_PROBE_IMPORTS],
      { encoding: 'utf8', timeout: PYTHON_PROBE_TIMEOUT_MS, killSignal: 'SIGKILL' },
      (error, _stdout, stderr) => {
        if (!error) return resolve();
        const reason = error.killed
          ? `${PYTHON_PROBE_IMPORTS} did not finish within ${PYTHON_PROBE_TIMEOUT_MS / 1000}s`
          : typeof error.code === 'string'
            ? error.message
            : ((stderr || '').trim().split('\n').pop() || error.message);
        reject(
          new Error(
            `Python sidecar deps missing or unusable at ${bin}\n` +
              `  ${reason}\n` +
              `  → fix: pnpm setup:python`,
          ),
        );
      },
    );
  });
}

function pythonCandidates(root: string): string[] {
  return process.platform === 'win32'
    ? [
        path.join(root, 'Scripts', 'python.exe'),
        path.join(root, 'bin', 'python'),
      ]
    : [
        path.join(root, 'bin', 'python'),
        path.join(root, 'Scripts', 'python.exe'),
      ];
}

async function resolveDaemonCommand(): Promise<DaemonCommand> {
  const unavailable = nativeComponentUnavailable();
  if (!DEVELOPMENT_RUNTIME && unavailable) throw new Error(unavailable);
  const binary = resolveDaemonBinary();
  const storeArgs = ['--store-root', globalVectorStoreDir()];
  if (binary) {
    return { command: binary, args: [...storeArgs], cwd: path.dirname(binary) };
  }
  const pythonBin = await resolvePythonBin();
  const script = resolvePythonDaemonScript();
  return { command: pythonBin, args: ['-u', script, ...storeArgs], cwd: PROJECT_ROOT };
}

function bindFolderPayload(folder: string, cfg: BindFolderArgs): Record<string, unknown> {
  return {
    folder,
    folder_identity: filesystemPath.identity(folder),
    provider: cfg.provider,
    ...(cfg.apiKey ? { api_key: cfg.apiKey } : {}),
    ...(cfg.model ? { model: cfg.model } : {}),
    ...(cfg.dimension ? { dimension: cfg.dimension } : {}),
    ...(cfg.baseUrl ? { base_url: cfg.baseUrl } : {}),
  };
}

function resolveDaemonBinary(): string | null {
  // PyInstaller --onedir output: `python/sidecar.nosync/stashbase-daemon/stashbase-daemon`
  // (the outer name is the directory, the inner name is the executable).
  // Repo build dir carries `.nosync` so iCloud leaves it intact; inside the
  // packaged .app it's plain `sidecar` (Resources isn't synced).
  //
  // In a development runtime skip BOTH project-dir
  // bundled-binary candidates and run `python/stashbase_daemon.py` from
  // source. A leftover `python/sidecar*` build would otherwise silently
  // shadow the source — and in dev RESOURCES_ROOT falls back to
  // PROJECT_ROOT, so even the non-`.nosync` candidate resolves into the
  // repo. The dev server would then spawn a frozen (possibly broken,
  // e.g. a half-written PyInstaller onedir missing `_internal/Python`)
  // daemon instead of the live script. STASHBASE_DAEMON_BIN still wins
  // when set explicitly.
  const candidates = [
    process.env.STASHBASE_DAEMON_BIN,
    DEVELOPMENT_RUNTIME
      ? undefined
      : sidecarExecutable(path.join(RESOURCES_ROOT, 'python', 'sidecar'), 'stashbase-daemon'),
    DEVELOPMENT_RUNTIME
      ? undefined
      : sidecarExecutable(path.join(RESOURCES_ROOT, 'python', 'sidecar'), 'stashbase-daemon', { direct: true }),
    DEVELOPMENT_RUNTIME
      ? undefined
      : sidecarExecutable(path.join(PROJECT_ROOT, 'python', 'sidecar.nosync'), 'stashbase-daemon'),
    DEVELOPMENT_RUNTIME
      ? undefined
      : sidecarExecutable(path.join(PROJECT_ROOT, 'python', 'sidecar.nosync'), 'stashbase-daemon', { direct: true }),
  ].filter(Boolean) as string[];
  return candidates.find(isFile) ?? null;
}

function sidecarExecutable(root: string, name: string, opts: { direct?: boolean } = {}): string {
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  return opts.direct
    ? path.join(root, exe)
    : path.join(root, name, exe);
}

function isFile(candidate: string): boolean {
  try { return statSync(candidate).isFile(); } catch { return false; }
}

function resolvePythonDaemonScript(): string {
  const candidates = [
    path.join(RESOURCES_ROOT, 'python', 'stashbase_daemon.py'),
    path.join(PROJECT_ROOT, 'python', 'stashbase_daemon.py'),
  ];
  const script = candidates.find((candidate) => existsSync(candidate));
  if (!script) {
    throw new Error(`Python sidecar script not found. Looked in: ${candidates.join(', ')}`);
  }
  return script;
}

let singleton: MfsDaemon | null = null;
export function getDaemon(): MfsDaemon {
  if (!singleton) singleton = new MfsDaemon();
  return singleton;
}
