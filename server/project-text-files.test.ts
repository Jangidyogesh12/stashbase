import './__tests__/isolated-home.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { execFileSync } from 'node:child_process';
import { callTool } from './__tests__/mcp-call.ts';
import { registerAttributedAgentSession, unregisterAttributedAgentSession } from './agent-session-registry.ts';
import { saveFileContent } from './file-save.ts';
import { registerProjectFolderAsync, runWithFolderRoot } from './folder.ts';
import { writeProjectFile } from './project-file-mutations.ts';
import { withAgentProjectScope } from './project-request-scope.ts';
import { mount as mountMcp } from './routes/mcp-http.ts';
import { mount as mountProjectFiles } from './routes/project-files.ts';
import { indexer } from './state.ts';
import { textVersion } from './text-file-transaction.ts';

test('Agent text tools preserve code and configuration independently of document formats', async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'stashbase-project-text-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const root = path.join(scratch, 'project');
  const other = path.join(scratch, 'other');
  fs.mkdirSync(root); fs.mkdirSync(other);
  await registerProjectFolderAsync(root);
  await registerProjectFolderAsync(other);
  const indexed = t.mock.method(indexer, 'upsertFile', async () => ({ outcome: 'unchanged' as const }));
  const deleted = t.mock.method(indexer, 'deleteFile', async () => undefined);

  const app = express();
  app.use(express.json());
  mountProjectFiles(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const token = 'b'.repeat(64);
  mountMcp(app, { webBase: base, getToken: () => token });
  const tool = (name: string, args: Record<string, unknown>) => callTool(base, token, name, args);

  await t.test('creates exact names, reads and edits text, and preserves BOM, line endings and versions', async () => {
    for (const name of ['.env', '.gitignore', 'src/main.ts', 'scripts/job.py', 'config/settings.yaml', 'Dockerfile', 'custom.unknown', 'bin']) {
      const file = path.join(root, name);
      const original = '\uFEFFVALUE=one\r\n# 中文配置\r\n';
      const created = await tool('write_file', { path: file, content: original });
      assert.equal(created.path, file.replace(/\\/g, '/'));
      assert.equal(created.version, textVersion(original));
      assert.equal(fs.existsSync(`${file}.md`), false);
      if (name === '.env') fs.chmodSync(file, 0o600);
      const read = await tool('read_file', { path: file });
      assert.equal(read.content, original);
      assert.equal(read.version, created.version);
      assert.equal(read.format, 'txt');
      const window = await tool('read_file', { path: file, offset: 2, limit: 1 });
      assert.equal(window.content, '# 中文配置\r\n');
      assert.equal(window.version, undefined);
      const edited = await tool('edit_file', {
        path: file, old_text: 'one', new_text: 'two', baseVersion: read.version,
      });
      assert.equal(fs.readFileSync(file, 'utf8'), original.replace('one', 'two'));
      if (name === '.env' && process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
      assert.equal(edited.version, textVersion(original.replace('one', 'two')));
      await assert.rejects(tool('write_file', {
        path: file, content: 'stale', baseVersion: read.version,
      }), /FILE_CHANGED/);
      assert.equal(fs.readFileSync(file, 'utf8'), original.replace('one', 'two'));
    }
    assert.equal(indexed.mock.callCount(), 0, 'generic text never enters the search index');
    assert.equal(deleted.mock.callCount(), 0, 'generic text does not require the index daemon');
    await assert.rejects(runWithFolderRoot(root, () => saveFileContent('.env', 'editor write')),
      { code: 'UNSUPPORTED_FORMAT' });
  });

  await t.test('rejects binary, invalid UTF-8 and oversized sources without overwriting them', async () => {
    const fixtures: Array<[string, Buffer, RegExp]> = [
      ['binary.custom', Buffer.from([0x61, 0, 0x62]), /UNSUPPORTED_FORMAT/],
      ['controls.custom', Buffer.from([0x61, 1, 0x62]), /UNSUPPORTED_FORMAT/],
      ['invalid.py', Buffer.from([0x61, 0xff]), /UNSUPPORTED_ENCODING/],
      ['disguised.md', Buffer.from([0x61, 0xff]), /UNSUPPORTED_ENCODING/],
      ['archive.zip', Buffer.from('PK fixture'), /UNSUPPORTED_FORMAT/],
      ['~$draft.docx', Buffer.from('container header'), /UNSUPPORTED_FORMAT/],
      ['large.ts', Buffer.alloc(8 * 1024 * 1024 + 1, 0x61), /FILE_TOO_LARGE/],
    ];
    for (const [name, bytes, error] of fixtures) {
      const file = path.join(root, name);
      fs.writeFileSync(file, bytes);
      await assert.rejects(tool('read_file', { path: file }), error);
      await assert.rejects(tool('write_file', { path: file, content: 'replacement' }), error);
      await assert.rejects(tool('edit_file', { path: file, old_text: 'a', new_text: 'b' }), error);
      assert.deepEqual(fs.readFileSync(file), bytes);
    }
    const newBinary = path.join(root, 'new.png');
    await assert.rejects(tool('write_file', { path: newBinary, content: 'text' }), /UNSUPPORTED_FORMAT/);
    assert.equal(fs.existsSync(newBinary), false);
    const invalid = path.join(root, 'invalid-new.ts');
    await assert.rejects(tool('write_file', { path: invalid, content: 'a\u0000b' }), /INVALID_TEXT_CONTENT/);
    await assert.rejects(tool('write_file', { path: invalid, content: 'a\uD800b' }), /INVALID_TEXT_CONTENT/);
    assert.equal(fs.existsSync(invalid), false);
    if (process.platform !== 'win32') {
      const fifo = path.join(root, 'pipe');
      execFileSync('mkfifo', [fifo]);
      await assert.rejects(tool('read_file', { path: fifo }), /not a file/);
      await assert.rejects(tool('write_file', { path: fifo, content: 'replacement' }), /not a file/);
      assert.ok(fs.lstatSync(fifo).isFIFO());
    }
  });

  await t.test('retains excluded paths, project scope and symlink containment', async () => {
    for (const name of ['.stashbase/config.ts', '.git/config', 'node_modules/pkg/index.ts', '.source.pdf.md']) {
      const file = path.join(root, name);
      await assert.rejects(tool('write_file', { path: file, content: 'blocked' }), /excluded|cannot write|derived notes/);
      assert.equal(fs.existsSync(file), false);
    }
    registerAttributedAgentSession('text-scope', {
      agentId: 'claude', windowId: 'text-window', boundFolder: () => root, turnInFlight: () => true,
    });
    try {
      await assert.rejects(withAgentProjectScope('text-scope', () =>
        writeProjectFile(path.join(other, 'outside.ts'), 'blocked')), { code: 'PROJECT_SCOPE_MISMATCH' });
      assert.equal(fs.existsSync(path.join(other, 'outside.ts')), false);
    } finally { unregisterAttributedAgentSession('text-scope'); }
    if (process.platform !== 'win32') {
      fs.symlinkSync(other, path.join(root, 'escape'));
      await assert.rejects(tool('write_file', { path: path.join(root, 'escape', '.env'), content: 'blocked' }));
      assert.equal(fs.existsSync(path.join(other, '.env')), false);
    }
  });

  await t.test('concurrent edits preserve one complete version and original file permissions', async () => {
    const file = path.join(root, 'run.sh');
    fs.writeFileSync(file, '#!/bin/sh\necho original\n');
    fs.chmodSync(file, 0o755);
    const current = await tool('read_file', { path: file });
    const previousMask = process.umask(0o077);
    let writes: PromiseSettledResult<unknown>[];
    try {
      writes = await Promise.allSettled(['one', 'two'].map((value) => tool('edit_file', {
        path: file, old_text: 'original', new_text: value, baseVersion: current.version,
      })));
    } finally { process.umask(previousMask); }
    assert.equal(writes.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(writes.filter((result) => result.status === 'rejected').length, 1);
    assert.match(fs.readFileSync(file, 'utf8'), /^#!\/bin\/sh\necho (one|two)\n$/);
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o755);
  });
});
