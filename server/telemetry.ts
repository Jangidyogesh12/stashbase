/** One Node owner for identity, opt-out and durable delivery across windows.
 * Only allowlisted facts enter the queue; account credentials never do. */
import { createNativeDiagnostics, type NativeDiagnostic } from './native-diagnostics.ts';
import { randomUUID } from 'node:crypto';
import type { AppConfigFile } from './app-config.ts';
import { readAppConfigStrict, writeAppConfigStrict } from './app-config.ts';
import { boundedDiagnosticContext, telemetryEventSchema, type TelemetryEvent, type ErrorContext } from '../shared/protocols/http/telemetry.ts';
import { diagnosticOperation, errorDiagnostic } from './error-diagnostics.ts';
import { diagnosticText } from '../shared/protocols/diagnostics.ts';
import { diagnosticScope, type DiagnosticScope } from './diagnostic-context.ts';
import { accountUsageId, usageState, usageIdentity, usagePayload, QUEUE_LIMIT,
  type QueuedUsage, type UsageIdentity, type TelemetryState } from './telemetry-state.ts';
import destination from './telemetry-destination.json' with { type: 'json' };
import packageInfo from '../package.json' with { type: 'json' };
export type { TelemetryState } from './telemetry-state.ts';

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
  const occurrences = new Map<string, { event: DiagnosticEvent; identity: UsageIdentity; startedAt: number; repeated: number }>();
  let occurrenceTimer: ReturnType<typeof setInterval> | undefined;
  const turns = new Map<string, { identity: UsageIdentity; startedAt: number; sessionId?: string }>();
  const allowed = () => options.available && !stopped && !collectionStopped;
  const preferences = () => ({ enabled: usageState(options.read(), now()).enabled, available: options.available });
  const save = (config: AppConfigFile, state: TelemetryState) => {
    config.telemetry = state;
    options.write(config);
  };
  const entry = (identity: UsageIdentity, event: QueuedUsage['event'], sessionId?: string): QueuedUsage => ({
    ...identity, uuid: randomUUID(), timestamp: new Date(now()).toISOString(),
    version: options.version, os: options.os, ...(sessionId ? { sessionId } : {}), event,
  });
  const cancel = () => {
    generation++;
    pending?.abort();
    pending = null;
    clearTimeout(retry);
    retry = undefined;
    occurrences.clear();
    clearInterval(occurrenceTimer);
    occurrenceTimer = undefined;
    turns.clear();
  };
  const sanitizeContext = (context: Record<string, unknown>) => Object.fromEntries(Object.entries(context).map(([key, value]) => [key, typeof value === 'string' ? diagnosticText(value, 500) : value]));
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
  const windowOpen = (bucket: { event: DiagnosticEvent; startedAt: number }) =>
    now() >= bucket.startedAt && now() - bucket.startedAt < OCCURRENCE_WINDOWS[bucket.event.event];
  /** Report counted repeats of closed windows (or all, before shutdown). */
  const releaseOccurrences = (all = false) => {
    for (const [key, bucket] of occurrences) {
      if (!all && windowOpen(bucket)) continue;
      occurrences.delete(key);
      if (bucket.repeated) capture({ ...bucket.event, occurrences: bucket.repeated }, bucket.identity, generation, true);
    }
    if (!occurrences.size) { clearInterval(occurrenceTimer); occurrenceTimer = undefined; }
  };
  const withScope = (input: TelemetryEvent, scope: DiagnosticScope = diagnosticScope.getStore() ?? {}): TelemetryEvent => {
    if (!['application_error', 'application_warning', 'account_login_result', 'billing_checkout_result', 'billing_portal_result', 'project_entry_result', 'document_write_result', 'agent_setup_result', 'agent_setup_stage'].includes(input.event)) return input;
    return { ...scope, ...input, ...('context' in input || scope.context ? { context: { ...scope.context, ...('context' in input ? input.context : {}) } } : {}) } as TelemetryEvent;
  };
  const capture = (input: TelemetryEvent, captured?: UsageIdentity, capturedGeneration = generation, rollup = false, native?: NativeDiagnostic): boolean | undefined => {
    if (!allowed() || capturedGeneration !== generation) return;
    try {
      const scoped = withScope(input);
      const parsed = telemetryEventSchema.safeParse('context' in scoped ? { ...scoped, context: boundedDiagnosticContext(scoped.context) } : scoped);
      if (!parsed.success) return;
      const config = options.read();
      const state = usageState(config, now());
      if (!state.enabled) return;
      const turn = parsed.data.event === 'agent_turn_finished' && parsed.data.turn_id ? turns.get(parsed.data.turn_id) : undefined;
      if (parsed.data.event === 'agent_turn_finished' && parsed.data.turn_id) {
        if (!turn || now() - turn.startedAt > 86400_000) return;
        captured = turn.identity;
      }
      // Reserve room for a link and its event; never evict an identity link
      // while accepting later events that depend on it.
      if ((state.queue?.length ?? 0) > QUEUE_LIMIT - 2) { kick(); return; }
      const identity = synchronize(config, state);
      if (captured && captured.installationId !== identity.installationId) return;
      const event = parsed.data;
      if ('diagnostic' in event && event.diagnostic) event.diagnostic = errorDiagnostic(event.diagnostic);
      if ('context' in event && event.context) event.context = sanitizeContext(event.context);
      if (event.event === 'application_error' || event.event === 'application_warning') {
        event.operation = diagnosticOperation(event.operation);
        if (!rollup && !native) {
          const repetitions = event.occurrences ?? 1;
          delete event.occurrences;
          // The key is the redacted event, so every counted repeat carries
          // exactly the diagnostic that was reported for its window.
          const diagnosticIdentity = captured ?? identity;
          const key = JSON.stringify([diagnosticIdentity.anonymousId, diagnosticIdentity.userId, event]);
          const bucket = occurrences.get(key);
          if (bucket && windowOpen(bucket)) { bucket.repeated += repetitions; return; }
          event.occurrences = (bucket?.repeated ?? 0) + repetitions;
          occurrences.delete(key);
          if (occurrences.size >= 100) {
            const [oldestKey, oldest] = occurrences.entries().next().value!;
            occurrences.delete(oldestKey);
            // Saved below with this event; a nested capture would be overwritten.
            if (oldest.repeated) (state.queue ??= []).push(entry(oldest.identity, { ...oldest.event, occurrences: oldest.repeated }));
          }
          occurrences.set(key, { event: { ...event }, identity: diagnosticIdentity, startedAt: now(), repeated: 0 });
          if (!occurrenceTimer) {
            occurrenceTimer = setInterval(() => releaseOccurrences(), 60_000);
            occurrenceTimer.unref();
          }
        }
      }
      if (event.event === 'app_opened' && opened) return;
      const minute = Math.floor(now() / 60000);
      if (minute !== rateWindow) { rateWindow = minute; count = 0; }
      if (count >= 120) return;
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
      if (marker && state.markers?.[marker] !== undefined && Math.floor(state.markers[marker] / 60_000) === minute) return;
      if (marker) state.markers = { ...state.markers, [marker]: now() };
      if (event.event === 'subscription_observed') {
        const status = `${event.plan}:${event.paid}:${event.cancel_at_period_end}`;
        if (!currentIdentity || state.subscription === status) return;
        state.subscription = status;
      }
      const queued = entry(captured ?? identity, event, turn?.sessionId ?? (currentIdentity ? state.sessionId : undefined));
      if (native) Object.assign(queued, { uuid: native.uuid, timestamp: native.timestamp, version: native.version, os: native.os });
      if (!state.queue?.some((item) => item.uuid === queued.uuid)) (state.queue ??= []).push(queued);
      save(config, state);
      if (event.event === 'agent_turn_started' && event.turn_id) {
        if (turns.size >= 100) turns.delete(turns.keys().next().value!);
        turns.set(event.turn_id, { identity, startedAt: now(), sessionId: state.sessionId });
      }
      if (event.event === 'agent_turn_finished' && event.turn_id) turns.delete(event.turn_id);
      if (event.event === 'app_opened') opened = true;
      count++;
      kick();
      return true;
    } catch { /* Unavailable persistence fails closed without affecting work. */ }
  };
  const drainNative = () => {
    if (collectionStopped) { options.native?.clear(); return; }
    options.native?.drain((record) => capture({ event: 'application_error', source: 'native',
    operation: record.operation, diagnostic: record.diagnostic, context: record.context }, record.identity, generation, false, record) === true);
  };
  const nativeTimer = options.native && options.available ? setInterval(drainNative, 5000) : undefined;
  nativeTimer?.unref();
  return {
    preferences,
    capture(input: TelemetryEvent) { capture(input); },
    /** Capture before asynchronous host work to keep its terminal outcome on
     * the initiating account even if another window signs out or switches. */
    scoped() {
      const capturedGeneration = generation;
      const scope = structuredClone(diagnosticScope.getStore() ?? {});
      try {
        if (!allowed()) return (_event: TelemetryEvent) => {};
        const config = options.read();
        const state = usageState(config, now());
        if (!state.enabled || (state.queue?.length ?? 0) >= QUEUE_LIMIT) return (_event: TelemetryEvent) => {};
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
        if (!state.enabled || (state.queue?.length ?? 0) >= QUEUE_LIMIT) return;
        synchronize(config, state);
        save(config, state);
        kick();
      } catch { /* Authentication never depends on analytics. */ }
    },
    captureError(error: unknown, context: ErrorContext) {
      try { capture({ event: 'application_error', ...context, diagnostic: errorDiagnostic(error) }); }
      catch { /* Never replace the original failure. */ }
    },
    /** A degraded but continuing operation, reported apart from failures. */
    captureWarning(error: unknown, context: ErrorContext) {
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
      if (next.enabled) { opened = false; retryDelay = 1000; kick(); }
      return preferences();
    },
    flush,
    /** Counted repeats are queued durably and delivered after the next launch. */
    close() {
      try { releaseOccurrences(true); } catch { /* Shutdown never depends on analytics. */ }
      drainNative();
      clearInterval(nativeTimer);
      stopped = true; cancel();
    },
  };
}

const available = process.env.STASHBASE_TELEMETRY_DISABLED !== '1'
  && process.env.STASHBASE_PACKAGED === '1'
  && destination.projectToken.startsWith('phc_') && destination.host.startsWith('https://');
export const telemetry = createTelemetry({
  available,
  native: createNativeDiagnostics({ available, version: packageInfo.version }),
  projectToken: destination.projectToken, host: destination.host,
  version: packageInfo.version, os: process.platform,
  read: readAppConfigStrict, write: writeAppConfigStrict,
});
