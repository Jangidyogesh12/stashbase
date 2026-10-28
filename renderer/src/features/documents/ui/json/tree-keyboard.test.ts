import { describe, expect, it } from 'vite-plus/test';

import { analyzeJsonSource, formatJsonPath } from '@/features/documents/domain/json-source';

import { jsonTreeKeyCommand, type JsonTreeKeyContext } from './tree-keyboard';
import { visibleJsonNodes, type VisibleJsonNode } from './tree-model';

const SOURCE = '{"one":{"deep":1},"two":"text"}';
const EXPANDED = new Set(['$', '$.one']);

function grid(): VisibleJsonNode[] {
  const analysis = analyzeJsonSource(SOURCE);
  if (!analysis.available) throw new Error(analysis.message);
  return [...visibleJsonNodes(analysis.root, EXPANDED)];
}

function rowAt(visible: VisibleJsonNode[], path: string): VisibleJsonNode {
  const item = visible.find((candidate) => formatJsonPath(candidate.node.path) === path);
  if (!item) throw new Error(`No visible row at ${path}.`);
  return item;
}

function context(path: string): JsonTreeKeyContext {
  const visible = grid();
  return { expanded: EXPANDED, item: rowAt(visible, path), visible };
}

function selectedPath(command: ReturnType<typeof jsonTreeKeyCommand>): string | null {
  if (!command || command.kind !== 'select') return null;
  return formatJsonPath(command.node.path);
}

describe('JSON tree keyboard', () => {
  it('walks the visible rows and clamps at both ends', () => {
    expect(selectedPath(jsonTreeKeyCommand('ArrowDown', context('$')))).toBe('$.one');
    expect(selectedPath(jsonTreeKeyCommand('ArrowUp', context('$.one')))).toBe('$');
    expect(selectedPath(jsonTreeKeyCommand('ArrowUp', context('$')))).toBe('$');
    expect(selectedPath(jsonTreeKeyCommand('End', context('$')))).toBe('$.two');
    expect(selectedPath(jsonTreeKeyCommand('Home', context('$.two')))).toBe('$');
  });

  it('expands a collapsed container and steps into an expanded one', () => {
    const collapsed = jsonTreeKeyCommand('ArrowRight', {
      ...context('$.one'),
      expanded: new Set(['$']),
    });
    expect(collapsed?.kind).toBe('toggle');
    expect(collapsed?.kind === 'toggle' && formatJsonPath(collapsed.node.path)).toBe('$.one');

    expect(selectedPath(jsonTreeKeyCommand('ArrowRight', context('$.one')))).toBe('$.one.deep');
  });

  it('collapses an expanded container and otherwise walks to the parent', () => {
    expect(jsonTreeKeyCommand('ArrowLeft', context('$.one'))?.kind).toBe('toggle');
    expect(selectedPath(jsonTreeKeyCommand('ArrowLeft', context('$.one.deep')))).toBe('$.one');
  });

  it('leaves ArrowRight on a leaf to the browser', () => {
    expect(jsonTreeKeyCommand('ArrowRight', context('$.two'))).toBeNull();
    expect(jsonTreeKeyCommand('a', context('$.two'))).toBeNull();
  });

  it('leaves every editing key to the browser: the outline only reads', () => {
    for (const key of ['Enter', 'F2', 'Delete', 'Backspace']) {
      expect(jsonTreeKeyCommand(key, context('$.two')), key).toBeNull();
    }
  });
});
