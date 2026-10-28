/**
 * Keyboard navigation for the JSON grid, resolved as pure data.
 *
 * The row handler asks what a key means for the row it fired on and applies
 * the answer, so the treegrid's arrow/Home/End contract can be read and tested
 * without a DOM.
 */
import { formatJsonPath, type JsonSourceNode } from '@/features/documents/domain/json-source';
import { listNavigationTarget } from '@/shared/utils/list-cursor';

import { isJsonContainer, type VisibleJsonNode } from './tree-model';

type JsonTreeCommand =
  /** Handled, but nothing moves — the edge of the list. */
  | { kind: 'none' }
  | { kind: 'select'; node: JsonSourceNode }
  | { kind: 'toggle'; node: JsonSourceNode };

export interface JsonTreeKeyContext {
  expanded: ReadonlySet<string>;
  item: VisibleJsonNode;
  visible: readonly VisibleJsonNode[];
}

function moved(node: JsonSourceNode | null | undefined): JsonTreeCommand {
  return node ? { kind: 'select', node } : { kind: 'none' };
}

/** `null` means the key belongs to the browser, not the grid. Every key the
 *  grid takes is consumed, so the page never scrolls under the cursor. */
export function jsonTreeKeyCommand(
  key: string,
  { expanded, item, visible }: JsonTreeKeyContext,
): JsonTreeCommand | null {
  const index = visible.indexOf(item);
  const container = isJsonContainer(item.node);
  const path = formatJsonPath(item.node.path);

  // Down, up, and the ends are the same cursor every list in the app runs; the
  // grid owns only the keys that are about being a tree. It declares no page
  // size, so a page key stays the browser's, as it is in the folder tree.
  const linear = listNavigationTarget(key, { activeIndex: index, count: visible.length });
  if (linear !== null) return moved(visible[linear]?.node);
  if (key === 'ArrowRight' && container) {
    return expanded.has(path) ? moved(item.node.children[0]) : { kind: 'toggle', node: item.node };
  }
  if (key === 'ArrowLeft') {
    return container && expanded.has(path)
      ? { kind: 'toggle', node: item.node }
      : moved(item.parent);
  }
  return null;
}
