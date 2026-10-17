/** The thinking level as a slider: the levels a model ranks from less
 *  thinking to more, and how each one reads. */
import { Slider } from '@base-ui/react/slider';

import { FOCUS_RING_FALLBACK } from '@/lib/focus-ring';
import { cn } from '@/lib/utils';

export function effortLabel(effort: string): string {
  return effort
    .replace(/^xhigh$/u, 'Extra high')
    .replace(/[-_]+/gu, ' ')
    .replace(/^./u, (letter) => letter.toUpperCase());
}

/** Levels that rank from less thinking to more, in that order. A runtime may
 *  also offer a level that does not rank (Auto), which the slider cannot
 *  place; it is offered beside the slider instead. */
const LEVEL_ORDER = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

export function rankedLevels(efforts: readonly string[]): {
  ranked: readonly string[];
  unranked: readonly string[];
} {
  const known = efforts.filter((effort) => LEVEL_ORDER.includes(effort.toLowerCase()));
  // One ranked level is no range to slide along; it is offered as a choice.
  if (known.length < 2) return { ranked: [], unranked: efforts };
  return {
    ranked: known.toSorted(
      (a, b) => LEVEL_ORDER.indexOf(a.toLowerCase()) - LEVEL_ORDER.indexOf(b.toLowerCase()),
    ),
    unranked: efforts.filter((effort) => !known.includes(effort)),
  };
}

function effortDescription(effort: string): string | undefined {
  switch (effort.toLowerCase()) {
    case 'low':
      return 'Faster';
    case 'medium':
      return 'Balanced';
    case 'high':
      return 'Deeper reasoning';
    case 'xhigh':
      return 'Deepest reasoning';
    case 'max':
      return 'Maximum reasoning';
    case 'ultra':
      return 'Maximum reasoning with delegation';
    default:
      return undefined;
  }
}

/** The level as a slider of the chosen model's ranked levels: a thin track
 *  with a stop for each, the thumb resting on the chosen one. It stays
 *  slight, so the model above it leads the panel. The
 *  panel above it names where the thumb is, live while it moves. A model
 *  that declares no default leaves the thumb unplaced until a level is
 *  chosen. */
export function ThinkingSlider({
  effort,
  onEffortChange,
  onMove,
  position,
  ranked,
}: {
  /** The level chosen now, or null for the model's default. */
  effort: string | null;
  onEffortChange(effort: string | null): void;
  onMove(position: number | null): void;
  position: number;
  ranked: readonly string[];
}) {
  const placed = position >= 0;
  const last = ranked.length - 1;
  const levelAt = (index: number) => ranked[Math.max(0, Math.min(last, index))];
  return (
    <Slider.Root
      max={last}
      min={0}
      // The pick lands on release, so a drag across four stops is one change.
      onValueChange={(value) => onMove(value)}
      onValueCommitted={(value) => {
        onMove(null);
        const next = levelAt(value);
        if (next !== undefined && next !== effort) onEffortChange(next);
      }}
      step={1}
      value={placed ? position : 0}
    >
      {/* The control is the hit area, taller than the track it draws, and
       *  pads it by the thumb's radius (`--thumb-r`) so the thumb's travel,
       *  and the stops, sit inside the track's rounded ends. The slider
       *  measures that padding out of its travel itself, which keeps the
       *  thumb visible before any layout is read. */}
      <Slider.Control className="relative flex h-6 w-full cursor-pointer touch-none items-center px-(--thumb-r) select-none [--thumb-r:9px]">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-1/2 h-2.5 -translate-y-1/2 rounded-full bg-muted"
        />
        <Slider.Track className="relative h-2.5 w-full">
          {/* One fill, pill-shaped at both ends: it reaches back over the
           *  control's padding to the track's own end, so its left end is
           *  the track's round end rather than a seam. */}
          {placed && (
            <Slider.Indicator className="-ml-(--thumb-r) box-content h-full rounded-full bg-foreground pl-(--thumb-r)" />
          )}
          {ranked.map((level, index) => (
            <span
              aria-hidden="true"
              className={cn(
                'pointer-events-none absolute top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full',
                placed && index <= position ? 'bg-background/60' : 'bg-muted-foreground/45',
              )}
              key={level}
              style={{ left: `${(index / last) * 100}%` }}
            />
          ))}
          <Slider.Thumb
            aria-label="Thinking"
            className={cn(
              'size-[calc(var(--thumb-r)*2)] rounded-full bg-card shadow-sm ring-1 ring-black/10 outline-none',
              // The app's focus colour, on the hairline the thumb already
              // draws: the focusable input is hidden inside it.
              FOCUS_RING_FALLBACK,
              'has-[:focus-visible]:ring-[color:var(--focus-ring,var(--focus-ring-fallback))]',
              // Unplaced, the thumb waits out of sight until focus or a
              // press puts it somewhere.
              !placed && 'opacity-0 has-[:focus-visible]:opacity-100',
            )}
            getAriaValueText={(_formatted, value) => {
              const level = levelAt(value);
              if (!placed || level === undefined) return 'Default';
              const description = effortDescription(level);
              return description === undefined
                ? effortLabel(level)
                : `${effortLabel(level)}, ${description}`;
            }}
          />
        </Slider.Track>
      </Slider.Control>
    </Slider.Root>
  );
}
