import type { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { diagnosticScope } from './diagnostic-context.ts';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { errorDiagnostic } from './error-diagnostics.ts';
import { telemetry } from './telemetry.ts';
import { setLogErrorReporter } from './log.ts';
import type { ErrorContext, AgentTurnStage } from '../shared/protocols/http/telemetry.ts';
import { agentClientEventSchema, type AgentServerEvent } from '../shared/protocols/websocket/agent-session.ts';

/** One fixed feature name, never a dynamic route, query, body, or file path. */
const FEATURES = new Set(['account', 'agents', 'agent', 'project', 'upload', 'asset', 'asset-derived', 'appearance', 'attach', 'embedder', 'files',
  'folders', 'gallery', 'index-status', 'mcp', 'projects', 'search', 'sync', 'terminal',
  'keyword-search', 'local-components', 'turn-changes', 'updates', 'workspace-preferences']);

/** A refused request (4xx) is an expected outcome such as a save conflict or a
 * missing file; only a server failure (5xx) is an application error. */
function captureHttp(service: typeof telemetry, status: number, error: unknown, operation: string): void {
  if (status >= 500) service.captureError(error, { source: 'server', operation });
  else service.captureWarning(error, { source: 'server', operation });
}

export function httpErrorReporting(service = telemetry): RequestHandler {
  return (req, res, next) => {
    const asset = /^\/(asset|asset-derived)\//.exec(req.path)?.[1];
    const feature = asset ?? req.path.split('/')[2] ?? '';
    if ((!asset && !req.path.startsWith('/api/')) || feature === 'telemetry' || feature === 'log') { next(); return; }
    const turnId = req.header('x-stashbase-agent-turn-id');
    const scope = { request_id: randomUUID(), ...(turnId && validTurnId(turnId) ? { turn_id: turnId } : {}), context: { method: req.method, route: req.path } };
    res.setHeader('x-request-id', scope.request_id);
    // Asset/HEAD/stream handlers can finish without JSON; preserve their body
    // and status while recording the same bounded operation/status once.
    res.once('finish', () => {
      if (res.statusCode >= 400 && !res.locals?.diagnosticReported) {
        diagnosticScope.run(scope, () => captureHttp(service, res.statusCode, { message: 'HTTP request failed', status: res.statusCode },
          `http.${FEATURES.has(feature) ? feature : 'other'}`));
      }
    });
    const json = res.json;
    res.json = function (body: unknown) {
      if (res.statusCode >= 400 && !res.locals?.diagnosticReported) {
        res.locals.diagnosticReported = true;
        scope.context.route = typeof req.route?.path === 'string' ? req.route.path : req.path;
        const value = body && typeof body === 'object' ? body as Record<string, unknown> : {};
        captureHttp(service, res.statusCode, {
          message: typeof value.error === 'string' ? value.error : 'HTTP request failed',
          code: value.code ?? res.locals?.diagnosticError?.code, status: res.statusCode,
          ...(res.locals?.diagnosticError instanceof Error ? {
            stack: res.locals.diagnosticError.stack,
            cause: res.locals.diagnosticError,
          } : {}),
        }, `http.${FEATURES.has(feature) ? feature : 'other'}`);
      }
      return json.call(this, body);
    };
    diagnosticScope.run(scope, next);
  };
}

export const unhandledHttpError: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  telemetry.captureError(error, { source: 'server', operation: 'http.unhandled' });
  if (res.headersSent) { _next(error); return; }
  res.locals.diagnosticReported = true;
  const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined;
  res.status(typeof status === 'number' && status >= 400 && status <= 599 ? status : 500)
    .json({ error: error instanceof Error ? error.message : 'The request failed.' });
};

/** Installation has its own terminal event. Runtime events carry only their
 * error sentence; tool inputs, outputs, prompts, and replies never enter here. */
const validTurnId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const agentStates = new WeakMap<object, { interrupted: boolean; closing: boolean; finished?: boolean; lastError?: string; stage?: AgentTurnStage; tools?: Map<string, 'read' | 'write' | 'shell' | 'search' | 'agent' | 'other'> }>();
const agentCaptures = new WeakMap<object, ReturnType<typeof telemetry.scoped>>();
const agentDiagnostics = new WeakMap<object, Omit<ErrorContext, 'source' | 'operation' | 'runtime'>>();
/** Installed before runtime listeners; connection identity exists even if setup fails. */
export function attachAgentDiagnostics(connection: WebSocket, runtime: NonNullable<ErrorContext['runtime']>, connectionId?: string): void {
  agentDiagnostics.set(connection, { context: { connection_id: connectionId && validTurnId(connectionId) ? connectionId : randomUUID() } });
  agentStates.set(connection, { interrupted: false, closing: false });
  agentCaptures.set(connection, telemetry.scoped());
  connection.on('message', (raw) => {
    try {
      const event = agentClientEventSchema.parse(JSON.parse(raw.toString()));
      const state = agentStates.get(connection)!;
      if (event.t === 'interrupt') state.interrupted = true;
      if (event.t === 'close') state.closing = true;
    } catch { /* Runtime validation owns invalid commands. */ }
  });
  connection.once('close', (code) => {
    const details = agentDiagnostics.get(connection);
    const state = agentStates.get(connection);
    const intentional = state?.closing === true;
    if (details?.turn_id && !state?.finished) {
      if (!intentional) agentCaptures.get(connection)?.({ event: 'application_error', source: 'agent', runtime,
        operation: 'connection', ...details, context: { ...details.context, close_code: code, close_initiator: 'unknown' },
        diagnostic: { message: 'Agent WebSocket closed during an active turn', code: 'AGENT_CONNECTION_LOST' } });
      telemetry.observeTurn(details.turn_id, { outcome: intentional ? 'cancelled' : 'interrupted', reason: intentional ? 'session_closed' : 'connection_lost' });
    }
    agentDiagnostics.delete(connection);
    agentCaptures.delete(connection);
    agentStates.delete(connection);
  });
}

export function agentDiagnosticStage(connection: object, stage: AgentTurnStage): void {
  const state = agentStates.get(connection);
  if (state?.stage === stage) return;
  if (state) state.stage = stage;
  const details = agentDiagnostics.get(connection);
  if (details) details.context = { ...details.context, stage };
  telemetry.observeTurn(details?.turn_id, { stage, ...(details?.context ? { context: details.context } : {}) });
}

export function beginAgentDiagnosticTurn(connection: object, turnId: string | undefined, context: NonNullable<ErrorContext['context']> = {}): void {
  agentCaptures.set(connection, telemetry.scoped());
  agentStates.set(connection, { interrupted: false, closing: false });
  const previous = agentDiagnostics.get(connection);
  agentDiagnostics.set(connection, {
    ...(turnId && validTurnId(turnId) ? { turn_id: turnId } : {}),
    context: { ...previous?.context, connection_id: previous?.context?.connection_id ?? randomUUID(), ...context },
  });
  agentDiagnosticStage(connection, 'host_accepted');
}

export function reportAgentRuntimeError(runtime: NonNullable<ErrorContext['runtime']>, event: AgentServerEvent, connection?: object, cause?: unknown): void {
  if (connection && !agentDiagnostics.has(connection)) beginAgentDiagnosticTurn(connection, undefined);
  const context = connection ? agentDiagnostics.get(connection) ?? {} : {};
  const state = connection ? agentStates.get(connection) : undefined;
  if (connection) {
    if (event.t === 'tool') {
      agentDiagnosticStage(connection, 'tool_running');
      const category = /^(read|read_file)$/i.test(event.name) ? 'read'
        : /^(write|edit|apply_patch|write_file|edit_file)$/i.test(event.name) ? 'write'
        : /^(bash|shell)$/i.test(event.name) ? 'shell'
        : /^(grep|glob|search|websearch|webfetch)$/i.test(event.name) ? 'search'
        : /^(task|agent)$/i.test(event.name) ? 'agent' : 'other';
      if (state) {
        state.tools ??= new Map();
        if (state.tools.size >= 100) state.tools.delete(state.tools.keys().next().value!);
        state.tools.set(event.id, category);
      }
    }
    if (event.t === 'permission') agentDiagnosticStage(connection, 'waiting_permission');
    if (event.t === 'text' || event.t === 'thinking') agentDiagnosticStage(connection, 'response_started');
  }
  const capture = (error: unknown, details: ErrorContext) => {
    const scoped = connection ? agentCaptures.get(connection) : undefined;
    if (scoped) scoped({ event: 'application_error', ...details, diagnostic: errorDiagnostic(error) });
    else telemetry.captureError(error, details);
  };
  if ((event.t === 'error' || event.t === 'exit') && 'message' in event && event.message) {
    // A runtime error can be immediately followed by an exit carrying that
    // same explanation for the UI. The first report owns its original cause.
    if (event.t !== 'exit' || state?.lastError !== event.message) {
      capture({ message: event.message, ...(cause ? { cause } : {}),
        ...(event.t === 'error' && event.failure ? { code: event.failure.kind } : {}),
      }, { ...context, source: 'agent', operation: event.t === 'exit' ? 'connection' : 'runtime', runtime });
    }
  } else if (event.t === 'tool-result' && event.isError) {
    // Tool output can contain source text; only the failure fact and call ID are safe.
    capture({ message: 'Agent tool call failed', code: 'AGENT_TOOL_FAILED' }, { ...context,
      context: { ...context.context, tool_call_id: event.id, tool_category: state?.tools?.get(event.id) ?? 'other' },
      source: 'agent', operation: 'tool', runtime });
  } else if (event.t === 'skills' && event.state === 'failed') {
    capture(event.error ?? 'Could not load Agent skills', { ...context, source: 'agent', operation: 'skills', runtime });
  } else if (event.t === 'steer-result' && !event.ok) {
    capture(event.message ?? 'Could not steer Agent', { ...context, source: 'agent', operation: 'steer', runtime });
  }
  if (state) state.lastError = event.t === 'error' ? event.message : undefined;
  if (event.t === 'tool-result') state?.tools?.delete(event.id);
  if (context.turn_id && (event.t === 'turn-end' || event.t === 'error' || event.t === 'exit')) {
    const cancelled = state?.interrupted || (event.t === 'exit' && 'reason' in event);
    const failed = event.t === 'error' || (event.t === 'turn-end' && event.isError) || (event.t === 'exit' && 'message' in event && Boolean(event.message));
    if (state) state.finished = true;
    telemetry.observeTurn(context.turn_id, {
      outcome: cancelled ? 'cancelled' : failed ? 'failed' : event.t === 'turn-end' ? 'success' : 'interrupted',
      reason: state?.interrupted ? 'user_cancelled' : event.t === 'exit' && 'reason' in event ? 'scope_removed'
        : failed ? 'runtime_error' : event.t === 'turn-end' ? 'completed' : 'connection_lost',
    });
    if (connection && (event.t === 'turn-end' || event.t === 'exit')) agentDiagnostics.set(connection, { context: context.context });
  }

}

export function installHostErrorReporting(service = telemetry): void {
  setLogErrorReporter((scope, args, level) => {
    if (scope === 'renderer') return; // Already collected by the renderer error sink.
    // Objects may be entire provider payloads. Keep Error values and sentences only.
    // A logged Error is classified alone: the surrounding sentence is a local
    // log template and must not decide the reported cause.
    const error = args.find((value) => value instanceof Error);
    const messages = args.filter((value): value is string => typeof value === 'string');
    const context = { source: 'server', operation: `background.${scope}`, context: { action: messages.join(' ').slice(0, 200) } } as const;
    if (level === 'warn') service.captureWarning(error ?? messages.join('\n'), context);
    else service.captureError(error ?? messages.join('\n'), context);
  });
  // Monitoring does not swallow an uncaught exception or change Node's exit policy.
  process.on('uncaughtExceptionMonitor', (error) => service.captureError(error, { source: 'server', operation: 'uncaught' }));
}
