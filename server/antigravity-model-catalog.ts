/**
 * Antigravity's model catalog, read from `agy --output-format json models`.
 *
 * The CLI names a model by a slug that may carry its reasoning effort
 * (`gemini-3.8-flash-high`), and accepts the base slug with `--effort` since
 * 1.3.4. Variants of one base collapse into one model whose efforts the
 * picker offers, so the reader chooses a model and a level the way the other
 * runtimes present them.
 */
import { agentCliEnv, agentCliNeedsShell, commandDir, resolveAgentCli } from './agent-cli.ts';
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

export async function readAntigravityModelCatalog(timeoutMs = 30_000): Promise<{ models: AgentModel[]; defaultModel?: string }> {
  const executable = resolveAgentCli(nativeAgentCliSpec('antigravity'));
  if (!executable) throw new Error('Antigravity CLI not found.');
  // `--output-format` must come before the subcommand.
  const result = await probeAgentCommand(executable, ['--output-format', 'json', 'models'], {
    timeoutMs,
    shell: agentCliNeedsShell(executable),
    env: agentCliEnv({}, [commandDir(executable)]),
  });
  if (result.status !== 0) {
    const detail = `${result.stderr}\n${result.stdout}`.replace(/\s+/g, ' ').trim().slice(-400);
    throw new Error(`agy models exited with code ${result.status ?? 'unknown'}${detail ? `: ${detail}` : ''}`);
  }
  const reading = antigravityModelsFromListing(result.stdout);
  if (!reading.models.length) throw new Error('agy models listed no models.');
  return reading;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
