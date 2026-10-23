/**
 * The boundary a surface renders behind, so one that throws is contained
 * instead of taking its window down.
 *
 * What it owns is the mechanics: catching the throw, naming the surface in the
 * line it logs, drawing the recovery where the surface would have been, and
 * clearing the failure before an action runs, so an action that only needs the
 * surface remounted carries nothing at all. Every word is the caller's. A
 * caught error's own message is written for a developer, and a feature keeps
 * its reader-facing sentences in `application/failure-messages.ts`, which a
 * leaf module like this one cannot reach.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { shapeTokens } from '@/lib/shape-context';

/** One thing the reader can do about a surface that failed to render. The
 *  boundary clears its own failure before `perform` runs, so an action whose
 *  only job is to remount the surface carries no `perform` at all. */
interface SurfaceRecoveryAction {
  readonly label: string;
  readonly perform?: (() => void) | undefined;
}

/** Where a failed surface's recovery is drawn. `pane` fills the region the
 *  surface would have occupied. `overlay` covers the window, for a surface
 *  that would have been a modal and so has no region of its own. `window` is
 *  the shell itself failing, with nothing left underneath to show. */
type SurfacePlacement = 'pane' | 'overlay' | 'window';

/** What the reader is offered in place of a surface that threw. The caller
 *  authors every word: a caught render error's own message is written for a
 *  developer, and this module cannot reach the sentence a feature would use. */
interface SurfaceRecovery {
  readonly message: string;
  /** A second sentence for what the reader must not be left to guess at, such
   *  as what happens to work in progress. */
  readonly detail?: string | undefined;
  /** Ordered, and never empty. The first reads as the one to reach for. */
  readonly actions: readonly [SurfaceRecoveryAction, ...SurfaceRecoveryAction[]];
}

interface SurfaceBoundaryProps {
  children: ReactNode;
  /** Names the failing surface in the line this logs, so a report says which
   *  one it was. Not shown to the reader. */
  surface: string;
  placement: SurfacePlacement;
  recovery: SurfaceRecovery;
}

/** The container each placement draws in, and the card the recovery needs to
 *  read against what is behind it. A pane paints its own ground because the
 *  region behind a failed surface may have none. An overlay has no region at
 *  all, so it covers the window on the scrim and needs a panel to sit on. */
const PLACEMENTS: Record<SurfacePlacement, { container: string; card: string }> = {
  pane: {
    container: 'flex h-full items-center justify-center bg-surface-2 p-4 text-center',
    card: 'max-w-md',
  },
  overlay: {
    container: 'fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4 text-center',
    card: `max-w-md ${shapeTokens.panel} bg-surface-3 p-6 shadow-surface-3`,
  },
  window: {
    container: 'flex h-svh items-center justify-center bg-surface-1 p-6 text-center',
    card: 'max-w-md',
  },
};

export class SurfaceBoundary extends Component<SurfaceBoundaryProps, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      `The ${this.props.surface} surface could not be drawn.`,
      error,
      info.componentStack,
    );
  }

  // Clearing first, because an action such as Close unmounts this boundary and
  // there would be no component left to set state on afterwards.
  private readonly recover = (action: SurfaceRecoveryAction) => {
    this.setState({ failed: false });
    action.perform?.();
  };

  override render() {
    const { children, placement, recovery } = this.props;
    if (!this.state.failed) return children;
    const { card, container } = PLACEMENTS[placement];
    return (
      <div className={container}>
        <div className={card}>
          <p className="text-body text-foreground">{recovery.message}</p>
          {recovery.detail ? (
            <p className="mt-2 text-caption text-muted-foreground">{recovery.detail}</p>
          ) : null}
          <div className="mt-4 flex items-center justify-center gap-2">
            {recovery.actions.map((action, index) => (
              <Button
                key={action.label}
                onClick={() => this.recover(action)}
                size="compact"
                variant={index === 0 ? 'tertiary' : 'ghost'}
              >
                {action.label}
              </Button>
            ))}
          </div>
        </div>
      </div>
    );
  }
}
