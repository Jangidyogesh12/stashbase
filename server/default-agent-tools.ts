/**
 * The Default Agent's optional tools, as the service's tool catalog defines
 * them, and the user's choice of which are on and on which model.
 *
 * The main agent always runs on the service's default profile and does the
 * whole job itself unless the user turns crew members on. Any of them may be
 * on together, and every one starts off; each runs on its catalog default
 * until the user picks another model. An enabled tool is a single model call, not an agent:
 * the host reads the files the main agent names, sends them with the tool's
 * published description as its role, and returns the text. Nothing about any
 * one member is written here: its work and output come from the catalog;
 * this module owns the shared briefing and selected division of work.
 *
 * A model the user picked that cannot be used is reported, never replaced
 * with another one. Choices belong to a chat and seed defaults for new chats.
 */
import { readAppConfig, readAppConfigStrict, writeAppConfigStrict } from './app-config.ts';
import type { CatalogTool, ToolCatalog, ToolModel } from './agent-tool-catalog.ts';
import type { DefaultAgentToolChoice, DefaultAgentToolView } from '../shared/protocols/http/agent-tools.ts';

/** The catalog's reason for a tool whose default model is switched off; the
 * tool still runs on another model the user chooses. */
const DEFAULT_MODEL_DISABLED = 'default_model_disabled';

export type CrewChoices = Partial<Record<string, DefaultAgentToolChoice>>;

function storedChoices(): CrewChoices {
  const stored = readAppConfig().defaultAgentTools;
  return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
}

/** A chat takes the remembered defaults once. Later choices belong to that
 * chat; they also seed future chats without changing any existing one. */
export function crewChatChoices(chat: string): CrewChoices {
  const config = readAppConfigStrict();
  if (config.agentCrewChats?.[chat]) return config.agentCrewChats[chat];
  const choices = { ...storedChoices() };
  config.agentCrewChats = Object.fromEntries([
    ...Object.entries(config.agentCrewChats ?? {}).slice(-9_999), [chat, choices],
  ]);
  writeAppConfigStrict(config);
  return choices;
}

export function rememberCrewChat(from: string, nativeId: string): void {
  if (from === nativeId) return;
  const choices = crewChatChoices(from);
  const config = readAppConfigStrict();
  config.agentCrewChats = { ...config.agentCrewChats, [nativeId]: choices };
  delete config.agentCrewChats[from];
  writeAppConfigStrict(config);
}

export function forgetCrewChat(chat: string): void {
  const config = readAppConfigStrict();
  if (!config.agentCrewChats?.[chat]) return;
  delete config.agentCrewChats[chat];
  writeAppConfigStrict(config);
}

/** A catalog reason is a code or a sentence; a code reads as plain words. */
function unavailableText(reason: string | undefined): string {
  return reason && /\s/.test(reason) ? reason : 'Not available right now.';
}

function pool(catalog: ToolCatalog, tool: CatalogTool): ToolModel[] {
  return tool.modelIds.flatMap((id) => catalog.models.filter((model) => model.id === id));
}

function usable(models: readonly ToolModel[], id: string | undefined): ToolModel | undefined {
  return models.find((model) => model.id === id && model.availability.status === 'available');
}

interface ToolResolution {
  model: ToolModel | null;
  /** The tool cannot be used at all. */
  unavailable: string | null;
  /** The tool needs the user to choose a model first. */
  modelProblem: string | null;
}

/** The model a tool runs on: the user's pick, else its default. Neither is
 * ever swapped for another model the user did not choose. */
function resolve(catalog: ToolCatalog, tool: CatalogTool, choice: DefaultAgentToolChoice | undefined): ToolResolution {
  const models = pool(catalog, tool);
  const defaultDisabled = tool.availability.status === 'unavailable' && tool.availability.reason === DEFAULT_MODEL_DISABLED;
  if (tool.availability.status === 'unavailable' && !defaultDisabled) {
    return { model: null, unavailable: unavailableText(tool.availability.reason), modelProblem: null };
  }
  if (choice?.model) {
    const picked = usable(models, choice.model);
    if (picked) return { model: picked, unavailable: null, modelProblem: null };
    const known = models.find((model) => model.id === choice.model);
    return {
      model: null,
      unavailable: null,
      modelProblem: known ? `${known.name} is unavailable. Choose another model.` : 'The chosen model is no longer offered. Choose another model.',
    };
  }
  const fallback = defaultDisabled ? undefined : usable(models, tool.defaultModelId);
  return fallback
    ? { model: fallback, unavailable: null, modelProblem: null }
    : { model: null, unavailable: null, modelProblem: 'Its default model is unavailable. Choose another model.' };
}

/** A tool that is on, with the model it runs on, both from one catalog. */
export interface EnabledAgentTool {
  tool: CatalogTool;
  model: ToolModel;
}

/** The tools enabled for a session, each on a model it can use now. */
export function enabledAgentTools(catalog: ToolCatalog, choices: CrewChoices = storedChoices()): EnabledAgentTool[] {
  return catalog.tools.flatMap((tool) => {
    const choice = choices[tool.id];
    if (choice?.enabled !== true) return [];
    const { model } = resolve(catalog, tool, choice);
    return model ? [{ tool, model }] : [];
  });
}

/** The same tool on the same model in a newer catalog, for a turn whose
 * first call found the catalog changed; null when it no longer fits. */
export function enabledAgentToolIn(catalog: ToolCatalog, toolId: string, modelId: string): EnabledAgentTool | null {
  const tool = catalog.tools.find((entry) => entry.id === toolId);
  if (!tool) return null;
  const { model } = resolve(catalog, tool, { model: modelId });
  return model ? { tool, model } : null;
}

/** The composer's view: each catalog tool, whether it is on, its model or
 * why it has none, and the models it may choose. */
export function defaultAgentToolViews(catalog: ToolCatalog, choices: CrewChoices = storedChoices()): DefaultAgentToolView[] {
  const views: DefaultAgentToolView[] = catalog.tools.map((tool) => {
    const choice = choices[tool.id];
    const resolution = resolve(catalog, tool, choice);
    const models = pool(catalog, tool);
    return {
      id: tool.id,
      label: tool.name,
      toolName: tool.agent.toolName,
      summary: tool.summary,
      icon: tool.icon,
      enabled: choice?.enabled === true,
      unavailable: resolution.unavailable,
      model: resolution.model?.id ?? null,
      modelProblem: resolution.modelProblem,
      defaultModel: models.some((model) => model.id === tool.defaultModelId) ? tool.defaultModelId : null,
      options: models.map((model) => {
        const available = model.availability.status === 'available';
        return { id: model.id, label: model.name, available, reason: available ? null : unavailableText(model.availability.reason) };
      }),
    };
  });
  for (const [id, choice] of Object.entries(choices)) {
    if (!choice?.enabled || catalog.tools.some((tool) => tool.id === id)) continue;
    views.push({ id, label: id, toolName: id, summary: '', icon: '', enabled: true,
      unavailable: 'This member is no longer offered. Turn it off to continue.',
      model: null, modelProblem: null, defaultModel: null, options: [] });
  }
  return views;
}

/** Turns a tool on or off, or picks one of its models that can be used now. */
export function setDefaultAgentTool(catalog: ToolCatalog, id: string, change: DefaultAgentToolChoice, chat?: string): void {
  const tool = catalog.tools.find((entry) => entry.id === id);
  if (!tool && !(change.enabled === false && change.model === undefined)) {
    throw Object.assign(new Error('That crew member is not offered.'), { status: 404 });
  }
  if (change.model !== undefined && tool && !usable(pool(catalog, tool), change.model)) {
    throw Object.assign(new Error(`${tool.name} cannot run on that model now.`), { status: 400 });
  }
  if (change.enabled === true && tool && resolve(catalog, tool, undefined).unavailable) {
    throw Object.assign(new Error(`${tool.name} is not available right now.`), { status: 409 });
  }
  const choices = chat ? crewChatChoices(chat) : storedChoices();
  const config = readAppConfigStrict();
  const next = { ...choices };
  next[id] = { ...next[id], ...change };
  config.defaultAgentTools = next;
  if (chat) config.agentCrewChats = { ...config.agentCrewChats, [chat]: { ...choices, [id]: { ...choices[id], ...change } } };
  writeAppConfigStrict(config);
}

/** The headers a tool call selects its tool and model with, versions read
 * separately from the turn's catalog snapshot. */
export interface AgentToolSelection {
  tool: string;
  toolVersion: number;
  model: string;
  modelVersion: number;
}

export function agentToolSelection(entry: EnabledAgentTool): AgentToolSelection {
  return { tool: entry.tool.id, toolVersion: entry.tool.version, model: entry.model.id, modelVersion: entry.model.version };
}

/** The catalog one root turn runs its tools on. It starts as the session's
 * own snapshot, so every role in the turn shares one catalog version, and a
 * newer catalog never replaces it once a call has bound the turn. */
export interface TurnToolSnapshot {
  catalog: ToolCatalog | null;
  tools: EnabledAgentTool[];
  /** Set by the turn's first accepted call; the service has then fixed the
   * catalog version for the whole turn. */
  bound: boolean;
}

export interface AgentToolResult {
  text: string;
  tool: string;
  model: string;
}

/**
 * Runs one tool call on the turn's snapshot. When the service says the
 * catalog changed, only a turn it has not bound yet may move to the latest
 * catalog, and only for the same tool on the same model; the call is then
 * made once more as a new request. A bound turn keeps its snapshot and the
 * refusal is reported as it came. A model missing from the latest catalog is
 * never taken to mean the turn's own model was withdrawn.
 */
export async function runToolInTurn(
  turn: TurnToolSnapshot | null,
  id: string,
  call: (entry: EnabledAgentTool) => Promise<string>,
  latest: () => Promise<ToolCatalog>,
  catalogChanged: (error: unknown) => boolean,
  signal?: AbortSignal,
): Promise<AgentToolResult> {
  signal?.throwIfAborted();
  if (!turn) throw Object.assign(new Error('Tools run only inside an Agent turn.'), { status: 409 });
  let entry = turn.tools.find((candidate) => candidate.tool.id === id);
  if (!entry) throw Object.assign(new Error('That crew member is not in this chat.'), { status: 409 });
  let text: string;
  try {
    text = await call(entry);
  } catch (error) {
    if (!catalogChanged(error) || turn.bound) throw error;
    const catalog = await latest();
    signal?.throwIfAborted();
    const moved = enabledAgentToolIn(catalog, entry.tool.id, entry.model.id);
    if (!moved) {
      throw Object.assign(new Error(`${entry.tool.name} changed and can no longer run on ${entry.model.name}. Choose a model and send again.`), { status: 409 });
    }
    turn.catalog = catalog;
    turn.tools = turn.tools.flatMap((on) => enabledAgentToolIn(catalog, on.tool.id, on.model.id) ?? []);
    entry = moved;
    text = await call(entry);
  }
  signal?.throwIfAborted();
  turn.bound = true;
  return { text, tool: entry.tool.name, model: entry.model.name };
}

/** How every tool's model reads its brief; see `agentToolBriefSchema` and
 * the route that composes it. */
const BRIEF_FORMAT = 'Your brief contains <task>, optional <context>, and optional <file> sources. '
  + 'Follow the task and the user\'s stated decisions, constraints, and writing style. '
  + 'You see only this brief and cannot use tools or ask follow-up questions. '
  + 'If essential information is missing, state what is missing; never invent facts, sources, or experiences.';

/** The tool model's system prompt: its published description as its role,
 * then the brief format. The service adds nothing to it. */
export function agentToolPrompt(tool: CatalogTool): string {
  return `You are the ${tool.name}. ${tool.agent.description}\n\n${BRIEF_FORMAT}`;
}

/** Shared coordination; catalog descriptions define each member's work. */
const BRIEFING = [
  'The user selected these crew members to take responsibility for their specialties in this chat. Hand matching work to them; keep discussion, planning, explanations, and mechanical edits yourself. The user\'s current request takes precedence over this standing division of work.',
  'Use ordinary tools as needed. A crew assignment is a deliberate handoff: each member receives only its brief, performs one model generation, and returns text.',
  'State the job in `task`. Include necessary user decisions, audience, writing rules, exact wording to preserve, drafts, specific feedback, and verified evidence with sources in `context`. Use `files` for relevant project files; unsaved drafts may stay in the brief. Omit unrelated history and reasoning.',
  'Ask only for essential missing information that prevents useful work. Otherwise make reasonable assumptions.',
  'Keep the work within the requested scope. A review-only request ends with feedback. For a finished draft, use the selected specialties that apply, then deliver it; do not start repeated review and rewrite rounds. Repeat a member only to correct a concrete failure or satisfy further user feedback.',
  'Preserve the member\'s work when presenting or saving it. If a selected member fails, say which member failed and why. Offer an alternative, but do not replace its work yourself unless the user asks to proceed without it.',
].join('\n');

/** The main agent's standing instructions for the tools that are on, or
 * nothing when none is. */
export function defaultAgentToolInstructions(tools: readonly EnabledAgentTool[]): string {
  if (tools.length === 0) return '';
  const listed = tools.map(({ tool }) => `- ${tool.name}: \`${tool.agent.toolName}\``);
  return ['<stashbase_crew>', BRIEFING, '', 'Selected crew (their function descriptions define their specialties):', ...listed, '</stashbase_crew>'].join('\n');
}

/** What the session's MCP host registers for each enabled tool. */
export interface McpAgentTool {
  id: string;
  name: string;
  toolName: string;
  description: string;
}

export function mcpAgentTools(tools: readonly EnabledAgentTool[]): McpAgentTool[] {
  return tools.map(({ tool }) => ({ id: tool.id, name: tool.name, toolName: tool.agent.toolName, description: tool.agent.description }));
}
