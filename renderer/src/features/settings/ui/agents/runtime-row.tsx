import { Button } from '@/components/ui/button';
import type { AgentRuntime } from '@/features/settings/domain/agent-catalog';
import {
  describeRuntime,
  type AgentRuntimeAction,
} from '@/features/settings/domain/agent-runtime-status';
import { SettingsRow } from '@/features/settings/ui/rows';
import { useShape } from '@/lib/shape-context';
import { cn } from '@/lib/utils';
import { AGENT_ICONS } from '@/shared/brand/agent-icons';
import type { FailureView } from '@/shared/domain/feature-error';
import { FailureNotice } from '@/shared/ui/failure-notice';
import { SignInPageLink } from '@/shared/ui/sign-in-page-link';

export interface RuntimeRowProps {
  runtime: AgentRuntime;
  /** This runtime has a preparation command of its own in flight. */
  busy: boolean;
  /** A failed install, sign-in, or reset stays on the row: a busy spinner that
   *  simply disappeared would contradict the truthful-loading requirement this
   *  panel owns. */
  failure: FailureView | null;
  onAction: (action: AgentRuntimeAction, runtime: AgentRuntime) => void;
  /** Opens the provider's sign-in page in the reader's browser. */
  onOpenSignIn: (url: string) => void;
  /** Stops waiting on this runtime's browser sign-in. */
  onStop: (runtime: AgentRuntime) => void;
}

/** One agent runtime: what it is, where its preparation stands, and the single
 *  action that applies right now. Work that is running keeps the name of the
 *  action that started it beside its spinner; what it waits for is the detail
 *  line, never the button. */
export function RuntimeRow({
  runtime,
  busy,
  failure,
  onAction,
  onOpenSignIn,
  onStop,
}: RuntimeRowProps) {
  const display = describeRuntime(runtime, busy);
  const shape = useShape();
  const Icon = AGENT_ICONS[runtime.id];
  const { action, description, working } = display;
  /** Nothing here is usable until preparation reaches `ready`. An unusable row
   *  recedes; it does not turn red. A failure the reader can act on says so in
   *  its own sentence and offers the action that clears it. */
  const ready = display.stage === 'ready';
  const signInUrl =
    runtime.preparation.kind === 'running' ? runtime.preparation.signInUrl : undefined;

  return (
    <SettingsRow
      as="li"
      detail={<span className="wrap-anywhere whitespace-pre-wrap">{description}</span>}
      lead={
        <span
          className={cn(
            'flex size-8 items-center justify-center border border-border',
            ready ? 'text-foreground' : 'text-muted-foreground',
            shape.chip,
          )}
        >
          <Icon aria-hidden="true" className="size-4" strokeWidth={1.5} />
        </span>
      }
      title={runtime.label}
      titleTone={ready ? 'default' : 'muted'}
      trail={
        working ? (
          <div className="flex items-center gap-2">
            <Button loading size="compact" variant="tertiary">
              {working.label}
            </Button>
            {working.stoppable && (
              <Button onClick={() => onStop(runtime)} size="compact" variant="ghost">
                Stop waiting
              </Button>
            )}
          </div>
        ) : action ? (
          <Button onClick={() => onAction(action, runtime)} size="compact" variant="tertiary">
            {action.label}
          </Button>
        ) : null
      }
    >
      {signInUrl && <SignInPageLink className="mt-1" url={signInUrl} onOpen={onOpenSignIn} />}
      {failure && (
        <FailureNotice className="mt-1 wrap-anywhere whitespace-pre-wrap" failure={failure} />
      )}
    </SettingsRow>
  );
}
