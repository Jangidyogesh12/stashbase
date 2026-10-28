import { describe, expect, it } from 'vite-plus/test';

import {
  analyzeJsonSource,
  formatJsonPath,
  type JsonSourceNode,
} from '@/features/documents/domain/json-source';

import {
  isJsonContainer,
  jsonNodeDisplayValue,
  jsonNodeLabel,
  visibleJsonNodes,
} from './tree-model';

function rootOf(source: string): JsonSourceNode {
  const analysis = analyzeJsonSource(source);
  if (!analysis.available) throw new Error(analysis.message);
  return analysis.root;
}

const NESTED = '{"one":{"deep":[1,2]},"two":"text"}';

describe('JSON tree projection', () => {
  it('shows only the children of expanded containers, in document order', () => {
    const root = rootOf(NESTED);
    expect(visibleJsonNodes(root, new Set()).map(({ node }) => formatJsonPath(node.path))).toEqual([
      '$',
    ]);

    const paths = visibleJsonNodes(root, new Set(['$', '$.one'])).map(({ node }) =>
      formatJsonPath(node.path),
    );
    expect(paths).toEqual(['$', '$.one', '$.one.deep', '$.two']);
  });

  it('reports each row position within its own container for the treegrid', () => {
    const visible = visibleJsonNodes(rootOf(NESTED), new Set(['$', '$.one', '$.one.deep']));
    const deepItems = visible.filter(
      ({ node }) => node.path[0] === 'one' && node.path.length === 3,
    );
    expect(deepItems.map((item) => [item.position, item.setSize])).toEqual([
      [1, 2],
      [2, 2],
    ]);
    expect(deepItems[0]?.parent?.type).toBe('array');
  });

  it('labels rows by key, array index, or root', () => {
    const visible = visibleJsonNodes(rootOf(NESTED), new Set(['$', '$.one', '$.one.deep']));
    expect(visible.map(({ node }) => jsonNodeLabel(node))).toEqual([
      'Root',
      'one',
      'deep',
      '[0]',
      '[1]',
      'two',
    ]);
  });

  it('summarizes containers and shows a string as its text', () => {
    const root = rootOf(NESTED);
    expect(jsonNodeDisplayValue(root)).toBe('2 properties');
    expect(jsonNodeDisplayValue(root.children[0]?.children[0] as JsonSourceNode)).toBe('2 items');
    expect(isJsonContainer(root)).toBe(true);

    const text = root.children[1] as JsonSourceNode;
    expect(isJsonContainer(text)).toBe(false);
    expect(jsonNodeDisplayValue(text)).toBe('text');
  });

  it('keeps a number cell literal and does not quote it', () => {
    const number = rootOf('{"count":42}').children[0] as JsonSourceNode;
    expect(jsonNodeDisplayValue(number)).toBe('42');
  });
});
