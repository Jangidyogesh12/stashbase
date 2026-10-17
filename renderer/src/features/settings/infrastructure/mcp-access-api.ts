import type { McpAccessPort } from '@/features/settings/application/ports';
import { formatMcpConfig, type McpHttpAccess } from '@/features/settings/domain/mcp-access';
import { settingsRequest } from '@/features/settings/infrastructure/settings-request';
import { request } from '@/platform/http/classify';
import type { HttpClient } from '@/platform/http/client';
import {
  mcpDockerAccessRequestSchema,
  mcpDockerPortRequestSchema,
  mcpFailureSchema,
  mcpHttpWriteResponseSchema,
  mcpStatusSchema,
  type McpHttpStatusWire,
} from '@/protocols/http/mcp';

/** The transport omits `dockerError` and `settingsError` when nothing is
 *  wrong; `domain/mcp-access.ts` spells "nothing is wrong" as null, so every
 *  reader above can compare instead of testing for presence. */
function toHttpAccess(wire: McpHttpStatusWire): McpHttpAccess {
  return {
    dockerAccess: wire.dockerAccess,
    dockerActive: wire.dockerActive,
    dockerError: wire.dockerError ?? null,
    dockerPort: wire.dockerPort,
    dockerUrl: wire.dockerUrl,
    loopbackUrl: wire.loopbackUrl,
    settingsError: wire.settingsError ?? null,
    token: wire.token,
  };
}

function mcpAccess(path: string, signal: AbortSignal) {
  return settingsRequest({ failureSchema: mcpFailureSchema, path, signal });
}

export function createMcpAccessAdapter(client: HttpClient): McpAccessPort {
  return {
    async status(signal) {
      const wire = await request(client, {
        ...mcpAccess('/api/mcp/status', signal),
        schema: mcpStatusSchema,
      });
      return {
        command: wire.command,
        config: formatMcpConfig(wire.config),
        http: toHttpAccess(wire.http),
      };
    },
    async rotateToken(signal) {
      const parsed = await request(client, {
        ...mcpAccess('/api/mcp/http/token', signal),
        method: 'POST',
        schema: mcpHttpWriteResponseSchema,
      });
      return toHttpAccess(parsed.http);
    },
    async setDockerAccess(enabled, signal) {
      const parsed = await request(client, {
        ...mcpAccess('/api/mcp/http/docker-access', signal),
        body: mcpDockerAccessRequestSchema.parse({ enabled }),
        method: 'PUT',
        schema: mcpHttpWriteResponseSchema,
      });
      return toHttpAccess(parsed.http);
    },
    async setDockerPort(port, signal) {
      const parsed = await request(client, {
        ...mcpAccess('/api/mcp/http/docker-port', signal),
        body: mcpDockerPortRequestSchema.parse({ port }),
        method: 'PUT',
        schema: mcpHttpWriteResponseSchema,
      });
      return toHttpAccess(parsed.http);
    },
  };
}
