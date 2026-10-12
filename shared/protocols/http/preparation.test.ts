import assert from 'node:assert/strict';
import test from 'node:test';

import {
  preparationCancelResponseSchema,
  preparationReprocessResponseSchema,
  preparationSourceRequestSchema,
} from './preparation.ts';

test('a preparation source request carries an explicit folder without media options', () => {
  assert.equal(
    preparationSourceRequestSchema.safeParse({
      folder: '/project/research',
      path: 'papers/report.pdf',
    }).success,
    true,
  );
  assert.equal(
    preparationSourceRequestSchema.safeParse({ path: 'papers/report.pdf' }).success,
    false,
  );
});

test('control responses distinguish the reprocess mode and the cancel outcome', () => {
  assert.equal(
    preparationReprocessResponseSchema.parse({ mode: 'conversion', ok: true }).mode,
    'conversion',
  );
  assert.equal(preparationReprocessResponseSchema.safeParse({ mode: 'retry', ok: true }).success, false);
  assert.equal(preparationCancelResponseSchema.parse({ cancelled: false, ok: true }).cancelled, false);
});
