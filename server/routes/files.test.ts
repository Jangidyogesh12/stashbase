import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import { workspaceFilesSchema } from "../../shared/protocols/http/files.ts";

import { fileVersionAsync } from "../active-file-operations.ts";
import { filesystemPath } from "../filesystem-path.ts";
import { clearCurrentFolder, removeRecentAsync, openProjectFolder } from "../folder.ts";
import { requireFolder } from "../http.ts";
import { mount } from "./files.ts";
import { getWorkspacePreferences, setWorkspacePreferences } from "../app-config.ts";
import { mount as mountWorkspacePreferences } from "./workspace-preferences.ts";

test('folder-explicit workspace listings apply the saved hidden-file preference', async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'stashbase-listing-preference-'));
  const root = path.join(scratch, 'project');
  const peer = path.join(scratch, 'peer');
  const previous = getWorkspacePreferences();
  fs.mkdirSync(path.join(root, '.custom'), { recursive: true });
  fs.mkdirSync(peer);
  fs.writeFileSync(path.join(root, '.custom', 'note.md'), '# Hidden project note');
  fs.writeFileSync(path.join(root, 'draft.md'), '# Project draft');
  fs.writeFileSync(path.join(peer, 'peer.md'), '# Another project');
  await openProjectFolder(root);
  await openProjectFolder(peer);
  const app = express();
  app.use(express.json());
  mount(app);
  mountWorkspacePreferences(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    for (const shown of [false, true, false]) {
      const saved = await fetch(`${base}/api/workspace-preferences`, {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ showHiddenFiles: shown }),
      });
      assert.equal(saved.status, 200);
      const response = await fetch(`${base}/api/files?folder=${encodeURIComponent(root)}`);
      assert.equal(response.status, 200);
      const listing = workspaceFilesSchema.parse(await response.json());
      assert.equal(listing.showHiddenFiles, shown);
      assert.deepEqual(listing.files.map((file) => file.name),
        shown ? ['.custom/note.md', 'draft.md'] : ['draft.md']);
    }
    const refused = await fetch(`${base}/api/files?folder=${encodeURIComponent(scratch)}`);
    assert.equal(refused.status, 400, 'listing preferences do not grant project membership');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    setWorkspacePreferences(previous);
    clearCurrentFolder();
    await removeRecentAsync(root);
    await removeRecentAsync(peer);
    fs.rmSync(scratch, { force: true, recursive: true });
  }
});

test("versioned document route accepts JSON through the shared source authority", async (t) => {
  // This route contract owns source bytes, not the Python daemon lifecycle.
  // A real upsert leaves a child alive in a clean CI environment.
  const { indexer } = await import('../state.ts');
  t.mock.method(indexer, 'upsertFile', async () => ({ outcome: 'updated' }));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stashbase-json-route-"));
  const source = '\uFEFF{\r\n  "value": 1\r\n}\r\n';
  fs.writeFileSync(path.join(root, "data.json"), source, "utf8");
  await openProjectFolder(root);

  const app = express();
  app.use(express.json());
  mount(app);
  const server = http.createServer(app);
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/files/data.json?folder=${encodeURIComponent(root)}`,
      {
        body: JSON.stringify({
          baseVersion: await fileVersionAsync("data.json"),
          content: '\uFEFF{\n  "value": 2\n}\n',
        }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      },
    );

    assert.equal(response.status, 200);
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(body.format, "json");
    assert.equal(body.name, "data.json");
    assert.equal(body.content, '\uFEFF{\r\n  "value": 2\r\n}\r\n');
    assert.equal(fs.readFileSync(path.join(root, "data.json"), "utf8"), body.content);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    clearCurrentFolder();
    await removeRecentAsync(root);
    fs.rmSync(root, { force: true, recursive: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("reveal resolves the requested registered folder and rejects an unregistered folder", async () => {
  const activeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "stashbase-reveal-active-"));
  const memberRoot = fs.mkdtempSync(path.join(os.tmpdir(), "stashbase-reveal-member-"));
  const outsiderRoot = fs.mkdtempSync(path.join(os.tmpdir(), "stashbase-reveal-outsider-"));
  const memberSource = path.join(memberRoot, "source.ts");
  fs.writeFileSync(memberSource, "export const answer = 42;\n", "utf8");
  // Reveal answers in source spelling with POSIX separators, which is not
  // what path.join produces on Windows.
  const revealedSource = filesystemPath.absolute(memberSource);
  await openProjectFolder(memberRoot);
  await openProjectFolder(activeRoot);

  const revealed: string[] = [];
  const app = express();
  app.use(express.json());
  mount(app, { revealInFileManager: (absolutePath) => revealed.push(absolutePath) });
  const server = http.createServer(app);
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    const revealedResponse = await fetch(
      `http://127.0.0.1:${address.port}/api/reveal/source.ts?folder=${encodeURIComponent(memberRoot)}`,
      { method: "POST" },
    );
    assert.equal(revealedResponse.status, 200);
    assert.deepEqual(revealed, [revealedSource]);

    const rejectedResponse = await fetch(
      `http://127.0.0.1:${address.port}/api/reveal/source.ts?folder=${encodeURIComponent(outsiderRoot)}`,
      { method: "POST" },
    );
    assert.equal(rejectedResponse.status, 400);
    assert.deepEqual(revealed, [revealedSource]);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    clearCurrentFolder();
    await removeRecentAsync(activeRoot);
    await removeRecentAsync(memberRoot);
    fs.rmSync(activeRoot, { force: true, recursive: true, maxRetries: 10, retryDelay: 100 });
    fs.rmSync(memberRoot, { force: true, recursive: true, maxRetries: 10, retryDelay: 100 });
    fs.rmSync(outsiderRoot, { force: true, recursive: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("folder-scoped browser assets load without a window header", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stashbase-folder-asset-"));
  const content = Buffer.from("%PDF-1.7\nfolder-scoped viewer fixture\n", "utf8");
  fs.writeFileSync(path.join(root, "viewer.pdf"), content);
  await openProjectFolder(root);
  clearCurrentFolder();

  const app = express();
  app.use("/asset", requireFolder);
  mount(app);
  const server = http.createServer(app);
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const folderToken = encodeURIComponent(encodeURIComponent(root));

  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/asset/__folder/${folderToken}/viewer.pdf`,
    );

    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), content);

    const outsider = fs.mkdtempSync(path.join(os.tmpdir(), "stashbase-folder-asset-outsider-"));
    try {
      const outsiderToken = encodeURIComponent(encodeURIComponent(outsider));
      const rejected = await fetch(
        `http://127.0.0.1:${address.port}/asset/__folder/${outsiderToken}/viewer.pdf`,
      );
      assert.equal(rejected.status, 404);
    } finally {
      fs.rmSync(outsider, { force: true, recursive: true, maxRetries: 10, retryDelay: 100 });
    }

    const unscoped = await fetch(`http://127.0.0.1:${address.port}/asset/viewer.pdf`);
    assert.equal(unscoped.status, 412);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    clearCurrentFolder();
    await removeRecentAsync(root);
    fs.rmSync(root, { force: true, recursive: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("folder-scoped DOCX fallback remains reachable without an active folder", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stashbase-folder-docx-fallback-"));
  fs.writeFileSync(path.join(root, "viewer.docx"), Buffer.from("PK fixture", "utf8"));
  await openProjectFolder(root);
  clearCurrentFolder();

  const app = express();
  app.use("/asset-derived", requireFolder);
  mount(app);
  const server = http.createServer(app);
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const folderToken = encodeURIComponent(encodeURIComponent(root));

  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/asset-derived/__folder/${folderToken}/viewer.docx`,
    );
    assert.equal(response.status, 409);
    assert.match(await response.text(), /Preparing document preview/u);

    const unscoped = await fetch(
      `http://127.0.0.1:${address.port}/asset-derived/viewer.docx`,
    );
    assert.equal(unscoped.status, 412);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    clearCurrentFolder();
    await removeRecentAsync(root);
    fs.rmSync(root, { force: true, recursive: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('folder-explicit listing, reads, saves, and index status preserve a trailing space', { skip: process.platform === 'win32' }, async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'stashbase-spaced-scope-'));
  const root = path.join(scratch, 'Project ');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'note.md'), 'draft');
  await openProjectFolder(root);
  const { indexer } = await import('../state.ts');
  t.mock.method(indexer, 'upsertFile', async () => ({ outcome: 'updated' }));
  t.mock.method(indexer, 'status', async (folder?: string) => {
    assert.equal(folder, root);
    return { total: 0, indexed: 0, pendingCount: 0, pending: [], orphanedCount: 0, orphaned: [], upToDate: true, indexReady: true };
  });
  const { mount: mountIndexing } = await import('./indexing.ts');
  const app = express();
  app.use(express.json());
  mount(app);
  mountIndexing(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const scope = `folder=${encodeURIComponent(root)}`;
  try {
    for (const endpoint of ['/api/files', '/api/files/note.md', '/api/index-status']) {
      const result = await fetch(`${base}${endpoint}?${scope}`);
      assert.equal(result.status, 200, `${endpoint}: ${await result.text()}`);
    }
    const saved = await fetch(`${base}/api/files/note.md?${scope}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'next draft', baseVersion: await fileVersionAsync('note.md') }),
    });
    assert.equal(saved.status, 200, await saved.text());
    assert.equal(fs.readFileSync(path.join(root, 'note.md'), 'utf8'), 'next draft');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    clearCurrentFolder();
    await removeRecentAsync(root);
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
