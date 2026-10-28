import { describe, expect, it } from 'vite-plus/test';

import { addJsonChild, deleteJsonPath } from './json-edit';
import { analyzeJsonSource } from './json-source';

describe('JSON source edits', () => {
  it('patches only the safe source range for structural edits', () => {
    const original =
      '\uFEFF{\r\n  "untouched" : "\\u0061\\/b",\r\n  "large": 900719925474099312345,\r\n  "nested": { "value": true },\r\n  "items": [1, 2, 3]\r\n}\r\n';
    let source = addJsonChild(original, ['nested'], 'false', 'enabled');
    expect(source).toContain('"enabled": false');
    source = addJsonChild(source, ['nested'], '900719925474099399999', 'precise');
    expect(source).toContain('"precise": 900719925474099399999');
    source = addJsonChild(source, ['items'], '{"raw":1.00e+2}');
    expect(source).toContain('[1, 2, 3, {"raw":1.00e+2}]');
    source = deleteJsonPath(source, ['nested', 'enabled']);
    expect(source).not.toContain('enabled');
    expect(source).toContain('"nested": { "value": true,');
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
});
