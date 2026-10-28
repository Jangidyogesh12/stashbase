import { expect, it } from 'vite-plus/test';

import { htmlDataSource, parseHtmlData, updateHtmlData } from './html-data';

it('resolves named JSON resources inside this page assets without allowing traversal or URL paths', () => {
  const source = { folderPath: '/project', path: 'Notebook/renamed.html' };
  expect(htmlDataSource(source, './assets/自由命名/records.json')).toEqual({
    ...source,
    path: 'Notebook/assets/自由命名/records.json',
  });
  for (const path of [
    '../other.json',
    'assets/../../other.json',
    '/assets/data.json',
    'https://example.com/data.json',
    'assets/%2e%2e/data.json',
    'assets/data.js',
    'assets\\data.json',
  ])
    expect(() => htmlDataSource(source, path)).toThrow('assets');
});

it('edits JSON leaves without rewriting unrelated lexemes, BOM, or whitespace', () => {
  const source =
    '\uFEFF{\n  "title": "old",\n  "number": 1.00,\n  "rows": [{"name":"a"},{"name":"b"}]\n}\n';
  const result = updateHtmlData(
    source,
    '{"title":"new","number":1,"rows":[{"name":"a"},{"name":"c"}]}',
  );
  expect(result).toBe(source.replace('"old"', '"new"').replace('"b"', '"c"'));
  expect(
    parseHtmlData(updateHtmlData('{"items":[1,2,3],"remove":true}', '{"items":[1],"add":[]}')),
  ).toEqual({ items: [1], add: [] });
  expect(parseHtmlData(updateHtmlData('null', '{"items":[1,2]}'))).toEqual({ items: [1, 2] });
  expect(() => updateHtmlData('{broken', '{}')).toThrow('Invalid Symbol');
  expect(() => parseHtmlData('{"name":1,"name":2}')).toThrow('duplicated');
  expect(parseHtmlData(updateHtmlData('{}', '{"__proto__":{"value":1},"constructor":2}'))).toEqual(
    JSON.parse('{"__proto__":{"value":1},"constructor":2}'),
  );
  expect(() => parseHtmlData('x'.repeat(8 * 1024 * 1024 + 1))).toThrow('supports JSON');
});
