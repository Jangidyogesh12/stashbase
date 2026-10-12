import { attachmentPdf } from './attachment-fixtures.ts';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { pathToFileURL } from 'node:url';
import type { WebSocket } from 'ws';
import { createOpencodeClient, type Event as LegacyEvent } from '@opencode-ai/sdk';
import type { EventPermissionAsked } from '@opencode-ai/sdk/v2/types';
import { blocksForMessage, OpenCodeEventTranslator, OpenCodePanelSession, storedOpenCodeModel } from '../opencode-agent.ts';
import { ensureMcpLauncher } from '../agent-mcp.ts';
import { filesystemPath } from '../filesystem-path.ts';
import { HostedAgentBroker } from '../hosted-agent-broker.ts';
import {
  BUNDLED_OPENCODE_VERSION,
  buildOpenCodeConfig,
  bundledOpenCodeExecutable,
  safeOpenCodeInheritedEnvironment,
} from '../opencode-runtime.ts';

type Event = LegacyEvent | EventPermissionAsked;

/** Two hosted profiles, one under the id the rest of this smoke sends. */
const SMOKE_PROFILES = [
  { id: 'stashbase-agent-default', version: 4, displayName: 'Writer Fast', contextTokenLimit: 1_000_000, outputTokenLimit: 65_536, isDefault: true },
  { id: 'writer-pro', version: 9, displayName: 'Writer Pro', contextTokenLimit: 200_000, outputTokenLimit: 16_000, isDefault: false },
];

class PanelSocket extends EventEmitter {
  OPEN = 1;
  readyState = 1;
  events: Array<{ t: string; id?: string }> = [];
  send(value: string): void {
    const event = JSON.parse(value);
    this.events.push(event);
    this.emit('server-event', event);
  }
  close(): void { this.readyState = 3; this.emit('close'); }
  waitFor(type: string, allowError = false): Promise<void> {
    return new Promise((resolve, reject) => {
      const listener = (event: { t: string; message?: string }) => {
        if ((event.t === 'error' && !allowError) || event.t === 'exit') {
          this.off('server-event', listener);
          reject(new Error(event.message ?? 'Panel exited'));
          return;
        }
        if (event.t !== type) return;
        this.off('server-event', listener);
        resolve();
      };
      this.on('server-event', listener);
    });
  }
  request(event: unknown): void { this.emit('message', Buffer.from(JSON.stringify(event))); }
}

async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('listener has no TCP port');
  return address.port;
}

async function unusedPort(): Promise<number> {
  const server = http.createServer();
  const port = await listen(server);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

test('packaged OpenCode resolves from the explicit resources path before dependency fallbacks', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stashbase-opencode-resource-'));
  const executable = path.join(temporaryRoot, 'opencode', 'opencode.exe');
  const previousResourcesRoot = process.env.STASHBASE_RESOURCES_PATH;
  fs.mkdirSync(path.dirname(executable), { recursive: true });
  fs.writeFileSync(executable, 'packaged runtime');
  process.env.STASHBASE_RESOURCES_PATH = temporaryRoot;

  try {
    assert.equal(bundledOpenCodeExecutable(), executable);
  } finally {
    if (previousResourcesRoot === undefined) delete process.env.STASHBASE_RESOURCES_PATH;
    else process.env.STASHBASE_RESOURCES_PATH = previousResourcesRoot;
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('pinned bundled OpenCode completes one SDK session against a fake compatible model gateway', {
  timeout: 30_000,
}, async (t) => {
  let stage = 'startup';
  let completed = false;
  const subscriptions = new AbortController();
  let panel: OpenCodePanelSession | undefined;
  let ownedBroker: HostedAgentBroker | undefined;
  let ownedChild: ReturnType<typeof spawn> | undefined;
  t.signal.addEventListener('abort', () => {
    if (!completed) console.error(`Native OpenCode smoke stopped during: ${stage}`);
  });
  const executable = bundledOpenCodeExecutable();
  assert.ok(executable, 'bundled OpenCode postinstall target is missing');
  assert.equal(execFileSync(executable, ['--version'], { encoding: 'utf8' }).trim(), BUNDLED_OPENCODE_VERSION);

  // Windows TEMP can use an 8.3 alias; the SDK and panel must bind the same
  // canonical directory rather than canonicalizing only the panel's scope.
  const temporaryRoot = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'stashbase-opencode-native-')));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'stashbase-outside-probe-'));
  const externalFile = path.join(outside, 'reference.txt');
  fs.writeFileSync(externalFile, 'EXPLICIT_EXTERNAL_READ_OK');
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  const gatewayRequests: Array<Record<string, unknown>> = [];
  const gatewayModels: Array<{ profile: string | undefined; version: string | undefined }> = [];
  let nextTool: { name: string; arguments: string } | undefined;
  let emptyResponses = 0;
  let emptyAfterTool = false;
  const gateway = http.createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    gatewayRequests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>);
    gatewayModels.push({
      profile: request.headers['x-stashbase-agent-profile'] as string | undefined,
      version: request.headers['x-stashbase-agent-profile-version'] as string | undefined,
    });
    const tool = nextTool ?? (gatewayRequests.length === 1
      ? { name: 'read', arguments: JSON.stringify({ filePath: externalFile }) }
      : gatewayRequests.length === 3
        ? { name: 'bash', arguments: JSON.stringify({ command: 'node -p process.versions.node', description: 'Check installed Node' }) }
        : undefined);
    nextTool = undefined;
    const empty = !tool && emptyResponses > 0;
    if (empty) emptyResponses--;
    if (tool && emptyAfterTool) {
      emptyAfterTool = false;
      emptyResponses = 1;
    }
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const base = { id: 'chatcmpl-stashbase-smoke', object: 'chat.completion.chunk', created: 1, model: 'stashbase-agent-default' };
    response.write(`data: ${JSON.stringify({
      ...base,
      choices: [{
        index: 0,
        delta: tool ? {
          role: 'assistant',
          tool_calls: [{
            index: 0, id: `smoke-tool-${gatewayRequests.length}`, type: 'function', function: tool,
          }],
        } : { role: 'assistant', content: empty ? '' : 'probe ok' },
        finish_reason: null,
      }],
    })}\n\n`);
    response.write(`data: ${JSON.stringify({
      ...base,
      choices: empty ? [] : [{ index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: empty ? 0 : 2, total_tokens: empty ? 1 : 3 },
    })}\n\n`);
    response.end('data: [DONE]\n\n');
  });
  t.after(async () => {
    subscriptions.abort();
    panel?.dispose();
    try {
      await ownedBroker?.close();
    } finally {
      try {
        const child = ownedChild;
        if (child?.pid && child.exitCode == null && child.signalCode == null) {
          const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
          child.kill('SIGTERM');
          const force = setTimeout(() => child.kill('SIGKILL'), 1_500);
          try { await exited; } finally { clearTimeout(force); }
        }
      } finally {
        gateway.closeAllConnections();
        await new Promise<void>((resolve) => gateway.close(() => resolve()));
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
      }
    }
  });
  const gatewayPort = await listen(gateway);
  const broker = new HostedAgentBroker({
    accessToken: async () => 'fixture-account-token', fetch: globalThis.fetch,
    upstreamUrl: `http://127.0.0.1:${gatewayPort}/v1/chat/completions`, clientVersion: () => 'native-smoke',
  });
  ownedBroker = broker;
  await broker.start();
  const model = broker.runtime('native-smoke')!;
  broker.beginTurn('native-smoke', '00000000-0000-4000-8000-000000000001');
  const serverPort = await unusedPort();
  const username = 'stashbase';
  const password = 'native-smoke-secret';
  const config = buildOpenCodeConfig(model, '/unused/stashbase-mcp', {}, undefined, SMOKE_PROFILES);
  config.mcp = {
    stashbase: {
      type: 'local',
      // Exercise the exact platform launcher used in production. In
      // particular, Windows must go through the generated `.cmd` wrapper
      // rather than a test-only Node/tsx command that bypasses its quoting.
      command: [ensureMcpLauncher(temporaryRoot)],
      environment: { STASHBASE_WINDOW_ID: 'native-smoke' },
      enabled: true,
      timeout: 10_000,
    },
  };

  const child = spawn(executable, [
    'serve', '--hostname=127.0.0.1', `--port=${serverPort}`, '--pure', '--log-level=WARN',
  ], {
    env: {
      ...safeOpenCodeInheritedEnvironment({
        ...process.env,
        ...(process.platform === 'darwin' ? { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', SHELL: '/bin/zsh' } : {}),
      }),
      HOME: temporaryRoot,
      USERPROFILE: temporaryRoot,
      OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
      OPENCODE_SERVER_USERNAME: username,
      OPENCODE_SERVER_PASSWORD: password,
      XDG_DATA_HOME: path.join(temporaryRoot, 'data'),
      XDG_CONFIG_HOME: path.join(temporaryRoot, 'config'),
      XDG_CACHE_HOME: path.join(temporaryRoot, 'cache'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  ownedChild = child;

  let startupOutput = '';
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(startupOutput || 'OpenCode startup timed out')), 15_000);
    const inspect = (chunk: Buffer) => {
      startupOutput += chunk.toString('utf8');
      if (!startupOutput.includes('opencode server listening')) return;
      clearTimeout(timeout);
      resolve();
    };
    child.stdout.on('data', inspect);
    child.stderr.on('data', inspect);
    child.once('exit', (code) => reject(new Error(`OpenCode exited during startup (${code}): ${startupOutput}`)));
  });

  const client = createOpencodeClient({
    baseUrl: `http://127.0.0.1:${serverPort}`,
    directory: temporaryRoot,
    headers: { authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` },
    throwOnError: true,
  });
  let mcpStatus: { status: string; error?: string } | undefined;
  const mcpDeadline = Date.now() + 10_000;
  while (Date.now() < mcpDeadline) {
    mcpStatus = (await client.mcp.status({ throwOnError: true })).data.stashbase as typeof mcpStatus;
    if (mcpStatus?.status === 'connected' || mcpStatus?.status === 'failed') break;
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(
    mcpStatus?.status,
    'connected',
    `${mcpStatus?.error ?? 'StashBase MCP did not connect'}\n${startupOutput}`.trim(),
  );
  type PermissionRule = { permission: string; pattern: string; action: string };
  const agents = (await client.app.agents({ throwOnError: true })).data as unknown as Array<{
    name: string;
    permission: PermissionRule[];
  }>;
  const actionFor = (agent: string, permission: string) => agents
    .find((candidate) => candidate.name === agent)
    ?.permission.filter((rule) => (rule.permission === permission || rule.permission === '*') && rule.pattern === '*').at(-1)?.action;
  assert.equal(actionFor('stashbase-folder', 'bash'), 'ask');
  assert.equal(actionFor('stashbase-folder', 'edit'), 'deny');
  assert.equal(actionFor('stashbase-folder', 'stashbase_edit_file'), 'ask');
  assert.equal(actionFor('stashbase-folder', 'stashbase_write_file'), 'ask');
  assert.equal(actionFor('stashbase-folder', 'external_directory'), 'ask');
  for (const permission of ['bash', 'edit', 'task', 'stashbase_edit_file', 'stashbase_write_file', 'stashbase_delete_file', 'stashbase_create_project']) {
    assert.equal(actionFor('stashbase-plan', permission), 'deny', `Plan allowed ${permission}`);
  }
  assert.equal(actionFor('stashbase-plan', 'stashbase_read_file'), 'allow');
  stage = 'external read';
  const subscription = await client.event.subscribe({ signal: subscriptions.signal, sseMaxRetryAttempts: 1 });
  const events: Event[] = [];
  const translator = new OpenCodeEventTranslator();
  const session = (await client.session.create({ throwOnError: true, body: { title: 'Native Smoke' } })).data;
  assert.ok(filesystemPath.equal(session.directory, temporaryRoot),
    `SDK session scope ${JSON.stringify(session.directory)} differs from fixture ${JSON.stringify(temporaryRoot)}`);
  translator.bindSession(session.id);
  const consumed = (async () => {
    for await (const event of subscription.stream) {
      events.push(event);
      for (const translated of translator.translate(event)) {
        if (translated.t !== 'permission') continue;
        assert.equal(translated.name, 'Read');
        await client.postSessionIdPermissionsPermissionId({
          throwOnError: true,
          path: { id: session.id, permissionID: translated.id },
          body: { response: 'once' },
        });
      }
      if (event.type === 'session.idle') return;
    }
  })();
  await client.session.promptAsync({
    throwOnError: true,
    path: { id: session.id },
    body: {
      model: { providerID: 'stashbase', modelID: 'stashbase-agent-default' },
      agent: 'stashbase-folder',
      parts: [{ type: 'text', text: `Read ${externalFile} and reply with probe ok.` }],
    },
  });
  await consumed;
  assert.ok(events.some(event => event.type === 'permission.asked'), 'external read must request permission');
  assert.ok(JSON.stringify(gatewayRequests.slice(1)).includes('EXPLICIT_EXTERNAL_READ_OK'), 'authorized external read must reach model');
  assert.ok(events.some((event) => (
    event.type === 'message.part.updated'
      && event.properties.part.type === 'text'
      && event.properties.part.text === 'probe ok'
  )), 'the fake gateway response did not reach the OpenCode event stream');
  assert.ok(events.some((event) => event.type === 'session.diff'));
  assert.ok(events.some((event) => event.type === 'session.idle'));

  stage = 'shell command';
  const commandSubscription = await client.event.subscribe({ signal: subscriptions.signal, sseMaxRetryAttempts: 1 });
  const commandEvents: Event[] = [];
  const commandConsumed = (async () => {
    for await (const event of commandSubscription.stream) {
      commandEvents.push(event);
      for (const translated of translator.translate(event)) {
        if (translated.t !== 'permission') continue;
        assert.equal(translated.name, 'Bash');
        await client.postSessionIdPermissionsPermissionId({
          throwOnError: true,
          path: { id: session.id, permissionID: translated.id },
          body: { response: 'once' },
        });
      }
      if (event.type === 'session.idle') return;
    }
  })();
  await client.session.promptAsync({
    throwOnError: true, path: { id: session.id },
    body: { agent: 'stashbase-folder', parts: [{ type: 'text', text: 'Check the installed Node version.' }] },
  });
  await commandConsumed;
  assert.ok(commandEvents.some(event => event.type === 'permission.asked'), 'Ask must still request command approval');
  const commandResult = commandEvents.find(event => event.type === 'message.part.updated'
    && event.properties.part.type === 'tool' && event.properties.part.tool === 'bash'
    && event.properties.part.state.status === 'completed');
  assert.ok(commandResult && commandResult.type === 'message.part.updated' && commandResult.properties.part.type === 'tool');
  const commandState = commandResult.properties.part.state;
  assert.equal(commandState.status, 'completed');
  if (commandState.status === 'completed') {
    assert.match(commandState.output, /\d+\.\d+\.\d+/);
    assert.ok(!commandState.output.includes('command not found'), commandState.output);
    assert.equal(commandState.metadata?.exit, 0);
  }

  // Use the real MCP permission protocol with an isolated file writer, so the
  // panel's Edit decision is exercised without relying on a running app host.
  const require = createRequire(import.meta.url);
  const moduleUrl = (name: string) => pathToFileURL(require.resolve(name)).href;
  const fixture = path.join(temporaryRoot, 'fixture-mcp.mjs');
  fs.writeFileSync(fixture, `
    import fs from 'node:fs';
    import { Server } from ${JSON.stringify(moduleUrl('@modelcontextprotocol/sdk/server/index.js'))};
    import { StdioServerTransport } from ${JSON.stringify(moduleUrl('@modelcontextprotocol/sdk/server/stdio.js'))};
    import { ListToolsRequestSchema, CallToolRequestSchema } from ${JSON.stringify(moduleUrl('@modelcontextprotocol/sdk/types.js'))};
    const server = new Server({ name: 'fixture', version: '1' }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{
      name: 'write_file', description: 'Write a fixture file',
      inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
    }] }));
    server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
      fs.writeFileSync(params.arguments.path, params.arguments.content);
      return { content: [{ type: 'text', text: 'fixture written' }] };
    });
    await server.connect(new StdioServerTransport());
  `);
  await client.mcp.add({ throwOnError: true, body: {
    name: 'stashbase', config: { type: 'local', command: [process.execPath, fixture], enabled: true },
  } });
  const socket = new PanelSocket();
  stage = 'panel permission modes';
  panel = new OpenCodePanelSession(socket as unknown as WebSocket, {
    windowId: 'native-modes', folder: temporaryRoot, access: 'acceptEdits',
  }, {
    models: async () => SMOKE_PROFILES,
    client: async () => client,
    beginTurn: (turnId, selected) => broker.beginTurn('native-smoke', turnId, selected),
    endTurn: () => broker.endTurn('native-smoke'),
    onExit: () => () => {}, close: async () => {},
  });
  await socket.waitFor('ready');
  const modeFile = path.join(temporaryRoot, 'mode-result.md');
  const runPanelTurn = async (allowError = false) => {
    const ended = socket.waitFor('turn-end', allowError);
    socket.request({ t: 'prompt', text: 'Run the fixture probe.' });
    await ended;
  };
  nextTool = { name: 'stashbase_write_file', arguments: JSON.stringify({ path: modeFile, content: 'Edit allowed' }) };
  await runPanelTurn();
  assert.equal(fs.readFileSync(modeFile, 'utf8'), 'Edit allowed');
  assert.equal(socket.events.filter(event => event.t === 'permission').length, 0, 'Edit should approve its scoped write automatically');
  socket.request({ t: 'set-mode', mode: 'plan' });
  nextTool = { name: 'stashbase_write_file', arguments: JSON.stringify({ path: modeFile, content: 'Plan must not overwrite' }) };
  await runPanelTurn();
  assert.equal(fs.readFileSync(modeFile, 'utf8'), 'Edit allowed', 'Plan must reject a provider that attempts a write');

  // A model chosen between turns reaches the provider body and the hosted
  // headers together, and the stored prompt names it for a later resume.
  stage = 'panel model choice';
  const firstPanelCall = gatewayModels.findIndex((entry) => entry.version !== undefined);
  assert.deepEqual(gatewayModels[firstPanelCall], { profile: 'stashbase-agent-default', version: '4' });
  socket.request({ t: 'set-model', model: 'writer-pro' });
  const beforeChoice = gatewayRequests.length;
  await runPanelTurn();
  assert.ok(gatewayRequests.length > beforeChoice);
  for (let index = beforeChoice; index < gatewayRequests.length; index++) {
    assert.equal(gatewayRequests[index]!.model, 'writer-pro');
    assert.deepEqual(gatewayModels[index], { profile: 'writer-pro', version: '9' });
  }
  const panelSession = socket.events.find((event) => event.t === 'session-id')!.id!;
  const panelHistory = (await client.session.messages({ throwOnError: true, path: { id: panelSession } })).data;
  assert.equal(storedOpenCodeModel(panelHistory), 'writer-pro');
  nextTool = { name: 'bash', arguments: JSON.stringify({ command: `echo changed > '${modeFile}'`, description: 'Attempt a command in Plan' }) };
  await runPanelTurn();
  assert.equal(fs.readFileSync(modeFile, 'utf8'), 'Edit allowed', 'Plan must reject shell writes');
  socket.request({ t: 'set-mode', mode: 'default' });
  socket.on('server-event', (event: { t: string; id?: string }) => {
    if (event.t === 'permission') socket.request({ t: 'permission-reply', id: event.id, allow: true });
  });
  nextTool = { name: 'stashbase_write_file', arguments: JSON.stringify({ path: modeFile, content: 'Ask approved' }) };
  await runPanelTurn();
  assert.equal(fs.readFileSync(modeFile, 'utf8'), 'Ask approved', 'switching out of Plan must restore approved writes');
  assert.equal(socket.events.filter(event => event.t === 'permission').length, 1);

  socket.request({ t: 'set-mode', mode: 'acceptEdits' });
  stage = 'empty response recovery';
  const recoveryStart = socket.events.length;
  const callsBeforeRecovery = gatewayRequests.length;
  nextTool = { name: 'stashbase_write_file', arguments: JSON.stringify({ path: modeFile, content: 'Saved before empty response' }) };
  emptyAfterTool = true;
  await runPanelTurn();
  assert.equal(gatewayRequests.length - callsBeforeRecovery, 3, 'write, empty continuation, recovered continuation');
  const recoveryEvents = socket.events.slice(recoveryStart) as Array<{ t: string; delta?: string; isError?: boolean }>;
  assert.equal(recoveryEvents.filter(event => event.t === 'tool-result').length, 1, 'recovery must not execute the write again');
  assert.ok(recoveryEvents.some(event => event.t === 'text' && event.delta?.includes('probe ok')));
  assert.deepEqual(recoveryEvents.filter(event => event.t === 'turn-end'), [{ t: 'turn-end', isError: false }]);
  assert.equal(fs.readFileSync(modeFile, 'utf8'), 'Saved before empty response');

  stage = 'two empty responses';
  const failureStart = socket.events.length;
  const callsBeforeFailure = gatewayRequests.length;
  emptyResponses = 2;
  await runPanelTurn(true);
  assert.equal(gatewayRequests.length - callsBeforeFailure, 2, 'native runtime must not retry beyond the broker limit');
  const failureEvents = socket.events.slice(failureStart) as Array<{ t: string; message?: string; isError?: boolean }>;
  assert.ok(failureEvents.some(event => event.t === 'error' && event.message?.includes('empty response twice')));
  assert.deepEqual(failureEvents.filter(event => event.t === 'turn-end'), [{ t: 'turn-end', isError: true }]);
  stage = 'follow-up after failure';
  await runPanelTurn(); // The same native session remains usable after the failure.
  panel.dispose();

  const toolNames = (request: Record<string, unknown>) => (
    Array.isArray(request.tools)
      ? request.tools.flatMap((tool) => {
          const fn = tool && typeof tool === 'object' ? (tool as { function?: { name?: unknown } }).function : undefined;
          return typeof fn?.name === 'string' ? [fn.name] : [];
        })
      : []
  );
  const folderTools = toolNames(gatewayRequests[0]);
  for (const name of ['bash', 'read', 'task']) {
    assert.ok(folderTools.includes(name), `folder profile omitted ${name}`);
  }
  for (const name of ['stashbase_read_file', 'stashbase_write_file']) {
    assert.ok(folderTools.includes(name), `folder profile omitted ${name}`);
  }

  // Exercise the pinned binary and its provider serializer, not an SDK mock.
  stage = 'native attachments';
  broker.beginTurn('native-smoke', '00000000-0000-4000-8000-000000000002');
  const attachmentsSession = (await client.session.create({ body: { title: 'Attachment probe' }, throwOnError: true })).data;
  const imageBytes = fs.readFileSync('build/icons/16x16.png');
  const pdfBytes = attachmentPdf();
  const attachmentPath = path.join(os.tmpdir(), 'stashbase-attachments', 'native-fixture', 'diagram.png');
  const firstAttachmentCall = gatewayRequests.length;
  await client.session.prompt({
    throwOnError: true, path: { id: attachmentsSession.id },
    body: { model: { providerID: 'stashbase', modelID: 'stashbase-agent-default' }, agent: 'stashbase-folder', parts: [
      { type: 'text', text: 'Describe the attachments.' },
      { type: 'file', mime: 'text/plain', filename: 'notes.txt', url: `data:text/plain;base64,${Buffer.from('ATTACHMENT_TEXT_OK').toString('base64')}` },
      { type: 'file', mime: 'image/png', filename: 'diagram.png', url: `data:image/png;base64,${imageBytes.toString('base64')}`,
        source: { type: 'file', path: attachmentPath, text: { value: 'diagram.png', start: 0, end: 11 } } },
      { type: 'file', mime: 'application/pdf', filename: 'report.pdf', url: `data:application/pdf;base64,${pdfBytes.toString('base64')}` },
    ] },
  });
  const firstBody = JSON.stringify(gatewayRequests[firstAttachmentCall]);
  assert.match(firstBody, /ATTACHMENT_TEXT_OK/);
  assert.match(firstBody, /image_url/);
  assert.ok(firstBody.includes(imageBytes.toString('base64')));
  assert.ok(firstBody.includes(pdfBytes.toString('base64')));
  const history = (await client.session.messages({ throwOnError: true, path: { id: attachmentsSession.id } })).data;
  const user = history.find(message => message.info.role === 'user')!;
  const replay = blocksForMessage(user.info, user.parts);
  assert.equal(replay[0]?.kind, 'user');
  assert.equal(replay[0]?.kind === 'user' && replay[0].text, 'Describe the attachments.');
  assert.equal(replay[0]?.kind === 'user' && replay[0].attachments?.[0]?.path, attachmentPath);
  stage = 'native attachment follow-up';
  await client.session.prompt({
    throwOnError: true, path: { id: attachmentsSession.id },
    body: { model: { providerID: 'stashbase', modelID: 'stashbase-agent-default' }, agent: 'stashbase-folder', parts: [{ type: 'text', text: 'Discuss the same attachments again.' }] },
  });
  const followUp = JSON.stringify(gatewayRequests.at(-1));
  assert.match(followUp, /ATTACHMENT_TEXT_OK/);
  assert.ok(followUp.includes(imageBytes.toString('base64')), 'the next model request retains image content');
  assert.ok(followUp.includes(pdfBytes.toString('base64')), 'the next model request retains PDF content');

  // Hosted Claude models refuse a forced tool choice, so every model call the
  // pinned runtime makes, tool continuations included, must leave it open.
  const forced = gatewayRequests.map((body) => body.tool_choice)
    .filter((choice) => choice !== undefined && choice !== 'auto' && choice !== 'none');
  assert.deepEqual(forced, [], `OpenCode forced a tool choice: ${JSON.stringify(forced)}`);
  assert.ok(gatewayRequests.some((body) => Array.isArray(body.tools) && body.tools.length > 0));

  // A hardened-runtime signing mismatch can let Bun finish the request and
  // then have AMFI kill it while it returns to executable memory. Do not let
  // teardown hide that packaged-only failure as a successful smoke.
  await new Promise<void>((resolve) => setTimeout(resolve, 250));
  assert.equal(child.exitCode, null, `OpenCode exited unexpectedly (${child.exitCode ?? child.signalCode})`);
  assert.equal(child.signalCode, null, `OpenCode exited unexpectedly (${child.signalCode})`);
  completed = true;
});
