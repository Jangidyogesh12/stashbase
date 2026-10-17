/**
 * The Default Agent's tool catalog, as the StashBase API publishes it
 * (`GET /v2/agent/tools`): the tools, what each one is for, and the tool
 * model pool they choose from.
 *
 * The tool pool is its own catalog. A model here may share an id with a main
 * Agent profile, but its version, configuration, and selection belong to the
 * tools alone, so nothing here reads `/v1/agent/models`.
 *
 * One cached copy is kept per signed-in account, with the ETag the service
 * sent. A failed refresh keeps serving that copy; without one the catalog is
 * unavailable, and the Agent runs without tools rather than on a guessed
 * configuration.
 */
import { z } from 'zod';
import { getHostedAccountSession } from './app-config.ts';
import { hostedAccessToken, stashbaseClientVersion, STASHBASE_API_URL } from './hosted-account.ts';
import { logger } from './log.ts';

const log = logger('agent-tool-catalog');

/** Ids and function names reach config keys and MCP tool names, so only
 * plain identifiers are accepted. */
const TOOL_ID = /^[a-z][a-z0-9-]{0,39}$/;
const TOOL_NAME = /^[a-z][a-z0-9_]{0,63}$/;

const availabilitySchema = z.object({
  status: z.enum(['available', 'unavailable']),
  reason: z.string().trim().max(200).optional(),
}).strip();

const toolModelSchema = z.object({
  id: z.string().trim().min(1).max(100),
  version: z.number().int().positive(),
  name: z.string().trim().min(1).max(200),
  relativeCost: z.number().positive().max(10_000),
  contextTokenLimit: z.number().int().positive(),
  outputTokenLimit: z.number().int().positive(),
  availability: availabilitySchema,
}).passthrough();

const toolSchema = z.object({
  id: z.string().regex(TOOL_ID),
  kind: z.literal('agent-role'),
  version: z.number().int().positive(),
  name: z.string().trim().min(1).max(100),
  summary: z.string().trim().max(200),
  icon: z.string().trim().max(60),
  availability: availabilitySchema,
  modelIds: z.array(z.string()),
  defaultModelId: z.string(),
  agent: z.object({
    toolName: z.string().regex(TOOL_NAME),
    description: z.string().trim().min(1).max(8_000),
  }).passthrough(),
}).passthrough();

export type ToolAvailability = z.infer<typeof availabilitySchema>;

export interface ToolModel {
  id: string;
  version: number;
  name: string;
  /** A display weight only; it never prices a call. */
  relativeCost: number;
  contextTokenLimit: number;
  outputTokenLimit: number;
  availability: ToolAvailability;
}

export interface CatalogTool {
  id: string;
  version: number;
  name: string;
  summary: string;
  icon: string;
  availability: ToolAvailability;
  /** The models it may run on, each present in the catalog's pool. */
  modelIds: string[];
  defaultModelId: string;
  /** The function name and full description registered with the main Agent,
   * used as published. */
  agent: { toolName: string; description: string };
}

export interface ToolCatalog {
  /** Opaque: it marks a change, and is never a tool version. */
  revision: string;
  models: ToolModel[];
  tools: CatalogTool[];
}

/** Entries this client cannot read are left out rather than failing the
 * whole catalog, so a later field or a new kind of tool never hides the
 * tools it can run. A different schema version is refused outright. */
export function parseToolCatalog(payload: unknown): ToolCatalog {
  const raw = payload as { schemaVersion?: unknown; revision?: unknown; models?: unknown; tools?: unknown } | null;
  if (raw?.schemaVersion !== 2 || typeof raw.revision !== 'string'
    || !Array.isArray(raw.models) || !Array.isArray(raw.tools)) {
    throw new Error('The tool catalog has an unexpected shape.');
  }
  const models: ToolModel[] = [];
  for (const entry of raw.models) {
    const parsed = toolModelSchema.safeParse(entry);
    if (!parsed.success || models.some((model) => model.id === parsed.data.id)) continue;
    const { id, version, name, relativeCost, contextTokenLimit, outputTokenLimit, availability } = parsed.data;
    models.push({ id, version, name, relativeCost, contextTokenLimit, outputTokenLimit, availability });
  }
  const tools: CatalogTool[] = [];
  for (const entry of raw.tools) {
    const parsed = toolSchema.safeParse(entry);
    if (!parsed.success) continue;
    const tool = parsed.data;
    if (tools.some((known) => known.id === tool.id || known.agent.toolName === tool.agent.toolName)) continue;
    tools.push({
      id: tool.id,
      version: tool.version,
      name: tool.name,
      summary: tool.summary,
      icon: tool.icon,
      availability: tool.availability,
      modelIds: [...new Set(tool.modelIds)].filter((id) => models.some((model) => model.id === id)),
      defaultModelId: tool.defaultModelId,
      agent: { toolName: tool.agent.toolName, description: tool.agent.description },
    });
  }
  return { revision: raw.revision, models, tools };
}

export interface ToolCatalogDependencies {
  accessToken(options?: { forceRefresh?: boolean }): Promise<string>;
  fetch(input: string, init?: RequestInit): Promise<Response>;
  /** The signed-in account the cache belongs to, or undefined when signed out. */
  accountId(): string | undefined;
  clientVersion(): string;
}

const defaultDependencies: ToolCatalogDependencies = {
  accessToken: hostedAccessToken,
  fetch: (input, init) => globalThis.fetch(input, init),
  accountId: () => getHostedAccountSession()?.userId,
  clientVersion: stashbaseClientVersion,
};

interface CachedCatalog {
  accountId: string;
  etag: string | null;
  catalog: ToolCatalog;
}

/** The latest catalog, for new turns and the model picker. A running turn
 * reads its own snapshot instead, so a refresh here never changes it. */
export class ToolCatalogSource {
  private cached: CachedCatalog | null = null;
  private reading: { accountId: string; promise: Promise<ToolCatalog> } | null = null;

  constructor(private readonly dependencies: ToolCatalogDependencies = defaultDependencies) {}

  /** The catalog for the signed-in account: refreshed with the stored ETag,
   * or the cached copy when the service answers 304 or cannot be reached. */
  async latest(): Promise<ToolCatalog> {
    const accountId = this.dependencies.accountId();
    if (!accountId) {
      this.clear();
      throw Object.assign(new Error('Sign in to use the crew.'), { status: 401 });
    }
    if (this.cached && this.cached.accountId !== accountId) this.clear();
    if (this.reading?.accountId === accountId) return this.reading.promise;
    const promise = this.refresh(accountId).finally(() => {
      if (this.reading?.promise === promise) this.reading = null;
    });
    this.reading = { accountId, promise };
    return promise;
  }

  /** Forgets the cached catalog, for sign-out and an account switch. */
  clear(): void {
    this.cached = null;
    this.reading = null;
  }

  private async refresh(accountId: string): Promise<ToolCatalog> {
    const cached = this.cached?.accountId === accountId ? this.cached : null;
    try {
      let response = await this.request(cached?.etag ?? null, false);
      if (response.status === 401) {
        await response.body?.cancel();
        response = await this.request(cached?.etag ?? null, true);
      }
      if (response.status === 304 && cached) {
        await response.body?.cancel();
        return cached.catalog;
      }
      const payload = await response.json().catch(() => null) as { message?: unknown; error?: { message?: unknown } } | null;
      if (!response.ok) {
        const message = payload?.error?.message ?? payload?.message;
        throw Object.assign(new Error(typeof message === 'string' && message
          ? message
          : `The crew is unavailable (HTTP ${response.status}).`), { status: response.status });
      }
      const catalog = parseToolCatalog(payload);
      // An account switch while the request was out must not keep it.
      if (this.dependencies.accountId() === accountId) {
        this.cached = { accountId, etag: response.headers.get('etag'), catalog };
      }
      return catalog;
    } catch (error) {
      const status = (error as { status?: unknown }).status;
      if (cached && status !== 401 && status !== 426) {
        log.warn('could not refresh the tool catalog; using the cached copy', error);
        return cached.catalog;
      }
      throw error;
    }
  }

  private async request(etag: string | null, forceRefresh: boolean): Promise<Response> {
    const token = await this.dependencies.accessToken({ forceRefresh });
    return this.dependencies.fetch(`${STASHBASE_API_URL}/v2/agent/tools`, {
      signal: AbortSignal.timeout(10_000),
      headers: {
        authorization: `Bearer ${token}`,
        'x-stashbase-client-version': this.dependencies.clientVersion(),
        // The ETag goes back exactly as it came; `revision` is never a substitute.
        ...(etag ? { 'if-none-match': etag } : {}),
      },
    });
  }
}

const source = new ToolCatalogSource();
export const latestToolCatalog = (): Promise<ToolCatalog> => source.latest();
export const clearToolCatalogCache = (): void => source.clear();
