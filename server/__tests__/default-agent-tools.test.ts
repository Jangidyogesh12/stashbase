import './isolated-home.ts';
import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  crewChatChoices,
  rememberCrewChat,
  forgetCrewChat,
  defaultAgentToolInstructions,
  defaultAgentToolViews,
  enabledAgentTools,
  mcpAgentTools,
  runToolInTurn,
  setDefaultAgentTool,
  type TurnToolSnapshot,
} from '../default-agent-tools.ts';
import { parseToolCatalog, ToolCatalogSource, type ToolCatalog } from '../agent-tool-catalog.ts';
import { readAppConfigStrict, writeAppConfigStrict } from '../app-config.ts';
import { createProjectMcpServer, parseMcpAgentTools } from '../../mcp/project-server.ts';

const available = { status: 'available' } as const;
const model = (id: string, name: string, version = 1, availability: object = available) => ({
  id, version, name, relativeCost: 2, contextTokenLimit: 200_000, outputTokenLimit: 32_000,
  reasoningEffort: 'medium', capabilities: { images: true, pdf: true }, availability,
});
const tool = (id: string, name: string, toolName: string, defaultModelId: string, extra: object = {}) => ({
  id, kind: 'agent-role', version: 3, name, summary: `${name} summary`, icon: 'pen-line', availability: available,
  modelIds: ['sonnet', 'sol', 'opus'], defaultModelId, agent: { toolName, description: `${name} does its job.` }, ...extra,
});

function catalog(overrides: { models?: object[]; tools?: object[]; revision?: string } = {}): ToolCatalog {
  return parseToolCatalog({
    schemaVersion: 2,
    revision: overrides.revision ?? 'catalog-a',
    models: overrides.models ?? [model('sonnet', 'Sonnet'), model('sol', 'Sol', 4), model('opus', 'Opus', 9)],
    tools: overrides.tools ?? [
      tool('writer', 'Writer', 'write_draft', 'opus'),
      tool('reader', 'Reader', 'read_draft', 'sol'),
    ],
  });
}

const reset = () => writeAppConfigStrict({ ...readAppConfigStrict(), defaultAgentTools: {} });

test('a catalog entry this client cannot read is left out, and another schema version is refused', () => {
  const read = catalog({
    models: [model('sonnet', 'Sonnet'), { id: 'broken' }],
    tools: [
      tool('writer', 'Writer', 'write_draft', 'sonnet'),
      tool('editor', 'Editor', 'edit_draft', 'sonnet', { kind: 'workflow' }),
      tool('Bad Id', 'Bad', 'bad_draft', 'sonnet'),
      tool('copy', 'Copy', 'write_draft', 'sonnet'),
    ],
  });
  assert.deepEqual(read.models.map((entry) => entry.id), ['sonnet']);
  assert.deepEqual(read.tools.map((entry) => entry.id), ['writer'], 'unknown kinds, unsafe ids, and duplicate names are skipped');
  assert.deepEqual(read.tools[0]!.modelIds, ['sonnet'], 'a model missing from the pool cannot be chosen');
  assert.throws(() => parseToolCatalog({ schemaVersion: 3, revision: 'x', models: [], tools: [] }), /unexpected shape/);
});

test('every tool starts off on its default, and a model pick survives turning it off', () => {
  reset();
  const read = catalog();
  assert.deepEqual(enabledAgentTools(read), []);
  assert.deepEqual(defaultAgentToolViews(read).map((view) => [view.id, view.enabled, view.model, view.modelProblem]), [
    ['writer', false, 'opus', null],
    ['reader', false, 'sol', null],
  ]);
  setDefaultAgentTool(read, 'writer', { model: 'sonnet' });
  assert.deepEqual(enabledAgentTools(read), [], 'picking a model does not turn the tool on');
  setDefaultAgentTool(read, 'writer', { enabled: true });
  assert.deepEqual(enabledAgentTools(read).map((on) => [on.tool.id, on.model.id, on.model.version]), [['writer', 'sonnet', 1]]);
  setDefaultAgentTool(read, 'writer', { enabled: false });
  assert.equal(defaultAgentToolViews(read)[0]!.model, 'sonnet');
  assert.throws(() => setDefaultAgentTool(read, 'writer', { model: 'main-profile' }), /cannot run on that model/);
  reset();
});

test('an unusable model is reported and never swapped for another one', () => {
  reset();
  const offline = { status: 'unavailable', reason: 'model_disabled' };
  // The user's own pick went offline: the tool stops rather than moving.
  writeAppConfigStrict({ ...readAppConfigStrict(), defaultAgentTools: { writer: { enabled: true, model: 'sonnet' } } });
  const pickOffline = catalog({ models: [model('sonnet', 'Sonnet', 1, offline), model('sol', 'Sol'), model('opus', 'Opus')] });
  assert.deepEqual(enabledAgentTools(pickOffline), []);
  const view = defaultAgentToolViews(pickOffline)[0]!;
  assert.equal(view.model, null);
  assert.match(view.modelProblem ?? '', /Sonnet is unavailable/);
  assert.deepEqual(view.options.map((option) => [option.id, option.available]), [['sonnet', false], ['sol', true], ['opus', true]]);
  assert.throws(() => setDefaultAgentTool(pickOffline, 'writer', { model: 'sonnet' }), /cannot run on that model/);

  // Its default is switched off: the tool waits for an explicit choice.
  writeAppConfigStrict({ ...readAppConfigStrict(), defaultAgentTools: { writer: { enabled: true } } });
  const defaultOff = catalog({ tools: [tool('writer', 'Writer', 'write_draft', 'opus', {
    availability: { status: 'unavailable', reason: 'default_model_disabled' },
  })] });
  assert.deepEqual(enabledAgentTools(defaultOff), []);
  assert.match(defaultAgentToolViews(defaultOff)[0]!.modelProblem ?? '', /default model is unavailable/);
  setDefaultAgentTool(defaultOff, 'writer', { model: 'sol' });
  assert.deepEqual(enabledAgentTools(defaultOff).map((on) => on.model.id), ['sol']);

  // A tool switched off by the service cannot be used or turned on.
  const toolOff = catalog({ tools: [tool('writer', 'Writer', 'write_draft', 'opus', {
    availability: { status: 'unavailable', reason: 'tool_disabled' },
  })] });
  assert.deepEqual(enabledAgentTools(toolOff), []);
  assert.equal(defaultAgentToolViews(toolOff)[0]!.unavailable, 'Not available right now.');
  reset();
  assert.throws(() => setDefaultAgentTool(toolOff, 'writer', { enabled: true }), /not available/);
  reset();
});

test('any crew members may be on together, each on its own model', () => {
  reset();
  const read = catalog();
  setDefaultAgentTool(read, 'writer', { enabled: true, model: 'sonnet' });
  setDefaultAgentTool(read, 'reader', { enabled: true });
  assert.deepEqual(enabledAgentTools(read).map((on) => [on.tool.id, on.model.id]), [['writer', 'sonnet'], ['reader', 'sol']]);
  setDefaultAgentTool(read, 'writer', { enabled: false });
  assert.deepEqual(enabledAgentTools(read).map((on) => on.tool.id), ['reader']);
  reset();
});

test('the main agent is told only the enabled tools, by their published descriptions', () => {
  reset();
  const read = catalog();
  setDefaultAgentTool(read, 'reader', { enabled: true });
  const instructions = defaultAgentToolInstructions(enabledAgentTools(read));
  assert.match(instructions, /Selected crew[\s\S]*Reader: `read_draft`/);
  assert.doesNotMatch(instructions, /write_draft/);
  assert.equal(defaultAgentToolInstructions([]), '');
  reset();
});

function snapshot(read: ToolCatalog, ids: string[]): TurnToolSnapshot {
  writeAppConfigStrict({ ...readAppConfigStrict(), defaultAgentTools: Object.fromEntries(ids.map((id) => [id, { enabled: true }])) });
  const tools = enabledAgentTools(read);
  reset();
  return { catalog: read, tools, bound: false };
}

const changed = Object.assign(new Error('changed'), { code: 'agent_tool_version_changed' });
const isChanged = (error: unknown) => (error as { code?: string }).code === 'agent_tool_version_changed';

test('a turn\'s calls run on its snapshot, and only an unbound turn moves to a newer catalog', async () => {
  const a = catalog();
  const b = catalog({ revision: 'catalog-b', models: [model('sonnet', 'Sonnet', 2), model('sol', 'Sol', 5), model('opus', 'Opus', 10)] });
  const sent: string[] = [];
  const call = async (entry: { tool: { id: string }; model: { id: string; version: number } }) => {
    sent.push(`${entry.tool.id}@${entry.model.id}v${entry.model.version}`);
    if (sent.length === 1) throw changed;
    return 'done';
  };

  // Unbound: refresh once, same tool on the same model, then the turn binds.
  const turn = snapshot(a, ['writer']);
  assert.deepEqual(await runToolInTurn(turn, 'writer', call, async () => b, isChanged), { text: 'done', tool: 'Writer', model: 'Opus' });
  assert.deepEqual(sent, ['writer@opusv9', 'writer@opusv10']);
  assert.equal(turn.bound, true);
  assert.equal(turn.catalog?.revision, 'catalog-b');

  // Bound: a later call keeps the turn's catalog even if another is published.
  let refreshed = false;
  await runToolInTurn(turn, 'writer', call, async () => { refreshed = true; return a; }, isChanged);
  assert.deepEqual(sent.slice(2), ['writer@opusv10']);
  assert.equal(refreshed, false);

  // A bound turn reports a refusal as it came instead of moving.
  const bound = { ...snapshot(a, ['writer']), bound: true };
  await assert.rejects(runToolInTurn(bound, 'writer', async () => { throw changed; }, async () => b, isChanged), /changed/);

  // The same model gone from the newer catalog stops the call.
  const unbound = snapshot(a, ['writer']);
  const withoutOpus = catalog({ revision: 'catalog-c', models: [model('sonnet', 'Sonnet'), model('sol', 'Sol')] });
  await assert.rejects(runToolInTurn(unbound, 'writer', async () => { throw changed; }, async () => withoutOpus, isChanged),
    /can no longer run on Opus/);

  await assert.rejects(runToolInTurn(null, 'writer', call, async () => a, isChanged), /only inside an agent turn/);
  await assert.rejects(runToolInTurn(snapshot(a, []), 'writer', call, async () => a, isChanged), /not in this chat/);
});

function catalogPayload(revision: string) {
  return { schemaVersion: 2, revision, models: [model('sonnet', 'Sonnet')], tools: [tool('writer', 'Writer', 'write_draft', 'sonnet')] };
}

test('the catalog is refreshed with its ETag, kept per account, and served from cache only when it is valid', async () => {
  let account: string | undefined = 'user-a';
  const requests: Array<{ etag: string | null; token: string }> = [];
  let answer: () => Response = () => Response.json(catalogPayload('r1'), { headers: { etag: '"one"' } });
  const source = new ToolCatalogSource({
    accessToken: async ({ forceRefresh } = {}) => (forceRefresh ? 'fresh' : 'stale'),
    fetch: async (_url, init) => {
      const headers = new Headers(init?.headers);
      requests.push({ etag: headers.get('if-none-match'), token: headers.get('authorization') ?? '' });
      return answer();
    },
    accountId: () => account,
    clientVersion: () => 'fixture',
  });
  assert.equal((await source.latest()).revision, 'r1');
  answer = () => new Response(null, { status: 304 });
  assert.equal((await source.latest()).revision, 'r1');
  assert.equal(requests[1]!.etag, '"one"', 'the ETag goes back exactly as it came');

  answer = () => new Response('{}', { status: 503 });
  assert.equal((await source.latest()).revision, 'r1', 'a failed refresh keeps the valid copy');

  account = 'user-b';
  await assert.rejects(source.latest(), /unavailable/, 'another account never sees the first one\'s catalog');
  assert.equal(requests.at(-1)!.etag, null);

  let first = true;
  answer = () => {
    if (first) { first = false; return new Response('{}', { status: 401 }); }
    return Response.json(catalogPayload('r2'));
  };
  assert.equal((await source.latest()).revision, 'r2');
  assert.deepEqual(requests.slice(-2).map((request) => request.token), ['Bearer stale', 'Bearer fresh']);

  account = undefined;
  await assert.rejects(source.latest(), /Sign in/);
});

test('the MCP host registers the enabled tools by their catalog names, with one brief shape', async () => {
  const names = async (agentTools?: ReturnType<typeof mcpAgentTools>) => {
    const server = createProjectMcpServer({ webBase: 'http://127.0.0.1:1', ...(agentTools ? { agentTools } : {}) });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test', version: '1' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const listed = (await client.listTools()).tools;
    await client.close();
    return listed;
  };
  reset();
  const read = catalog();
  setDefaultAgentTool(read, 'writer', { enabled: true });
  const env = JSON.stringify(mcpAgentTools(enabledAgentTools(read)));
  reset();
  const withWriter = await names(parseMcpAgentTools(env));
  const writer = withWriter.find((entry) => entry.name === 'write_draft')!;
  assert.equal(writer.description, 'Writer does its job.');
  assert.deepEqual(writer.inputSchema.required, ['task']);
  assert.ok(!withWriter.some((entry) => entry.name === 'read_draft'));
  assert.ok(!(await names()).some((entry) => entry.name === 'write_draft'));

  // A published name can never shadow a project operation.
  const shadow = await names([{ id: 'x', name: 'X', toolName: 'read_file', description: 'Not this.' }]);
  assert.notEqual(shadow.find((entry) => entry.name === 'read_file')?.description, 'Not this.');
  assert.deepEqual(parseMcpAgentTools('not json'), []);
});

test('a long crew call reports progress so the runtime does not time it out', async (t) => {
  const host = http.createServer((request, response) => {
    // Answers well after several progress intervals, like a real generation.
    setTimeout(() => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ text: 'Drafted.', tool: 'Writer', model: 'Opus' }));
    }, 150);
  });
  await new Promise<void>((resolve) => host.listen(0, '127.0.0.1', resolve));
  t.after(() => host.close());
  const port = (host.address() as { port: number }).port;
  const server = createProjectMcpServer({
    webBase: `http://127.0.0.1:${port}`,
    agentTools: [{ id: 'writer', name: 'Writer', toolName: 'write_draft', description: 'Writes.' }],
    agentToolProgressMs: 20,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  t.after(() => client.close());
  let reports = 0;
  const result = await client.callTool({ name: 'write_draft', arguments: { task: 'Write it.' } }, undefined, {
    // Shorter than the call itself: only progress keeps it alive.
    timeout: 60,
    resetTimeoutOnProgress: true,
    onprogress: () => { reports++; },
  });
  assert.ok(reports >= 2, `expected progress reports, got ${reports}`);
  assert.match(JSON.stringify(result.content), /Drafted\./);
});


test('crew selections belong to one chat, seed only future chats, and survive native identification', () => {
  reset();
  const read = catalog();
  const a = 'crew-chat-a', b = 'crew-chat-b', c = 'crew-chat-c', native = 'crew-native';
  for (const id of [a, b, c, native]) forgetCrewChat(id);
  assert.deepEqual(crewChatChoices(a), {});
  assert.deepEqual(crewChatChoices(b), {});
  setDefaultAgentTool(read, 'writer', { enabled: true, model: 'opus' }, a);
  assert.equal(crewChatChoices(a).writer?.enabled, true);
  assert.deepEqual(crewChatChoices(b), {}, 'an existing chat keeps its choices');
  assert.equal(crewChatChoices(c).writer?.model, 'opus', 'new chats take the last chosen crew');
  rememberCrewChat(a, native);
  assert.equal(crewChatChoices(native).writer?.enabled, true);
  setDefaultAgentTool(read, 'reader', { enabled: true }, b);
  assert.equal(crewChatChoices(native).reader, undefined);
  for (const id of [a, b, c, native]) forgetCrewChat(id);
  reset();
});

test('a removed selected member remains visible and can be turned off', () => {
  reset();
  const chat = 'crew-withdrawn';
  forgetCrewChat(chat);
  setDefaultAgentTool(catalog(), 'writer', { enabled: true }, chat);
  const withdrawn = catalog({ tools: [] });
  const view = defaultAgentToolViews(withdrawn, crewChatChoices(chat));
  assert.equal(view[0]?.enabled, true);
  assert.match(view[0]?.unavailable ?? '', /no longer offered/);
  setDefaultAgentTool(withdrawn, 'writer', { enabled: false }, chat);
  assert.deepEqual(defaultAgentToolViews(withdrawn, crewChatChoices(chat)), []);
  forgetCrewChat(chat);
  reset();
});

test('Stop during catalog refresh prevents a stale call from retrying in another turn', async () => {
  const abort = new AbortController();
  let calls = 0;
  let resolve!: (catalog: ToolCatalog) => void;
  const fresh = new Promise<ToolCatalog>((done) => { resolve = done; });
  const pending = runToolInTurn(snapshot(catalog(), ['writer']), 'writer', async () => {
    calls++;
    throw changed;
  }, () => fresh, isChanged, abort.signal);
  await new Promise<void>((done) => setImmediate(done));
  abort.abort();
  resolve(catalog({ revision: 'later-turn' }));
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(calls, 1);
});
