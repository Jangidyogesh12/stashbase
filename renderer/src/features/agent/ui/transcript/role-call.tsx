/** A Default tool call in the transcript. It stands on its own rather than
 *  folding into the activity group, because handing work to a tool the
 *  reader turned on is the moment they should see: which tool, on which
 *  model, how far it got, and what came back. Opening it shows the brief the
 *  main agent sent and the full result. A failure stays visible. */
import { ChevronRight } from 'lucide-react';
import { useId, useState } from 'react';

import { Disclosure } from '@/components/ui/disclosure';
import type { AgentRoleCallView } from '@/features/agent/domain/agent-role-call';
import type { AgentTranscriptBlock } from '@/features/agent/domain/session';
import { agentToolIcon } from '@/features/agent/ui/tool-icon';
import { focusRing } from '@/lib/focus-ring';
import { useShape } from '@/lib/shape-context';
import { cn } from '@/lib/utils';

type ToolStatus = Extract<AgentTranscriptBlock, { kind: 'tool' }>['status'];

/** A finished call says nothing: the card itself is the record. */
function statusText(status: ToolStatus): string | null {
  switch (status) {
    case 'running':
    case 'awaiting':
      return 'Working…';
    case 'error':
      return 'Failed';
    case 'cancelled':
    case 'denied':
      return 'Stopped';
    default:
      return null;
  }
}

function basename(path: string): string {
  return path.split(/[\\/]/u).findLast(Boolean) ?? path;
}

export function AgentRoleCall({ status, view }: { status: ToolStatus; view: AgentRoleCallView }) {
  const shape = useShape();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const Icon = agentToolIcon(view.icon);
  const label = view.model ? `${view.label} on ${view.model}` : view.label;
  const state = statusText(status);
  return (
    <div
      className={cn(
        'border border-border/50 bg-background',
        shape.container,
        status === 'cancelled' && 'opacity-65',
      )}
    >
      <button
        aria-controls={panelId}
        aria-expanded={open}
        aria-label={state ? `${label}: ${state}` : label}
        className={cn(
          'flex min-h-10 w-full items-center gap-2 px-3 text-left text-ui-13 outline-none',
          shape.item,
          focusRing('hover:bg-hover'),
        )}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <Icon aria-hidden className="size-4 shrink-0 text-foreground" strokeWidth={1.5} />
        <span className="shrink-0 font-medium text-foreground">{view.label}</span>
        {view.model && <span className="min-w-0 truncate text-muted-foreground">{view.model}</span>}
        <span
          className={cn(
            'ml-auto shrink-0 text-ui-12 text-muted-foreground',
            status === 'error' && 'text-destructive',
          )}
        >
          {state}
        </span>
        <ChevronRight
          aria-hidden
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground transition-transform duration-fast motion-reduce:transition-none',
            open && 'rotate-90',
          )}
          strokeWidth={1.5}
        />
      </button>
      {view.error && (
        <p className="px-3 pb-2.5 text-ui-12 text-destructive" role="status">
          {view.error}
        </p>
      )}
      <Disclosure id={panelId} open={open}>
        <div className="flex flex-col gap-3 border-t border-border/50 px-3 py-3 text-ui-12">
          <section className="flex flex-col gap-1.5">
            <h4 className="text-caption text-muted-foreground">Brief</h4>
            {view.task && (
              <p className="whitespace-pre-wrap text-foreground select-text">{view.task}</p>
            )}
            {view.context && (
              <p className="whitespace-pre-wrap text-muted-foreground select-text">
                {view.context}
              </p>
            )}
            {view.files.length > 0 && (
              <ul className="flex flex-wrap gap-1.5" aria-label="Files">
                {view.files.map((file) => (
                  <li
                    className={cn(
                      'max-w-56 truncate border border-border/50 px-1.5 py-0.5 text-muted-foreground',
                      shape.chip,
                    )}
                    key={file}
                    title={file}
                  >
                    {basename(file)}
                  </li>
                ))}
              </ul>
            )}
          </section>
          {view.text && (
            <section className="flex flex-col gap-1.5">
              <h4 className="text-caption text-muted-foreground">Result</h4>
              <div className="max-h-72 overflow-auto whitespace-pre-wrap text-foreground select-text">
                {view.text}
              </div>
            </section>
          )}
        </div>
      </Disclosure>
    </div>
  );
}
