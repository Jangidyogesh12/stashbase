import assert from 'node:assert/strict';
import test from 'node:test';

import { codexModelName, loadCodexModelCatalog } from '../codex-model-catalog.ts';

// Names as Codex's own model/list gives them.
test('a GPT version-and-name reads name first, without the prefix', () => {
  assert.equal(codexModelName('GPT-6.1-Sol'), 'Sol 6.1');
  assert.equal(codexModelName('GPT-6-Astra'), 'Astra 6');
  assert.equal(codexModelName('GPT-5.6-Terra'), 'Terra 5.6');
  assert.equal(codexModelName('GPT-5.2-Codex-Mini'), 'Codex Mini 5.2');
});

test('a name of any other shape is passed through whole', () => {
  assert.equal(codexModelName('GPT-6'), 'GPT-6');
  assert.equal(codexModelName('o3'), 'o3');
  assert.equal(codexModelName('GPT-5.3 Codex'), 'GPT-5.3 Codex');
});

test('the catalog carries the rewritten name and keeps the id the runtime runs', async () => {
  const models = await loadCodexModelCatalog(async () => ({
    data: [{ id: 'gpt-6.1-sol', displayName: 'GPT-6.1-Sol', isDefault: true }],
  }));
  assert.deepEqual(models, [{ id: 'gpt-6.1-sol', label: 'Sol 6.1', isDefault: true }]);
});
