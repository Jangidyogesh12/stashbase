/** A sent prompt's body, folded with a Show more control once it runs well
 *  past a screenful, so one long brief does not push the conversation away. */
import { useState, type ReactNode } from 'react';

import { focusRing } from '@/lib/focus-ring';
import { useMeasuredSize } from '@/lib/use-measured-size';
import { cn } from '@/lib/utils';

/** A long prompt folds to this height; one that overflows it by less than a
 *  couple of lines stays open, since hiding two lines saves nothing. */
const COLLAPSED_PROMPT_PX = 288;
const COLLAPSE_SLACK_PX = 48;

export function CollapsibleUserText({ children }: { children: ReactNode }) {
  const content = useMeasuredSize<HTMLDivElement>();
  const [expanded, setExpanded] = useState(false);
  const long = (content.size ?? 0) > COLLAPSED_PROMPT_PX + COLLAPSE_SLACK_PX;
  const folded = long && !expanded;
  return (
    <>
      <div
        className={cn(
          'overflow-hidden',
          folded && '[mask-image:linear-gradient(to_bottom,black_70%,transparent)]',
        )}
        style={folded ? { maxHeight: COLLAPSED_PROMPT_PX } : undefined}
      >
        <div ref={content.ref}>{children}</div>
      </div>
      {long && (
        <button
          aria-expanded={expanded}
          className={cn(
            'mt-1 block font-medium opacity-75 transition-opacity duration-fast outline-none hover:opacity-100',
            focusRing('focus-visible:ring-offset-0'),
          )}
          onClick={() => setExpanded((open) => !open)}
          type="button"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </>
  );
}
