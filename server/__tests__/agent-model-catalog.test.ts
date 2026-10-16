import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import './isolated-home.ts';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { readAppConfig } from '../app-config.ts';
import {
  ensureAgentModelCatalog,
  readCodexModelCatalog,
  recallAgentModels,
  rememberAgentDefaultModel,
  rememberAgentModels,
  rememberedCatalogFor,
} from '../agent-model-catalog.ts';
import { readClaudeModelCatalog } from '../claude-model-catalog.ts';

class FakeAppServer extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  readonly methods: string[] = [];

  constructor(pages: Array<Array<Record<string, unknown>>>) {
    super();
    let page = 0;
    this.stdin.on('data', (chunk: Buffer) => {
      for (const line of String(chunk).split('\n')) {
        if (!line.trim()) continue;
        const request = JSON.parse(line) as { id: number; method: string };
        this.methods.push(request.method);
        const result = request.method === 'model/list'
          ? { data: pages[page] ?? [], ...(page++ < pages.length - 1 ? { nextCursor: `page-${page}` } : {}) }
          : {};
        this.stdout.write(`${JSON.stringify({ id: request.id, result })}\n`);
      }
    });
  }

  kill(): boolean {
    this.killed = true;
    this.emit('close', null, 'SIGTERM');
    return true;
  }
}

test('reads the Codex catalog from a bare app-server, every page, then lets it go', async () => {
  const server = new FakeAppServer([
    [{ id: 'gpt-6', displayName: 'GPT-6', isDefault: true, defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'medium' }] }],
    [{ id: 'gpt-5', displayName: 'GPT-5' }, { id: 'retired', displayName: 'Retired', hidden: true }],
  ]);
  const cwds: string[] = [];
  const { models, defaultModel } = await readCodexModelCatalog((cwd) => {
    cwds.push(cwd);
    return server as unknown as ChildProcessWithoutNullStreams;
  }, 1_000);
  assert.equal(defaultModel, undefined, 'Codex flags its default inside the catalog');
  assert.deepEqual(models, [
    { id: 'gpt-6', label: 'GPT-6', supportedEfforts: ['low', 'medium'], defaultEffort: 'medium', isDefault: true },
    { id: 'gpt-5', label: 'GPT-5' },
  ]);
  assert.deepEqual(server.methods, ['initialize', 'model/list', 'model/list']);
  assert.equal(cwds.length, 1);
  assert.equal(server.killed, true, 'the read owns its process for exactly as long as the read');
});

test('a listing reads Codex once, shares the read, remembers it, and does not retry a failure at once', async () => {
  assert.equal(recallAgentModels('codex'), undefined);
  let reads = 0;
  const failing = () => { reads += 1; return Promise.reject(new Error('signed out')); };
  let clock = 1_000;
  const now = () => clock;
  assert.equal(await ensureAgentModelCatalog('codex', { read: failing, now }), undefined);
  assert.equal(await ensureAgentModelCatalog('codex', { read: failing, now }), undefined);
  assert.equal(reads, 1, 'a failed read waits out its pause before it is tried again');

  clock += 10 * 60_000;
  let resolveRead: (reading: { models: Array<{ id: string; label: string }> }) => void = () => undefined;
  const read = () => {
    reads += 1;
    return new Promise<{ models: Array<{ id: string; label: string }> }>((resolve) => { resolveRead = resolve; });
  };
  const first = ensureAgentModelCatalog('codex', { read, now });
  const second = ensureAgentModelCatalog('codex', { read, now });
  resolveRead({ models: [{ id: 'gpt-6', label: 'GPT-6' }] });
  const [a, b] = await Promise.all([first, second]);
  assert.equal(reads, 2, 'callers waiting on the same runtime share one read');
  assert.deepEqual(a?.models, [{ id: 'gpt-6', label: 'GPT-6' }]);
  assert.equal(a, b);
  assert.deepEqual(recallAgentModels('codex')?.models, [{ id: 'gpt-6', label: 'GPT-6' }]);
  assert.deepEqual(readAppConfig().agentModelCatalogs?.codex?.models, [{ id: 'gpt-6', label: 'GPT-6' }]);

  reads = 0;
  await ensureAgentModelCatalog('codex', { read, now });
  assert.equal(reads, 0, 'a remembered catalog answers without a read');
});

test('reads the Claude catalog from a bare handshake and its default from the CLI\'s own settings', async () => {
  const closes: number[] = [];
  const prompts: unknown[] = [];
  const handshake = {
    models: [
      { value: 'default', displayName: 'Default (recommended)', supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
      { value: 'sonnet', displayName: 'Sonnet', supportedEffortLevels: ['low', 'medium', 'high', 'max'] },
      { value: 'haiku', displayName: 'Haiku' },
      { value: 'fable[1m]', displayName: 'fable[1m]', supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
    ],
  };
  const createQuery = ((params: { prompt: unknown; options: { settingSources: string[]; tools: unknown[] } }) => {
    prompts.push(params.prompt);
    assert.deepEqual(params.options.settingSources, ['user']);
    assert.deepEqual(params.options.tools, []);
    return { initializationResult: async () => handshake, close: () => { closes.push(1); } };
  }) as unknown as typeof import('@anthropic-ai/claude-agent-sdk').query;
  const read = (settings: { model?: string; effortLevel?: string }) =>
    readClaudeModelCatalog({ createQuery, executable: () => '/fake/claude', readSettings: () => settings });

  const configured = await read({ model: 'fable[1m]', effortLevel: 'xhigh' });
  assert.equal(configured.defaultModel, 'fable[1m]', 'the configured model is the default when the catalog lists it');
  assert.deepEqual(configured.models.map((model) => [model.id, model.defaultEffort ?? null, model.isDefault ?? false]), [
    ['default', 'xhigh', false],
    ['sonnet', null, false],
    ['haiku', null, false],
    ['fable[1m]', 'xhigh', true],
  ]);
  assert.equal(typeof (prompts[0] as AsyncIterable<unknown>)[Symbol.asyncIterator], 'function', 'an idle prompt stream, so no turn begins');

  const unset = await read({});
  assert.equal(unset.defaultModel, 'default', 'with nothing configured the catalog\'s own Default entry stands in');
  assert.equal(unset.models.find((model) => model.id === 'default')?.isDefault, true);
  assert.equal(unset.models.every((model) => model.defaultEffort === undefined), true);

  const unlisted = await read({ model: 'claude-3-retired', effortLevel: 'ultra' });
  assert.equal(unlisted.defaultModel, 'default', 'a configured model the catalog does not list is not invented');
  assert.equal(unlisted.models.every((model) => model.defaultEffort === undefined), true, 'nor an effort no model can run at');
  assert.equal(closes.length, 3, 'the handshake is closed every time');

  await assert.rejects(
    readClaudeModelCatalog({ createQuery, executable: () => null, readSettings: () => ({}) }),
    /Claude CLI not found/,
  );
  assert.equal(recallAgentModels('claude'), undefined, 'a bare read remembers nothing by itself');
});

test('a listing completes a memory a session left without a default, once', async () => {
  // A session wrote the catalog before the runtime's default was known.
  rememberAgentModels('claude', [{ id: 'default', label: 'Default (recommended)' }, { id: 'fable[1m]', label: 'fable[1m]' }]);
  let reads = 0;
  let clock = 5_000_000;
  const now = () => clock;
  const still = await ensureAgentModelCatalog('claude', { now, read: async () => { reads += 1; return { models: [{ id: 'default', label: 'Default (recommended)' }] }; } });
  assert.equal(reads, 1, 'an incomplete memory is worth one runtime-level read');
  assert.deepEqual(still?.models.map((model) => model.id), ['default'], 'the read replaces the list even when it names no default');
  await ensureAgentModelCatalog('claude', { now, read: async () => { reads += 1; return { models: [] }; } });
  assert.equal(reads, 1, 'and is not repeated before the pause has passed');

  clock += 10 * 60_000;
  const remembered = await ensureAgentModelCatalog('claude', {
    now,
    read: async () => ({ defaultModel: 'fable[1m]', models: [{ id: 'default', label: 'Default (recommended)' }, { id: 'fable[1m]', label: 'fable[1m]', defaultEffort: 'xhigh', isDefault: true, supportedEfforts: ['xhigh'] }] }),
  });
  assert.equal(remembered?.defaultModel, 'fable[1m]');
  assert.deepEqual(readAppConfig().agentModelCatalogs?.claude?.defaultModel, 'fable[1m]');
  await ensureAgentModelCatalog('claude', { now, read: async () => { throw new Error('never read again'); } });
});

test('a runtime that flags no default keeps the model it last ran with nothing chosen', () => {
  rememberAgentModels('claude', [{ id: 'sonnet', label: 'Sonnet' }]);
  assert.equal(recallAgentModels('claude')?.defaultModel, undefined, 'a re-read that no longer lists the default drops it');
  rememberAgentModels('claude', []);
  assert.deepEqual(recallAgentModels('claude')?.models, [{ id: 'sonnet', label: 'Sonnet' }], 'an empty reading is not a catalog');
  rememberAgentDefaultModel('claude', 'opus');
  assert.equal(recallAgentModels('claude')?.defaultModel, undefined, 'a default is never invented outside the catalog');

  rememberAgentModels('claude', [{ id: 'opus', label: 'Opus' }, { id: 'sonnet', label: 'Sonnet' }]);
  rememberAgentDefaultModel('claude', 'haiku');
  assert.equal(recallAgentModels('claude')?.defaultModel, undefined, 'only a listed model can be the default');
  rememberAgentDefaultModel('claude', 'opus');
  assert.equal(recallAgentModels('claude')?.defaultModel, 'opus');

  rememberAgentModels('claude', [{ id: 'opus', label: 'Opus 5' }]);
  assert.equal(recallAgentModels('claude')?.defaultModel, 'opus', 'a re-read keeps a default it still lists');
  rememberAgentModels('claude', [{ id: 'sonnet', label: 'Sonnet' }]);
  assert.equal(recallAgentModels('claude')?.defaultModel, undefined, 'and drops one it no longer lists');
  assert.equal(recallAgentModels('stashbase'), undefined);
});

test('only a runtime that can run a turn and offers a model choice carries a catalog in the listing', () => {
  rememberAgentModels('codex', [{ id: 'gpt-6', label: 'GPT-6' }]);
  const ready = { id: 'codex' as const, installed: true, state: 'available', capabilities: { models: true } };
  assert.deepEqual(rememberedCatalogFor(ready)?.models, [{ id: 'gpt-6', label: 'GPT-6' }]);
  assert.equal(rememberedCatalogFor({ ...ready, installed: false }), undefined);
  assert.equal(rememberedCatalogFor({ ...ready, state: 'failed' }), undefined);
  assert.equal(rememberedCatalogFor({ ...ready, capabilities: { models: false } }), undefined);
  assert.equal(rememberedCatalogFor({ ...ready, id: 'stashbase' }), undefined);
});


test('catalog refresh preserves malformed settings and remains available in memory', () => {
  const configPath = path.join(os.homedir(), '.stashbase', 'config.json');
  const previous = fs.readFileSync(configPath);
  try {
    fs.writeFileSync(configPath, '{"unfinished":');
    assert.doesNotThrow(() => rememberAgentModels('codex', [{ id: 'fresh', label: 'Fresh' }]));
    assert.equal(recallAgentModels('codex')?.models[0].id, 'fresh');
    assert.equal(fs.readFileSync(configPath, 'utf8'), '{"unfinished":');
  } finally {
    fs.writeFileSync(configPath, previous);
  }
});

test('the hosted Default catalog stays in memory and is read again once it is old', async () => {
  let reads = 0;
  let clock = Date.now();
  const now = () => clock;
  const read = async () => {
    reads += 1;
    return { models: [{ id: `profile-${reads}`, label: `Profile ${reads}`, isDefault: true }] };
  };
  assert.deepEqual((await ensureAgentModelCatalog('stashbase', { read, now }))?.models.map((model) => model.id), ['profile-1']);
  await ensureAgentModelCatalog('stashbase', { read, now });
  assert.equal(reads, 1, 'a recent hosted list answers without a read');
  // The approved list belongs to the account, not to this installation.
  assert.ok(!Object.keys(readAppConfig().agentModelCatalogs ?? {}).includes('stashbase'));

  clock += 6 * 60_000;
  assert.deepEqual((await ensureAgentModelCatalog('stashbase', { read, now }))?.models.map((model) => model.id), ['profile-2']);
  assert.equal(reads, 2);
});

test('a session asking for a fresh catalog reads a remembered one again once it is older than it allows', async () => {
  let reads = 0;
  let clock = Date.now();
  const now = () => clock;
  const read = async () => {
    reads += 1;
    return { models: [{ id: `model-${reads}`, label: `Model ${reads}`, isDefault: true }] };
  };
  await ensureAgentModelCatalog('antigravity', { read, now, maxAgeMs: 60_000 });
  await ensureAgentModelCatalog('antigravity', { read, now, maxAgeMs: 60_000 });
  assert.equal(reads, 1, 'chats opened together share one read');
  clock += 2 * 60_000;
  await ensureAgentModelCatalog('antigravity', { read, now });
  assert.equal(reads, 1, 'the runtime listing alone keeps a complete native catalog');
  assert.deepEqual((await ensureAgentModelCatalog('antigravity', { read, now, maxAgeMs: 60_000 }))?.models.map((model) => model.id), ['model-2']);
  assert.equal(reads, 2);
});
