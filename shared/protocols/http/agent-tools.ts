import { z } from 'zod';

/** A tool id as the service's catalog names it. Tools come from the catalog,
 *  so the set is not fixed here. */
export const AGENT_TOOL_ID = /^[a-z][a-z0-9-]{0,39}$/;
export type DefaultAgentToolId = string;

/** Attribution captured by the host for one invocation, independent of menus. */
export const agentCrewCallSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().min(1).max(100),
  icon: z.string().max(60),
  model: z.string().min(1).max(200),
}).strip();
export type AgentCrewCall = z.infer<typeof agentCrewCallSchema>;

const toolOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  /** Whether it may be chosen now; an unavailable model is shown, not hidden. */
  available: z.boolean(),
  /** Why it cannot be chosen, when it cannot. */
  reason: z.string().nullable(),
}).strip();

const toolSchema = z.object({
  id: z.string().regex(AGENT_TOOL_ID),
  label: z.string().min(1),
  /** The function name the main agent calls it by, so a transcript can tell
   *  its calls from other tools'. */
  toolName: z.string().min(1),
  /** The short line the tools list shows. */
  summary: z.string(),
  /** A generic icon name; one the client does not know falls back. */
  icon: z.string(),
  /** Whether the user turned it on. Every tool starts off. */
  enabled: z.boolean(),
  /** Why the tool cannot be used at all right now, or null. */
  unavailable: z.string().nullable(),
  /** The model it runs on, or would once on: the user's choice, else its
   *  default; null when neither can be used. */
  model: z.string().min(1).nullable(),
  /** Why no model can be used until the user chooses one, or null. */
  modelProblem: z.string().nullable(),
  defaultModel: z.string().min(1).nullable(),
  /** The models it may run on, from the tool model pool. */
  options: z.array(toolOptionSchema),
}).strip();

/** `GET /api/agent-tools` and the `PUT` echo. */
export const defaultAgentToolsSchema = z.object({ tools: z.array(toolSchema) }).strip();

/** Turns a tool on or off, chooses its model, or both. The write reaches
 *  durable configuration, so an unknown key is refused. */
export const defaultAgentToolRequestSchema = z.object({
  tool: z.string().regex(AGENT_TOOL_ID),
  enabled: z.boolean().optional(),
  model: z.string().trim().min(1).max(100).optional(),
}).strict().refine((request) => request.enabled !== undefined || request.model !== undefined);

/** A stored tool choice: whether it is on, and the model the reader picked. */
export interface DefaultAgentToolChoice {
  enabled?: boolean;
  model?: string;
}

export type DefaultAgentToolView = z.infer<typeof toolSchema>;
export type DefaultAgentToolsWire = z.infer<typeof defaultAgentToolsSchema>;

/** The most project files one tool call may include in full. */
export const AGENT_TOOL_MAX_FILES = 20;

/**
 * `POST /api/project/agent-tools/:tool`: the main agent's brief for one tool
 * call. A tool sees nothing else. The parts are the same for every tool;
 * what a tool needs in its context is said in its own description.
 */
export const agentToolBriefSchema = z.object({
  task: z.string().trim().min(1).max(8_000),
  context: z.string().trim().max(30_000).optional(),
  files: z.array(z.string().min(1)).max(AGENT_TOOL_MAX_FILES).default([]),
}).strip();

export type AgentToolBrief = z.infer<typeof agentToolBriefSchema>;
