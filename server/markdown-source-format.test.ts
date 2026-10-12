import assert from 'node:assert/strict';
import test from 'node:test';
import { preserveTextSourceFormat } from './markdown-source-format.ts';

test('preserves BOM and uniform CRLF while serializing an edited Markdown note', () => {
  assert.equal(
    preserveTextSourceFormat('\uFEFF# Title\r\n\r\nBody\r\n', '# Title\n\nEdited\n'),
    '\uFEFF# Title\r\n\r\nEdited\r\n',
  );
});

test('preserves uniform LF and normalizes mixed endings only on a save', () => {
  assert.equal(
    preserveTextSourceFormat('one\ntwo\n', 'one\ntwo\nthree\n'),
    'one\ntwo\nthree\n',
  );
  assert.equal(
    preserveTextSourceFormat('one\r\ntwo\r\nthree\n', 'one\ntwo\nthree\nfour\n'),
    'one\r\ntwo\r\nthree\r\nfour\r\n',
  );
});

test('does not rewrite source text that has no line-ending convention', () => {
  assert.equal(preserveTextSourceFormat('plain source', 'changed source'), 'changed source');
});

test('the shared text preservation seam keeps JSON BOM and CRLF without serializing it', () => {
  assert.equal(
    preserveTextSourceFormat('\uFEFF{\r\n  "b": 1,\r\n  "a": 2\r\n}\r\n', '{\n  "b": 3,\n  "a": 2\n}\n'),
    '\uFEFF{\r\n  "b": 3,\r\n  "a": 2\r\n}\r\n',
  );
});
