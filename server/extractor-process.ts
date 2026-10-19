import { spawn, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import { extractorSpawn } from './python-host.ts';
import { errorDiagnostic, diagnosticText } from '../shared/protocols/diagnostics.ts';
import type { z } from 'zod';
import type { processTerminationSchema } from '../shared/protocols/http/telemetry.ts';

const KILL_GRACE_MS = 1500;
const EXTRACTOR_NICE_PRIORITY = 15;
const STDERR_TAIL_BYTES = 64 * 1024;

interface ExtractorSpawnOptions {
  detached: boolean;
  stdio: ['ignore', 'pipe', 'pipe'];
  env: NodeJS.ProcessEnv;
}

export function spawnOptionsForExtractor(): ExtractorSpawnOptions {
  return {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      OMP_NUM_THREADS: process.env.STASHBASE_EXTRACTOR_THREADS ?? '1',
      OPENBLAS_NUM_THREADS: process.env.STASHBASE_EXTRACTOR_THREADS ?? '1',
      MKL_NUM_THREADS: process.env.STASHBASE_EXTRACTOR_THREADS ?? '1',
      VECLIB_MAXIMUM_THREADS: process.env.STASHBASE_EXTRACTOR_THREADS ?? '1',
      NUMEXPR_NUM_THREADS: process.env.STASHBASE_EXTRACTOR_THREADS ?? '1',
      OMP_WAIT_POLICY: 'PASSIVE',
    },
  };
}

/** PDF/OCR use a console-enabled Python sidecar for progress reporting.
 * Windows cancellation already uses taskkill /T, so detaching is unnecessary
 * there and would allocate a console window for every extractor launch. */
export function spawnOptionsForPdfOcr(
  platform: NodeJS.Platform = process.platform,
): ExtractorSpawnOptions & { windowsHide: boolean } {
  return {
    ...spawnOptionsForExtractor(),
    detached: platform !== 'win32',
    windowsHide: true,
  };
}

export function lowerExtractorPriority(proc: ChildProcess): void {
  if (!proc.pid) return;
  try {
    os.setPriority(proc.pid, EXTRACTOR_NICE_PRIORITY);
  } catch {
    // Best effort only. Thread limits above are the primary guard; priority
    // lowering is an extra courtesy to keep the Electron UI responsive.
  }
}

export interface ExtractorRun {
  mode: 'pdf' | 'ocr';
  script: string;
  args: string[];
  signal?: AbortSignal;
  /** Called for each complete stderr line, including a final unterminated one. */
  onStderrLine?: (line: string) => void;
}

export interface ExtractorOutcome {
  /** Exit code once the whole process tree is gone; null when signal-terminated. */
  code: number | null;
  /** True when `signal` aborted the run; the tree has been reaped. */
  cancelled: boolean;
  /** Last three trimmed stderr lines, for failure messages. */
  stderrTail: string;
}

/** Spawn one PDF/OCR extractor at lowered priority and settle after its whole
 * process tree has exited. Rejects only when the spawn itself fails; exit
 * codes and cancellation are the caller's error policy. */
export function runExtractor({ mode, script, args, signal, onStderrLine }: ExtractorRun): Promise<ExtractorOutcome> {
  return new Promise((resolve, reject) => {
    const spawnSpec = extractorSpawn(mode, script, args);
    const proc = spawn(spawnSpec.cmd, spawnSpec.args, spawnOptionsForPdfOcr());
    lowerExtractorPriority(proc);
    let stderr = '';
    let lineBuffer = '';
    let cancelled = false;
    const onAbort = () => {
      cancelled = true;
      terminateExtractorTree(proc);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    proc.stderr?.on('data', (chunk) => {
      const text = String(chunk);
      stderr = (stderr + text).slice(-STDERR_TAIL_BYTES);
      const lines = (lineBuffer + text).split(/\r?\n/);
      lineBuffer = lines.pop() ?? '';
      for (const line of lines) onStderrLine?.(line);
    });
    proc.on('error', (err) => {
      signal?.removeEventListener('abort', onAbort);
      reject(new Error(`spawn failed: ${err.message}`));
    });
    void waitForExtractorTree(proc).then((code) => {
      signal?.removeEventListener('abort', onAbort);
      if (lineBuffer) onStderrLine?.(lineBuffer);
      resolve({ code, cancelled, stderrTail: stderr.trim().split('\n').slice(-3).join('\n') });
    }, reject);
  });
}

/** Install immediately after spawn. Completion includes pipe release and descendants,
 * even if the leader exits first. Cancellation still uses terminateExtractorTree. */
export function waitForExtractorTree(proc: ChildProcess): Promise<number | null> {
  return new Promise((resolve, reject) => {
    let closed = false;
    let poll: ReturnType<typeof setInterval> | undefined;
    const cleanup = () => {
      clearInterval(poll);
      proc.off('error', fail);
      proc.off('exit', onExit);
      proc.off('close', onClose);
    };
    const inspect = () => {
      if (!closed || (process.platform !== 'win32' && extractorGroupExists(proc))) return;
      cleanup();
      resolve(proc.exitCode);
    };
    const fail = (error: Error) => { cleanup(); reject(error); };
    const onExit = () => {
      if (process.platform !== 'win32' && extractorGroupExists(proc)) terminateExtractorTree(proc);
      poll = setInterval(inspect, 25);
    };
    const onClose = () => { closed = true; inspect(); };
    proc.once('error', fail);
    proc.once('exit', onExit);
    proc.once('close', onClose);
  });
}

export type ProcessTermination = z.infer<typeof processTerminationSchema>;

/** The snapshot is updated as termination progresses; it contains no command or environment. */
export function terminateExtractorTree(proc: ChildProcess, options: {
  platform?: NodeJS.Platform; spawn?: typeof spawn;
} = {}): ProcessTermination {
  if ((options.platform ?? process.platform) === 'win32') {
    return terminateWindowsTree(proc, options.spawn ?? spawn);
  }
  const result: ProcessTermination = { method: 'signals', escalated: false };
  sendSignal(proc, 'SIGTERM');
  setTimeout(() => {
    // The group can outlive its leader while descendants still own pipes.
    if (extractorGroupExists(proc) || (proc.exitCode == null && proc.signalCode == null)) {
      result.escalated = true;
      sendSignal(proc, 'SIGKILL');
    }
  }, KILL_GRACE_MS).unref();
  return result;
}

/** Node cannot address Windows process groups with a negative PID. `taskkill`
 * is the OS-provided tree primitive; `/T /F` makes cancellation a real tree
 * kill before the scheduler observes the extractor's close event. */
function terminateWindowsTree(proc: ChildProcess, spawnProcess: typeof spawn): ProcessTermination {
  const result: ProcessTermination = { method: 'taskkill', fallback_attempted: false };
  if (!proc.pid) return result;
  const fallback = () => {
    if (!result.fallback_attempted && proc.exitCode == null && proc.signalCode == null) {
      result.fallback_attempted = true;
      try { result.fallback_sent = proc.kill(); }
      catch (error) { result.fallback_error = errorDiagnostic(error); }
    }
  };
  try {
    result.taskkill_state = 'pending';
    const killer = spawnProcess('taskkill.exe', ['/PID', String(proc.pid), '/T', '/F'], {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });
    let stderr = '';
    killer.stderr?.on('data', (chunk: Buffer | string) => {
      stderr = (stderr + String(chunk)).slice(-8_000);
      result.taskkill_stderr = diagnosticText(stderr);
    });
    killer.once('error', (error) => {
      result.taskkill_state = 'spawn_failed';
      result.taskkill_error = errorDiagnostic(error);
      fallback();
    });
    killer.once('close', (code, signal) => {
      if (result.taskkill_state !== 'spawn_failed') result.taskkill_state = 'finished';
      if (code !== null) result.taskkill_exit_code = code;
      if (signal !== null) result.taskkill_signal = signal;
      if (code !== 0) fallback();
    });
  } catch (error) {
    result.taskkill_state = 'spawn_failed';
    result.taskkill_error = errorDiagnostic(error);
    fallback();
  }
  return result;
}

function extractorGroupExists(proc: ChildProcess): boolean {
  if (!proc.pid) return false;
  try {
    process.kill(-proc.pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function sendSignal(proc: ChildProcess, signal: NodeJS.Signals): void {
  if (!proc.pid) return;
  try {
    process.kill(-proc.pid, signal);
  } catch {
    if (proc.exitCode == null && proc.signalCode == null) {
      try { proc.kill(signal); } catch { /* already gone */ }
    }
  }
}
