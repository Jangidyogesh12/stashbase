/** The active Chat's name for the workspace titlebar: the Agent's mark and
 *  the conversation's title, at the left of the row's shared slot while the
 *  Chat has the whole card and the pane draws no name row of its own, on the
 *  column that row would have named it in. It names and does not rename: the
 *  Chats panel beside it owns renaming. */
import { CalendarClock } from 'lucide-react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

import type { AgentSessionRuntime } from '@/features/agent/application/session-runtime';
import type { AgentWorkspaceRuntime } from '@/features/agent/application/workspace-runtime';
import { agentLabel } from '@/features/agent/domain/agent-catalog';
import { agentSessionIsUnstarted } from '@/features/agent/domain/session';
import { cn } from '@/lib/utils';
import { AGENT_ICONS } from '@/shared/brand/agent-icons';

export function ChatTitle({ runtime }: { runtime: AgentWorkspaceRuntime }) {
  const active = useStore(runtime.store, (state) => runtime.session(state.activeId));
  const tasks = useStore(runtime.store, (state) => state.surface === 'scheduled-tasks');
  if (tasks) {
    return (
      <span
        aria-level={2}
        className="flex min-w-0 items-center gap-1.5 text-caption"
        role="heading"
      >
        <CalendarClock
          aria-hidden
          className="size-3.5 shrink-0 text-muted-foreground"
          strokeWidth={1.75}
        />
        <span className="min-w-0 truncate font-medium text-foreground">Scheduled tasks</span>
      </span>
    );
  }
  return active ? <SessionTitle active={active} /> : null;
}

function SessionTitle({ active }: { active: AgentSessionRuntime }) {
  const state = useStore(
    active.store,
    useShallow((current) => ({
      agent: current.agent,
      title: current.title,
      unstarted: agentSessionIsUnstarted(current),
    })),
  );
  const Icon = AGENT_ICONS[state.agent];
  return (
    <span
      aria-label={`${state.title}, ${agentLabel(state.agent)}`}
      aria-level={2}
      className="flex min-w-0 items-center gap-1.5 text-caption"
      role="heading"
      title={state.title}
    >
      <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
      {/* An unstarted Chat's default name stays quiet, the same voice the
       *  pane's own row gives it; a named conversation reads as the title. */}
      <span
        className={cn(
          'min-w-0 truncate',
          state.unstarted ? 'text-muted-foreground' : 'font-medium text-foreground',
        )}
      >
        {state.title}
      </span>
    </span>
  );
}
