/** The Chat pane's way into the project's scheduled tasks, beside history and
 *  New chat, so the list is in reach from Documents too. It toggles: pressed,
 *  the tasks stand in the chat's place, and pressing again brings the chat
 *  back. */
import { CalendarClock } from 'lucide-react';
import { useStore } from 'zustand';

import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import type { AgentWorkspaceRuntime } from '@/features/agent/application/workspace-runtime';

export function ScheduledTasksButton({ runtime }: { runtime: AgentWorkspaceRuntime }) {
  const open = useStore(runtime.store, (state) => state.surface === 'scheduled-tasks');
  return (
    <Tooltip content="Scheduled tasks" side="bottom">
      <Button
        aria-label="Scheduled tasks"
        aria-pressed={open}
        className={open ? 'bg-hover text-foreground' : undefined}
        onClick={() => runtime.showScheduledTasks(!open)}
        size="icon-compact"
        variant="ghost"
      >
        <CalendarClock aria-hidden="true" />
      </Button>
    </Tooltip>
  );
}
