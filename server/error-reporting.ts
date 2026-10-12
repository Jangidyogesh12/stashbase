import { randomUUID } from 'node:crypto';
import { diagnosticScope } from './diagnostic-context.ts';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { errorDiagnostic } from './error-diagnostics.ts';
import { telemetry } from './telemetry.ts';
import { setLogErrorReporter } from './log.ts';
import type { ErrorContext } from '../shared/protocols/http/telemetry.ts';
import type { AgentServerEvent } from '../shared/protocols/websocket/agent-session.ts';

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
    const scope = { request_id: randomUUID(), context: { method: req.method, route: req.path } };
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
const agentCaptures = new WeakMap<object, ReturnType<typeof telemetry.scoped>>();
const agentDiagnostics = new WeakMap<object, Omit<ErrorContext, 'source' | 'operation' | 'runtime'>>();
export function beginAgentDiagnosticTurn(connection: object, turnId: string | undefined, context: NonNullable<ErrorContext['context']> = {}): void {
  agentCaptures.set(connection, telemetry.scoped());
  const previous = agentDiagnostics.get(connection);
  agentDiagnostics.set(connection, {
    ...(turnId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(turnId) ? { turn_id: turnId } : {}),
    context: { ...previous?.context, connection_id: previous?.context?.connection_id ?? randomUUID(), ...context },
  });
}

export function reportAgentRuntimeError(runtime: NonNullable<ErrorContext['runtime']>, event: AgentServerEvent, connection?: object, cause?: unknown): void {
  if (connection && !agentDiagnostics.has(connection)) beginAgentDiagnosticTurn(connection, undefined);
  const context = connection ? agentDiagnostics.get(connection) ?? {} : {};
  if (connection && event.t === 'turn-end') {
    agentDiagnostics.set(connection, { context: context.context });
  }
  const capture = (error: unknown, details: ErrorContext) => {
    const scoped = connection ? agentCaptures.get(connection) : undefined;
    if (scoped) scoped({ event: 'application_error', ...details, diagnostic: errorDiagnostic(error) });
    else telemetry.captureError(error, details);
  };
  if ((event.t === 'error' || event.t === 'exit') && 'message' in event && event.message) {
    capture({ message: event.message, ...(cause ? { cause } : {}),
      ...(event.t === 'error' && event.failure ? { code: event.failure.kind } : {}),
    }, { ...context, source: 'agent', operation: event.t === 'exit' ? 'connection' : 'runtime', runtime });
  } else if (event.t === 'skills' && event.state === 'failed') {
    capture(event.error ?? 'Could not load Agent skills', { ...context, source: 'agent', operation: 'skills', runtime });
  } else if (event.t === 'steer-result' && !event.ok) {
    capture(event.message ?? 'Could not steer Agent', { ...context, source: 'agent', operation: 'steer', runtime });
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
