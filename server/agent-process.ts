import { diagnosticText } from '../shared/protocols/diagnostics.ts';
import type { ChildProcess } from 'node:child_process';
import { terminateExtractorTree } from './extractor-process.ts';
import { logger } from './log.ts';

const log = logger('agent-process');
const closed = new WeakSet<ChildProcess>();
const processes = new Set<ChildProcess>();
const retirements = new Map<ChildProcess, Promise<void>>();

function groupExists(child: ChildProcess): boolean {
  if (!child.pid || process.platform === 'win32') return false;
  try { process.kill(-child.pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}

/** App-server launches use their own POSIX group; Windows termination uses taskkill /T. */
export function ownAgentProcess<T extends ChildProcess>(child: T): T {
  processes.add(child);
  child.once('close', () => {
    closed.add(child);
    if (groupExists(child)) void retireAgentProcess(child);
    else processes.delete(child);
  });
  child.once('error', () => { if (!child.pid) processes.delete(child); });
  return child;
}

/** Retain ownership until pipes close, including descendants, and escalate a stalled exit. */
export function retireAgentProcess(child: ChildProcess): Promise<void> {
  const pending = retirements.get(child);
  if (pending) return pending;
  if (closed.has(child) && !groupExists(child)) return Promise.resolve();
  // Spawn failures and injected test transports have no native process to wait for.
  if (!child.pid) {
    try { child.kill('SIGTERM'); } catch { /* spawn already failed */ }
    processes.delete(child);
    return Promise.resolve();
  }
  const retirement = new Promise<void>((resolve, reject) => {
    let pipesClosed = closed.has(child);
    const cleanup = () => {
      clearTimeout(deadline);
      clearInterval(poll);
      child.off('close', onClose);
    };
    const inspect = () => {
      if (pipesClosed && !groupExists(child)) { cleanup(); resolve(); }
    };
    const onClose = () => { pipesClosed = true; inspect(); };
    const deadline = setTimeout(() => {
      cleanup();
      reject(new Error(`Agent process ${child.pid} did not finish closing after termination.`));
    }, 4000);
    const poll = setInterval(inspect, 25);
    child.once('close', onClose);
    terminateExtractorTree(child);
  }).finally(() => {
    retirements.delete(child);
    if (closed.has(child) && !groupExists(child)) processes.delete(child);
  });
  retirements.set(child, retirement);
  // Callers that retire synchronously still report failed cleanup; awaited callers also reject.
  void retirement.catch((error) => log.warn(String(error)));
  return retirement;
}

/** Shutdown includes idle history readers and retirements already removed from session maps. */
export async function closeAgentProcesses(): Promise<void> {
  const results = await Promise.allSettled([
    ...[...processes].map(retireAgentProcess), ...retirements.values(),
  ]);
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
