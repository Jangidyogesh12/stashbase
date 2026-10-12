import type { ComponentProps } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** The strip a document view raises above its content: a notice, and
 *  usually the one action that answers it. Callers lay out its contents. */
export function DocumentBanner({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div className={cn('border-b border-border px-4 py-2 text-caption', className)} {...props} />
  );
}

/** A refresh that failed over a preview still on screen. */
export function RefreshFailedBanner({ onRetry }: { onRetry: () => void }) {
  return (
    <DocumentBanner className="flex items-center justify-between gap-3">
      <span role="status">Refresh failed. Showing the last loaded preview.</span>
      <Button onClick={onRetry} size="compact" variant="tertiary">
        Retry
      </Button>
    </DocumentBanner>
  );
}
