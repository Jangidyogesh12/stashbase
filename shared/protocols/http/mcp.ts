import { z } from 'zod';

/**
 * The Settings → MCP access surface: `GET /api/mcp/status` and the three
 * writes under `/api/mcp/http/`.
 *
 * `token` is nullable rather than optional because the server reports an
 * unreadable credential as an explicit null, and `dockerError` /
 * `settingsError` are absent rather than empty when nothing is wrong.
 */

const urlSchema = z.string().min(1).max(2048);
const portSchema = z.number().int().min(1).max(65_535);

/** The Streamable HTTP listener state, as `shared/mcp.ts` declares it. */
const mcpHttpStatusSchema = z
  .object({
    dockerAccess: z.boolean(),
    dockerActive: z.boolean(),
    dockerError: z.string().max(2000).optional(),
    dockerPort: portSchema,
    dockerUrl: urlSchema,
    loopbackUrl: urlSchema,
    settingsError: z.string().max(2000).optional(),
    token: z.string().max(512).nullable(),
  })
  .passthrough();

/** `GET /api/mcp/status`. `config` is the standard stdio block to paste. */
export const mcpStatusSchema = z
  .object({
    command: z.string().min(1).max(4096),
    config: z.record(z.string(), z.unknown()),
    http: mcpHttpStatusSchema,
  })
  .passthrough();

/** Every `/api/mcp/http/` write answers with the listener state it produced. */
export const mcpHttpWriteResponseSchema = z
  .object({ http: mcpHttpStatusSchema, ok: z.literal(true) })
  .passthrough();

export const mcpDockerAccessRequestSchema = z.object({ enabled: z.boolean() }).strict();

/** The server refuses anything outside the unprivileged range. */
export const mcpDockerPortRequestSchema = z
  .object({ port: z.number().int().min(1024).max(65_535) })
  .strict();

export const mcpFailureSchema = z.object({ error: z.string().trim().min(1).max(500) }).passthrough();

export type McpHttpStatusWire = z.infer<typeof mcpHttpStatusSchema>;
