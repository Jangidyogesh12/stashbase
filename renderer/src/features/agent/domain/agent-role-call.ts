/** A Crew card uses the call's persisted identity, brief, and result. */
import type { AgentTranscriptBlock } from '@/features/agent/domain/session';
import type { AgentCrewCall } from '@/features/agent/domain/session-transcript';

type ToolBlock = Extract<AgentTranscriptBlock, { kind: 'tool' }>;

export interface AgentRoleCallView {
  readonly label: string;
  readonly icon: string;
  /** The model that ran it, or the one it runs on while it is running. */
  readonly model: string | null;
  readonly task: string;
  readonly context: string;
  readonly files: readonly string[];
  /** The complete text returned by the member. */
  readonly text: string | null;
  readonly error: string | null;
}

export function agentRoleCallView(block: ToolBlock, tool: AgentCrewCall): AgentRoleCallView {
  const input = block.input;
  const files = Array.isArray(input.files)
    ? input.files.filter((file): file is string => typeof file === 'string')
    : [];
  const raw = block.result ?? null;
  const text = raw?.trim() ?? null;
  const failed = block.status === 'error';
  return {
    label: tool.label,
    icon: tool.icon,
    model: tool.model,
    task: typeof input.task === 'string' ? input.task : '',
    context: typeof input.context === 'string' ? input.context : '',
    files,
    text: block.status === 'done' ? text || null : null,
    error: failed ? text || 'The tool did not finish.' : null,
  };
}
