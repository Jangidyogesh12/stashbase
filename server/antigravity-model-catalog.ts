/**
 * Antigravity's model catalog, read from `agy --output-format json models`.
 *
 * The CLI names a model by a slug that may carry its reasoning effort
 * (`gemini-3.8-flash-high`), and accepts the base slug with `--effort` since
 * 1.3.4. Variants of one base collapse into one model whose efforts the
 * picker offers, so the reader chooses a model and a level the way the other
 * runtimes present them.
 */
import { agentCliEnv, commandDir, resolveAgentCli } from './agent-cli.ts';
import { probeAgentCommand } from './agent-probe.ts';
import { nativeAgentCliSpec } from './native-agents.ts';
import type { AgentModel } from '../shared/agent-protocol.ts';

/** Levels `--effort` accepts, in the order the picker presents them. */
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
const EFFORT_SUFFIX = new RegExp(`-(${EFFORTS.join('|')})$`, 'i');

interface ListedModel {
  id: string;
  label: string;
  isDefault: boolean;
}

/** The models a JSON listing names, from its command payload or a bare list. */
function listedModels(output: string): ListedModel[] {
  let parsed: unknown;
  try { parsed = JSON.parse(output.trim()); } catch { return []; }
  const root = object(parsed);
  const command = object(root.command);
  const candidates = [object(command.data).models, command.models, object(root.data).models, root.models, parsed];
  const list = candidates.find(Array.isArray) as unknown[] | undefined;
  if (!list) return [];
  return list.flatMap((entry) => {
    if (typeof entry === 'string') return entry ? [{ id: entry, label: entry, isDefault: false }] : [];
    const value = object(entry);
    const id = text(value.id) || text(value.slug) || text(value.model) || text(value.name);
    if (!id) return [];
    return [{
      id,
      label: text(value.label) || text(value.display_name) || text(value.displayName) || text(value.name) || id,
      isDefault: value.default === true || value.is_default === true || value.isDefault === true || value.current === true,
    }];
  });
}

export function antigravityModelsFromListing(output: string): { models: AgentModel[]; defaultModel?: string } {
  const listed = listedModels(output);
  const groups = new Map<string, { label: string; efforts: Set<string>; isDefault: boolean; bare: boolean }>();
  for (const model of listed) {
    const suffix = EFFORT_SUFFIX.exec(model.id)?.[1]?.toLowerCase();
    const variants = suffix ? listed.filter((other) => other.id.replace(EFFORT_SUFFIX, '') === model.id.replace(EFFORT_SUFFIX, '')) : [];
    // A lone slug that merely ends in an effort word is its own model.
    const base = suffix && variants.length > 1 ? model.id.replace(EFFORT_SUFFIX, '') : model.id;
    const group = groups.get(base) ?? { label: '', efforts: new Set<string>(), isDefault: false, bare: false };
    if (base === model.id) {
      group.bare = true;
      group.label = model.label;
    } else {
      group.efforts.add(suffix!);
      if (!group.label) group.label = labelWithoutEffort(model.label);
    }
    group.isDefault ||= model.isDefault;
    groups.set(base, group);
  }
  const models: AgentModel[] = [...groups].map(([id, group]) => ({
    id,
    label: group.label || id,
    ...(group.efforts.size ? { supportedEfforts: EFFORTS.filter((effort) => group.efforts.has(effort)) } : {}),
    ...(group.isDefault ? { isDefault: true } : {}),
  }));
  const defaultModel = models.find((model) => model.isDefault)?.id;
  return { models, ...(defaultModel ? { defaultModel } : {}) };
}

function labelWithoutEffort(label: string): string {
  return label
    .replace(new RegExp(`\\s*[-(]?\\s*(?:${EFFORTS.join('|')})\\)?$`, 'i'), '')
    .trim() || label;
}

/** The model `agy` runs when none is chosen, as `-p /model` names it:
 * `command.data` carries its slug and effort. `agy` reports no model when a
 * session starts, so this is how the picker learns what an unchosen turn
 * runs on. */
export function antigravityCurrentModel(output: string): { id: string; effort?: string } | null {
  let parsed: unknown;
  try { parsed = JSON.parse(output.trim()); } catch { return null; }
  const data = object(object(object(parsed).command).data);
  const id = text(data.id);
  const effort = text(data.effort).toLowerCase();
  return id ? { id, ...(effort ? { effort } : {}) } : null;
}

/** Name the current model as the catalog's default: its own row, or the row
 * its effort variant was grouped into, with that effort as the row's default. */
export function withCurrentModel(
  reading: { models: AgentModel[]; defaultModel?: string },
  current: { id: string; effort?: string } | null,
): { models: AgentModel[]; defaultModel?: string } {
  if (!current) return reading;
  const base = current.id.replace(EFFORT_SUFFIX, '');
  const match = reading.models.find((model) => model.id === current.id)
    ?? reading.models.find((model) => model.id === base && !!model.supportedEfforts?.length);
  if (!match) return reading;
  const effort = current.effort ?? EFFORT_SUFFIX.exec(current.id)?.[1]?.toLowerCase();
  const models = reading.models.map((model) => {
    const { isDefault: _isDefault, ...rest } = model;
    if (model !== match) return rest;
    return {
      ...rest,
      isDefault: true,
      ...(effort && model.supportedEfforts?.includes(effort) ? { defaultEffort: effort } : {}),
    };
  });
  return { models, defaultModel: match.id };
}

export async function readAntigravityModelCatalog(timeoutMs = 60_000): Promise<{ models: AgentModel[]; defaultModel?: string }> {
  const executable = resolveAgentCli(nativeAgentCliSpec('antigravity'));
  if (!executable) throw new Error('Antigravity CLI not found.');
  const run = (args: string[]) => probeAgentCommand(executable, args, {
    timeoutMs,
    env: agentCliEnv({}, [commandDir(executable)]),
  });
  // Each `agy` run starts its own backend, so the two reads go side by side.
  // `--output-format` must come before the subcommand.
  const [listing, current] = await Promise.all([
    run(['--output-format', 'json', 'models']),
    run(['--output-format', 'json', '-p', '/model']).catch(() => null),
  ]);
  if (listing.status !== 0) {
    const detail = `${listing.stderr}\n${listing.stdout}`.replace(/\s+/g, ' ').trim().slice(-400);
    throw new Error(`agy models exited with code ${listing.status ?? 'unknown'}${detail ? `: ${detail}` : ''}`);
  }
  const reading = antigravityModelsFromListing(listing.stdout);
  if (!reading.models.length) throw new Error('agy models listed no models.');
  // Without the current model the list still offers every model; only the
  // name of an unchosen turn's model is missing.
  return withCurrentModel(reading, current?.status === 0 ? antigravityCurrentModel(current.stdout) : null);
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
