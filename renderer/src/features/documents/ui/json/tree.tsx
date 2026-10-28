/**
 * The JSON outline: a read-only treegrid over the parsed source.
 *
 * It holds no copy of the document, only which row is selected and which
 * containers are open, and those live in the tab's session. Edits happen in
 * Source. Row rendering lives in `tree-rows`, the projection in `tree-model`,
 * and the keyboard contract in `tree-keyboard`.
 */
import { useMemo, useRef } from 'react';

import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { JsonDocumentSession } from '@/features/documents/domain/document';
import {
  analyzeJsonSource,
  formatJsonPath,
  type JsonSourceNode,
} from '@/features/documents/domain/json-source';

import { jsonTreeKeyCommand } from './tree-keyboard';
import { visibleJsonNodes, type VisibleJsonNode } from './tree-model';
import { JsonValueRow } from './tree-rows';

export interface JsonTreeProps {
  hidden?: boolean;
  onSessionChange(patch: Partial<JsonDocumentSession>): void;
  session: JsonDocumentSession;
  source: string;
}

export function JsonTree({ hidden = false, onSessionChange, session, source }: JsonTreeProps) {
  const analysis = useMemo(() => analyzeJsonSource(source), [source]);
  const selectedRef = useRef<HTMLTableRowElement | null>(null);

  if (!analysis.available) {
    return (
      <section
        aria-label="JSON outline"
        className="flex min-h-0 min-w-0 flex-1 items-center justify-center px-6 py-10 text-center"
        hidden={hidden}
      >
        <p className="max-w-sm text-body text-muted-foreground" role="status">
          {analysis.message}
        </p>
      </section>
    );
  }

  const expanded = new Set(session.expandedPaths);
  const visible = visibleJsonNodes(analysis.root, expanded);
  const selectedIndex = Math.max(
    0,
    visible.findIndex(({ node }) => formatJsonPath(node.path) === session.selectedPath),
  );
  const selectedPath = formatJsonPath((visible[selectedIndex] ?? visible[0]).node.path);

  // Only the reader's own keystrokes move focus; a selection made from
  // elsewhere, such as Find, leaves focus where the reader is typing.
  const selectNode = (node: JsonSourceNode, focus = false) => {
    onSessionChange({ selectedPath: formatJsonPath(node.path) });
    if (focus) queueMicrotask(() => selectedRef.current?.focus({ preventScroll: true }));
  };
  const toggleNode = (node: JsonSourceNode) => {
    const path = formatJsonPath(node.path);
    const next = new Set(expanded);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    onSessionChange({ expandedPaths: [...next] });
  };
  const onRowKeyDown = (key: string, item: VisibleJsonNode, preventDefault: () => void) => {
    const command = jsonTreeKeyCommand(key, { expanded, item, visible });
    if (!command) return;
    preventDefault();
    if (command.kind === 'select') selectNode(command.node, true);
    else if (command.kind === 'toggle') toggleNode(command.node);
  };

  return (
    <section
      aria-label="JSON outline"
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      data-json-tree=""
      hidden={hidden}
    >
      <ScrollArea className="min-h-0 flex-1" orientation="both">
        <div className="min-w-[30rem] pb-4">
          <Table
            aria-label="JSON values"
            className="table-fixed font-mono"
            role="treegrid"
            selectedIndex={selectedIndex}
            size="compact"
          >
            <colgroup>
              <col className="w-[36%]" />
              <col className="w-[44%]" />
              <col />
            </colgroup>
            <TableHeader className="sticky top-0 z-10 bg-surface-2 font-sans text-caption">
              <TableRow>
                <TableHead className="pl-10" scope="col">
                  Key
                </TableHead>
                <TableHead scope="col">Value</TableHead>
                <TableHead scope="col">Type</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((item, rowIndex) => {
                const path = formatJsonPath(item.node.path);
                return (
                  <JsonValueRow
                    isExpanded={expanded.has(path)}
                    isSelected={path === selectedPath}
                    item={item}
                    key={path}
                    onKeyDown={onRowKeyDown}
                    onSelect={selectNode}
                    onToggle={toggleNode}
                    rowIndex={rowIndex}
                    selectedRef={selectedRef}
                  />
                );
              })}
            </TableBody>
          </Table>
        </div>
      </ScrollArea>
    </section>
  );
}
