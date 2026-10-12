/** The Codex app-server's model catalog as StashBase reads it: `model/list`
 * pages normalized into the shared model shape, in the order the runtime
 * advertises, with the entries it hides from its own picker dropped. Pure
 * over a request function, so a chat session and the runtime-level read that
 * needs no thread share one reading. */
import type { AgentModel } from '../shared/agent-protocol.ts';

type JsonObject = Record<string, unknown>;

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

/** Normalize one catalog entry while retaining its advertised effort order.
 * Codex returns effort entries as objects, unlike the Claude SDK. The
 * runtime's own default model and each model's default effort travel with
 * the entry, so the composer can name what an unchosen turn runs on. */
function codexCatalogModel(entry: unknown): AgentModel | null {
  if (!entry || typeof entry !== 'object') return null;
  const value = entry as JsonObject;
  if (value.hidden === true) return null;
  const id = stringValue(value.id) ?? stringValue(value.model);
  if (!id) return null;
  const supportedEfforts = Array.isArray(value.supportedReasoningEfforts)
    ? value.supportedReasoningEfforts.flatMap((effort): string[] => {
      if (typeof effort === 'string') return [effort];
      if (!effort || typeof effort !== 'object') return [];
      const name = stringValue((effort as JsonObject).reasoningEffort);
      return name ? [name] : [];
    })
    : [];
  const defaultEffort = stringValue(value.defaultReasoningEffort);
  return {
    id,
    label: stringValue(value.displayName) ?? stringValue(value.name) ?? id,
    ...(typeof value.description === 'string' ? { description: value.description } : {}),
    ...(supportedEfforts.length ? { supportedEfforts } : {}),
    ...(defaultEffort && supportedEfforts.includes(defaultEffort) ? { defaultEffort } : {}),
    ...(value.isDefault === true ? { isDefault: true } : {}),
  };
}

/** Model catalogs are paginated by the native app-server. A valid selected
 * model can appear on a later page, so callers validate only after every
 * page has been collected. */
export async function loadCodexModelCatalog(
  request: (method: string, params: unknown) => Promise<unknown>,
): Promise<AgentModel[]> {
  const models: AgentModel[] = [];
  const seenModels = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  while (true) {
    const result = await request('model/list', cursor ? { cursor } : {}) as JsonObject;
    const entries = Array.isArray(result.data) ? result.data : Array.isArray(result.models) ? result.models : [];
    for (const entry of entries) {
      const model = codexCatalogModel(entry);
      if (model && !seenModels.has(model.id)) {
        seenModels.add(model.id);
        models.push(model);
      }
    }
    const nextCursor = stringValue(result.nextCursor);
    if (!nextCursor || seenCursors.has(nextCursor)) break;
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
  return models;
}
