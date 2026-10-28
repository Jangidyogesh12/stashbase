import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { Table, TableBody } from '@/components/ui/table';
import { analyzeJsonSource } from '@/features/documents/domain/json-source';

import { visibleJsonNodes, type VisibleJsonNode } from './tree-model';
import { JsonValueRow } from './tree-rows';

afterEach(cleanup);

const SOURCE = '{"title":"Plan","tags":["draft"],"count":2}';

/** The visible rows of `SOURCE` with every container expanded. */
function nodes(): VisibleJsonNode[] {
  const analysis = analyzeJsonSource(SOURCE);
  if (!analysis.available) throw new Error('fixture is not valid JSON');
  return [...visibleJsonNodes(analysis.root, new Set(['$', '$.tags']))];
}

function nodeAt(label: string): VisibleJsonNode {
  const item = nodes().find((candidate) => candidate.node.key === label);
  if (!item) throw new Error(`no node keyed ${label}`);
  return item;
}

function inTable(row: React.ReactNode) {
  return render(
    <Table>
      <TableBody>{row}</TableBody>
    </Table>,
  );
}

function valueRow(
  item: VisibleJsonNode,
  overrides: Partial<Parameters<typeof JsonValueRow>[0]> = {},
) {
  const props = {
    isExpanded: false,
    isSelected: false,
    item,
    onKeyDown: vi.fn(),
    onSelect: vi.fn(),
    onToggle: vi.fn(),
    rowIndex: 0,
    selectedRef: null,
    ...overrides,
  };
  return { ...inTable(<JsonValueRow {...props} />), props };
}

describe('JSON value row', () => {
  it('states its place in the tree so a reader on assistive tech can follow it', () => {
    const { props } = valueRow(nodeAt('title'), { isSelected: true });

    const row = screen.getByRole('row');
    expect(row.getAttribute('aria-level')).toBe('2');
    expect(row.getAttribute('aria-selected')).toBe('true');
    expect(row.getAttribute('aria-posinset')).toBe(String(props.item.position));
    expect(row.getAttribute('aria-setsize')).toBe(String(props.item.setSize));
  });

  it('shows the value and its type', () => {
    valueRow(nodeAt('title'));

    expect(screen.getByRole('cell', { name: 'Plan' })).not.toBeNull();
    expect(screen.getByRole('cell', { name: 'string' })).not.toBeNull();
  });

  it('offers expansion for a container and nothing to expand for a leaf', () => {
    valueRow(nodeAt('tags'), { isExpanded: true });
    expect(screen.getByRole('button', { name: 'Collapse $.tags' })).not.toBeNull();

    cleanup();
    valueRow(nodeAt('count'));
    expect(screen.queryByRole('button', { name: /Expand|Collapse/u })).toBeNull();
  });

  it('reports selection and toggling without deciding either', async () => {
    const { props } = valueRow(nodeAt('tags'), { isExpanded: false });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Expand $.tags' }));
    expect(props.onToggle).toHaveBeenCalledWith(props.item.node);
    // Toggling is not a selection: the click never reaches the row.
    expect(props.onSelect).not.toHaveBeenCalled();

    await user.click(screen.getByRole('cell', { name: 'array' }));
    expect(props.onSelect).toHaveBeenCalledWith(props.item.node);
  });
});
