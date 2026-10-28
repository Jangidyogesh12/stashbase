/**
 * The JSON grid's row: a controlled view that reports selection and toggling
 * and decides neither. The outline only reads; edits happen in Source.
 */
import { ChevronDown, ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { TableCell, TableRow } from '@/components/ui/table';
import { formatJsonPath, type JsonSourceNode } from '@/features/documents/domain/json-source';
import { focusRing } from '@/lib/focus-ring';
import { cn } from '@/lib/utils';

import {
  isJsonContainer,
  jsonNodeDisplayValue,
  jsonNodeLabel,
  type VisibleJsonNode,
} from './tree-model';

function JsonKeyCell({
  isExpanded,
  node,
  onToggle,
}: {
  isExpanded: boolean;
  node: JsonSourceNode;
  onToggle(): void;
}) {
  const container = isJsonContainer(node);
  return (
    <div
      className="flex min-w-0 items-center gap-1 pr-4"
      style={{ paddingLeft: `${Math.max(0, node.path.length) * 16}px` }}
    >
      {container ? (
        <Button
          aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${formatJsonPath(node.path)}`}
          className="shrink-0"
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
          size="icon-compact"
          tabIndex={-1}
          type="button"
          variant="ghost"
        >
          {isExpanded ? <ChevronDown /> : <ChevronRight />}
        </Button>
      ) : (
        <span aria-hidden="true" className="size-7 shrink-0" />
      )}
      <span className="min-w-0 truncate text-foreground">{jsonNodeLabel(node)}</span>
    </div>
  );
}

export interface JsonValueRowProps {
  isExpanded: boolean;
  isSelected: boolean;
  item: VisibleJsonNode;
  onKeyDown(key: string, item: VisibleJsonNode, preventDefault: () => void): void;
  onSelect(node: JsonSourceNode): void;
  onToggle(node: JsonSourceNode): void;
  rowIndex: number;
  selectedRef: React.Ref<HTMLTableRowElement>;
}

export function JsonValueRow({
  isExpanded,
  isSelected,
  item,
  onKeyDown,
  onSelect,
  onToggle,
  rowIndex,
  selectedRef,
}: JsonValueRowProps) {
  const { node, position, setSize } = item;
  const container = isJsonContainer(node);

  return (
    <TableRow
      aria-expanded={container ? isExpanded : undefined}
      aria-level={node.path.length + 1}
      aria-posinset={position}
      aria-selected={isSelected}
      aria-setsize={setSize}
      className={cn(
        'cursor-default outline-none',
        isSelected && 'bg-hover [&>td]:text-foreground',
        focusRing('focus-visible:ring-inset'),
      )}
      data-json-node-row=""
      index={rowIndex}
      onClick={() => onSelect(node)}
      onKeyDown={(event) => onKeyDown(event.key, item, () => event.preventDefault())}
      ref={isSelected ? selectedRef : undefined}
      tabIndex={isSelected ? 0 : -1}
    >
      <TableCell>
        <JsonKeyCell isExpanded={isExpanded} node={node} onToggle={() => onToggle(node)} />
      </TableCell>
      <TableCell
        className={cn('truncate', node.type !== 'string' && 'text-foreground')}
        title={node.raw}
      >
        {jsonNodeDisplayValue(node)}
      </TableCell>
      <TableCell className="font-sans text-caption">{node.type}</TableCell>
    </TableRow>
  );
}
