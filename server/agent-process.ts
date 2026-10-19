import { randomUUID } from 'node:crypto';
import { diagnosticText, errorDiagnostic } from '../shared/protocols/diagnostics.ts';
import type { ChildProcess } from 'node:child_process';
import type { AgentStopReason, TelemetryEvent } from '../shared/protocols/http/telemetry.ts';
import { terminateExtractorTree, type ProcessTermination } from './extractor-process.ts';
import { markDiagnosticReported } from './error-diagnostics.ts';
import { telemetry } from './telemetry.ts';
import { logger } from './log.ts';

export type { AgentStopReason } from '../shared/protocols/http/telemetry.ts';
type StopEvent = Extract<TelemetryEvent, { event: 'agent_runtime_stop_result' }>;
export interface AgentProcessContext {
  runtime: StopEvent['runtime'];
  purpose: StopEvent['purpose'];
  processStartId?: string;
  runtimeVersion?: string;
}
interface OwnedProcess {
  closed: boolean;
  exited: boolean;
  finished: boolean;
  completion: Promise<void>;
  finish(): void;
  retirement?: Promise<void>;
  poll?: ReturnType<typeof setInterval>;
  context?: AgentProcessContext;
  processStartId: string;
  capture: ReturnType<typeof telemetry.scoped>;
}
const log = logger('agent-process');
const owners = new WeakMap<ChildProcess, OwnedProcess>();
const processes = new Set<ChildProcess>();
const CLOSE_DEADLINE_MS = 4000;

function groupExists(child: ChildProcess): boolean {
  if (!child.pid || process.platform === 'win32') return false;
  try { process.kill(-child.pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}

function inspect(child: ChildProcess, owner: OwnedProcess): void {
  if (!owner.closed || groupExists(child) || owner.finished) return;
  owner.finished = true;
  clearInterval(owner.poll);
  processes.delete(child);
  owner.finish();
}

/** App-server launches use their own POSIX group; Windows termination uses taskkill /T. */
export function ownAgentProcess<T extends ChildProcess>(child: T, context?: AgentProcessContext): T {
  if (owners.has(child)) return child;
  let finish!: () => void;
  const owner: OwnedProcess = {
    closed: false, exited: child.exitCode != null || child.signalCode != null, finished: false,
    completion: new Promise<void>(resolve => { finish = resolve; }), finish: () => finish(),
    context, processStartId: context?.processStartId ?? randomUUID(), capture: telemetry.scoped(),
  };
  owners.set(child, owner);
  processes.add(child);
  const onExit = () => { owner.exited = true; };
  child.once('exit', onExit);
  child.once('close', () => {
    owner.closed = true;
    child.off('exit', onExit);
    inspect(child, owner);
    if (!owner.finished) void retireAgentProcess(child, 'process_exit');
  });
  child.once('error', () => {
    if (!child.pid) { owner.closed = true; inspect(child, owner); }
  });
  return child;
}

/** Unlike the deadline result, this barrier resolves only on verified final closure. */
export function agentProcessClosed(child: ChildProcess): Promise<void> {
  ownAgentProcess(child);
  return owners.get(child)!.completion;
}

/** One termination attempt and one timeout fact, even when several owners await it. */
export function retireAgentProcess(child: ChildProcess, reason: AgentStopReason = 'session_closed'): Promise<void> {
  ownAgentProcess(child);
  const owner = owners.get(child)!;
  if (owner.finished) return Promise.resolve();
  if (owner.retirement) return owner.retirement;
  // Spawn failures and injected test transports have no native process to await.
  if (!child.pid) {
    try { child.kill('SIGTERM'); } catch { /* spawn already failed */ }
    owner.closed = true;
    inspect(child, owner);
    return Promise.resolve();
  }
  const started = performance.now();
  const attemptId = randomUUID();
  let termination: ProcessTermination | undefined;
  let timeoutError: Error | undefined;
  const report = (outcome: StopEvent['outcome']) => {
    if (!owner.context) return;
    owner.capture({ event: 'agent_runtime_stop_result', runtime: owner.context.runtime,
      purpose: owner.context.purpose, reason, attempt_id: attemptId, outcome,
      elapsed_ms: Math.round(performance.now() - started), deadline_ms: CLOSE_DEADLINE_MS,
      exit_observed: owner.exited, pipes_closed: owner.closed,
      ...(child.exitCode != null ? { exit_code: child.exitCode } : {}),
      ...(child.signalCode != null ? { signal: child.signalCode } : {}),
      ...(process.platform !== 'win32' ? { process_tree_alive: groupExists(child) } : {}),
      ...(termination ? { termination: { ...termination } } : {}),
      ...(outcome === 'timeout' ? { diagnostic: errorDiagnostic(timeoutError) } : {}),
      context: { process_start_id: owner.processStartId,
        ...(owner.context.runtimeVersion ? { runtime_version: owner.context.runtimeVersion } : {}) },
    });
  };
  owner.retirement = new Promise<void>((resolve, reject) => {
    const deadline = setTimeout(() => {
      timeoutError = Object.assign(new Error('Agent process did not finish closing after termination.'), {
        code: 'AGENT_PROCESS_CLOSE_TIMEOUT',
      });
      if (owner.context) markDiagnosticReported(timeoutError);
      report('timeout');
      log.info('Agent process retirement timed out', { pid: child.pid, attempt_id: attemptId });
      reject(timeoutError);
      // Keep observing late closure without keeping an otherwise-closed host alive.
    }, CLOSE_DEADLINE_MS);
    void owner.completion.then(() => {
      clearTimeout(deadline);
      report(timeoutError ? 'closed_after_timeout' : 'success');
      resolve(); // A timed-out caller stays rejected; late closure is a separate fact.
    });
    owner.poll = setInterval(() => inspect(child, owner), 25);
    owner.poll.unref();
    termination = terminateExtractorTree(child);
    inspect(child, owner);
  });
  // Detached callers are safe; awaited callers still receive the original failure.
  void owner.retirement.catch(() => {});
  return owner.retirement;
}

/** Includes idle history readers and processes whose original close timed out. */
export async function closeAgentProcesses(): Promise<void> {
  const results = await Promise.allSettled([...processes].map(child => retireAgentProcess(child, 'app_shutdown')));
  const failed = results.find((result) => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
}

/** Bounded process evidence; never serialize the child, environment or command. */
export function agentProcessExitDiagnostic(child: ChildProcess) {
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer | string) => {
    stderr = (stderr + String(chunk)).slice(-8_000);
  });
  return (message: string, code: number | null, signal: string | null) => Object.assign(new Error(message), {
    code: 'AGENT_PROCESS_EXIT', ...(code === null ? {} : { exit_code: code }),
    ...(signal === null ? {} : { signal }), ...(stderr ? { stderr: diagnosticText(stderr) } : {}),
  });
}
