import './__tests__/isolated-home.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { BUILT_IN_AGENT_ADAPTERS } from './agent-adapters.ts';
import { registerAgentAdapter } from './agent-contract.ts';
import { markFailed, readAll } from './conversion-status.ts';
import { derivedNoteFor, registerDerivedSource } from './derived-store.ts';
import { beginProjectFolderRemovalAsync, registerProjectFolderAsync } from './folder.ts';
import { filesystemPath } from './filesystem-path.ts';
import { bindIndexerForFolder, indexer } from './state.ts';
import { closeStateDb } from './state-db.ts';
import { mount } from './routes/project.ts';

test('removing a parent preserves nested project preparation, failures, namespace, and runtime scope', async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'stashbase-remove-parent-'));
  const parent = filesystemPath.absolute(path.join(scratch, 'Parent'));
  const child = filesystemPath.absolute(path.join(parent, 'Child'));
  const absent = filesystemPath.absolute(path.join(parent, 'Absent'));
  fs.mkdirSync(child, { recursive: true });
  fs.mkdirSync(absent);
  for (const folder of [parent, child, absent]) await registerProjectFolderAsync(folder);
  const stops: Array<[string, string]> = [];
  for (const adapter of BUILT_IN_AGENT_ADAPTERS) {
    registerAgentAdapter({ ...adapter, stopFolder: (folder) => { stops.push([adapter.id, folder]); } });
  }
  const app = express();
  app.use(express.json());
  mount(app);
  const server = app.listen(0, '127.0.0.1');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await indexer.close();
    closeStateDb();
    for (const adapter of BUILT_IN_AGENT_ADAPTERS) registerAgentAdapter(adapter);
    fs.rmSync(scratch, { recursive: true, force: true });
  });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const prepared = new Map<string, string>();
  for (const folder of [parent, child, absent]) {
    const source = filesystemPath.join(folder, 'paper.pdf');
    fs.writeFileSync(source, 'source');
    registerDerivedSource(source);
    const note = derivedNoteFor(source);
    fs.mkdirSync(path.dirname(note), { recursive: true });
    fs.writeFileSync(note, 'prepared text\n<!-- stashbase-pdf-conversion: complete -->');
    markFailed(source, 'fixture failure');
    prepared.set(folder, note);
  }
  fs.rmSync(absent, { recursive: true });
  for (const folder of [parent, child]) {
    await bindIndexerForFolder(folder);
    const note = filesystemPath.join(folder, 'note.md');
    fs.writeFileSync(note, 'searchable');
    await indexer.upsertFile(note, 'searchable');
  }
  const release = await beginProjectFolderRemovalAsync(parent);
  await assert.rejects(beginProjectFolderRemovalAsync(child), { code: 'FOLDER_REMOVING' });
  await assert.rejects(registerProjectFolderAsync(path.join(parent, 'New')), { code: 'FOLDER_REMOVING' });
  release();
  const response = await fetch(`http://127.0.0.1:${address.port}/api/projects/remove`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: parent }),
  });
  assert.equal(response.status, 200);
  const registry = await response.json() as { recent: Array<{ path: string }> };
  assert.deepEqual(registry.recent.map((row) => row.path).sort(), [child, absent].sort());
  assert.deepEqual(stops.map(([id]) => id).sort(), ['antigravity', 'claude', 'codex', 'stashbase']);
  assert.ok(stops.every(([, folder]) => folder === parent));
  assert.equal(fs.existsSync(prepared.get(parent)!), false);
  for (const retained of [child, absent]) {
    assert.match(fs.readFileSync(prepared.get(retained)!, 'utf8'), /prepared text/);
    assert.equal(readAll()[filesystemPath.join(retained, 'paper.pdf')]?.status, 'failed');
  }
  assert.equal(readAll()[filesystemPath.join(parent, 'paper.pdf')], undefined);
  assert.equal(fs.existsSync(filesystemPath.join(parent, 'paper.pdf')), true);
  assert.deepEqual(await indexer.listDocuments(child), [filesystemPath.join(child, 'note.md')]);
});
