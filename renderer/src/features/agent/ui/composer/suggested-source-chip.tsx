import { Plus } from 'lucide-react';

import { FileTypeIcon } from '@/components/ui/file-type-icon';
import { Tooltip } from '@/components/ui/tooltip';
import { focusRing } from '@/lib/focus-ring';
import { useShape } from '@/lib/shape-context';
import { cn } from '@/lib/utils';
import type { SourceReference } from '@/shared/domain/source-reference';
import { basePathName } from '@/shared/utils/file-path';

import { CHIP_FRAME, ChipCloseButton } from './chip';

/** The document in front of the reader, offered but never bound until the
 *  reader clicks it. It wears an attached chip's frame and close, so the row
 *  reads as one kind of thing; muted words and a leading plus are all that
 *  say it is only offered. */
export function SuggestedSourceChip({
  onAttach,
  onDismiss,
  source,
}: {
  onAttach: () => void;
  onDismiss: () => void;
  source: SourceReference;
}) {
  const shape = useShape();
  const name = basePathName(source.path);
  return (
    <div className={cn(CHIP_FRAME, 'max-w-64 shrink-0 text-muted-foreground', shape.bg)}>
      <Tooltip content={`Attach ${source.path}`} side="top">
        <button
          aria-label={`Attach ${name}`}
          className={cn(
            'inline-flex h-full min-w-0 cursor-pointer items-center gap-1.5 pr-1.5 pl-2 transition-colors duration-fast outline-none hover:text-foreground',
            shape.bg,
            focusRing(),
          )}
          onClick={onAttach}
          type="button"
        >
          <Plus aria-hidden="true" className="shrink-0" size={12} strokeWidth={2.5} />
          <FileTypeIcon aria-hidden="true" className="shrink-0" path={source.path} size={14} />
          <span className="min-w-0 truncate">{name}</span>
        </button>
      </Tooltip>
      <Tooltip content="Don't suggest" side="top">
        <ChipCloseButton label={`Don't suggest ${name}`} onClick={onDismiss} />
      </Tooltip>
    </div>
  );
}
