/** One Node owner for identity, opt-out and durable delivery across windows.
 * Only allowlisted facts enter the queue; account credentials never do. */
import { createNativeDiagnostics, type NativeDiagnostic } from './native-diagnostics.ts';
import { telemetryAvailable } from './telemetry-environment.ts';
import { randomUUID } from 'node:crypto';
import type { AppConfigFile } from './app-config.ts';
import { readAppConfigStrict, writeAppConfigStrict } from './app-config.ts';
import { boundedDiagnosticContext, telemetryEventSchema, type TelemetryEvent, type ErrorContext,
  type RendererTelemetryRequest, type TelemetryReceiptStatus } from '../shared/protocols/http/telemetry.ts';
import { diagnosticAlreadyReported, diagnosticOperation, errorDiagnostic } from './error-diagnostics.ts';
import { diagnosticText } from '../shared/protocols/diagnostics.ts';
import { diagnosticScope, type DiagnosticScope } from './diagnostic-context.ts';
import { accountUsageId, usageState, usageIdentity, usagePayload, QUEUE_LIMIT,
  turnCapacity, TURN_LIMIT, type PendingTurn, type QueuedUsage, type UsageIdentity, type TelemetryState } from './telemetry-state.ts';
import { finishTelemetryTurn, type TurnObservation } from './telemetry-turns.ts';
import destination from './telemetry-destination.json' with { type: 'json' };
import packageInfo from '../package.json' with { type: 'json' };
export type { TelemetryState } from './telemetry-state.ts';

const turnIdentity = (turn: PendingTurn): UsageIdentity => ({ installationId: turn.installationId, anonymousId: turn.anonymousId, firstSeenAt: turn.firstSeenAt, ...(turn.userId ? { userId: turn.userId } : {}) });

type DiagnosticEvent = Extract<TelemetryEvent, { event: 'application_error' | 'application_warning' }>;
/** A diagnostic is reported when first seen; repeats inside its window are
 * counted and reported once when the window closes, so a persistent failure
 * keeps one event per window while its frequency stays measurable. */
const OCCURRENCE_WINDOWS = { application_error: 60_000, application_warning: 10 * 60_000 } as const;

export function createTelemetry(options: {
  available: boolean;
  projectToken: string;
  host: string;
  version: string;
  distribution: QueuedUsage['distribution'];
  os: string;
  native?: ReturnType<typeof createNativeDiagnostics>;
  read(): AppConfigFile;
  write(config: AppConfigFile): void;
  fetch?: typeof fetch;
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  const sendFetch = options.fetch ?? fetch;
  let opened = false;
  let stopped = false;
  let collectionStopped = false;
  let rateWindow = 0;
  let count = 0;
  let sending: Promise<void> | null = null;
  let pending: AbortController | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let retryDelay = 1000;
  let generation = 0;
  // Receipts only cover short renderer retries. The existing disk queue remains
  // the sole durable owner; a new host refuses retries from its predecessor.
  let rendererSince = now() - 1;
  let rendererAccount: string | undefined;
  try { rendererAccount = accountUsageId(options.read()); } catch { /* Admission retries unreadable storage. */ }
  const rendererReceipts = new Map<string, number>();
  const retireRenderer = () => { rendererSince = now(); rendererReceipts.clear(); };
  const synchronizeRenderer = (config: AppConfigFile) => {
    const account = accountUsageId(config);
    if (rendererAccount !== account) { retireRenderer(); rendererAccount = account; }
  };
  const occurrences = new Map<string, { event: DiagnosticEvent; identity: UsageIdentity; startedAt: number; repeated: number; native?: NativeDiagnostic }>();
  let occurrenceTimer: ReturnType<typeof setInterval> | undefined;
  // WS facts can arrive before the renderer's independent start HTTP request.
  const earlyTurns = new Map<string, { at: number; observations: TurnObservation[] }>();
  const allowed = () => options.available && !stopped && !collectionStopped;
  const preferences = () => ({ enabled: usageState(options.read(), now()).enabled, available: options.available });
  const save = (config: AppConfigFile, state: TelemetryState) => {
    config.telemetry = state;
    options.write(config);
  };
  const entry = (identity: UsageIdentity, event: QueuedUsage['event'], sessionId?: string): QueuedUsage => ({
    ...identity, uuid: randomUUID(), timestamp: new Date(now()).toISOString(),
    version: options.version, distribution: options.distribution, os: options.os, ...(sessionId ? { sessionId } : {}), event,
  });
  const cancel = () => {
    generation++;
    retireRenderer();
    pending?.abort();
    pending = null;
    clearTimeout(retry);
    retry = undefined;
    occurrences.clear();
    clearInterval(occurrenceTimer);
    occurrenceTimer = undefined;
    earlyTurns.clear();
  };
  const sanitizeContext = (context: Record<string, unknown>) => Object.fromEntries(Object.entries(context).map(([key, value]) => [key, typeof value === 'string' ? diagnosticText(value, 500) : Array.isArray(value) ? value.map(item => typeof item === 'string' ? diagnosticText(item, 100) : item) : value]));
  const sanitizeTermination = (value: NonNullable<Extract<TelemetryEvent, { event: 'agent_runtime_stop_result' }>['termination']>) => ({
    ...value,
    ...(value.taskkill_error ? { taskkill_error: errorDiagnostic(value.taskkill_error) } : {}),
    ...(value.fallback_error ? { fallback_error: errorDiagnostic(value.fallback_error) } : {}),
    ...(value.taskkill_stderr ? { taskkill_stderr: diagnosticText(value.taskkill_stderr) } : {}),
  });
  const send = async (queued: QueuedUsage, controller: AbortController) => {
    const timeout = setTimeout(() => controller.abort(), 2000);
    timeout.unref();
    try {
      const payload = usagePayload(queued);
      // Re-redact disk diagnostics too, even if a queue file was modified.
      if ('diagnostic' in payload.properties && payload.properties.diagnostic) {
        payload.properties.diagnostic = errorDiagnostic(payload.properties.diagnostic);
      }
      if ('context' in payload.properties && payload.properties.context) payload.properties.context = sanitizeContext(payload.properties.context);
      if ('termination' in payload.properties && payload.properties.termination) payload.properties.termination = sanitizeTermination(payload.properties.termination);
      if ('operation' in payload.properties) payload.properties.operation = diagnosticOperation(payload.properties.operation);
      const response = await sendFetch(`${options.host.replace(/\/$/, '')}/i/v0/e/`, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: options.projectToken, ...payload }),
      });
      await response.body?.cancel();
      // Retrying a refused payload cannot repair it. Network failures, timeouts,
      // rate limits and service failures retain the same UUID and timestamp.
      return response.ok || (response.status >= 400 && response.status < 500
        && response.status !== 408 && response.status !== 429);
    } finally { clearTimeout(timeout); }
  };
  const schedule = () => {
    if (retry || !allowed()) return;
    retry = setTimeout(() => { retry = undefined; void flush(); }, retryDelay);
    retry.unref();
    retryDelay = Math.min(retryDelay * 2, 60_000);
  };
  const drain = async () => {
    const capturedGeneration = generation;
    while (allowed() && capturedGeneration === generation) {
      const config = options.read();
      const state = usageState(config, now());
      if (!state.enabled) return;
      const queued = state.queue?.[0];
      // Persist expiry/filtering even when there is nothing left to deliver.
      if (!queued) {
        if (config.telemetry?.queue?.length) save(config, state);
        return;
      }
      const controller = new AbortController();
      pending = controller;
      let delivered = false;
      try { delivered = await send(queued, controller); } catch { /* bounded retry below */ }
      if (capturedGeneration !== generation || !allowed()) return;
      pending = null;
      if (!delivered) { schedule(); return; }
      // Re-read after await: never overwrite captures, settings or account
      // changes made while this request was in flight.
      const latest = options.read();
      const current = usageState(latest, now());
      if (!current.enabled) return;
      current.queue = current.queue?.filter((item) => item.uuid !== queued.uuid);
      save(latest, current);
      retryDelay = 1000;
    }
  };
  const flush = (): Promise<void> => {
    if (!allowed()) return Promise.resolve();
    if (sending) return sending;
    // Defer transport so a synchronous opt-out cancels even a new capture.
    const capturedGeneration = generation;
    const work = Promise.resolve().then(drain).catch(() => { schedule(); }).finally(() => {
      if (sending !== work) return;
      sending = null;
      if (capturedGeneration !== generation && allowed()) kick();
    });
    sending = work;
    return work;
  };
  const kick = () => { if (!retry) void flush(); };

  const synchronize = (config: AppConfigFile, state: TelemetryState): UsageIdentity => {
    synchronizeRenderer(config);
    usageIdentity(state, now());
    const userId = accountUsageId(config);
    if (state.userId !== userId) {
      if (state.userId) state.anonymousId = randomUUID();
      state.userId = userId;
      delete state.sessionId;
      delete state.lastActiveAt;
      delete state.markers;
      delete state.subscription;
      if (userId) (state.queue ??= []).push(entry(usageIdentity(state, now()), { event: '$identify' }));
    }
    return usageIdentity(state, now());
  };
  const windowOpen = (bucket: { event: DiagnosticEvent; startedAt: number }, at = now()) => {
    const window = bucket.event.event === 'application_warning' && bucket.event.source === 'native'
      && bucket.event.operation === 'app-update' && bucket.event.context?.stage === 'checking'
      ? 60 * 60_000 : OCCURRENCE_WINDOWS[bucket.event.event];
    return at >= bucket.startedAt && at - bucket.startedAt < window;
  };
  /** Report counted repeats of closed windows (or all, before shutdown). */
  const releaseOccurrences = (all = false) => {
    for (const [key, bucket] of occurrences) {
      if (!all && windowOpen(bucket)) continue;
      occurrences.delete(key);
      if (bucket.repeated) capture({ ...bucket.event, occurrences: bucket.repeated }, bucket.identity, generation, true, bucket.native);
    }
    if (!occurrences.size) { clearInterval(occurrenceTimer); occurrenceTimer = undefined; }
  };
  const withScope = (input: TelemetryEvent, scope: DiagnosticScope = diagnosticScope.getStore() ?? {}): TelemetryEvent => {
    if (!['application_error', 'application_warning', 'account_login_result', 'billing_checkout_result', 'billing_portal_result', 'project_entry_result', 'document_write_result', 'agent_setup_result', 'agent_setup_stage', 'agent_runtime_start_result'].includes(input.event)) return input;
    return { ...scope, ...input, ...('context' in input || scope.context ? { context: { ...scope.context, ...('context' in input ? input.context : {}) } } : {}) } as TelemetryEvent;
  };
  const capture = (input: TelemetryEvent, captured?: UsageIdentity, capturedGeneration = generation, rollup = false,
    native?: NativeDiagnostic, receipt?: RendererTelemetryRequest): TelemetryReceiptStatus => {
    if (!allowed() || capturedGeneration !== generation) return 'disabled';
    try {
      const scoped = withScope(input);
      const parsed = telemetryEventSchema.safeParse('context' in scoped ? { ...scoped, context: boundedDiagnosticContext(scoped.context) } : scoped);
      if (!parsed.success) return 'discarded';
      const config = options.read();
      const state = usageState(config, now());
      if (!state.enabled) return 'disabled';
      const eventTurnId = 'turn_id' in parsed.data ? parsed.data.turn_id : undefined;
      const turn = eventTurnId ? state.turns?.find((item) => item.turnId === eventTurnId) : undefined;
      if (parsed.data.event === 'agent_turn_finished' && eventTurnId) {
        if (!turn) return state.finishedTurns?.[eventTurnId] !== undefined ? 'duplicate' : 'retry';
        finishTelemetryTurn(state, turn, { ...parsed.data, source: parsed.data.source ?? 'renderer' }, receipt ? Date.parse(receipt.timestamp) : now());
        save(config, state);
        kick();
        return 'accepted';
      }
      if (parsed.data.event === 'agent_turn_started' && eventTurnId) {
        if (turn || state.finishedTurns?.[eventTurnId] !== undefined) return 'duplicate';
        if ((state.turns?.length ?? 0) >= TURN_LIMIT) return 'retry';
      }
      if (turn) captured = turnIdentity(turn);
      // Reserve an identity link, the new event, and every admitted terminal.
      const reservation = parsed.data.event === 'agent_turn_started' && eventTurnId ? 3 : 2;
      if (turnCapacity(state) > QUEUE_LIMIT - reservation) { kick(); return 'retry'; }
      const identity = synchronize(config, state);
      if (captured && captured.installationId !== identity.installationId) return 'discarded';
      if (native && state.queue?.some((item) => item.uuid === native.uuid)) return 'duplicate';
      const event = parsed.data;
      if ('diagnostic' in event && event.diagnostic) event.diagnostic = errorDiagnostic(event.diagnostic);
      if ('context' in event && event.context) event.context = sanitizeContext(event.context);
      if (event.event === 'agent_runtime_stop_result' && event.termination) event.termination = sanitizeTermination(event.termination);
      if (event.event === 'application_error' || event.event === 'application_warning') {
        event.operation = diagnosticOperation(event.operation);
        if (!rollup && (!native || event.event === 'application_warning')) {
          const repetitions = event.occurrences ?? 1;
          delete event.occurrences;
          // The key is the redacted event, so every counted repeat carries
          // exactly the diagnostic that was reported for its window.
          const diagnosticIdentity = captured ?? identity;
          const key = JSON.stringify([diagnosticIdentity.anonymousId, diagnosticIdentity.userId, native?.version, native?.distribution, native?.os, event]);
          const bucket = occurrences.get(key);
          const occurredAt = native ? Date.parse(native.timestamp) : now();
          if (bucket && windowOpen(bucket, occurredAt)) {
            // A rollup keeps the first repeated native occurrence's UUID/time,
            // version and identity, even if delivered by a later host build.
            if (!bucket.repeated) bucket.native = native;
            bucket.repeated += repetitions;
            return 'duplicate';
          }
          event.occurrences = (bucket?.repeated ?? 0) + repetitions;
          occurrences.delete(key);
          if (occurrences.size >= 100) {
            const [oldestKey, oldest] = occurrences.entries().next().value!;
            occurrences.delete(oldestKey);
            // Saved below with this event; a nested capture would be overwritten.
            if (oldest.repeated && turnCapacity(state) < QUEUE_LIMIT - 3) {
              const summary = entry(oldest.identity, { ...oldest.event, occurrences: oldest.repeated });
              if (oldest.native) Object.assign(summary, { uuid: oldest.native.uuid, timestamp: oldest.native.timestamp, version: oldest.native.version, distribution: oldest.native.distribution, os: oldest.native.os });
              (state.queue ??= []).push(summary);
            }
          }
          occurrences.set(key, { event: { ...event }, identity: diagnosticIdentity, startedAt: occurredAt, repeated: 0 });
          if (!occurrenceTimer) {
            occurrenceTimer = setInterval(() => releaseOccurrences(), 60_000);
            occurrenceTimer.unref();
          }
        }
      }
      if (event.event === 'app_opened' && opened) return 'duplicate';
      const minute = Math.floor(now() / 60000);
      if (minute !== rateWindow) { rateWindow = minute; count = 0; }
      if (count >= 120) return 'retry';
      const active = event.event === 'app_active' || event.event === 'document_engaged' || event.event === 'agent_turn_started';
      const currentIdentity = !captured || (captured.anonymousId === identity.anonymousId && captured.userId === identity.userId);
      if (active && currentIdentity) {
        if (!state.sessionId || !state.lastActiveAt || now() - state.lastActiveAt >= 30 * 60_000 || now() < state.lastActiveAt) {
          state.sessionId = randomUUID();
        }
        state.lastActiveAt = now();
      }
      const marker = event.event === 'app_active' ? `app_active:${event.mode}`
        : event.event === 'document_engaged' ? `document_engaged:${event.activity}:${event.format}` : null;
      if (marker && state.markers?.[marker] !== undefined && Math.floor(state.markers[marker] / 60_000) === minute) return 'duplicate';
      if (marker) state.markers = { ...state.markers, [marker]: now() };
      if (event.event === 'subscription_observed') {
        const status = `${event.plan}:${event.paid}:${event.cancel_at_period_end}`;
        if (!currentIdentity || state.subscription === status) return 'duplicate';
        state.subscription = status;
      }
      const queued = entry(captured ?? identity, event, turn?.sessionId ?? (currentIdentity ? state.sessionId : undefined));
      if (receipt) Object.assign(queued, { uuid: receipt.id, timestamp: receipt.timestamp });
      if (native) Object.assign(queued, { uuid: native.uuid, timestamp: native.timestamp, version: native.version, distribution: native.distribution, os: native.os });
      if (!state.queue?.some((item) => item.uuid === queued.uuid)) (state.queue ??= []).push(queued);
      if (event.event === 'agent_turn_started' && event.turn_id) {
        (state.turns ??= []).push({ ...identity, turnId: event.turn_id, runtime: event.runtime,
          startedAt: queued.timestamp, observedAt: queued.timestamp, stage: 'preparing', sequence: 0,
          version: queued.version, distribution: queued.distribution, os: queued.os, ...(state.sessionId ? { sessionId: state.sessionId } : {}) });
      }
      save(config, state);
      if (event.event === 'agent_turn_started' && event.turn_id) {
        const early = earlyTurns.get(event.turn_id);
        earlyTurns.delete(event.turn_id);
        if (early && now() - early.at < 120_000) {
          for (const observation of early.observations) observeTurn(event.turn_id, observation);
        }
      }
      if (event.event === 'app_opened') opened = true;
      count++;
      kick();
      return 'accepted';
    } catch { return 'retry'; /* Unavailable persistence never affects work. */ }
  };
  const observeTurn = (turnId: string | undefined, observation: TurnObservation) => {
    if (!turnId || !allowed()) return;
    try {
      const config = options.read();
      const state = usageState(config, now());
      if (!state.enabled || state.finishedTurns?.[turnId] !== undefined) return;
      const turn = state.turns?.find((item) => item.turnId === turnId);
      if (!turn) {
        // Only an actual runtime acceptance can establish a missing start.
        // Its time is host observation, never an invented renderer submission.
        if ('stage' in observation && observation.stage === 'host_accepted' && observation.runtime
          && capture({ event: 'agent_turn_started', runtime: observation.runtime, turn_id: turnId, source: 'host' }) === 'accepted') {
          observeTurn(turnId, observation);
          return;
        }
        if (!earlyTurns.has(turnId) && earlyTurns.size >= TURN_LIMIT) earlyTurns.delete(earlyTurns.keys().next().value!);
        const early = earlyTurns.get(turnId) ?? { at: now(), observations: [] };
        if (early.observations.length >= 32 && 'outcome' in observation) early.observations.pop();
        if (early.observations.length < 32) early.observations.push(observation);
        earlyTurns.set(turnId, early);
        return;
      }
      if ('outcome' in observation) {
        capture({ event: 'agent_turn_finished', runtime: turn.runtime, turn_id: turnId,
          ...observation, source: observation.source ?? 'host' });
        return;
      }
      const parsed = telemetryEventSchema.safeParse({ event: 'agent_turn_stage', runtime: turn.runtime,
        turn_id: turnId, stage: observation.stage, sequence: turn.sequence + 1,
        ...(observation.context ? { context: boundedDiagnosticContext(observation.context) } : {}) });
      if (!parsed.success || parsed.data.event !== 'agent_turn_stage') return;
      const context = parsed.data.context;
      // Stream deltas never write disk. A new model call may repeat the stage.
      if (turn.stage === observation.stage && !context?.call_id) return;
      turn.stage = observation.stage;
      turn.observedAt = new Date(now()).toISOString();
      turn.sequence++;
      if (context) turn.context = { ...turn.context, ...sanitizeContext(context) };
      save(config, state);
      capture(parsed.data, turnIdentity(turn));
    } catch { /* Diagnostics never block execution, including a full/unwritable disk. */ }
  };
  const retireTurns = (reason: 'host_restarted' | 'app_shutdown' | 'host_shutdown' | 'app_update') => {
    if (!allowed()) return;
    try {
      const config = options.read();
      const state = usageState(config, now());
      if (!state.enabled || !state.turns?.length) return;
      for (const turn of [...state.turns]) finishTelemetryTurn(state, turn, {
        event: 'agent_turn_finished', runtime: turn.runtime, outcome: 'interrupted', reason,
        source: reason === 'host_restarted' ? 'recovery' : 'host',
      }, now());
      save(config, state);
    } catch { /* Leave the durable records for another healthy launch. */ }
  };
  const drainNative = () => {
    if (collectionStopped) { options.native?.clear(); return; }
    options.native?.drain((record) => record.severity === 'info'
      ? ['accepted', 'duplicate'].includes(capture({ event: 'native_lifecycle', operation: record.operation, diagnostic: errorDiagnostic(record.diagnostic), context: record.context }, record.identity, generation, false, record))
      : ['accepted', 'duplicate'].includes(capture({ event: record.severity === 'warning' ? 'application_warning' : 'application_error', source: 'native',
    operation: record.operation, diagnostic: record.diagnostic, context: record.context, occurrences: 1 }, record.identity, generation, false, record)));
  };
  const nativeTimer = options.native && options.available ? setInterval(drainNative, 5000) : undefined;
  nativeTimer?.unref();
  retireTurns('host_restarted');
  return {
    preferences,
    observeTurn,
    capture(input: TelemetryEvent) { capture(input); },
    captureRenderer(request: RendererTelemetryRequest): TelemetryReceiptStatus {
      if (!allowed()) return 'disabled';
      try {
        const config = options.read();
        synchronizeRenderer(config);
        const state = usageState(config, now());
        if (!state.enabled) return 'disabled';
        const occurred = Date.parse(request.timestamp);
        if (!Number.isFinite(occurred) || occurred <= rendererSince || occurred < now() - 60_000 || occurred > now() + 1000) return 'discarded';
        for (const [id, at] of rendererReceipts) if (at < now() - 60_000) rendererReceipts.delete(id);
        if (rendererReceipts.has(request.id) || state.queue?.some(item => item.uuid === request.id)) return 'duplicate';
        if (rendererReceipts.size >= QUEUE_LIMIT) return 'retry';
        const event = request.event.event === 'agent_turn_started' ? { ...request.event, source: 'renderer' as const } : request.event;
        const status = capture(event, undefined, generation, false, undefined, request);
        if (status === 'accepted' || status === 'duplicate') rendererReceipts.set(request.id, now());
        return status;
      } catch { return 'retry'; }
    },
    /** Capture before asynchronous host work to keep its terminal outcome on
     * the initiating account even if another window signs out or switches. */
    scoped() {
      const capturedGeneration = generation;
      const scope = structuredClone(diagnosticScope.getStore() ?? {});
      try {
        if (!allowed()) return (_event: TelemetryEvent) => {};
        const config = options.read();
        const state = usageState(config, now());
        if (!state.enabled || turnCapacity(state) >= QUEUE_LIMIT - 1) return (_event: TelemetryEvent) => {};
        const identity = synchronize(config, state);
        save(config, state);
        kick();
        return (event: TelemetryEvent) => capture(withScope(event, scope), identity, capturedGeneration);
      } catch { return (_event: TelemetryEvent) => {}; }
    },
    identityChanged() {
      // Persist even a sign-out with no subsequent events, so its anonymous
      // successor can never be linked to the previous account after restart.
      try {
        if (!allowed()) return;
        const config = options.read();
        const state = usageState(config, now());
        if (!state.enabled || turnCapacity(state) >= QUEUE_LIMIT - 1) return;
        synchronize(config, state);
        save(config, state);
        kick();
      } catch { /* Authentication never depends on analytics. */ }
    },
    captureError(error: unknown, context: ErrorContext) {
      if (diagnosticAlreadyReported(error)) return;
      try { capture({ event: 'application_error', ...context, diagnostic: errorDiagnostic(error) }); }
      catch { /* Never replace the original failure. */ }
    },
    /** A degraded but continuing operation, reported apart from failures. */
    captureWarning(error: unknown, context: ErrorContext) {
      if (diagnosticAlreadyReported(error)) return;
      try { capture({ event: 'application_warning', ...context, diagnostic: errorDiagnostic(error) }); }
      catch { /* Never replace the original condition. */ }
    },
    update(next: { enabled: boolean }) {
      if (!next.enabled) { collectionStopped = true; cancel(); options.native?.clear(); }
      const config = options.read();
      const state = usageState(config, now());
      // Disabling erases the queue and all local analytics identity. No final
      // network request is made after the switch is turned off.
      save(config, next.enabled ? { ...state, enabled: true } : { enabled: false });
      collectionStopped = !next.enabled;
      if (next.enabled) { retireRenderer(); opened = false; retryDelay = 1000; kick(); }
      return preferences();
    },
    flush,
    /** Counted repeats are queued durably and delivered after the next launch. */
    close(reason?: 'app_shutdown' | 'host_shutdown' | 'app_update') {
      if (reason) retireTurns(reason);
      drainNative();
      try { releaseOccurrences(true); } catch { /* Shutdown never depends on analytics. */ }
      clearInterval(nativeTimer);
      stopped = true; cancel();
    },
  };
}

const available = telemetryAvailable()
  && destination.projectToken.startsWith('phc_') && destination.host.startsWith('https://');
const distribution = process.env.STASHBASE_PACKAGED === '1' ? 'packaged' : 'source';
export const telemetry = createTelemetry({
  available, distribution,
  native: createNativeDiagnostics({ available, distribution, version: packageInfo.version }),
  projectToken: destination.projectToken, host: destination.host,
  version: packageInfo.version, os: process.platform,
  read: readAppConfigStrict, write: writeAppConfigStrict,
});
