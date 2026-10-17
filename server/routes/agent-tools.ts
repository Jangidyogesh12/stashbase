/** The Default Agent's optional tools: the catalog's tools with the user's
 * choices (read and changed from the composer), and the call an enabled
 * tool makes. */
import type express from 'express';
import {
  AGENT_TOOL_ID,
  AGENT_TOOL_MAX_FILES,
  agentToolBriefSchema,
  type AgentToolBrief,
  defaultAgentToolRequestSchema,
  defaultAgentToolsSchema,
} from '../../shared/protocols/http/agent-tools.ts';
import { AGENT_SESSION_ID_HEADER } from '../agent-session-registry.ts';
import { getHostedAccountSession } from '../app-config.ts';
import { latestToolCatalog } from '../agent-tool-catalog.ts';
import { crewChatChoices, defaultAgentToolViews, setDefaultAgentTool } from '../default-agent-tools.ts';
import { sendError } from '../http.ts';
import { errorMessage } from '../log.ts';
import { openCodeToolSession } from '../opencode-agent.ts';
import { readProjectFile } from '../project-file-reader.ts';

/** The same ceiling a message's attachments have. */
const MAX_SOURCE_CHARACTERS = 200_000;

function chatOf(req: express.Request): string {
  const chat = req.query.chat;
  if (typeof chat !== 'string' || !/^[a-zA-Z0-9_-]{1,512}$/.test(chat)) {
    throw Object.assign(new Error('Choose a chat for this crew.'), { status: 400 });
  }
  return chat;
}

/** A failed catalog read keeps its status, so a signed-out or outdated client
 * reads as that rather than as a generic outage. */
function catalogFailure(res: express.Response, error: unknown) {
  const status = (error as { status?: unknown }).status;
  res.status(status === 400 || status === 401 || status === 426 ? status : 502).json({ error: errorMessage(error) });
}

/** The brief as the tool's model reads it: the task, its context, then each
 * named file's text, read by the host within the chat's project. */
async function composeTask(brief: AgentToolBrief): Promise<string> {
  const parts = [`<task>\n${brief.task}\n</task>`];
  if (brief.context) parts.push(`<context>\n${brief.context}\n</context>`);
  let characters = 0;
  for (const file of brief.files) {
    const read = await readProjectFile(file);
    characters += read.content.length;
    if (characters > MAX_SOURCE_CHARACTERS) {
      throw Object.assign(new Error('The files are too long for one tool call. Pass fewer or shorter files.'), { status: 413 });
    }
    parts.push(`<file path="${read.path}">\n${read.content}\n</file>`);
  }
  return parts.join('\n\n');
}

export function mount(app: express.Express): void {
  app.get('/api/agent-tools', async (req, res) => {
    if (!getHostedAccountSession()) return res.status(401).json({ error: 'Sign in first.' });
    try {
      const choices = crewChatChoices(chatOf(req));
      res.json(defaultAgentToolsSchema.parse({ tools: defaultAgentToolViews(await latestToolCatalog(), choices) }));
    } catch (error: unknown) {
      catalogFailure(res, error);
    }
  });

  app.put('/api/agent-tools', async (req, res) => {
    if (!getHostedAccountSession()) return res.status(401).json({ error: 'Sign in first.' });
    const request = defaultAgentToolRequestSchema.safeParse(req.body ?? {});
    if (!request.success) return res.status(400).json({ error: 'Choose a crew member, and mount it, take it off, or pick its model.' });
    const { tool, ...change } = request.data;
    let catalog;
    try {
      catalog = await latestToolCatalog();
    } catch (error: unknown) {
      return catalogFailure(res, error);
    }
    try {
      setDefaultAgentTool(catalog, tool, change, chatOf(req));
    } catch (error: unknown) {
      return sendError(res, error);
    }
    res.json(defaultAgentToolsSchema.parse({ tools: defaultAgentToolViews(catalog, crewChatChoices(chatOf(req))) }));
  });

  // Under `/api/project`, so the calling chat's project scope already bounds
  // every file read. Mounted after the project routes that install it.
  app.post('/api/project/agent-tools/:tool', async (req, res) => {
    const id = req.params.tool;
    const session = openCodeToolSession(req.header(AGENT_SESSION_ID_HEADER));
    const brief = agentToolBriefSchema.safeParse(req.body ?? {});
    if (!AGENT_TOOL_ID.test(id) || !session) {
      return res.status(404).json({ error: 'This crew member works only for the Default Agent chat it is mounted in.' });
    }
    if (!brief.success) {
      return res.status(400).json({ error: `Give the crew member its task, and at most ${AGENT_TOOL_MAX_FILES} file paths.` });
    }
    const abort = new AbortController();
    res.once('close', () => { if (!res.writableEnded) abort.abort(); });
    try {
      res.json(await session.runTool(id, () => composeTask(brief.data), abort.signal));
    } catch (error: unknown) {
      sendError(res, error);
    }
  });
}
