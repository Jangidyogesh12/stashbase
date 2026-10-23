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

test('a table keeps the line endings of rows its edit left alone', () => {
  // Spreadsheet apps end records with CRLF and break lines inside a quoted cell with LF.
  const previous = 'name,note\r\n"A","first\nsecond"\r\n"B","x"\r\n"C","third\nfourth"\r\n';
  const edited = 'name,note\n"A","first\nsecond"\n"B","changed"\n"C","third\nfourth"\n';
  assert.equal(
    preserveTextSourceFormat(previous, edited, { keepUnchangedLineEndings: true }),
    'name,note\r\n"A","first\nsecond"\r\n"B","changed"\r\n"C","third\nfourth"\r\n',
  );
  // Two separate edits since the last save: the rows between them keep theirs too.
  assert.equal(
    preserveTextSourceFormat(previous, `${edited}"D","new\nrow"\n`, { keepUnchangedLineEndings: true }),
    'name,note\r\n"A","first\nsecond"\r\n"B","changed"\r\n"C","third\nfourth"\r\n"D","new\r\nrow"\r\n',
  );
  assert.equal(
    preserveTextSourceFormat(previous, 'name,note\n"C","third\nfourth"\n', { keepUnchangedLineEndings: true }),
    'name,note\r\n"C","third\nfourth"\r\n',
  );
  // Blank and repeated lines inside cells are matched by position, not guessed:
  // deleting one must leave another cell's identical blank line alone.
  const blanks = 'id,note\r\n1,"para1\n\npara2"\r\n2,plain\r\n3,plain\r\n4,"x\n\ny"\r\n5,end\r\n';
  assert.equal(
    preserveTextSourceFormat(
      blanks,
      'id,note\n1,"para1\npara2"\n2,plain\n3,plain\n4,"x\n\ny"\n5,end\n',
      { keepUnchangedLineEndings: true },
    ),
    'id,note\r\n1,"para1\npara2"\r\n2,plain\r\n3,plain\r\n4,"x\n\ny"\r\n5,end\r\n',
  );
  assert.equal(
    preserveTextSourceFormat(
      blanks,
      'id,note\n0,new\n1,"para1\n\npara2"\n2,plain\n3,changed\n4,"x\n\ny"\n5,end\n',
      { keepUnchangedLineEndings: true },
    ),
    'id,note\r\n0,new\r\n1,"para1\n\npara2"\r\n2,plain\r\n3,changed\r\n4,"x\n\ny"\r\n5,end\r\n',
  );
  assert.equal(
    preserveTextSourceFormat('a,1\rb,2\r', 'a,1\nb,3\nc,4\n', { keepUnchangedLineEndings: true }),
    'a,1\rb,3\rc,4\r',
  );
  assert.equal(
    preserveTextSourceFormat('\uFEFFa\r\nb\nc', 'a\nb\nc', { keepUnchangedLineEndings: true }),
    '\uFEFFa\r\nb\nc',
  );
});
