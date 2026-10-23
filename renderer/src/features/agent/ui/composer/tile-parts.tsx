/**
 * The parts every bound-context tile is drawn from: the square itself, the
 * state line under a name, and the remove badge a tile reveals on hover. The
 * draft and the sent row share them, so a tile is one thing in both places.
 */
import { X } from 'lucide-react';

import { Tooltip } from '@/components/ui/tooltip';
import type { ContextStatus } from '@/features/agent/domain/context';
import { focusRing } from '@/lib/focus-ring';
import { useShape } from '@/lib/shape-context';
import { cn } from '@/lib/utils';

import { STATUS_WORD } from './mention-widgets';

/** The square every tile shares with `FileThumbnail`: paper, a hairline with
 *  no fill, so the composer and the transcript show through around a glyph
 *  and an image sits on nothing grey. */
export function TileBox({
  children,
  className,
  size,
  title,
}: {
  children: React.ReactNode;
  className?: string;
  size: number;
  title?: string;
}) {
  const shape = useShape();
  return (
    <div
      className={cn(
        'relative shrink-0 overflow-hidden border border-border/50',
        shape.bg,
        className,
      )}
      style={{ height: size, width: size }}
      title={title}
    >
      {children}
    </div>
  );
}

/** State as form under the name: a dot and a word, never a colored tile. */
export function StatusLine({ status }: { status: Exclude<ContextStatus, 'ready'> }) {
  const alarming = status === 'stale' || status === 'failed';
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center gap-1 text-ui-10 leading-tight font-medium',
        alarming ? 'text-destructive' : 'text-muted-foreground',
      )}
    >
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
      {STATUS_WORD[status]}
    </span>
  );
}

/** The hover-revealed remove badge, the composer's own recipe: a fixed dark
 *  circle with a white X so it reads over any tile content. */
export function RemoveBadge({ name, onRemove }: { name: string; onRemove: () => void }) {
  return (
    <Tooltip content="Remove" side="top">
      <button
        aria-label={`Remove ${name}`}
        className={cn(
          'absolute top-1 right-1 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full bg-neutral-900 text-white opacity-0 transition-opacity duration-fast outline-none group-hover/tile:opacity-100 focus-visible:opacity-100',
          focusRing(),
        )}
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
        type="button"
      >
        <X size={12} strokeWidth={2.5} />
      </button>
    </Tooltip>
  );
}
