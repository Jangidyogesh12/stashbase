/**
 * Streamable HTTP transport for the project MCP server.
 *
 * URL-only server clients attach at `POST /mcp`. Transport plumbing only:
 * each request gets a stateless server instance from the shared factory in
 * `mcp/project-server.ts`, backed directly by the app's Project Operations
 * module. The separately spawned stdio shim reaches those operations through
 * the `/api/project/*` HTTP adapter.
 *
 * Every request must carry the Settings-managed bearer token. The loopback
 * route is mounted on the app server; an optional Docker-facing listener
 * mounts only this route on its own port.
 *
 * Stateless mode (no session ids): the tool surface is pure request /
 * response, so there are no server-initiated streams to resume — GET (SSE)
 * and DELETE (session teardown) answer 405.
 */
import express from 'express';
import crypto from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createProjectMcpServer } from '../../mcp/project-server.ts';
import { logger } from '../log.ts';
import { createProjectOperations, type ProjectOperations } from '../project-operations/index.ts';

const log = logger('mcp-http');

export interface McpHttpTransportOptions {
  webBase: string;
  getToken(): string;
  /** Test-only or composition-root override for the in-process adapter. */
  operations?: ProjectOperations;
}

export function mount(app: express.Express, options: McpHttpTransportOptions): void {
  app.post('/mcp', (req, res) => {
    void handleMcpPost(req, res, options);
  });
  app.get('/mcp', (_req, res) => sendMethodNotAllowed(res));
  app.delete('/mcp', (_req, res) => sendMethodNotAllowed(res));
}

async function handleMcpPost(
  req: express.Request,
  res: express.Response,
  options: McpHttpTransportOptions,
): Promise<void> {
  let token: string;
  try {
    token = options.getToken();
  } catch (err: unknown) {
    log.warn(`credential read failed:`, err);
    res.status(500).json({
      jsonrpc: '2.0',
      error: { code: -32603, message: 'MCP HTTP credential is unavailable. Open Settings → MCP and try again.' },
      id: null,
    });
    return;
  }
  if (!bearerTokenMatches(req.header('authorization'), token)) {
    res.status(401).json({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Unauthorized. Copy the current bearer token from Settings → MCP.' },
      id: null,
    });
    return;
  }
  const server = createProjectMcpServer({
    webBase: options.webBase,
    operations: options.operations ?? createProjectOperations({ fileOperationOrigin: () => ({ origin: 'mcp' }) }),
  });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err: unknown) {
    log.warn(`request failed:`, err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'internal error' },
        id: null,
      });
    }
  }
}

function sendMethodNotAllowed(res: express.Response): void {
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed. The StashBase MCP endpoint is stateless: send JSON-RPC over POST.' },
    id: null,
  });
}

function bearerTokenMatches(header: string | undefined, token: string): boolean {
  const match = header?.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  const presented = Buffer.from(match[1].trim());
  const expected = Buffer.from(token);
  return presented.length === expected.length && crypto.timingSafeEqual(presented, expected);
}
