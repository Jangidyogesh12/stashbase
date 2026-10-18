/**
 * One runtime row's staged-preparation state.
 *
 * A row says where preparation stands in one sentence and offers the single
 * action that applies there. The stage it reports is the daemon's own, so the
 * copy and the action can never name different steps.
 */
import type { AgentRuntime, AgentRuntimeStage } from '@/features/settings/domain/agent-catalog';

/** What a row says when the daemon sent no note of its own. The daemon's note
 *  names the exact step, so it is preferred wherever there is one — the same
 *  rule a server-authored refusal sentence follows. */
const PREPARATION_FAILED = 'Setup failed';
const PREPARING = 'Preparing…';

type AgentRuntimeActionKind = 'install' | 'login' | 'retry' | 'update';

export interface AgentRuntimeAction {
  readonly kind: AgentRuntimeActionKind;
  readonly label: string;
}

export interface AgentRuntimeStatus {
  readonly description: string;
  /** Where preparation stands. `null` only while the catalog hasn't loaded
   *  this agent row at all. */
  readonly stage: AgentRuntimeStage | null;
  readonly action: AgentRuntimeAction | null;
}

/**
 * Unifies the old app's `runtimeAction` and `runtimeDescription` into one
 * derivation, so a runtime's description, the step it stands on, and the
 * single applicable action can never disagree with each other.
 */
export function describeRuntime(
  runtime: AgentRuntime | undefined,
  busy: boolean,
): AgentRuntimeStatus {
  if (!runtime) {
    return { description: 'Checking…', stage: null, action: null };
  }

  const preparation = runtime.preparation;
  if (preparation.kind === 'failed') {
    const failure = preparation.failure;
    // Only the bundled runtime needs the StashBase account, and its group's
    // Account row owns that sign-in, so the row only says what it waits on.
    if (failure.refusal === 'account-required') {
      return { description: 'Needs sign-in', stage: failure.stage, action: null };
    }
    // A refused account is already signed in; another sign-in changes nothing.
    const action: AgentRuntimeAction | null = busy
      ? null
      : failure.stage === 'authenticate' && failure.refusal !== 'account-refused'
        ? { kind: 'login', label: 'Sign in' }
        : {
            kind: failure.stage === 'configure' ? 'retry' : (failure.retryAction ?? 'retry'),
            label: failure.stage === 'configure' ? 'Retry connection' : 'Retry',
          };
    return {
      description: failure.note ?? PREPARATION_FAILED,
      stage: failure.stage,
      action,
    };
  }

  if (preparation.kind === 'running') {
    return {
      description: preparation.note ?? PREPARING,
      stage: preparation.stage,
      action: null,
    };
  }

  if (!runtime.installed) {
    return {
      description: 'Not installed',
      stage: 'discover',
      action: busy ? null : { kind: 'install', label: 'Install' },
    };
  }

  // A model the runtime is too old to run is the one thing worth saying
  // ahead of readiness: the row already carries the action for it, and a
  // reader who is ready to chat still has a reason to run it.
  const lead = runtime.upgrade
    ? `${runtime.upgrade.model} needs a newer ${runtime.label}`
    : preparation.kind === 'ready'
      ? 'Ready'
      : 'Installed';
  // An installed runtime names its version, so an update the reader runs from
  // here has a visible before and after, and the newer release when one is
  // known. Only the bundled one says where it came from; every other row is
  // the reader's own install.
  const parts = [
    lead,
    runtime.ownership === 'bundled' ? 'Included with StashBase' : null,
    runtime.version,
    runtime.availableVersion ? `${runtime.availableVersion} available` : null,
  ];
  return {
    description: parts.filter(Boolean).join(' · '),
    stage: 'ready',
    action: !busy && runtime.updatable ? { kind: 'update', label: 'Update' } : null,
  };
}
