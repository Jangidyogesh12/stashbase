import { TextQuote } from 'lucide-react';
import type { ReactNode } from 'react';

import { Tooltip } from '@/components/ui/tooltip';
import {
  contextItemName,
  passageExcerpt,
  passageLocatable,
  type AgentContextItem,
} from '@/features/agent/domain/context';
import { focusRing } from '@/lib/focus-ring';
import { useShape } from '@/lib/shape-context';
import { cn } from '@/lib/utils';
import type { SourceReference } from '@/shared/domain/source-reference';

import { CHIP_FRAME, ChipCloseButton } from './chip';

/** A selected passage: the source chip's frame with a quote glyph, the file
 *  name, and the passage's first words; the whole quote is its tooltip. In a
 *  draft it carries its own remove. */
export function PassageChip({
  item,
  onOpenSource,
  onRemove,
  reason,
  status,
}: {
  item: Extract<AgentContextItem, { kind: 'passage' }>;
  reason?: string | null | undefined;
  status?: ReactNode;
  onOpenSource?:
    | ((source: SourceReference, phrase: string | null, quoteFormat?: 'markdown') => void)
    | undefined;
  onRemove?: (() => void) | undefined;
}) {
  const shape = useShape();
  const name = contextItemName(item);
  const locatable = passageLocatable(item.source);
  const content = (
    <>
      <TextQuote aria-hidden="true" className="shrink-0 text-muted-foreground" size={14} />
      <span className="max-w-32 shrink-0 truncate text-foreground">{name}</span>
      <span className="min-w-0 truncate text-muted-foreground">{passageExcerpt(item.quote)}</span>
      {status}
    </>
  );
  return (
    <div
      className={cn(CHIP_FRAME, 'max-w-72', onRemove ? 'pr-0' : 'pr-2.5', shape.bg)}
      title={reason ?? `${item.source.path}\n\n${item.quote}`}
    >
      {onOpenSource ? (
        <button
          aria-label={`${locatable ? 'Locate passage in' : 'Open'} ${name}: ${passageExcerpt(item.quote)}`}
          className={cn(
            'inline-flex h-full min-w-0 cursor-pointer items-center gap-1.5 pl-2 outline-none',
            shape.bg,
            focusRing(),
          )}
          onClick={() =>
            locatable
              ? onOpenSource(item.source, item.quote, 'markdown')
              : onOpenSource(item.source, null)
          }
          type="button"
        >
          {content}
        </button>
      ) : (
        <span className="inline-flex min-w-0 items-center gap-1.5 pl-2">{content}</span>
      )}
      {onRemove && (
        <Tooltip content="Remove" side="top">
          <ChipCloseButton label={`Remove ${name}`} onClick={onRemove} />
        </Tooltip>
      )}
    </div>
  );
}
