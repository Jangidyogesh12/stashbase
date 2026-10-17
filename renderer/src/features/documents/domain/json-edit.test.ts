import { describe, expect, it } from 'vite-plus/test';

import { addJsonChild, deleteJsonPath, renameJsonProperty, replaceJsonNode } from './json-edit';
import { analyzeJsonSource, type JsonSourceNode } from './json-source';

function childAt(node: JsonSourceNode, index: number): JsonSourceNode {
  const child = node.children[index];
  if (!child) throw new Error(`Expected a child at index ${index}.`);
  return child;
}

describe('JSON source edits', () => {
  it('patches only the safe source range for structural edits', () => {
    const original =
      '\uFEFF{\r\n  "untouched" : "\\u0061\\/b",\r\n  "large": 900719925474099312345,\r\n  "nested": { "value": true },\r\n  "items": [1, 2, 3]\r\n}\r\n';
    const analysis = analyzeJsonSource(original);
    expect(analysis.available).toBe(true);
    if (!analysis.available) return;

    const value = childAt(childAt(analysis.root, 2), 0);
    let source = replaceJsonNode(original, value, 'false');
    expect(source.replace('false', 'true')).toBe(original);
    source = renameJsonProperty(source, ['nested', 'value'], 'enabled');
    expect(source).toContain('"nested": { "enabled": false }');
    source = addJsonChild(source, ['nested'], '900719925474099399999', 'precise');
    expect(source).toContain('"precise": 900719925474099399999');
    source = addJsonChild(source, ['items'], '{"raw":1.00e+2}');
    expect(source).toContain('[1, 2, 3, {"raw":1.00e+2}]');
    source = deleteJsonPath(source, ['nested', 'enabled']);
    expect(source).not.toContain('enabled');
    expect(source.startsWith('\uFEFF')).toBe(true);
    expect(source.endsWith('\r\n')).toBe(true);
    expect(source).toContain('"untouched" : "\\u0061\\/b"');
    expect(source).toContain('900719925474099312345');
    expect(analyzeJsonSource(source).available).toBe(true);
  });

  it('adds the first member without introducing a blank line', () => {
    const cases: Array<[string, string, string | undefined, string]> = [
      ['{\n}', '1', 'a', '{\n  "a": 1\n}'],
      ['[\n]', '1', undefined, '[\n  1\n]'],
      ['{\n  }', '1', 'a', '{\n    "a": 1\n  }'],
      ['[\n  ]', '1', undefined, '[\n    1\n  ]'],
      ['{\r\n}', '1', 'a', '{\r\n  "a": 1\r\n}'],
    ];
    for (const [source, value, key, expected] of cases) {
      expect(addJsonChild(source, [], value, key), source).toBe(expected);
    }
  });

  it('validates subtree replacements before touching the source', () => {
    const source = '{"node":{"a":1},"keep" : 2}';
    const analysis = analyzeJsonSource(source);
    expect(analysis.available).toBe(true);
    if (!analysis.available) return;

    expect(() => replaceJsonNode(source, childAt(analysis.root, 0), '{"bad":}', true)).toThrow(
      /not valid strict JSON/u,
    );
    expect(replaceJsonNode(source, childAt(analysis.root, 0), '{\n  "fresh": 3\n}', true)).toBe(
      '{"node":{\n  "fresh": 3\n},"keep" : 2}',
    );
  });
});
