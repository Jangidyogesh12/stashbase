import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeHtml } from './html.ts';
import { injectHtmlDataClient } from './html-data.ts';

// The preview iframe renders a user's own document, so the app stylesheet
// never reaches it. What the server injects is the only chrome the frame
// gets, and these are the properties of that injection that matter.

test('previewed HTML carries the app scrollbar anatomy and theme fallback', () => {
  const { preparedHtml } = analyzeHtml('<html><head><title>t</title></head><body><p>x</p></body></html>');
  assert.match(preparedHtml, /scrollbar-width:thin/);
  assert.match(
    preparedHtml,
    /scrollbar-color:rgb\(var\(--stashbase-scrollbar-overlay\)\/\.08\) rgb\(var\(--stashbase-scrollbar-surface\)\)/,
  );
  assert.match(preparedHtml, /::-webkit-scrollbar\{width:10px;height:10px\}/);
  assert.match(preparedHtml, /::-webkit-scrollbar-button\{display:none;width:0;height:0\}/);
  assert.match(
    preparedHtml,
    /::-webkit-scrollbar-track,::-webkit-scrollbar-corner\{background:rgb\(var\(--stashbase-scrollbar-surface\)\)\}/,
  );
  assert.doesNotMatch(preparedHtml, /!important/u);
});

test('the scrollbar rule precedes the page, so a page that styles its own wins', () => {
  const { preparedHtml } = analyzeHtml(
    '<html><head><style>html{scrollbar-color:red blue}</style></head><body><p>x</p></body></html>',
  );
  // Source order is the whole mechanism — same specificity, no
  // `!important`, injected first. A document that said nothing gets a
  // sane default; one that expressed an opinion keeps it.
  assert.ok(preparedHtml.indexOf('scrollbar-width:thin') < preparedHtml.indexOf('red blue'));
});

test('a document with no head still gets the rule ahead of its content', () => {
  const { preparedHtml } = analyzeHtml('<h1>Fragment</h1><p>body only</p>');
  assert.ok(preparedHtml.startsWith('<style>'));
  assert.ok(preparedHtml.indexOf('scrollbar-width:thin') < preparedHtml.indexOf('Fragment'));
});

test('injected chrome never reaches the indexed plaintext', () => {
  // `plaintext` feeds MFS chunking and keyword search. Viewer chrome in
  // the index would be a search hit on every HTML file in the project.
  const { plaintext } = analyzeHtml('<html><head><title>t</title></head><body><h1>Hi</h1><p>x</p></body></html>');
  assert.doesNotMatch(plaintext, /scrollbar/);
  assert.equal(plaintext, 't\n\n# Hi\n\nx');
});

test('the frame forwards the original link for parent-side scope resolution', () => {
  const { preparedHtml } = analyzeHtml(
    '<html><body><a href="next.html#details">Next</a></body></html>',
  );
  assert.match(preparedHtml, /type: 'stashbase-nav',[\s\S]*href: raw,/u);
});

test('the frame accepts a bounded scrollbar theme only from its parent', () => {
  const { preparedHtml } = analyzeHtml('<p>content</p>');
  assert.match(preparedHtml, /e\.source !== window\.parent/u);
  assert.match(preparedHtml, /d\.type === 'stashbase-theme'/u);
  assert.match(preparedHtml, /d\.theme !== 'dark' && d\.theme !== 'light'/u);
  assert.match(preparedHtml, /--stashbase-scrollbar-surface/u);
});

test('authored markup reaches the frame unchanged, so scripts and links find their own ids', () => {
  const body = '<h2 id="plan" class="title">Plan</h2><h3 id="modal-title">Delete?</h3><a href="#plan">Top</a>';
  const { preparedHtml, plaintext } = analyzeHtml(`<html><head></head><body>${body}</body></html>`);
  assert.ok(preparedHtml.includes(body));
  assert.equal(plaintext, '## Plan\n\n### Delete?\n\nTop');
});

test('injected chrome adds no lines ahead of authored code', () => {
  const source = [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<title>t</title>',
    '</head>',
    '<body>',
    '<script>document.getElementById("modal-title").textContent = "x";</script>',
    '</body>',
    '</html>',
  ].join('\n');
  const served = injectHtmlDataClient(analyzeHtml(source).preparedHtml);
  const line = (html: string) => html.slice(0, html.indexOf('modal-title')).split('\n').length;
  assert.equal(line(served), line(source));
});
