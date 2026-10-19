import '../__tests__/isolated-home.ts';
import { mountFileOperationReceipts } from './file-operations.ts';
import { withWindowContext } from '../http.ts';
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";

import { clearCurrentFolder, removeRecentAsync, openProjectFolder } from "../folder.ts";
import { indexer } from "../state.ts";
import { mount as mountFiles } from "./files.ts";
import { mount as mountFolders } from "./folders.ts";

async function listen(app: express.Express): Promise<{ origin: string; close(): Promise<void> }> {
  const server = http.createServer(app);
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test("entry mutations honor an explicit folder that names the active folder and refuse any other", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stashbase-entry-mutations-"));
  const other = fs.mkdtempSync(path.join(os.tmpdir(), "stashbase-entry-other-"));
  fs.writeFileSync(path.join(root, "keep.md"), "# Keep\n", "utf8");
  await openProjectFolder(root);

  const app = express();
  app.use(express.json());
  mountFiles(app);
  mountFolders(app);
  const server = await listen(app);
  const explicit = `?folder=${encodeURIComponent(root)}`;
  const foreign = `?folder=${encodeURIComponent(other)}`;
  const json = { "content-type": "application/json" };

  try {
    const created = await fetch(`${server.origin}/api/files${explicit}`, {
      body: JSON.stringify({ dir: "", name: "Plan" }),
      headers: json,
      method: "POST",
    });
    assert.equal(created.status, 200);
    assert.equal(((await created.json()) as { name: string }).name, "Plan.md");
    assert.ok(fs.existsSync(path.join(root, "Plan.md")));

    const folder = await fetch(`${server.origin}/api/folders${explicit}`, {
      body: JSON.stringify({ path: "drafts" }),
      headers: json,
      method: "POST",
    });
    assert.equal(folder.status, 200);
    assert.ok(fs.statSync(path.join(root, "drafts")).isDirectory());

    for (const request of [
      { method: "POST", path: `/api/files${foreign}`, body: { name: "Foreign" } },
      { method: "POST", path: `/api/folders${foreign}`, body: { path: "foreign" } },
      { method: "PATCH", path: `/api/files/keep.md${foreign}`, body: { new_name: "Moved" } },
      { method: "DELETE", path: `/api/files/keep.md${foreign}` },
      { method: "PATCH", path: `/api/folders/drafts${foreign}`, body: { new_name: "moved" } },
      { method: "DELETE", path: `/api/folders/drafts${foreign}` },
    ]) {
      const refused = await fetch(`${server.origin}${request.path}`, {
        body: request.body ? JSON.stringify(request.body) : undefined,
        headers: json,
        method: request.method,
      });
      assert.equal(refused.status, 409, `${request.method} ${request.path}`);
      assert.equal(((await refused.json()) as { code: string }).code, "FOLDER_CHANGED");
    }
    assert.ok(fs.existsSync(path.join(root, "keep.md")));
    assert.ok(fs.existsSync(path.join(root, "drafts")));
    assert.equal(fs.existsSync(path.join(root, "Foreign.md")), false);
    assert.equal(fs.existsSync(path.join(other, "Foreign.md")), false);

  } finally {
    await server.close();
    clearCurrentFolder();
    await removeRecentAsync(root);
    fs.rmSync(root, { force: true, recursive: true, maxRetries: 10, retryDelay: 100 });
    fs.rmSync(other, { force: true, recursive: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("a file moves under its own name into an existing folder and back to the root", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stashbase-entry-move-"));
  fs.mkdirSync(path.join(root, "drafts"));
  fs.mkdirSync(path.join(root, "archive"));
  fs.writeFileSync(path.join(root, "plan.md"), "# Plan\n", "utf8");
  fs.writeFileSync(path.join(root, "index.md"), "See [plan](plan.md).\n", "utf8");
  fs.writeFileSync(path.join(root, "archive", "plan.md"), "# Old plan\n", "utf8");
  await openProjectFolder(root);

  const app = express();
  app.use(express.json());
  mountFiles(app);
  const server = await listen(app);
  const query = `?folder=${encodeURIComponent(root)}`;
  const move = (entry: string, dir: string) =>
    fetch(`${server.origin}/api/files/${entry}${query}`, {
      body: JSON.stringify({ dir }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });

  try {
    const moved = await move("plan.md", "drafts");
    assert.equal(moved.status, 200);
    assert.equal(((await moved.json()) as { name: string }).name, "drafts/plan.md");
    assert.equal(fs.readFileSync(path.join(root, "drafts", "plan.md"), "utf8"), "# Plan\n");
    assert.equal(fs.existsSync(path.join(root, "plan.md")), false);
    // Links elsewhere follow the file, as they do for a rename.
    assert.equal(fs.readFileSync(path.join(root, "index.md"), "utf8"), "See [plan](drafts/plan.md).\n");

    // A name already taken in the destination refuses and leaves both files.
    const taken = await move("drafts/plan.md", "archive");
    assert.equal(taken.status, 409);
    assert.equal(fs.readFileSync(path.join(root, "archive", "plan.md"), "utf8"), "# Old plan\n");
    assert.ok(fs.existsSync(path.join(root, "drafts", "plan.md")));

    // A destination that is gone, or that is not a folder, is never created.
    assert.equal((await move("drafts/plan.md", "gone")).status, 404);
    assert.equal(fs.existsSync(path.join(root, "gone")), false);
    assert.equal((await move("drafts/plan.md", "index.md")).status, 404);
    assert.equal((await move("drafts/plan.md", "../elsewhere")).status, 400);

    const back = await move("drafts/plan.md", "");
    assert.equal(back.status, 200);
    assert.equal(((await back.json()) as { name: string }).name, "plan.md");
    assert.ok(fs.existsSync(path.join(root, "plan.md")));
    // A selected existing directory is an exact identity, not a name to trim.
    fs.mkdirSync(path.join(root, " drafts"));
    const spaced = await move("plan.md", " drafts");
    assert.equal(spaced.status, 200);
    assert.equal(((await spaced.json()) as { name: string }).name, " drafts/plan.md");
    assert.ok(fs.existsSync(path.join(root, " drafts", "plan.md")));
    assert.equal(fs.existsSync(path.join(root, "drafts", "plan.md")), false);
  } finally {
    await server.close();
    clearCurrentFolder();
    await removeRecentAsync(root);
    fs.rmSync(root, { force: true, recursive: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("a folder moves with everything inside it, never into itself, and its links follow", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stashbase-folder-move-"));
  // No daemon is bound here; the index owner only has to hear about the move.
  const prefixMoves: Array<[string, string]> = [];
  t.mock.method(indexer, "renamePathPrefix", async (from: string, to: string) => {
    prefixMoves.push([path.relative(root, from), path.relative(root, to)]);
  });
  t.mock.method(indexer, "upsertFile", async () => undefined);
  fs.mkdirSync(path.join(root, "drafts", "chapter"), { recursive: true });
  fs.mkdirSync(path.join(root, "archive", "drafts"), { recursive: true });
  fs.mkdirSync(path.join(root, "book"));
  fs.writeFileSync(path.join(root, "index.md"), "See [one](drafts/chapter/one.md).\n", "utf8");
  fs.writeFileSync(path.join(root, "drafts", "chapter", "one.md"), "Back to [index](../../index.md).\n", "utf8");
  await openProjectFolder(root);

  const app = express();
  app.use(express.json());
  mountFolders(app);
  const server = await listen(app);
  const query = `?folder=${encodeURIComponent(root)}`;
  const move = (entry: string, dir: string) =>
    fetch(`${server.origin}/api/folders/${entry}${query}`, {
      body: JSON.stringify({ dir }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });

  try {
    assert.equal((await move("drafts", "drafts")).status, 400);
    assert.equal((await move("drafts", "drafts/chapter")).status, 400);
    // The destination already holds a folder by that name.
    assert.equal((await move("drafts", "archive")).status, 409);
    assert.equal((await move("drafts", "gone")).status, 404);
    assert.ok(fs.existsSync(path.join(root, "drafts", "chapter", "one.md")));

    const moved = await move("drafts", "book");
    assert.equal(moved.status, 200);
    assert.equal(((await moved.json()) as { path: string }).path, "book/drafts");
    assert.equal(fs.existsSync(path.join(root, "drafts")), false);
    assert.equal(
      fs.readFileSync(path.join(root, "index.md"), "utf8"),
      "See [one](book/drafts/chapter/one.md).\n",
    );
    // A link out of the moved folder is one level deeper now.
    assert.equal(
      fs.readFileSync(path.join(root, "book", "drafts", "chapter", "one.md"), "utf8"),
      "Back to [index](../../../index.md).\n",
    );

    assert.deepEqual(prefixMoves, [["drafts", path.join("book", "drafts")]]);

    const back = await move("book/drafts", "");
    assert.equal(back.status, 200);
    assert.equal(((await back.json()) as { path: string }).path, "drafts");
    assert.equal(fs.readFileSync(path.join(root, "index.md"), "utf8"), "See [one](drafts/chapter/one.md).\n");
  } finally {
    await server.close();
    clearCurrentFolder();
    await removeRecentAsync(root);
    fs.rmSync(root, { force: true, recursive: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('a lost rename response can be confirmed without repeating its filesystem write', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stashbase-file-receipt-'));
  fs.writeFileSync(path.join(root, 'source.bin'), 'original bytes');
  await openProjectFolder(root);
  const app = express();
  app.use(express.json());
  app.use(withWindowContext);
  mountFileOperationReceipts(app);
  app.use((req, res, next) => {
    if (req.headers['x-lose-response']) {
      const json = res.json.bind(res);
      res.json = body => { res.destroy(); return json(body); };
    }
    next();
  });
  mountFiles(app);
  const server = await listen(app);
  const query = `?folder=${encodeURIComponent(root)}`;
  const operation = `${server.origin}/api/files/source.bin${query}&operationId=rename-once`;
  try {
    await assert.rejects(fetch(operation, { method: 'PATCH', headers: { 'content-type': 'application/json', 'x-lose-response': 'true' }, body: JSON.stringify({ new_name: 'target.bin' }) }));
    let receipt: Response | null = null;
    for (let attempt = 0; attempt < 100; attempt++) {
      const response = await fetch(`${server.origin}/api/file-operations/rename-once${query}`);
      if (response.status === 200) {
        receipt = response;
        break;
      }
      assert.equal(response.status, 202, 'the operation remains in progress until its result is recorded');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.ok(receipt, 'the route eventually records the lost response');
    assert.equal(fs.existsSync(path.join(root, 'source.bin')), false);
    assert.equal(fs.readFileSync(path.join(root, 'target.bin'), 'utf8'), 'original bytes');
    assert.equal(receipt.status, 200);
    assert.equal(((await receipt.json()) as { body: { name: string } }).body.name, 'target.bin');
    // A replay cannot rename a newly created source at the original path.
    fs.writeFileSync(path.join(root, 'source.bin'), 'newer file');
    const replay = await fetch(operation, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ new_name: 'target.bin' }) });
    assert.equal(replay.status, 200);
    assert.equal(fs.readFileSync(path.join(root, 'source.bin'), 'utf8'), 'newer file');
    const foreign = await fetch(`${server.origin}/api/file-operations/rename-once`, { headers: { 'x-stashbase-window-id': 'another-window' } });
    assert.equal(foreign.status, 404);
    const changed = await fetch(operation, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ new_name: 'different.bin' }) });
    assert.equal(changed.status, 409);
  } finally {
    await server.close(); clearCurrentFolder(); await removeRecentAsync(root);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
