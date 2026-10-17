/** The composer's chip: a source or passage beside the draft, and the
 *  suggested source that is offered there. */
import { X } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes } from 'react';

import { focusRing } from '@/lib/focus-ring';
import { useShape } from '@/lib/shape-context';
import { cn } from '@/lib/utils';

/** Every chip's frame, at the composer's control height. A hairline on the
 *  composer's own paper, not a grey fill: a filled chip beside the draft
 *  read as a smudge. Callers add `shape.bg`, their width, and their padding. */
export const CHIP_FRAME = 'inline-flex h-7 items-center border border-border text-ui-12';

/** A chip's own remove: a quiet X inside the chip's frame, shared by the
 *  passage chip and the suggested source, rather than the tiles' dark badge,
 *  which sat over a chip's words. */
export const ChipCloseButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { label: string }
>(function ChipCloseButton({ className, label, onClick, ...props }, ref) {
  const shape = useShape();
  return (
    <button
      {...props}
      aria-label={label}
      className={cn(
        'mr-1 flex size-5 shrink-0 cursor-pointer items-center justify-center text-muted-foreground transition-colors duration-fast outline-none hover:bg-hover hover:text-foreground',
        shape.chip,
        focusRing(),
        className,
      )}
      // The event goes on to the caller's handler, which a Tooltip around
      // this button merges its own into, and stops here so the chip does not
      // answer the same press.
      onClick={(event) => {
        event.stopPropagation();
        onClick?.(event);
      }}
      ref={ref}
      type="button"
    >
      <X aria-hidden="true" size={12} />
    </button>
  );
});
