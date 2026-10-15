import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { claudeModelRelease, claudeUpgradeOffer, claudeUpgradeOfferFrom } from '../claude-model-catalog.ts';

const DISABLED = {
  value: 'cc-update-required-1',
  label: 'Opus 5.5 (disabled)',
  description: 'Update to 2.1.280+ to use Opus 5.5',
  disabled: true,
};
const RUNNABLE = { value: 'claude-fable-5-1[1m]', label: 'Fable', description: 'Most capable' };

test('a model the runtime marks disabled is carried through in its own words', () => {
  assert.deepEqual(claudeUpgradeOfferFrom([RUNNABLE, DISABLED]), {
    model: 'Opus 5.5',
    note: 'Update to 2.1.280+ to use Opus 5.5',
  });
});

/** The parenthetical belongs to Claude's own picker, where the entry sits
 *  greyed out beside models that can be chosen. Nothing here is greyed out. */
test('the disabled parenthetical is not part of the model name', () => {
  assert.equal(claudeUpgradeOfferFrom([{ ...DISABLED, label: 'Opus 5.5' }])?.model, 'Opus 5.5');
  assert.equal(claudeUpgradeOfferFrom([{ ...DISABLED, label: 'Opus 5.5 (Disabled)' }])?.model, 'Opus 5.5');
  assert.equal(claudeUpgradeOfferFrom([{ ...DISABLED, label: '(disabled)' }])?.model, '(disabled)');
});

test('models the runtime can actually run are not an offer', () => {
  assert.equal(claudeUpgradeOfferFrom([RUNNABLE]), undefined);
  assert.equal(claudeUpgradeOfferFrom([{ ...DISABLED, disabled: false }]), undefined);
  assert.equal(claudeUpgradeOfferFrom([]), undefined);
});

/** The cache belongs to another product and may be reshaped without notice.
 *  Every shape this cannot read means silence, never a half-built sentence. */
test('a differently shaped entry is read as nothing to say', () => {
  assert.equal(claudeUpgradeOfferFrom(undefined), undefined);
  assert.equal(claudeUpgradeOfferFrom('cc-update-required-1'), undefined);
  assert.equal(claudeUpgradeOfferFrom([null, 7, 'x']), undefined);
  assert.equal(claudeUpgradeOfferFrom([{ ...DISABLED, description: undefined }]), undefined);
  assert.equal(claudeUpgradeOfferFrom([{ ...DISABLED, label: '   ' }]), undefined);
  assert.equal(claudeUpgradeOfferFrom([{ ...DISABLED, description: '  ' }]), undefined);
});

test('a missing or unparseable configuration file offers nothing', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-config-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, '.claude.json');

  assert.equal(claudeUpgradeOffer(file), undefined);

  fs.writeFileSync(file, '{ not json');
  assert.equal(claudeUpgradeOffer(file), undefined);
});

test('the file is re-read once it changes, so an update withdraws the offer', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-config-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, '.claude.json');

  fs.writeFileSync(file, JSON.stringify({ additionalModelOptionsCache: [DISABLED] }));
  assert.equal(claudeUpgradeOffer(file)?.model, 'Opus 5.5');

  // A runtime that has been updated no longer names the model at all.
  fs.writeFileSync(file, JSON.stringify({ additionalModelOptionsCache: [RUNNABLE] }));
  fs.utimesSync(file, new Date(), new Date(Date.now() + 1000));
  assert.equal(claudeUpgradeOffer(file), undefined);
});

// Descriptions as Claude's own handshake gives them for its aliases.
test('an alias reads as the release its own description starts with', () => {
  assert.equal(claudeModelRelease('Opus 5.5 with 1M context · Best for everyday, complex tasks'), 'Opus 5.5');
  assert.equal(claudeModelRelease('Fable 5.1 · Most capable for your hardest and longest-running tasks'), 'Fable 5.1');
  assert.equal(claudeModelRelease('Sonnet 5 · Efficient for routine tasks'), 'Sonnet 5');
  assert.equal(claudeModelRelease('Haiku 4.5 · Fastest for quick answers'), 'Haiku 4.5');
});

test('a description that does not start with a release names none, and the alias stands', () => {
  assert.equal(claudeModelRelease('Update to 2.1.280+ to use Opus 5.5'), undefined);
  assert.equal(claudeModelRelease('Most capable'), undefined);
  assert.equal(claudeModelRelease(undefined), undefined);
});
