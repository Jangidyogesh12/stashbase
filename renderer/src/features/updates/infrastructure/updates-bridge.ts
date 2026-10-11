/**
 * The updates boundary.
 *
 * The only module in the feature that sees the wire schema. Preload is another
 * process, so every answer arrives as `unknown`, is parsed here, and leaves in
 * the feature's own vocabulary.
 *
 * Nothing throws. An updater this window cannot reach, a refusal main will not
 * explain, and an answer that does not parse are one outcome to a reader who
 * can act on none of them, so all three leave as `unavailable`. A pushed
 * snapshot that does not parse is dropped for the same reason: there is no
 * sentence to say about it, and saying nothing is what a reader already sees.
 */
import type { UpdateResult, UpdatesPort } from '@/features/updates/application/ports';
import type { UpdateState, UpdateStatus } from '@/features/updates/domain/update-status';
import type { UpdatesBridge } from '@/platform/electron/updates';
import type { ErrorReporter } from '@/platform/error-reporting';
import {
  updatesResultSchema,
  updatesSnapshotSchema,
  type UpdatesSnapshot,
} from '@/protocols/electron/updates';

const UNAVAILABLE: UpdateResult = { kind: 'unavailable', ok: false };

/** No `default` clause and no cast, so a phase added to the wire union stops
 *  here at compile time rather than reaching a surface unhandled. */
function toStatus(snapshot: UpdatesSnapshot): UpdateStatus {
  switch (snapshot.phase) {
    case 'unsupported':
    case 'idle':
    case 'checking':
    case 'current':
    case 'error':
      return { phase: snapshot.phase };
    case 'available':
      return { phase: 'available', version: snapshot.availableVersion };
    case 'downloading':
      return {
        percent: snapshot.percent ?? null,
        phase: 'downloading',
        version: snapshot.availableVersion,
      };
    case 'ready':
      return { phase: 'ready', version: snapshot.availableVersion };
    case 'installing':
      return { phase: 'installing', version: snapshot.availableVersion };
  }
}

function toState(snapshot: UpdatesSnapshot): UpdateState {
  return {
    autoCheckEnabled: snapshot.autoCheckEnabled,
    currentVersion: snapshot.currentVersion,
    status: toStatus(snapshot),
  };
}

/** The parse-and-map step every command shares, so the five below differ only
 *  in which channel they ask. */
async function command(
  invoke: () => Promise<unknown>,
  observe: (snapshot: UpdatesSnapshot) => void,
  reportError?: ErrorReporter,
): Promise<UpdateResult> {
  try {
    const result = updatesResultSchema.safeParse(await invoke());
    if (!result.success) {
      reportError?.(new Error('Invalid update response'), 'app-update');
      return UNAVAILABLE;
    }
    if (result.data.ok) {
      observe(result.data.snapshot);
      return { ok: true, state: toState(result.data.snapshot) };
    }
    reportError?.(new Error(`Update failed: ${result.data.failure.kind}`), 'app-update');
    return result.data.failure.kind === 'unauthorized'
      ? { kind: 'unauthorized', ok: false }
      : UNAVAILABLE;
  } catch (error) {
    reportError?.(error, 'app-update');
    return UNAVAILABLE;
  }
}

export function createUpdatesAdapter(
  bridge: UpdatesBridge,
  reportError?: ErrorReporter,
): UpdatesPort {
  // The error phase persists until main moves on, and every read and push
  // repeats it. Report entering it once, not each time a window looks.
  let inError = false;
  const observe = (snapshot: UpdatesSnapshot) => {
    if (snapshot.phase === 'error' && !inError)
      reportError?.(new Error('Update failed'), 'app-update');
    inError = snapshot.phase === 'error';
  };
  return {
    check: () => command(() => bridge.check(), observe, reportError),
    openReleasePage: () => command(() => bridge.openReleasePage(), observe, reportError),
    read: () => command(() => bridge.read(), observe, reportError),
    runPrimaryAction: () => command(() => bridge.primaryAction(), observe, reportError),
    setAutoCheck: (enabled) => command(() => bridge.setAutoCheck(enabled), observe, reportError),
    subscribe: (onState) =>
      bridge.onSnapshot((snapshot) => {
        const parsed = updatesSnapshotSchema.safeParse(snapshot);
        if (!parsed.success) {
          reportError?.(new Error('Invalid update response'), 'app-update');
          return;
        }
        observe(parsed.data);
        onState(toState(parsed.data));
      }),
  };
}
