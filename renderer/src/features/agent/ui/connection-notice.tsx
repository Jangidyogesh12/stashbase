import { Button } from '@/components/ui/button';
import type { AgentConnection } from '@/features/agent/domain/session';

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
}: {
  connection: AgentConnection;
  onReconnect(): void;
}) {
  const notice = connectionNotice(connection);
  if (!notice) return null;
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
