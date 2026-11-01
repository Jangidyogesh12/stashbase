import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('math_mode is local, defaults off, follows the resolved project identity, and is forgotten on removal', () => {
  const temporaryHome = fs.mkdtempSync(path.join(os.tmpdir(), 'stashbase-project-math-'));
  try {
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', `
      import assert from 'node:assert/strict';
      import fs from 'node:fs';
      import os from 'node:os';
      import path from 'node:path';
      import express from 'express';
      const config = await import('./server/app-config.ts');
      const { mount } = await import('./server/routes/project-settings.ts');
      const { filesystemPath } = await import('./server/filesystem-path.ts');
      const first = path.join(os.homedir(), 'first');
      const second = path.join(os.homedir(), 'second');
      fs.mkdirSync(first, { recursive: true }); fs.mkdirSync(second, { recursive: true });
      config.writeAppConfigStrict({ recentFolders: [first, second].map(path => ({ path, openedAt: new Date().toISOString() })) });
      const app = express(); app.use(express.json()); mount(app);
      const server = app.listen(0, '127.0.0.1');
      await new Promise(resolve => server.once('listening', resolve));
      const url = 'http://127.0.0.1:' + server.address().port + '/api/project-settings/math';
      const read = async (scope) => fetch(url + '?' + new URLSearchParams({ scope }));
      const save = (scope, math_mode) => fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scope, math_mode }) });
      assert.deepEqual(await (await read(first)).json(), { scope: filesystemPath.absolute(first), math_mode: false });
      assert.equal((await save(first, true)).status, 200);
      assert.deepEqual(await (await read(first)).json(), { scope: filesystemPath.absolute(first), math_mode: true });
      assert.deepEqual(await (await read(second)).json(), { scope: filesystemPath.absolute(second), math_mode: false });
      assert.deepEqual(config.readAppConfigStrict().projectSettings, [{ scope: filesystemPath.absolute(first), math_mode: true }]);
      assert.equal((await save(second, 'yes')).status, 400);
      assert.equal((await save('/not-registered', true)).status, 404);
      const { removeRecentAsync } = await import('./server/folder.ts');
      await removeRecentAsync(first);
      assert.deepEqual(config.readAppConfigStrict().projectSettings, []);
      await new Promise(resolve => server.close(resolve));
    `], {
      encoding: 'utf8',
      env: { ...process.env, HOME: temporaryHome, USERPROFILE: temporaryHome },
      timeout: 15_000,
    });
    assert.equal(result.status, 0, result.stderr);
  } finally {
    fs.rmSync(temporaryHome, { recursive: true, force: true });
  }
});
