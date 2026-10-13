/** Each chat owns its crew selection; the host remembers defaults for new chats. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';

import type {
  AgentTool,
  AgentToolChange,
  AgentToolsPort,
} from '@/features/agent/application/ports';
import { useRequestSignals } from '@/shared/runtime/use-request-signals';

export interface AgentToolsView {
  readonly tools: readonly AgentTool[];
  readonly loading: boolean;
  readonly saving: boolean;
  readonly error: string | null;
  retryLoading(): void;
  change(tool: AgentTool['id'], change: AgentToolChange): void;
}

export function useAgentTools(
  port: AgentToolsPort,
  chat: string,
  onChanged: () => void,
): AgentToolsView {
  const client = useQueryClient();
  const signalFor = useRequestSignals<'set'>();
  const pending = useRef(false);
  const key = ['agent-tools', chat] as const;
  const tools = useQuery({
    queryFn: ({ signal }) => port.list(signal, chat),
    queryKey: key,
    retry: false,
  });
  const set = useMutation({
    mutationFn: (input: { tool: string; change: AgentToolChange; chat: string; applied(): void }) =>
      port.set(input.tool, input.change, signalFor('set'), input.chat),
    onMutate: async (input) => {
      const queryKey = ['agent-tools', input.chat];
      await client.cancelQueries({ queryKey });
      const previous = client.getQueryData<readonly AgentTool[]>(queryKey);
      client.setQueryData<readonly AgentTool[]>(queryKey, (current) =>
        current?.map((tool) => (tool.id === input.tool ? { ...tool, ...input.change } : tool)),
      );
      return { previous, queryKey };
    },
    onError: (_error, _input, context) => {
      if (context) client.setQueryData(context.queryKey, context.previous);
    },
    onSuccess: (saved, input) => {
      client.setQueryData(['agent-tools', input.chat], saved);
      input.applied();
    },
    onSettled: () => {
      pending.current = false;
    },
  });
  return {
    tools: tools.data ?? [],
    loading: tools.isPending,
    saving: set.isPending,
    error: set.isError
      ? 'Crew could not be saved. Your previous choices are kept. Try again.'
      : tools.isError
        ? 'Crew could not be loaded. Reopen the menu to try again.'
        : null,
    retryLoading: () => {
      if (tools.isError) void tools.refetch();
    },
    change: (tool, change) => {
      if (pending.current) return;
      pending.current = true;
      set.mutate({ tool, change, chat, applied: onChanged });
    },
  };
}
