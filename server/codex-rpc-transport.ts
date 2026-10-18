import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import readline from 'node:readline';
import { agentProcessExitDiagnostic } from './agent-process.ts';
import { appVersion } from './codex-app-server-process.ts';
import { logger } from './log.ts';
import {
  errorFromUnknown,
  rpcError,
  type JsonObject,
  type JsonRpcId,
} from './codex-protocol.ts';

const log = logger('codex-app-server');

export const CODEX_RPC_REQUEST_TIMEOUT_MS = 30000;

export class CodexRpcRequestTimeoutError extends Error {
  constructor(readonly method: string) {
    super(`Codex app-server request timed out: ${method}`);
    this.name = 'CodexRpcRequestTimeoutError';
  }
}

interface PendingRpc {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}
export interface CodexRpcPeerOptions {
  requestTimeoutMs?: number;
  scheduleTimeout?: (callback: () => void, timeoutMs: number) => ReturnType<typeof setTimeout>;
  cancelTimeout?: (timer: ReturnType<typeof setTimeout>) => void;
  onRequest?: (message: { id: JsonRpcId; method: string; params: JsonObject }) => void;
  onNotification?: (method: string, params: JsonObject) => void;
}

/** JSON-RPC correlation and dispatch over an injected line writer. */
export class CodexRpcPeer {
  private nextRequestId = 1;
  private pending = new Map<JsonRpcId, PendingRpc>();
  private closed = false;

  constructor(
    private writeLine: (line: string) => void,
    private options: CodexRpcPeerOptions = {},
  ) {}

  request(method: string, params: unknown): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('Codex app-server is not running.'));
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const pending: PendingRpc = { method, resolve, reject };
      const timeoutMs = this.options.requestTimeoutMs ?? 0;
      if (timeoutMs > 0) {
        const scheduleTimeout = this.options.scheduleTimeout ?? setTimeout;
        pending.timer = scheduleTimeout(() => {
          pending.timer = undefined;
          this.pending.delete(id);
          reject(new CodexRpcRequestTimeoutError(method));
        }, timeoutMs);
        pending.timer.unref?.();
      }
      this.pending.set(id, pending);
      try {
        this.writeLine(JSON.stringify({ id, method, params }));
      } catch (err: unknown) {
        this.pending.delete(id);
        this.clearPendingTimer(pending);
        reject(errorFromUnknown(err));
      }
    });
  }

  respond(id: JsonRpcId, result: unknown): void {
    if (this.closed) return;
    this.writeLine(JSON.stringify({ id, result }));
  }

  reject(id: JsonRpcId, message: string, code = -32603): void {
    if (this.closed) return;
    this.writeLine(JSON.stringify({ id, error: { code, message } }));
  }

  receiveLine(line: string): void {
    if (this.closed) return;
    let message: JsonObject;
    try {
      message = JSON.parse(line) as JsonObject;
    } catch {
      return;
    }

    if ('id' in message && ('result' in message || 'error' in message) && !('method' in message)) {
      this.receiveResponse(message);
      return;
    }
    if (typeof message.method !== 'string') return;
    const params = message.params && typeof message.params === 'object'
      ? message.params as JsonObject
      : {};
    if ('id' in message) {
      this.options.onRequest?.({
        id: message.id as JsonRpcId,
        method: message.method,
        params,
      });
    } else {
      this.options.onNotification?.(message.method, params);
    }
  }

  close(error = new Error('Codex app-server connection closed.')): void {
    if (this.closed) return;
    this.closed = true;
    for (const [, pending] of this.pending) {
      this.clearPendingTimer(pending);
      pending.reject(error);
    }
    this.pending.clear();
  }

  pendingMethods(): string[] {
    return [...new Set([...this.pending.values()].map(({ method }) => method))].slice(0, 20);
  }

  isClosed(): boolean {
    return this.closed;
  }

  private receiveResponse(message: JsonObject): void {
    const id = message.id as JsonRpcId;
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    this.clearPendingTimer(pending);
    if ('error' in message) pending.reject(rpcError(message.error));
    else pending.resolve(message.result);
  }

  private clearPendingTimer(pending: PendingRpc): void {
    if (!pending.timer) return;
    const cancelTimeout = this.options.cancelTimeout ?? clearTimeout;
    cancelTimeout(pending.timer);
    pending.timer = undefined;
  }
}

export interface CodexAppServerConnection {
  readonly rpc: CodexRpcPeer;
  /** The StashBase client handshake every app-server connection begins with. */
  initialize(): Promise<unknown>;
  /** Close the RPC peer and stop reading the process streams. Idempotent. */
  close(error?: Error): void;
  pendingMethods(): string[];
}

/** Wire a spawned app-server's stdio to a JSON-RPC peer. A process exit or
 * spawn error closes the connection with its cause, then reports it through
 * `onExit`; an explicit `close()` reports nothing. Retiring the process stays
 * with the caller. */
export function connectCodexAppServer(
  proc: ChildProcessWithoutNullStreams,
  options: Pick<CodexRpcPeerOptions, 'requestTimeoutMs' | 'onRequest' | 'onNotification'> & {
    onExit?: (error: Error) => void;
  } = {},
): CodexAppServerConnection {
  const rpc = new CodexRpcPeer((line) => {
    if (!proc.stdin.writable) throw new Error('Codex app-server is not running.');
    proc.stdin.write(`${line}\n`);
  }, options);
  const exitDiagnostic = agentProcessExitDiagnostic(proc);
  let finalPending: string[] = [];
  const stdout = readline.createInterface({ input: proc.stdout });
  const stderr = readline.createInterface({ input: proc.stderr });
  stdout.on('line', (line) => rpc.receiveLine(line));
  stderr.on('line', (line) => {
    const clean = line.trim();
    if (clean) log.debug(clean);
  });
  let closed = false;
  const close = (error?: Error): boolean => {
    if (closed) return false;
    closed = true;
    finalPending = rpc.pendingMethods();
    rpc.close(error);
    stdout.close();
    stderr.close();
    return true;
  };
  const exit = (error: Error): void => {
    if (close(error)) options.onExit?.(error);
  };
  proc.once('error', (err) => exit(errorFromUnknown(err)));
  proc.once('close', (code, signal) => {
    exit(exitDiagnostic(`Codex app-server exited with ${signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`}.`, code, signal));
  });
  return {
    rpc,
    pendingMethods: () => closed ? finalPending : rpc.pendingMethods(),
    initialize: () => rpc.request('initialize', {
      clientInfo: { name: 'StashBase', title: null, version: appVersion() },
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
        // Guardian also emits a prose summary for every automatic review.
        // Live sessions prefer the structured completion event so successful
        // Auto reviews stay quiet while denied or interrupted reviews remain
        // visible. Older app-servers that ignore this capability continue
        // through the legacy guardianWarning handler.
        optOutNotificationMethods: ['guardianWarning'],
      },
    }),
    close: (error) => { close(error); },
  };
}
