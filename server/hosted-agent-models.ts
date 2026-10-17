import { z } from 'zod';
import type { AgentModel } from '../shared/agent-protocol.ts';
import { hostedAccessToken, stashbaseClientVersion, STASHBASE_API_URL } from './hosted-account.ts';

const catalogSchema = z.object({ models: z.array(z.object({
  version: z.number().int().positive(),
  id: z.string().min(1).max(200), displayName: z.string().min(1).max(500),
  contextTokenLimit: z.number().int().positive(), outputTokenLimit: z.number().int().positive(),
  reasoningEnabled: z.boolean(), isDefault: z.boolean(),
})).min(1).max(256) });

export interface HostedAgentModel extends AgentModel {
  version: number;
  contextTokenLimit: number;
  outputTokenLimit: number;
  reasoningEnabled: boolean;
}

/** Account tokens stay in the host. Never persist an account's hosted catalog. */
export async function readHostedAgentModels(dependencies = {
  accessToken: hostedAccessToken, fetch: globalThis.fetch,
}): Promise<HostedAgentModel[]> {
  for (const forceRefresh of [false, true]) {
    const token = await dependencies.accessToken({ forceRefresh });
    const response = await dependencies.fetch(`${STASHBASE_API_URL}/v1/agent/models`, {
      headers: { authorization: `Bearer ${token}`, 'x-stashbase-client-version': stashbaseClientVersion() },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 401 && !forceRefresh) { await response.body?.cancel(); continue; }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Could not load available Agent models (HTTP ${response.status}).`);
    }
    const { models } = catalogSchema.parse(await response.json());
    if (new Set(models.map(model => model.id)).size !== models.length || models.filter(model => model.isDefault).length !== 1) {
      throw new Error('The Agent model catalog has no unique default.');
    }
    return models.map(({ displayName, ...model }) => ({ ...model, label: displayName }));
  }
  throw new Error('Sign in to StashBase to load Agent models.');
}

export function publicHostedModels(models: HostedAgentModel[]): AgentModel[] {
  return models.map(({ id, label, isDefault }) => ({ id, label, isDefault }));
}
