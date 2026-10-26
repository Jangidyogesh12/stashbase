import { Button } from '@/components/ui/button';
import type { AgentConnection } from '@/features/agent/domain/session';
import type { AgentRuntimeUpdateView } from '@/features/agent/hooks/use-agent-runtime-update';

import { RuntimeUpdateNotes } from './runtime-update-notes';

/** Repairing credentials or a runtime also applies before a turn can start. */
export function connectionNeedsRepair(connection: AgentConnection): boolean {
  return (
    (connection.kind === 'closed' || connection.kind === 'failed') &&
    (connection.failure === 'auth-expired' ||
      connection.failure === 'runtime-outdated' ||
      connection.failure === 'app-outdated')
  );
}

/** The line for a connection that has ended; a live or starting one has none. */
export function connectionNotice(connection: AgentConnection): { text: string } | null {
  switch (connection.kind) {
    case 'draft':
    case 'restoring':
    case 'connecting':
    case 'reconnecting':
    case 'live':
      return null;
    case 'closed':
      return { text: connection.message ?? 'Disconnected' };
    case 'failed':
      return { text: connection.message };
    case 'retired':
      return { text: 'Folder removed · transcript preserved' };
    case 'disposed':
      return { text: 'Chat closed' };
    default: {
      const unreachable: never = connection;
      return unreachable;
    }
  }
}

/** The one line a chat says about its own connection, above the composer.
 *  A connection with nothing to report renders nothing, so the caller states
 *  only when a notice is allowed at all. Its dot is the neutral "look here"
 *  mark: an ended connection is not a decision, so it never wears the
 *  decision colour. */
export function AgentConnectionNotice({
  connection,
  onReconnect,
  onSignIn,
  onUpdateApp,
  runtimeUpdate,
}: {
  connection: AgentConnection;
  onReconnect(): void;
  onSignIn(): void;
  onUpdateApp(): void;
  runtimeUpdate?: AgentRuntimeUpdateView | undefined;
}) {
  const notice = connectionNotice(connection);
  if (!notice) return null;
  const failure =
    connection.kind === 'closed' || connection.kind === 'failed' ? connection.failure : undefined;
  if (connectionNeedsRepair(connection)) {
    const appOutdated = failure === 'app-outdated';
    const signingIn = failure === 'auth-expired';
    return (
      <section className="mx-auto w-full max-w-[46rem] px-5 pb-2 text-caption text-muted-foreground">
        <p className="font-medium text-foreground">
          {signingIn
            ? 'Sign in to continue'
            : appOutdated
              ? 'Update StashBase to continue'
              : 'Update this agent to continue'}
        </p>
        <p className="mt-1">{notice.text}</p>
        <p className="mt-1">Your chat and draft are kept. Nothing is resent automatically.</p>
        {signingIn ? (
          <>
            <p className="mt-1">After signing in, reconnect to continue.</p>
            <div className="mt-2 flex gap-2">
              <Button onClick={onSignIn} size="compact" variant="tertiary">
                Sign in
              </Button>
              <Button onClick={onReconnect} size="compact" variant="tertiary">
                Reconnect
              </Button>
            </div>
          </>
        ) : appOutdated ? (
          <Button className="mt-2" onClick={onUpdateApp} size="compact" variant="tertiary">
            Update StashBase
          </Button>
        ) : runtimeUpdate ? (
          <>
            {!runtimeUpdate.signIn && (
              <Button
                className="mt-2"
                disabled={runtimeUpdate.busy}
                loading={runtimeUpdate.busy}
                onClick={() => runtimeUpdate.update()}
                size="compact"
                variant="tertiary"
              >
                Update {runtimeUpdate.label}
              </Button>
            )}
            <RuntimeUpdateNotes progressClassName="mt-1" runtimeUpdate={runtimeUpdate} />
          </>
        ) : (
          <>
            <p className="mt-1">Update this installation externally, then reconnect.</p>
            <Button className="mt-2" onClick={onReconnect} size="compact" variant="tertiary">
              Reconnect
            </Button>
          </>
        )}
      </section>
    );
  }
  return (
    <div className="mx-auto flex w-full max-w-[46rem] shrink-0 items-center gap-2 px-5 pb-2 text-caption text-muted-foreground max-sm:px-4">
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-muted-foreground" />
      <span>{notice.text}</span>
      {(connection.kind === 'closed' || connection.kind === 'failed') && (
        // Outlined with no icon like every recovery, but named for what it
        // does: a turn's own Retry can sit on the same screen.
        <Button className="ml-auto" onClick={onReconnect} size="compact" variant="tertiary">
          Reconnect
        </Button>
      )}
    </div>
  );
}
