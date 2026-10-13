/** Default's model tools: which are on, on which model. */
import {
  AgentSessionError,
  type AgentTool,
  type AgentToolsPort,
} from '@/features/agent/application/ports';
import { request, type TransportRequest } from '@/platform/http/classify';
import type { HttpClient } from '@/platform/http/client';
import { agentRuntimeFailureSchema } from '@/protocols/http/agent-runtime';
import {
  defaultAgentToolRequestSchema,
  defaultAgentToolsSchema,
  type DefaultAgentToolsWire,
} from '@/protocols/http/agent-tools';

const PATH = '/api/agent-tools';

function toolsRequest(signal: AbortSignal, method: 'GET' | 'PUT', chat: string): TransportRequest {
  return {
    error: AgentSessionError,
    failureSchema: agentRuntimeFailureSchema,
    method,
    path: `${PATH}?${new URLSearchParams({ chat })}`,
    signal,
  };
}

function toTools(wire: DefaultAgentToolsWire): readonly AgentTool[] {
  return wire.tools;
}

export function createAgentToolsAdapter(client: HttpClient): AgentToolsPort {
  return {
    async list(signal, chat) {
      return toTools(
        await request(client, {
          ...toolsRequest(signal, 'GET', chat),
          schema: defaultAgentToolsSchema,
        }),
      );
    },
    async set(tool, change, signal, chat) {
      return toTools(
        await request(client, {
          ...toolsRequest(signal, 'PUT', chat),
          body: defaultAgentToolRequestSchema.parse({ tool, ...change }),
          schema: defaultAgentToolsSchema,
        }),
      );
    },
  };
}
