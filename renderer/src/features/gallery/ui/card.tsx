import type { GalleryEntry } from '@/features/gallery/domain/entry';
import { focusRing } from '@/lib/focus-ring';
import { useShape } from '@/lib/shape-context';
import { cn } from '@/lib/utils';

import { GalleryImage } from './image';

/**
 * One ready-made project on the shelf.
 *
 * The whole card is the affordance rather than a title link with a button
 * beside it: every card does exactly one thing, which is open its entry page,
 * and a second target inside it would only invite a copy nobody has read about
 * yet. Taking a copy is a decision the entry page asks for.
 *
 * A shelf is scanned, so at rest each card shows the picture, its category as
 * a small line above its name, and nothing else — a wall of paragraphs is a
 * list, not a shelf. The category sits above the name rather than beside it,
 * so the name keeps the whole width and truncates only when it must, and every
 * card's band is the same height whatever the name's length. The band sits
 * below the picture, not over it, because the cover is drawn to the frame's
 * 16:9 and shows the project's output edge to edge; the name is the band's job,
 * so the cover never carries it. The description is one pointer or one Tab
 * away, and it rises out of the band over the picture rather than below it: a
 * card that changed height on hover would shuffle every card after it across
 * the grid.
 */
export function GalleryCard({
  entry,
  onOpen,
}: {
  entry: GalleryEntry;
  onOpen(entry: GalleryEntry): void;
}) {
  const shape = useShape();
  const hero = entry.screenshot;
  return (
    <button
      className={cn(
        'group flex w-full cursor-pointer flex-col overflow-hidden border border-border bg-surface-2 text-left shadow-surface-2 transition-colors duration-fast outline-none hover:border-foreground/25',
        shape.card,
        focusRing(),
      )}
      onClick={() => onOpen(entry)}
      type="button"
    >
      <span className="relative aspect-video overflow-hidden">
        {hero && (
          <GalleryImage
            key={hero}
            alt=""
            className="absolute inset-0 size-full object-cover transition-transform duration-slow group-hover:scale-[1.03] motion-reduce:transition-none"
            loading="lazy"
            src={hero}
          />
        )}
      </span>
      <span className="relative flex flex-col gap-1 bg-surface-3 px-4 py-3">
        <span className="text-caption text-muted-foreground capitalize">{entry.category}</span>
        <span
          className="-mt-0.5 block min-w-0 truncate text-body font-medium text-foreground"
          title={entry.name}
        >
          {entry.name}
        </span>
        {/* Rows from nothing to content: the one way to animate a height CSS
         * has never been told. It reads after the name but draws above the
         * band, growing up over the picture. Focus opens it too, so the
         * description is not pointer-only. */}
        <span
          className={cn(
            'absolute inset-x-0 bottom-full grid grid-rows-[0fr] bg-surface-3 transition-[grid-template-rows] duration-base',
            'group-hover:grid-rows-[1fr] group-focus-visible:grid-rows-[1fr]',
            'motion-reduce:transition-none',
          )}
        >
          <span className="overflow-hidden">
            {/* No `block` beside the clamp: `line-clamp-2` sets its own
                display (-webkit-box), and Tailwind emits `.block` after it, so
                a display utility here silently unclamps the description and
                the card grows a paragraph over its picture. */}
            <span className="line-clamp-2 px-4 pt-3 text-caption text-muted-foreground">
              {entry.description}
            </span>
          </span>
        </span>
      </span>
    </button>
  );
}
