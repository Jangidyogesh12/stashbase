import { describe, expect, it, vi } from 'vite-plus/test';

import type { HttpClient } from '@/platform/http/client';

import { createMcpAccessAdapter } from './mcp-access-api';

const signal = new AbortController().signal;

const command = '/home/ada/.stashbase/mcp/stashbase-mcp';

const listener = {
  dockerAccess: true,
  dockerActive: false,
  dockerPort: 8787,
  dockerUrl: 'http://host.docker.internal:8787/mcp',
  loopbackUrl: 'http://127.0.0.1:8787/mcp',
  token: 'sk-stashbase-local',
};

describe('MCP access API', () => {
  it('formats the stdio config and reads an unset listener error as null', async () => {
    const client: HttpClient = {
      request: vi.fn(async () => ({
        body: {
          command,
          config: { mcpServers: { stashbase: { command } } },
          http: listener,
        },
        status: 200,
      })),
    };
    await expect(createMcpAccessAdapter(client).status(signal)).resolves.toEqual({
      command,
      config: `{
  "mcpServers": {
    "stashbase": {
      "command": "${command}"
    }
  }
}`,
      http: { ...listener, dockerError: null, settingsError: null },
    });
  });

  it('saves the Docker port and returns the listener the server produced', async () => {
    const request = vi.fn(async () => ({
      body: {
        http: {
          ...listener,
          dockerActive: true,
          dockerPort: 9000,
          dockerUrl: 'http://host.docker.internal:9000/mcp',
        },
        ok: true,
      },
      status: 200,
    }));
    await expect(
      createMcpAccessAdapter({ request }).setDockerPort(9000, signal),
    ).resolves.toMatchObject({ dockerActive: true, dockerPort: 9000 });
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { port: 9000 },
        method: 'PUT',
        path: '/api/mcp/http/docker-port',
      }),
    );
  });

  it('carries the server reason for a refused port as the cause', async () => {
    const client: HttpClient = {
      request: vi.fn(async () => ({
        body: { error: '`port` must be an integer from 1024 to 65535' },
        status: 400,
      })),
    };
    await expect(createMcpAccessAdapter(client).setDockerPort(9000, signal)).rejects.toMatchObject({
      cause: new Error('`port` must be an integer from 1024 to 65535'),
      kind: 'invalid-request',
    });
  });
});
