/**
 * What the JSON grid shows, derived from the parsed outline.
 *
 * The projection is pure: which rows are visible for a set of expanded paths,
 * and what a row's label and display value are. Rendering and keyboard
 * handling live beside it.
 */
import { formatJsonPath, type JsonSourceNode } from '@/features/documents/domain/json-source';

export interface VisibleJsonNode {
  node: JsonSourceNode;
  parent: JsonSourceNode | null;
  position: number;
  setSize: number;
}

/** The root is always visible, so the projection is never empty. */
export type VisibleJsonNodes = [VisibleJsonNode, ...VisibleJsonNode[]];

export function isJsonContainer(node: JsonSourceNode): boolean {
  return node.type === 'array' || node.type === 'object';
}

export function jsonNodeLabel(node: JsonSourceNode): string {
  if (node.key !== undefined) return node.key;
  const index = node.path.at(-1);
  return typeof index === 'number' ? `[${index}]` : 'Root';
}

function containerSummary(node: JsonSourceNode): string {
  const count = node.children.length;
  if (node.type === 'array') return `${count.toLocaleString()} ${count === 1 ? 'item' : 'items'}`;
  return `${count.toLocaleString()} ${count === 1 ? 'property' : 'properties'}`;
}

/** A container shows its size; a string its text; anything else its literal. */
export function jsonNodeDisplayValue(node: JsonSourceNode): string {
  if (isJsonContainer(node)) return containerSummary(node);
  if (node.type !== 'string') return node.raw;
  const value: unknown = JSON.parse(node.raw);
  return typeof value === 'string' ? value : node.raw;
}

export function visibleJsonNodes(
  root: JsonSourceNode,
  expanded: ReadonlySet<string>,
): VisibleJsonNodes {
  const rootItem: VisibleJsonNode = { node: root, parent: null, position: 1, setSize: 1 };
  const result: VisibleJsonNodes = [rootItem];
  const visit = (item: VisibleJsonNode) => {
    if (!isJsonContainer(item.node) || !expanded.has(formatJsonPath(item.node.path))) return;
    item.node.children.forEach((child, index) => {
      const next: VisibleJsonNode = {
        node: child,
        parent: item.node,
        position: index + 1,
        setSize: item.node.children.length,
      };
      result.push(next);
      visit(next);
    });
  };
  visit(rootItem);
  return result;
}
