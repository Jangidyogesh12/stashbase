/** Matching nodes in a parsed JSON outline: the Find controller's index. */
import { findTextMatches } from './find-text';
import { formatJsonPath, type JsonSourceNode } from './json-source';
import type { FindOptions } from './location';

export function matchingJsonTreeNodes(
  root: JsonSourceNode,
  query: string,
  options: FindOptions,
): JsonSourceNode[] {
  if (!query) return [];
  return flattenNodes(root).filter(
    (node) => findTextMatches(treeSearchText(node), query, options).length > 0,
  );
}

function flattenNodes(root: JsonSourceNode): JsonSourceNode[] {
  return [root, ...root.children.flatMap(flattenNodes)];
}

function treeSearchText(node: JsonSourceNode): string {
  return `${node.key ?? ''}\n${node.type === 'object' || node.type === 'array' ? '' : node.raw}\n${formatJsonPath(node.path)}`;
}
